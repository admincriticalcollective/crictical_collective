import {connect} from 'framer-api'

export const FRAMER_FIELDS = [
  {id: 'sanityId', name: 'Sanity ID', type: 'string'},
  {id: 'title', name: 'Title', type: 'string'},
  {id: 'slug', name: 'Slug', type: 'string'},
  {id: 'kicker', name: 'Kicker', type: 'string'},
  {id: 'subtitle', name: 'Subtitle', type: 'string'},
  {id: 'articleType', name: 'Article Type', type: 'string'},
  {id: 'teaser', name: 'Teaser', type: 'string'},
  {id: 'accessTier', name: 'Access Tier', type: 'string'},
  {id: 'year', name: 'Year', type: 'number'},
  {id: 'readingTime', name: 'Reading Time', type: 'number'},
  {id: 'publishedAt', name: 'Published At', type: 'date'},
  {id: 'section', name: 'Section', type: 'string'},
  {id: 'sectionSlug', name: 'Section Slug', type: 'string'},
  {id: 'subsection', name: 'Subsection', type: 'string'},
  {id: 'authorName', name: 'Author Name', type: 'string'},
  {id: 'authorSlug', name: 'Author Slug', type: 'string'},
  {id: 'tags', name: 'Tags', type: 'string'},
  {id: 'heroImage', name: 'Hero Image', type: 'image'},
  {id: 'seoTitle', name: 'SEO Title', type: 'string'},
  {id: 'seoDescription', name: 'SEO Description', type: 'string'},
  {id: 'status', name: 'Status', type: 'string'},
]

function value(type, value) {
  return {type, value}
}

async function getFieldIds(collection) {
  const fields = await collection.getFields()
  const ids = new Map(fields.map(field => [field.name, field.id]))
  const missing = FRAMER_FIELDS.filter(field => !ids.has(field.name)).map(field => field.name)
  if (missing.length) throw new Error(`Framer collection is missing fields: ${missing.join(', ')}`)
  return Object.fromEntries(FRAMER_FIELDS.map(field => [field.id, ids.get(field.name)]))
}

export function articleToFramerItem(article, fieldIds = Object.fromEntries(FRAMER_FIELDS.map(field => [field.id, field.id])), itemId) {
  if (!article?._id || !article.slug || !article.title) return null

  const item = {
    slug: article.slug,
    draft: false,
    fieldData: {
      [fieldIds.sanityId]: value('string', article._id),
      [fieldIds.title]: value('string', article.title),
      [fieldIds.slug]: value('string', article.slug),
      [fieldIds.kicker]: value('string', article.kicker || article.section || ''),
      [fieldIds.subtitle]: value('string', article.subtitle || ''),
      [fieldIds.articleType]: value('string', article.articleType || ''),
      [fieldIds.teaser]: value('string', article.teaser || ''),
      [fieldIds.accessTier]: value('string', article.accessTier || 'free'),
      [fieldIds.year]: value('number', article.year ?? null),
      [fieldIds.readingTime]: value('number', article.readingTimeMins ?? null),
      [fieldIds.publishedAt]: value('date', article.publishedAt || null),
      [fieldIds.section]: value('string', article.section || ''),
      [fieldIds.sectionSlug]: value('string', article.sectionSlug || ''),
      [fieldIds.subsection]: value('string', article.subsection || ''),
      [fieldIds.authorName]: value('string', article.author || ''),
      [fieldIds.authorSlug]: value('string', article.authorSlug || ''),
      [fieldIds.tags]: value('string', (article.tags || []).filter(Boolean).join(', ')),
      [fieldIds.heroImage]: value('image', article.heroImage || ''),
      [fieldIds.seoTitle]: value('string', article.seoTitle || ''),
      [fieldIds.seoDescription]: value('string', article.seoDescription || ''),
      [fieldIds.status]: value('string', 'live'),
    },
  }
  if (itemId) item.id = itemId
  return item
}

async function withCollection(callback) {
  if (!process.env.FRAMER_PROJECT_URL || !process.env.FRAMER_API_KEY || !process.env.FRAMER_COLLECTION_ID) {
    throw new Error('Missing FRAMER_PROJECT_URL, FRAMER_API_KEY, or FRAMER_COLLECTION_ID')
  }

  const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
  try {
    const collection = await framer.getCollection(process.env.FRAMER_COLLECTION_ID)
    if (!collection) throw new Error(`Framer collection not found: ${process.env.FRAMER_COLLECTION_ID}`)
    return await callback(collection)
  } finally {
    await framer.disconnect()
  }
}

export function upsertFramerArticle(article) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection)
    const existingItems = await collection.getItems()
    const existingItem = existingItems.find((item) => {
      const entry = item.fieldData?.[fieldIds.sanityId]
      const existingSanityId = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry
      return existingSanityId === article?._id
    })
    const item = articleToFramerItem(article, fieldIds, existingItem?.id)
    if (!item) throw new Error(`Incomplete article: ${article?._id || 'unknown'}`)
    return collection.addItems([item])
  })
}

export function removeFramerArticle(sanityId) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection)
    const existingItems = await collection.getItems()
    const item = existingItems.find((candidate) => {
      const entry = candidate.fieldData?.[fieldIds.sanityId]
      const existingSanityId = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry
      return existingSanityId === sanityId
    })
    if (item) await collection.removeItems([item.id])
  })
}

export function configureFramerFields() {
  return withCollection(async (collection) => {
    const existingFields = await collection.getFields()
    const existingNames = new Set(existingFields.map(field => field.name))
    const fieldsToAdd = FRAMER_FIELDS
      .filter(field => !existingNames.has(field.name))
      .map(({id, ...field}) => field)
    if (fieldsToAdd.length) await collection.addFields(fieldsToAdd)
  })
}