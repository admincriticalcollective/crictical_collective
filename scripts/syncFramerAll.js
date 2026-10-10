import dotenv from 'dotenv'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const projectDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const configuredEnvFile = process.env.SYNC_ENV_FILE
if (configuredEnvFile) {
  const envPath = resolve(projectDirectory, configuredEnvFile)
  if (!existsSync(envPath)) throw new Error(`SYNC_ENV_FILE does not exist: ${envPath}`)
  dotenv.config({path: envPath})
}
dotenv.config({path: resolve(projectDirectory, '.env.local')})
dotenv.config({path: resolve(projectDirectory, '.env')})

const required = [
  'SANITY_PROJECT_ID',
  'SANITY_API_READ_TOKEN',
  'FRAMER_PROJECT_URL',
  'FRAMER_API_KEY',
  'FRAMER_COLLECTION_ID',
  'FRAMER_AUTHORS_COLLECTION_ID',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

const [{fetchAllArticles, fetchAllAuthors}, {fullSyncFramer}] = await Promise.all([
  import('../lib/sanity.js'),
  import('../lib/framer.js'),
])

const dryRun = process.argv.includes('--dry-run')
const batchArg = process.argv.find((argument) => argument.startsWith('--batch-size='))
const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 25
const sessionArg = process.argv.find((argument) => argument.startsWith('--session-size='))
const sessionSize = sessionArg ? Number(sessionArg.split('=')[1]) : 100
const targetArg = process.argv.find((argument) => argument.startsWith('--target='))
const target = targetArg ? targetArg.split('=')[1] : 'both'
const offsetArg = process.argv.find((argument) => argument.startsWith('--offset='))
const offset = offsetArg ? Number(offsetArg.split('=')[1]) : 0
const limitArg = process.argv.find((argument) => argument.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null

if (!['articles', 'authors', 'both'].includes(target)) throw new Error('--target must be articles, authors, or both')
if (!Number.isInteger(offset) || offset < 0) throw new Error('--offset must be a non-negative integer')
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer')

async function main() {
  const [articles, authors] = await Promise.all([fetchAllArticles(), fetchAllAuthors()])
  const articleBatch = target === 'authors' ? undefined : articles.slice(offset, limit === null ? undefined : offset + limit)
  const authorBatch = target === 'articles' ? undefined : authors.slice(offset, limit === null ? undefined : offset + limit)
  console.log(`Fetched ${articles.length} article(s) and ${authors.length} author(s) from Sanity`)
  if (articleBatch) console.log(`Selected articles: ${articleBatch.length} at offset ${offset}`)
  if (authorBatch) console.log(`Selected authors: ${authorBatch.length} at offset ${offset}`)
  if (dryRun) console.log('Dry run: Framer will not be changed')

  const completeRun = target === 'both' && offset === 0 && limit === null
  const result = await fullSyncFramer({
    articles: articleBatch,
    authors: authorBatch,
    dryRun,
    batchSize,
    sessionSize,
    pruneStale: completeRun,
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error('Framer full sync failed:', error.message)
  process.exit(1)
})