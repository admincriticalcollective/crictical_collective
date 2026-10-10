import assert from 'node:assert/strict'
import test from 'node:test'
import {createArticleHandler} from '../lib/articleAccess.js'

const origin = 'https://publication.example'

async function request({dependencies = {}, headers = {}, query, method = 'GET'} = {}) {
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this },
    end() { return this },
  }
  const handler = createArticleHandler({
    allowedOrigins: [origin],
    authenticate: async () => ({id: 'mem_verified'}),
    fetchArticle: async () => ({
      _id: 'article-1', title: 'Example', slug: 'example',
      accessTier: 'free', body: [{_type: 'block', children: []}],
      internalField: 'never expose',
    }),
    hasPremiumAccess: async () => false,
    logError: () => {},
    ...dependencies,
  })
  await handler({
    method,
    headers: {origin, authorization: 'Bearer test-token', ...headers},
    query: query ?? {slug: 'example'},
  }, response)
  assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0')
  assert.equal(response.headers['Vercel-CDN-Cache-Control'], 'no-store')
  return response
}

test('signed-in member receives only whitelisted free article fields', async () => {
  const response = await request({dependencies: {
    hasPremiumAccess: async () => { throw new Error('free must not check billing') },
  }})
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.article.title, 'Example')
  assert.ok(Array.isArray(response.body.article.body))
  assert.equal(response.body.article.internalField, undefined)
  assert.equal(response.headers['Access-Control-Allow-Origin'], origin)
})

for (const authorization of [undefined, 'Bearer expired-token', 'malformed']) {
  test(`free article bypasses auth and billing with ${authorization ?? 'no token'}`, async () => {
    let authenticated = false
    let checkedBilling = false
    const response = await request({headers: {authorization}, dependencies: {
      authenticate: async () => { authenticated = true; throw new Error('auth unavailable') },
      hasPremiumAccess: async () => { checkedBilling = true; throw new Error('billing unavailable') },
    }})
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(response.body.article.body))
    assert.equal(authenticated, false)
    assert.equal(checkedBilling, false)
  })
}

for (const authorization of [undefined, 'malformed']) {
  test(`premium denies ${authorization ?? 'no token'} without checking billing`, async () => {
    let checkedBilling = false
    const response = await request({headers: {authorization}, dependencies: {
      fetchArticle: async () => ({accessTier: 'plan-3', body: 'protected text'}),
      hasPremiumAccess: async () => { checkedBilling = true; return true },
    }})
    assert.equal(response.statusCode, 401)
    assert.deepEqual(response.body, {error: 'login_required'})
    assert.equal(checkedBilling, false)
  })
}

test('invalid session cannot receive premium content', async () => {
  const response = await request({dependencies: {
    authenticate: async () => null,
    fetchArticle: async () => ({accessTier: 'plan-3', body: 'protected text'}),
  }})
  assert.equal(response.statusCode, 401)
  assert.deepEqual(response.body, {error: 'invalid_session'})
})

test('free member cannot read premium body', async () => {
  const response = await request({dependencies: {
    fetchArticle: async () => ({accessTier: 'plan-3', body: 'protected text'}),
  }})
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body, {error: 'premium_required'})
})

test('premium decision uses verified member ID, not request claims', async () => {
  const response = await request({
    query: {slug: 'example', memberId: 'mem_attacker', premium: 'true'},
    dependencies: {
      fetchArticle: async () => ({accessTier: 'plan-3', body: 'protected text'}),
      hasPremiumAccess: async memberId => {
        assert.equal(memberId, 'mem_verified')
        return true
      },
    },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.article.body, 'protected text')
})

for (const accessTier of [undefined, null, '', 'plan-1', 'Free', 'Plan 3 (everything)']) {
  test(`unconfigured access tier ${JSON.stringify(accessTier)} denies even premium`, async () => {
    const response = await request({dependencies: {
      fetchArticle: async () => ({accessTier, body: 'protected text'}),
      hasPremiumAccess: async () => true,
    }})
    assert.equal(response.statusCode, 403)
    assert.equal(response.body.article, undefined)
  })
}

test('exact alternate stored labels can be configured', async () => {
  const response = await request({dependencies: {
    freeTier: 'Free', premiumTier: 'Plan 3 (everything)',
    fetchArticle: async () => ({accessTier: 'Free'}),
  }})
  assert.equal(response.statusCode, 200)
})

test('missing published article returns 404', async () => {
  const response = await request({dependencies: {fetchArticle: async () => null}})
  assert.equal(response.statusCode, 404)
})

for (const dependency of ['authenticate', 'fetchArticle', 'hasPremiumAccess']) {
  test(`${dependency} failure never returns article or exception details`, async () => {
    const response = await request({dependencies: {
      fetchArticle: async () => ({accessTier: 'plan-3', body: 'protected text'}),
      [dependency]: async () => { throw new Error('secret upstream response') },
    }})
    assert.equal(response.statusCode, 503)
    assert.deepEqual(response.body, {error: 'content_temporarily_unavailable'})
  })
}

test('CORS preflight succeeds without authentication', async () => {
  const response = await request({method: 'OPTIONS', headers: {authorization: undefined}})
  assert.equal(response.statusCode, 204)
})

test('unapproved origin denied without reflecting it', async () => {
  const response = await request({headers: {origin: 'https://unapproved.example'}})
  assert.equal(response.statusCode, 403)
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
})

test('nonbrowser anonymous request can read free content', async () => {
  const response = await request({headers: {origin: undefined, authorization: undefined}})
  assert.equal(response.statusCode, 200)
})

test('anonymous request cannot override an unknown tier through query parameters', async () => {
  const response = await request({
    headers: {authorization: undefined},
    query: {slug: 'example', accessTier: 'free'},
    dependencies: {fetchArticle: async () => ({body: 'protected text'})},
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body, {error: 'access_tier_not_supported'})
})

test('missing CORS configuration fails closed', async () => {
  const response = await request({dependencies: {allowedOrigins: []}})
  assert.equal(response.statusCode, 503)
})

test('overlapping tiers fail closed', async () => {
  const response = await request({dependencies: {freeTier: 'plan-3'}})
  assert.equal(response.statusCode, 503)
})

test('unsupported methods rejected', async () => {
  const response = await request({method: 'POST'})
  assert.equal(response.statusCode, 405)
})

for (const slug of ['', '  ', ['example'], 'x'.repeat(513)]) {
  test(`invalid slug (${typeof slug}) rejected`, async () => {
    const response = await request({query: {slug}})
    assert.equal(response.statusCode, 400)
  })
}

test('Vercel entry point serves anonymous free content but denies premium', async () => {
  process.env.SANITY_PROJECT_ID = 'testproject'
  process.env.SANITY_DATASET = 'testdataset'
  process.env.SANITY_API_READ_TOKEN = 'unit-test-placeholder'
  process.env.ALLOWED_ORIGINS = origin
  const {default: handler} = await import('../api/article.js')
  const {sanity} = await import('../lib/sanity.js')
  const originalWithConfig = sanity.withConfig
  try {
    for (const accessTier of ['free', 'plan-3']) {
      sanity.withConfig = () => ({fetch: async () => ({accessTier, body: 'article text'})})
      const response = {
        headers: {},
        setHeader(name, value) { this.headers[name] = value },
        status(code) { this.statusCode = code; return this },
        json(body) { this.body = body; return this },
      }
      await handler({method: 'GET', headers: {origin}, query: {slug: 'example'}}, response)
      if (accessTier === 'free') {
        assert.equal(response.statusCode, 200)
        assert.equal(response.body.article.body, 'article text')
      } else {
        assert.equal(response.statusCode, 401)
        assert.deepEqual(response.body, {error: 'login_required'})
      }
    }
  } finally {
    sanity.withConfig = originalWithConfig
  }
})

test('protected Sanity query binds slug and excludes drafts and releases; sync stays body-free', async () => {
  process.env.SANITY_PROJECT_ID = 'testproject'
  process.env.SANITY_DATASET = 'testdataset'
  process.env.SANITY_API_READ_TOKEN = 'unit-test-placeholder'
  const {sanity, ARTICLE_PROJECTION, fetchProtectedArticleBySlug} = await import('../lib/sanity.js')
  const originalWithConfig = sanity.withConfig
  const hostileSlug = 'example\" || true || slug.current == \"'
  try {
    sanity.withConfig = options => {
      assert.equal(options.perspective, 'published')
      assert.equal(options.timeout, 6000)
      assert.equal(options.maxRetries, 0)
      return {fetch: async (query, params) => {
        assert.ok(query.includes('slug.current == $slug'))
        assert.ok(query.includes('!(_id in path("drafts.**"))'))
        assert.ok(query.includes('!(_id in path("versions.**"))'))
        assert.equal(query.includes(hostileSlug), false)
        assert.deepEqual(params, {slug: hostileSlug})
        return null
      }}
    }
    assert.equal(await fetchProtectedArticleBySlug(hostileSlug), null)
    assert.equal(/\bbody\b/.test(ARTICLE_PROJECTION), false)
  } finally {
    sanity.withConfig = originalWithConfig
  }
})