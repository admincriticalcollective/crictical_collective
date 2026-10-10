import assert from 'node:assert/strict'
import test from 'node:test'
import {createCheckout} from '../lib/checkout.js'

const memberId = 'mem_verified'
const requestId = '12345678-1234-4123-8123-123456789abc'
const origin = 'https://publication.example'
const prices = {INR: 'cc-premium-INR-yearly', USD: 'cc-premium-USD-Yearly'}
const missing = {status: 404, data: {api_error_code: 'resource_not_found'}}
const customer = {customer: {id: memberId, deleted: false}}
const page = {hosted_page: {
  id: 'page-test', type: 'checkout_new', state: 'created',
  url: 'https://publication-test.chargebee.com/pages/v4/page-test/',
}}

function setup(overrides = {}, results = [missing, {list: []}, customer, page]) {
  const calls = []
  const checkout = createCheckout({
    enabled: true, site: 'publication-test', apiKey: 'test-fixture',
    prices, returnUrl: `${origin}/`, allowedOrigins: [origin],
    fetchImpl: async (url, options) => {
      calls.push({url, ...options})
      const result = results.shift()
      assert.ok(result, `Unexpected request: ${url.pathname}`)
      const status = result.status || 200
      return {ok: status < 400, status, json: async () => result.data || result}
    },
    ...overrides,
  })
  return {checkout, calls}
}

for (const currency of ['INR', 'USD']) {
  test(`checkout maps ${currency} to the exact server-owned price`, async () => {
    const {checkout, calls} = setup()
    assert.deepEqual(await checkout(memberId, currency, requestId), {url: page.hosted_page.url})
    const params = new URLSearchParams(calls.at(-1).body)
    assert.equal(params.get('customer[id]'), memberId)
    assert.equal(params.get('subscription_items[item_price_id][0]'), prices[currency])
    assert.equal(params.get('subscription[trial_end]'), '0')
    assert.equal(params.get('layout'), 'full_page')
    assert.equal(params.get('redirect_url'), `${origin}/`)
    assert.equal(params.get('cancel_url'), `${origin}/`)
    assert.equal(params.get('allow_offline_payment_methods'), 'false')
    assert.equal(params.has('subscription_items[unit_price][0]'), false)
    assert.equal(calls[1].url.searchParams.get('customer_id[is]'), memberId)
    for (const call of calls) {
      assert.equal(call.redirect, 'error')
      assert.equal(call.cache, 'no-store')
      assert.ok(call.signal instanceof AbortSignal)
    }
  })
}

test('creates a missing customer before asking checkout to reuse its ID', async () => {
  const {checkout, calls} = setup({}, [missing, {list: []}, missing, customer, page])
  await checkout(memberId, 'INR', requestId)
  assert.equal(calls[3].url.pathname, '/api/v2/customers')
  assert.equal(new URLSearchParams(calls[3].body).get('id'), memberId)
  assert.equal(calls[4].url.pathname, '/api/v2/hosted_pages/checkout_new_for_items')
})

test('customer create race rechecks the exact ID', async () => {
  const {checkout, calls} = setup({}, [missing, {list: []}, missing,
    {status: 409, data: {}}, customer, page])
  await checkout(memberId, 'INR', requestId)
  assert.equal(calls[4].url.pathname, `/api/v2/customers/${memberId}`)
})

test('fixed subscription ID survives different requests and currency choices', async () => {
  const first = setup()
  const second = setup()
  await first.checkout(memberId, 'INR', requestId)
  await second.checkout(memberId, 'USD', '22345678-1234-4123-8123-123456789abc')
  assert.equal(new URLSearchParams(first.calls.at(-1).body).get('subscription[id]'),
    new URLSearchParams(second.calls.at(-1).body).get('subscription[id]'))
})

test('retries with identical input send identical idempotency keys', async () => {
  const first = setup()
  const second = setup()
  await first.checkout(memberId, 'INR', requestId)
  await second.checkout(memberId, 'INR', requestId)
  assert.equal(first.calls.at(-1).headers['chargebee-idempotency-key'],
    second.calls.at(-1).headers['chargebee-idempotency-key'])
})

test('an existing subscription blocks a new purchase', async () => {
  const {checkout, calls} = setup({}, [missing, {list: [{subscription: {id: 'legacy'}}]}])
  await assert.rejects(checkout(memberId, 'INR', requestId), {code: 'subscription_exists'})
  assert.equal(calls.length, 2)
})

test('direct lookup blocks a newly created subscription before list indexing', async () => {
  const first = setup()
  await first.checkout(memberId, 'INR', requestId)
  const subscriptionId = new URLSearchParams(first.calls.at(-1).body).get('subscription[id]')
  const {checkout, calls} = setup({}, [{subscription: {
    id: subscriptionId, customer_id: memberId, status: 'active',
  }}])
  await assert.rejects(checkout(memberId, 'USD', requestId), {code: 'subscription_exists'})
  assert.equal(calls.length, 1)
})

for (const overrides of [
  {enabled: false}, {apiKey: ''}, {site: 'evil.example/path'},
  {returnUrl: 'https://attacker.example'}, {returnUrl: 'http://publication.example/'},
  {returnUrl: 'https://user:password@publication.example/'}, {prices: {}},
  {prices: {INR: 'same', USD: 'same'}},
]) {
  test(`invalid checkout configuration denies before network: ${JSON.stringify(overrides)}`, async () => {
    const {checkout, calls} = setup(overrides)
    await assert.rejects(checkout(memberId, 'INR', requestId), {code: 'checkout_not_configured'})
    assert.equal(calls.length, 0)
  })
}

for (const args of [
  ['mem_other/../verified', 'INR', requestId],
  [memberId, 'EUR', requestId], [memberId, '__proto__', requestId],
  [memberId, 'INR', 'invalid'],
]) {
  test(`invalid input denies before network: ${JSON.stringify(args)}`, async () => {
    const {checkout, calls} = setup()
    await assert.rejects(checkout(...args))
    assert.equal(calls.length, 0)
  })
}

for (const invalidCustomer of [
  {customer: {id: 'mem_other', deleted: false}},
  {customer: {id: memberId, deleted: true}}, {},
]) {
  test(`invalid customer prevents checkout: ${JSON.stringify(invalidCustomer)}`, async () => {
    const {checkout, calls} = setup({}, [missing, {list: []}, invalidCustomer])
    await assert.rejects(checkout(memberId, 'INR', requestId))
    assert.equal(calls.length, 3)
  })
}

test('upstream failure does not create customer or checkout', async () => {
  const {checkout, calls} = setup({}, [{status: 500, data: {error: 'private'}}])
  await assert.rejects(checkout(memberId, 'INR', requestId), {code: 'checkout_unavailable'})
  assert.equal(calls.length, 1)
})

for (const url of ['https://attacker.example/pages/x',
  'http://publication-test.chargebee.com/pages/x',
  'https://user:secret@publication-test.chargebee.com/pages/x']) {
  test(`untrusted hosted URL is not returned: ${url}`, async () => {
    const {checkout} = setup({}, [missing, {list: []}, customer,
      {hosted_page: {...page.hosted_page, url}}])
    await assert.rejects(checkout(memberId, 'INR', requestId), {code: 'checkout_unavailable'})
  })
}