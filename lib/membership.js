import {createHash} from 'node:crypto'

const TOKEN_PATTERN = /^Bearer\s+(\S+)$/i

function applyHeaders(req, res, allowedOrigins, methods) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('CDN-Cache-Control', 'no-store')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  res.setHeader('Vary', 'Origin, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!allowedOrigins.length) {
    res.status(503).json({error: 'not_configured'})
    return false
  }
  const origin = req.headers?.origin
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({error: 'origin_not_allowed'})
    return false
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`)
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return false
  }
  if (!methods.split(', ').includes(req.method)) {
    res.setHeader('Allow', `${methods}, OPTIONS`)
    res.status(405).json({error: 'method_not_allowed'})
    return false
  }
  return true
}

function bearerToken(req) {
  const authorization = req.headers?.authorization
  return typeof authorization === 'string' ? TOKEN_PATTERN.exec(authorization)?.[1] : undefined
}

// GET /api/me -> {premium: boolean} for the verified member.
export function createMeHandler({authenticate, hasPremiumAccess, allowedOrigins, logError = () => {}}) {
  return async function handler(req, res) {
    if (!applyHeaders(req, res, allowedOrigins, 'GET')) return
    const token = bearerToken(req)
    if (!token) return res.status(401).json({error: 'login_required'})
    try {
      const member = await authenticate(token)
      if (!member?.id) return res.status(401).json({error: 'invalid_session'})
      const premium = await hasPremiumAccess(member.id)
      return res.status(200).json({premium: premium === true})
    } catch {
      logError()
      return res.status(503).json({error: 'status_unavailable'})
    }
  }
}

export function createPortalSession({site, apiKey, returnUrl, allowedOrigins, fetchImpl = fetch}) {
  return async function openPortal(memberId) {
    let destination
    try { destination = new URL(returnUrl) } catch {}
    if (!site || !/^[a-z0-9][a-z0-9-]*$/.test(site) || !apiKey || !destination ||
        destination.protocol !== 'https:' || destination.username || destination.password ||
        !allowedOrigins.includes(destination.origin) || returnUrl.length > 250) {
      throw new Error('portal_not_configured')
    }
    if (typeof memberId !== 'string' || memberId.length > 50 || !/^mem_[A-Za-z0-9_-]+$/.test(memberId)) {
      throw new Error('invalid_session')
    }
    const body = new URLSearchParams({'customer[id]': memberId, redirect_url: returnUrl})
    const response = await fetchImpl(new URL('portal_sessions', `https://${site}.chargebee.com/api/v2/`), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'chargebee-idempotency-key': createHash('sha256')
          .update(JSON.stringify([site, memberId, Math.floor(Date.now() / 60000)])).digest('hex'),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error('portal_unavailable')
    const session = result?.portal_session
    let url
    try { url = new URL(session?.access_url) } catch {}
    if (session?.customer_id !== memberId || !url || url.protocol !== 'https:' ||
        url.username || url.password || !/\.chargebee(?:portal)?\.com$/.test(url.hostname)) {
      throw new Error('portal_unavailable')
    }
    return {url: url.href}
  }
}

// POST /api/portal -> {url} to Chargebee self-serve portal; premium members only.
export function createPortalHandler({authenticate, hasPremiumAccess, openPortal, allowedOrigins, logError = () => {}}) {
  return async function handler(req, res) {
    if (!applyHeaders(req, res, allowedOrigins, 'POST')) return
    const token = bearerToken(req)
    if (!token) return res.status(401).json({error: 'login_required'})
    try {
      const member = await authenticate(token)
      if (!member?.id) return res.status(401).json({error: 'invalid_session'})
      if (await hasPremiumAccess(member.id) !== true) {
        return res.status(403).json({error: 'premium_required'})
      }
      const {url} = await openPortal(member.id)
      return res.status(200).json({url})
    } catch (error) {
      const code = ['portal_not_configured', 'invalid_session'].includes(error?.message)
        ? error.message : 'portal_unavailable'
      if (code === 'invalid_session') return res.status(401).json({error: code})
      logError(code)
      return res.status(503).json({error: code})
    }
  }
}