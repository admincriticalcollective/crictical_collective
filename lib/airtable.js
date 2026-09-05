// Airtable upsert keyed on "Sanity ID" (idempotent — safe to re-run / redeliver).
const API = 'https://api.airtable.com/v0'

function tableUrl() {
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || 'Articles')
  return `${API}/${process.env.AIRTABLE_BASE_ID}/${table}`
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function toFields(a) {
  return {
    'Sanity ID': a._id,
    Title: a.title || '',
    Slug: a.slug || '',
    Kicker: a.kicker || a.section || '',
    Subtitle: a.subtitle || '',
    'Article Type': a.articleType || '',
    Teaser: a.teaser || '',
    'Access Tier': a.accessTier || 'free',
    Year: a.year ?? null,
    'Reading Time': a.readingTimeMins ?? null,
    'Published At': a.publishedAt || null,
    Section: a.section || '',
    'Section Slug': a.sectionSlug || '',
    Subsection: a.subsection || '',
    'Author Name': a.author || '',
    'Author Slug': a.authorSlug || '',
    Tags: (a.tags || []).filter(Boolean).join(', '),
    'Hero Image': a.heroImage || '',
    'SEO Title': a.seoTitle || '',
    'SEO Description': a.seoDescription || '',
    Status: 'live',
  }
}

// Airtable caps at 10 records per write; upsert merges on "Sanity ID".
export async function upsertArticles(articles) {
  const url = tableUrl()
  for (let i = 0; i < articles.length; i += 10) {
    const chunk = articles.slice(i, i + 10)
    const res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({
        performUpsert: {fieldsToMergeOn: ['Sanity ID']},
        records: chunk.map((a) => ({fields: toFields(a)})),
        typecast: true,
      }),
    })
    if (!res.ok) {
      throw new Error(`Airtable upsert failed ${res.status}: ${await res.text()}`)
    }
  }
}

// On delete/unpublish, flag the row so Framer can drop/hide the page.
export async function archiveArticle(sanityId) {
  const base = tableUrl()
  const formula = encodeURIComponent(`{Sanity ID}='${sanityId}'`)
  const found = await fetch(`${base}?filterByFormula=${formula}`, {
    headers: {Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`},
  }).then((r) => r.json())
  const rec = found.records?.[0]
  if (!rec) return
  await fetch(`${base}/${rec.id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({fields: {Status: 'archived'}}),
  })
}
