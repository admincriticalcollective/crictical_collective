// Full re-sync: pull every published article from Sanity and upsert into Airtable.
// Run initially, and any time the bridge drifts or the schema changes.
//   npm run sync:all
import 'dotenv/config'
import {fetchAllArticles} from './lib/sanity.js'
import {upsertArticles} from './lib/airtable.js'

async function main() {
  const articles = await fetchAllArticles()
  console.log(`Fetched ${articles.length} article(s) from Sanity`)

  // Skip rows missing hard-required fields rather than writing broken records.
  const ready = articles.filter((a) => a.slug && a.title)
  const skipped = articles.length - ready.length
  if (skipped) console.warn(`Skipping ${skipped} incomplete article(s) (missing slug/title)`)

  await upsertArticles(ready)
  console.log(`Upserted ${ready.length} row(s) into Airtable "${process.env.AIRTABLE_TABLE || 'Articles'}"`)
}

main().catch((e) => {
  console.error('Full sync failed:', e.message)
  process.exit(1)
})
