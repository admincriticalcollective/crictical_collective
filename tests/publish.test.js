import assert from 'node:assert/strict'
import test from 'node:test'
import handler, {isPublishIntervalDue} from '../api/publish.js'

function response() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('publish interval becomes due on matching hour boundaries', () => {
  assert.equal(isPublishIntervalDue(new Date(3 * 60 * 60 * 1000), 3), true)
  assert.equal(isPublishIntervalDue(new Date(4 * 60 * 60 * 1000), 3), false)
})

test('scheduled publish rejects methods other than GET', async () => {
  const res = response()
  await handler({method: 'POST', headers: {}}, res)

  assert.equal(res.statusCode, 405)
  assert.deepEqual(res.body, {error: 'method not allowed'})
})

test('scheduled publish fails closed when the cron secret is missing', async () => {
  const originalSecret = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  try {
    const res = response()
    await handler({method: 'GET', headers: {}}, res)

    assert.equal(res.statusCode, 500)
    assert.deepEqual(res.body, {error: 'cron secret is not configured'})
  } finally {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  }
})

test('scheduled publish rejects missing or incorrect cron bearer token', async () => {
  const originalSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'unit-test-secret'
  try {
    for (const authorization of [undefined, 'Bearer wrong']) {
      const res = response()
      await handler({method: 'GET', headers: {authorization}}, res)

      assert.equal(res.statusCode, 401)
      assert.deepEqual(res.body, {error: 'unauthorized'})
    }
  } finally {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  }
})
