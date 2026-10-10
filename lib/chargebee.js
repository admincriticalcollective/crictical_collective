const MAX_PAGES = 10
const MAX_RETRIEVALS = 10

export function subscriptionGrantsPremium(subscription, customerId, priceIds, now) {
  return Boolean(
    subscription &&
    subscription.customer_id === customerId &&
    subscription.deleted === false &&
    subscription.decommissioned !== true &&
    ['active', 'non_renewing'].includes(subscription.status) &&
    Number.isFinite(now) &&
    Number.isSafeInteger(subscription.current_term_start) &&
    Number.isSafeInteger(subscription.current_term_end) &&
    subscription.current_term_start <= now && now < subscription.current_term_end &&
    (subscription.due_invoices_count ?? 0) === 0 &&
    (subscription.total_dues ?? 0) === 0 &&
    subscription.due_since == null &&
    Array.isArray(subscription.subscription_items) &&
    subscription.subscription_items.some(item =>
      item?.item_type === 'plan' && priceIds.includes(item.item_price_id)),
  )
}

export function createPremiumChecker({
  site,
  apiKey,
  priceIds,
  fetchImpl = fetch,
  clock = () => Date.now() / 1000,
}) {
  return async function hasPremiumAccess(memberId) {
    if (!site && !apiKey && !priceIds.length) return false
    if (!site || !/^[a-z0-9][a-z0-9-]*$/.test(site) || !apiKey || !priceIds.length) {
      throw new Error('Chargebee configuration is incomplete')
    }
    if (typeof memberId !== 'string' || !/^mem_[A-Za-z0-9_-]+$/.test(memberId) || memberId.length > 50) {
      throw new Error('Invalid billing identity')
    }

    const signal = AbortSignal.timeout(8000)
    const baseUrl = `https://${site}.chargebee.com/api/v2/`
    const headers = {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      Accept: 'application/json',
    }
    async function get(path, params) {
      signal.throwIfAborted()
      const url = new URL(path, baseUrl)
      if (params) url.search = params.toString()
      const response = await fetchImpl(url, {headers, signal, redirect: 'error', cache: 'no-store'})
      if (!response.ok) throw new Error('Chargebee lookup failed')
      return response.json()
    }

    let offset
    let retrievals = 0
    const visited = new Set()
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        limit: '100',
        'customer_id[is]': memberId,
        'item_price_id[in]': JSON.stringify(priceIds),
        'status[in]': JSON.stringify(['active', 'non_renewing']),
        include_deleted: 'false',
      })
      if (offset) params.set('offset', offset)
      const result = await get('subscriptions', params)
      if (!Array.isArray(result?.list)) throw new Error('Invalid Chargebee response')

      for (const entry of result.list) {
        const candidate = entry?.subscription
        if (!candidate || candidate.customer_id !== memberId) continue
        if (typeof candidate.id !== 'string' || !candidate.id) {
          throw new Error('Missing subscription identity')
        }
        retrievals += 1
        if (retrievals > MAX_RETRIEVALS) throw new Error('Subscription lookup limit exceeded')
        const current = await get(`subscriptions/${encodeURIComponent(candidate.id)}`)
        if (current?.subscription?.id === candidate.id &&
            subscriptionGrantsPremium(current.subscription, memberId, priceIds, clock())) {
          return true
        }
      }

      if (result.next_offset === undefined || result.next_offset === null) return false
      if (typeof result.next_offset !== 'string' || !result.next_offset ||
          result.next_offset.length > 1000 || visited.has(result.next_offset)) {
        throw new Error('Invalid Chargebee pagination')
      }
      offset = result.next_offset
      visited.add(offset)
    }
    throw new Error('Subscription page limit exceeded')
  }
}