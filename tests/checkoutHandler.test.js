import assert from 'node:assert/strict'
import test from 'node:test'
import {CheckoutError} from '../lib/checkout.js'
import {createCheckoutHandler} from '../lib/checkoutHandler.js'

const origin = 'https://publication.example'
const requestId = '12345678-1234-4123-8123-123456789abc'

async function request({method = 'POST', headers = {}, body = {currency: 'INR', requestId}, dependencies = {}} = {}) {
  const calls = []
  const res = {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
    end() { return this },
  }
  const handler = createCheckoutHandler({
    allowedOrigins: [origin], logError: () => {},
    authenticate: async token => { assert.equal(token, 'test-token'); return {id: 'mem_verified'} },
    checkout: async (...args) => { calls.push(args); return {url: 'https://publication-test.chargebee.com/pages/test'} },
    ...dependencies,
  })
  await handler({method, body, headers: {
    origin, authorization: 'Bearer test-token', 'content-type': 'application/json', ...headers,
  }}, res)
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0')
  assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store')
  return {res, calls}
}

test('passes only authenticated identity and approved request fields', async () => {
  const {res, calls} = await request()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls, [['mem_verified', 'INR', requestId]])
  assert.deepEqual(Object.keys(res.body), ['url'])
})

test('Vercel string JSON request body is supported', async () => {
  const {res} = await request({body: JSON.stringify({currency: 'USD', requestId})})
  assert.equal(res.statusCode, 200)
})

for (const body of [null, [], '{', {currency: 'EUR', requestId},
  {currency: 'INR', requestId, customerId: 'mem_attacker'},
  {currency: 'INR', requestId, priceId: 'cheap'},
  {currency: 'INR', requestId, returnUrl: 'https://attacker.example'},
  {currency: 'INR'}, 'x'.repeat(1025)]) {
  test(`invalid body cannot initiate checkout: ${JSON.stringify(body).slice(0, 100)}`, async () => {
    const {res, calls} = await request({body})
    assert.equal(res.statusCode, 400)
    assert.equal(calls.length, 0)
  })
}

for (const authorization of [undefined, 'malformed', 'Bearer two tokens']) {
  test(`missing/malformed auth cannot initiate checkout: ${authorization}`, async () => {
    const {res, calls} = await request({headers: {authorization}})
    assert.equal(res.statusCode, 401)
    assert.equal(calls.length, 0)
  })
}

test('invalid session cannot initiate checkout', async () => {
  const {res, calls} = await request({dependencies: {authenticate: async () => null}})
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})

test('preflight does not authenticate or contact billing', async () => {
  const {res, calls} = await request({method: 'OPTIONS', headers: {authorization: undefined},
    dependencies: {authenticate: async () => assert.fail('preflight auth')}})
  assert.equal(res.statusCode, 204)
  assert.equal(res.headers['Access-Control-Allow-Origin'], origin)
  assert.equal(calls.length, 0)
})

test('disallowed origin cannot initiate checkout', async () => {
  const {res, calls} = await request({headers: {origin: 'https://attacker.example'}})
  assert.equal(res.statusCode, 403)
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined)
  assert.equal(calls.length, 0)
})

test('GET is not a checkout link', async () => {
  const {res, calls} = await request({method: 'GET'})
  assert.equal(res.statusCode, 405)
  assert.equal(calls.length, 0)
})

test('form requests are rejected', async () => {
  const {res, calls} = await request({headers: {'content-type': 'application/x-www-form-urlencoded'}})
  assert.equal(res.statusCode, 415)
  assert.equal(calls.length, 0)
})

test('dependency details and tokens are not returned', async () => {
  const {res} = await request({dependencies: {authenticate: async () => { throw new Error('secret detail') }}})
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, {error: 'checkout_unavailable'})
})

test('existing subscriptions return a conflict, not another checkout', async () => {
  const {res} = await request({dependencies: {checkout: async () => {
    throw new CheckoutError('subscription_exists', 409)
  }}})
  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, {error: 'subscription_exists'})
})

test('Vercel checkout entry imports without credentials', async () => {
  const {default: handler} = await import('../api/checkout.js')
  assert.equal(typeof handler, 'function')
})