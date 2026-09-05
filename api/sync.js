// Incremental direct sync webhook (Vercel serverless).
// Sanity fires on create/update/delete of an article -> we re-fetch by _id and
// upsert/remove the matching Framer CMS item. Signature-verified and idempotent.
import {isValidSignature, SIGNATURE_HEADER_NAME} from '@sanity/webhook'
import {fetchArticleById} from '../lib/sanity.js'
import {removeFramerArticle, upsertFramerArticle} from '../lib/framer.js'

// We need the raw body to verify the signature, so disable Vercel's parser.
export const config = {api: {bodyParser: false}}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'method not allowed'})

  const raw = await readRawBody(req)
  const signature = req.headers[SIGNATURE_HEADER_NAME]
  const valid = await isValidSignature(raw, signature, process.env.SANITY_WEBHOOK_SECRET)
  if (!valid) return res.status(401).json({error: 'invalid signature'})

  let id
  try {
    id = JSON.parse(raw)._id
  } catch {
    return res.status(400).json({error: 'bad payload'})
  }
  if (!id) return res.status(400).json({error: 'missing _id'})

  try {
    const doc = await fetchArticleById(id)
    if (!doc) {
      await removeFramerArticle(id) // deleted or unpublished in Sanity
      return res.status(200).json({ok: true, id, action: 'removed'})
    }
    if (!doc.slug || !doc.title) {
      console.warn('skip incomplete', id)
      return res.status(200).json({ok: true, id, action: 'skipped-incomplete'})
    }
    await upsertFramerArticle(doc)
    return res.status(200).json({ok: true, id, action: 'upserted'})
  } catch (e) {
    console.error('sync error', id, e.message)
    return res.status(500).json({error: 'sync failed', id})
  }
}
