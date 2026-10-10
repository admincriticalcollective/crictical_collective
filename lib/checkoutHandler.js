import {CheckoutError} from './checkout.js'

export function createCheckoutHandler({
  authenticate, checkout, allowedOrigins,
  logError = code => console.error('checkout request failed', {code}),
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('CDN-Cache-Control', 'no-store')
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
    res.setHeader('Vary', 'Origin, Authorization')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (!allowedOrigins.length) return res.status(503).json({error: 'checkout_not_configured'})
    const origin = req.headers?.origin
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({error: 'origin_not_allowed'})
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') return res.status(204).end()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      return res.status(405).json({error: 'method_not_allowed'})
    }
    const authorization = req.headers?.authorization
    const token = typeof authorization === 'string' && /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
    if (!token) return res.status(401).json({error: 'login_required'})
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) {
      return res.status(415).json({error: 'json_required'})
    }
    let body = req.body
    if (typeof body === 'string') {
      if (body.length > 1024) return res.status(400).json({error: 'invalid_checkout_request'})
      try { body = JSON.parse(body) } catch {
        return res.status(400).json({error: 'invalid_checkout_request'})
      }
    }
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
        Object.keys(body).length !== 2 ||
        !['INR', 'USD'].includes(body.currency) ||
        typeof body.requestId !== 'string' || body.requestId.length !== 36 ||
        !Object.keys(body).every(key => ['currency', 'requestId'].includes(key))) {
      return res.status(400).json({error: 'invalid_checkout_request'})
    }
    try {
      const member = await authenticate(token)
      if (!member?.id) return res.status(401).json({error: 'invalid_session'})
      const result = await checkout(member.id, body.currency, body.requestId)
      return res.status(200).json({url: result.url})
    } catch (error) {
      const known = error instanceof CheckoutError
      const code = known ? error.code : 'checkout_unavailable'
      const status = known ? error.status : 503
      if (status >= 500) logError(code)
      return res.status(status).json({error: code})
    }
  }
}