import {createHash} from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')

export class CheckoutError extends Error {
  constructor(code, status = 503) {
    super(code)
    this.code = code
    this.status = status
  }
}

export function createCheckout({
  site, apiKey, prices, returnUrl, allowedOrigins, enabled = false,
  fetchImpl = fetch,
}) {
  return async function checkout(memberId, currency, requestId) {
    let destination
    try { destination = new URL(returnUrl) } catch {}
    if (!enabled || !site || !/^[a-z0-9][a-z0-9-]*$/.test(site) ||
        !apiKey || !destination || destination.protocol !== 'https:' ||
        destination.username || destination.password ||
        !allowedOrigins.includes(destination.origin) ||
        returnUrl.length > 250 || !prices?.INR || !prices?.USD ||
        prices.INR === prices.USD) {
      throw new CheckoutError('checkout_not_configured')
    }
    if (typeof memberId !== 'string' || memberId.length > 50 ||
        !/^mem_[A-Za-z0-9_-]+$/.test(memberId)) {
      throw new CheckoutError('invalid_session', 401)
    }
    if (!['INR', 'USD'].includes(currency) ||
        typeof requestId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new CheckoutError('invalid_checkout_request', 400)
    }

    const baseUrl = `https://${site}.chargebee.com/api/v2/`
    const signal = AbortSignal.timeout(12000)
    async function call(path, params, allowMissing = false) {
      signal.throwIfAborted()
      const body = params?.toString()
      const headers = {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        Accept: 'application/json',
      }
      if (body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        headers['chargebee-idempotency-key'] = digest(
          JSON.stringify([site, memberId, requestId, path, body]),
        )
      }
      const response = await fetchImpl(new URL(path, baseUrl), {
        method: body ? 'POST' : 'GET', headers, body, signal,
        redirect: 'error', cache: 'no-store',
      })
      const result = await response.json()
      if (allowMissing && response.status === 404 &&
          result?.api_error_code === 'resource_not_found') return null
      if (!response.ok) {
        throw new CheckoutError(
          response.status === 409 ? 'checkout_in_progress' : 'checkout_unavailable',
          response.status === 409 ? 409 : 503,
        )
      }
      return result
    }

    const subscriptionId = `cc_${digest(memberId).slice(0, 40)}`
    const current = await call(`subscriptions/${subscriptionId}`, undefined, true)
    if (current) {
      if (current.subscription?.id !== subscriptionId ||
          current.subscription?.customer_id !== memberId) {
        throw new CheckoutError('checkout_unavailable')
      }
      throw new CheckoutError('subscription_exists', 409)
    }
    const query = new URLSearchParams({
      'customer_id[is]': memberId, include_deleted: 'false', limit: '1',
    })
    const existing = await call(`subscriptions?${query}`)
    if (!Array.isArray(existing?.list)) throw new CheckoutError('checkout_unavailable')
    if (existing.list.length || existing.next_offset) {
      throw new CheckoutError('subscription_exists', 409)
    }

    const customerPath = `customers/${encodeURIComponent(memberId)}`
    let customer = await call(customerPath, undefined, true)
    if (!customer) {
      try {
        customer = await call('customers', new URLSearchParams({
          id: memberId, auto_collection: 'on', net_term_days: '0',
        }))
      } catch (error) {
        customer = await call(customerPath, undefined, true)
        if (!customer) throw error
      }
    }
    if (customer.customer?.id !== memberId || customer.customer?.deleted !== false) {
      throw new CheckoutError('checkout_unavailable')
    }

    const result = await call('hosted_pages/checkout_new_for_items', new URLSearchParams({
      'customer[id]': memberId,
      'subscription[id]': subscriptionId,
      'subscription[trial_end]': '0',
      'subscription[auto_collection]': 'on',
      'subscription_items[item_price_id][0]': prices[currency],
      'subscription_items[quantity][0]': '1',
      layout: 'full_page',
      allow_offline_payment_methods: 'false',
      redirect_url: returnUrl,
      cancel_url: returnUrl,
    }))
    const page = result?.hosted_page
    let url
    try { url = new URL(page?.url) } catch {}
    if (!page?.id || page.type !== 'checkout_new' ||
        !['created', 'requested'].includes(page.state) ||
        !url || url.origin !== `https://${site}.chargebee.com` ||
        url.username || url.password || !url.pathname.startsWith('/pages/')) {
      throw new CheckoutError('checkout_unavailable')
    }
    return {url: url.href}
  }
}