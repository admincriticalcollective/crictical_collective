import assert from 'node:assert/strict'
import test from 'node:test'
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from 'jose'
import {createMemberAuthenticator} from '../lib/memberstack.js'

const {privateKey, publicKey} = await generateKeyPair('RS256')
const publicJwk = await exportJWK(publicKey)
const keySet = createLocalJWKSet({keys: [{...publicJwk, kid: 'test', alg: 'RS256'}]})
const now = new Date('2026-03-15T12:00:00Z')
const nowSeconds = now.getTime() / 1000

async function token(overrides = {}, key = privateKey) {
  return new SignJWT({
    id: 'mem_test', type: 'member', iss: 'https://api.memberstack.com',
    aud: 'app_test', iat: nowSeconds - 60, exp: nowSeconds + 600, ...overrides,
  }).setProtectedHeader({alg: 'RS256', kid: 'test'}).sign(key)
}

function authenticator(overrides = {}) {
  return createMemberAuthenticator({
    appId: 'app_test', secretKey: 'unit-test-placeholder', keySet, clock: () => now,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://admin.memberstack.com/members/mem_test')
      assert.equal(options.headers['X-API-KEY'], 'unit-test-placeholder')
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      return {ok: true, json: async () => ({data: {id: 'mem_test', customFields: {premium: true}}})}
    },
    ...overrides,
  })
}

test('valid signed token and existing member return identity only', async () => {
  assert.deepEqual(await authenticator()(await token()), {id: 'mem_test'})
})

for (const [name, claims] of [
  ['wrong audience', {aud: 'app_other'}],
  ['wrong issuer', {iss: 'https://attacker.example'}],
  ['expiry equality', {exp: nowSeconds}],
  ['expired', {exp: nowSeconds - 1}],
  ['missing expiry', {exp: undefined}],
  ['non-member token', {type: 'admin'}],
  ['missing identity', {id: undefined}],
  ['malformed identity', {id: '../other'}],
]) {
  test(`${name} denied before member API call`, async () => {
    let called = false
    const auth = authenticator({fetchImpl: async () => { called = true }})
    assert.equal(await auth(await token(claims)), null)
    assert.equal(called, false)
  })
}

test('just-before expiry accepted', async () => {
  assert.deepEqual(await authenticator()(await token({exp: nowSeconds + 1})), {id: 'mem_test'})
})

test('tampered signature denied', async () => {
  const other = await generateKeyPair('RS256')
  assert.equal(await authenticator()(await token({}, other.privateKey)), null)
})

test('malformed token denied', async () => {
  assert.equal(await authenticator()('not-a-jwt'), null)
})

test('deleted or wrong-environment member denied', async () => {
  const auth = authenticator({fetchImpl: async () => ({status: 404, ok: false})})
  assert.equal(await auth(await token()), null)
})

test('mismatched API member denied', async () => {
  const auth = authenticator({fetchImpl: async () => ({
    ok: true, json: async () => ({data: {id: 'mem_other'}}),
  })})
  assert.equal(await auth(await token()), null)
})

test('API outage is not mistaken for an invalid password', async () => {
  const auth = authenticator({fetchImpl: async () => ({status: 503, ok: false})})
  await assert.rejects(auth(await token()), /Member lookup failed/)
})

test('missing configuration does not call remote services', async () => {
  await assert.rejects(authenticator({appId: ''})(await token()), /not configured/)
})