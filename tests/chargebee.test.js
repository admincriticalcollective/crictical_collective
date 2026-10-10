import assert from 'node:assert/strict'
import test from 'node:test'
import {createPremiumChecker, subscriptionGrantsPremium} from '../lib/chargebee.js'

const now = Date.parse('2026-03-15T12:00:00Z') / 1000
const customerId = 'mem_test'
const priceIds = ['cc-premium-inr-monthly']
const subscription = {
  id: 'sub_test', customer_id: customerId, deleted: false,
  status: 'active', current_term_start: now - 100, current_term_end: now + 100,
  due_invoices_count: 0, total_dues: 0,
  subscription_items: [{item_type: 'plan', item_price_id: priceIds[0]}],
}

test('active premium subscription grants access', () => {
  assert.equal(subscriptionGrantsPremium(subscription, customerId, priceIds, now), true)
})

test('scheduled cancellation retains access through current term', () => {
  assert.equal(subscriptionGrantsPremium({...subscription, status: 'non_renewing'}, customerId, priceIds, now), true)
})

for (const [name, changes] of [
  ['wrong owner', {customer_id: 'mem_other'}],
  ['cancelled', {status: 'cancelled'}],
  ['paused', {status: 'paused'}],
  ['trial', {status: 'in_trial'}],
  ['future', {status: 'future'}],
  ['deleted', {deleted: true}],
  ['decommissioned', {decommissioned: true}],
  ['expiry equality', {current_term_end: now}],
  ['expired', {current_term_end: now - 1}],
  ['future term', {current_term_start: now + 1}],
  ['missing end', {current_term_end: undefined}],
  ['unpaid invoice', {due_invoices_count: 1}],
  ['outstanding dues', {total_dues: 100}],
  ['unknown dues', {total_dues: undefined}],
  ['wrong price', {subscription_items: [{item_type: 'plan', item_price_id: 'other'}]}],
  ['addon only', {subscription_items: [{item_type: 'addon', item_price_id: priceIds[0]}]}],
]) {
  test(`${name} denies access`, () => {
    assert.equal(subscriptionGrantsPremium({...subscription, ...changes}, customerId, priceIds, now), false)
  })
}

test('term start equality and just-before end grant access', () => {
  assert.equal(subscriptionGrantsPremium({...subscription, current_term_start: now}, customerId, priceIds, now), true)
  assert.equal(subscriptionGrantsPremium({...subscription, current_term_end: now + 1}, customerId, priceIds, now), true)
})

function checker(fetchImpl, config = {}) {
  return createPremiumChecker({
    site: 'cc-test', apiKey: 'unit-test-placeholder', priceIds,
    clock: () => now, fetchImpl, ...config,
  })
}

function response(payload) {
  return {ok: true, json: async () => payload}
}

test('retrieves current subscription before granting, with scoped list and bounded HTTPS', async () => {
  let calls = 0
  const check = checker(async (url, options) => {
    calls += 1
    assert.equal(url.origin, 'https://cc-test.chargebee.com')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('unit-test-placeholder:').toString('base64')}`)
    if (calls === 1) {
      assert.equal(url.searchParams.get('customer_id[is]'), customerId)
      assert.deepEqual(JSON.parse(url.searchParams.get('item_price_id[in]')), priceIds)
      return response({list: [{subscription}]})
    }
    assert.equal(url.pathname, '/api/v2/subscriptions/sub_test')
    return response({subscription})
  })
  assert.equal(await check(customerId), true)
  assert.equal(calls, 2)
})

test('stale active list result cannot override current cancellation', async () => {
  const check = checker(async url => response(url.pathname.endsWith('/sub_test')
    ? {subscription: {...subscription, status: 'cancelled'}}
    : {list: [{subscription}]}))
  assert.equal(await check(customerId), false)
})

test('current result must still match subscription ID and owner', async () => {
  for (const changes of [{customer_id: 'mem_other'}, {id: 'sub_other'}]) {
    const check = checker(async url => response(url.pathname.endsWith('/sub_test')
      ? {subscription: {...subscription, ...changes}}
      : {list: [{subscription}]}))
    assert.equal(await check(customerId), false)
  }
})

test('follows next_offset for later subscription', async () => {
  const check = checker(async url => {
    if (url.pathname.endsWith('/sub_test')) return response({subscription})
    if (url.searchParams.get('offset') === 'next') return response({list: [{subscription}]})
    return response({list: [], next_offset: 'next'})
  })
  assert.equal(await check(customerId), true)
})

test('no billing configuration or subscription grants no premium', async () => {
  const disabled = checker(async () => { throw new Error('must not call') }, {site: '', apiKey: '', priceIds: []})
  assert.equal(await disabled(customerId), false)
  assert.equal(await checker(async () => response({list: []}))(customerId), false)
})

test('partial configuration and invalid site do not call remote services', async () => {
  for (const config of [{apiKey: ''}, {site: 'https://attacker.example'}, {priceIds: []}]) {
    await assert.rejects(checker(async () => { assert.fail('unexpected request') }, config)(customerId), /configuration/)
  }
})

test('upstream failure and malformed payload fail closed', async () => {
  await assert.rejects(checker(async () => ({ok: false, status: 500}))(customerId), /lookup failed/)
  await assert.rejects(checker(async () => response({}))(customerId), /Invalid Chargebee response/)
})

test('repeating pagination cannot loop forever', async () => {
  await assert.rejects(checker(async () => response({list: [], next_offset: 'repeat'}))(customerId), /pagination/)
})

test('page count is bounded', async () => {
  let calls = 0
  const check = checker(async () => response({list: [], next_offset: String(++calls)}))
  await assert.rejects(check(customerId), /page limit/)
  assert.equal(calls, 10)
})

test('candidate retrieval count is bounded', async () => {
  const check = checker(async url => response(url.pathname.endsWith('/subscriptions')
    ? {list: Array.from({length: 11}, () => ({subscription}))}
    : {subscription: {...subscription, status: 'cancelled'}}))
  await assert.rejects(check(customerId), /lookup limit/)
})