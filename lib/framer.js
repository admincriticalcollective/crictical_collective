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

export const AUTHOR_FIELDS = [
  {id: 'sanityId', name: 'Sanity ID', type: 'string'},
  {id: 'name', name: 'Name', type: 'string'},
  {id: 'avatar', name: 'Avatar', type: 'image'},
  {id: 'bio', name: 'Bio', type: 'formattedText'},
]

function value(type, value) {
  return {type, value}
}

function optionalNumberField(fieldId, input) {
  if (input === null || input === undefined || input === '') return {}
  const numericValue = Number(input)
  return Number.isFinite(numericValue) ? {[fieldId]: value('number', numericValue)} : {}
}

function readFieldValue(item, fieldId, fieldName) {
  const entry = item.fieldData?.[fieldId] ?? item.fieldData?.[fieldName]
  return entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry
}

function readSanityId(item, fieldId) {
  return readFieldValue(item, fieldId, 'Sanity ID')
}

async function getFieldIds(collection, expectedFields) {
  const existingFields = await collection.getFields()
  const ids = new Map(existingFields.map(field => [field.name, field.id]))
  const missing = expectedFields.filter(field => !ids.has(field.name)).map(field => field.name)
  if (missing.length) throw new Error(`Framer collection is missing fields: ${missing.join(', ')}`)
  return Object.fromEntries(expectedFields.map(field => [field.id, ids.get(field.name)]))
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
      ...optionalNumberField(fieldIds.year, article.year),
      ...optionalNumberField(fieldIds.readingTime, article.readingTimeMins),
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

async function withCollection(callback, collectionEnv = 'FRAMER_COLLECTION_ID') {
  if (!process.env.FRAMER_PROJECT_URL || !process.env.FRAMER_API_KEY || !process.env[collectionEnv]) {
    throw new Error(`Missing FRAMER_PROJECT_URL, FRAMER_API_KEY, or ${collectionEnv}`)
  }

  const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
  try {
    const collection = await framer.getCollection(process.env[collectionEnv])
    if (!collection) throw new Error(`Framer collection not found: ${process.env[collectionEnv]}`)
    return await callback(collection)
  } finally {
    await framer.disconnect()
  }
}

export function upsertFramerArticle(article) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection, FRAMER_FIELDS)
    const existingItems = await collection.getItems()
    const existingItem = existingItems.find((item) => readSanityId(item, fieldIds.sanityId) === article?._id)
    const item = articleToFramerItem(article, fieldIds, existingItem?.id)
    if (!item) throw new Error(`Incomplete article: ${article?._id || 'unknown'}`)
    return collection.addItems([item])
  })
}

export function removeFramerArticle(sanityId) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection, FRAMER_FIELDS)
    const existingItems = await collection.getItems()
    const item = existingItems.find((candidate) => readSanityId(candidate, fieldIds.sanityId) === sanityId)
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

export function authorToFramerItem(author, fieldIds, itemId) {
  if (!author?._id || !author.slug || !author.name) return null
  const fieldData = {
    [fieldIds.sanityId]: value('string', author._id),
    [fieldIds.name]: value('string', author.name),
    [fieldIds.avatar]: value('image', author.avatar || ''),
    [fieldIds.bio]: value('formattedText', author.bio || ''),
  }
  const item = {slug: author.slug, draft: false, fieldData}
  if (itemId) item.id = itemId
  return item
}

export function upsertFramerAuthor(author) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection, AUTHOR_FIELDS)
    const existingItems = await collection.getItems()
    const existingItem = existingItems.find(item => readSanityId(item, fieldIds.sanityId) === author?._id)
    const item = authorToFramerItem(author, fieldIds, existingItem?.id)
    if (!item) throw new Error(`Incomplete author: ${author?._id || 'unknown'}`)
    return collection.addItems([item])
  }, 'FRAMER_AUTHORS_COLLECTION_ID')
}

export function removeFramerAuthor(sanityId) {
  return withCollection(async (collection) => {
    const fieldIds = await getFieldIds(collection, AUTHOR_FIELDS)
    const existingItems = await collection.getItems()
    const item = existingItems.find(candidate => readSanityId(candidate, fieldIds.sanityId) === sanityId)
    if (item) await collection.removeItems([item.id])
  }, 'FRAMER_AUTHORS_COLLECTION_ID')
}

export async function publishFramerProject() {
  if (!process.env.FRAMER_PROJECT_URL || !process.env.FRAMER_API_KEY) {
    throw new Error('Missing FRAMER_PROJECT_URL or FRAMER_API_KEY')
  }

  const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
  try {
    if (!framer.isAllowedTo('publish')) throw new Error('Framer API key cannot publish this project')
    const result = await framer.publish()
    const canDeploy = framer.isAllowedTo('deploy')
    const deployedHostnames = canDeploy
      ? await framer.deploy(result.deployment.id)
      : []
    return {
      deployment: result.deployment,
      publishedHostnames: result.hostnames,
      deployedHostnames,
      customDomainDeploySkipped: !canDeploy,
    }
  } finally {
    await framer.disconnect()
  }
}

export function planCollectionSync(documents, existingItems, fieldIds, toItem) {
  const sourceIds = new Set(documents.map((document) => document._id).filter(Boolean))
  const existingBySanityId = new Map()
  const staleItemIds = []
  const staleItemIdSet = new Set()
  const legacyBySlug = new Map()

  function markStale(item) {
    if (item.id && !staleItemIdSet.has(item.id)) {
      staleItemIdSet.add(item.id)
      staleItemIds.push(item.id)
    }
  }

  for (const item of existingItems) {
    const sanityId = readSanityId(item, fieldIds.sanityId)
    if (sanityId) {
      if (!sourceIds.has(sanityId) || existingBySanityId.has(sanityId)) markStale(item)
      else existingBySanityId.set(sanityId, item)
      continue
    }
    if (item.slug) {
      if (!legacyBySlug.has(item.slug)) legacyBySlug.set(item.slug, [])
      legacyBySlug.get(item.slug).push(item)
    }
  }

  const items = []
  let skipped = 0
  for (const document of documents) {
    let existingItem = existingBySanityId.get(document._id)
    const legacyMatches = legacyBySlug.get(document.slug) || []
    if (existingItem) {
      const titleFieldName = fieldIds.title ? 'Title' : 'Name'
      const conflictingLegacy = legacyMatches.find((item) =>
        readFieldValue(item, fieldIds.title || fieldIds.name, titleFieldName) !== (document.title || document.name)
      )
      if (conflictingLegacy) {
        throw new Error(`Framer slug conflict for ${document.slug}: existing item ${conflictingLegacy.id} has different content`)
      }
      legacyMatches.forEach(markStale)
    } else if (legacyMatches.length) {
      const titleFieldName = fieldIds.title ? 'Title' : 'Name'
      const matchingLegacy = legacyMatches.find((item) =>
        readFieldValue(item, fieldIds.title || fieldIds.name, titleFieldName) === (document.title || document.name)
      )
      if (!matchingLegacy) {
        throw new Error(`Framer slug conflict for ${document.slug}: existing item ${legacyMatches[0].id} has no matching Sanity ID or title`)
      }
      existingItem = matchingLegacy
      legacyMatches.filter((item) => item !== matchingLegacy).forEach(markStale)
    }

    const item = toItem(document, fieldIds, existingItem?.id)
    if (item) items.push(item)
    else skipped++
  }

  return {items, staleItemIds, skipped}
}

function assertUnmanagedCollection(collection) {
  if (collection.managedBy !== 'user') {
    throw new Error(`Collection is managed by ${collection.managedBy}; full sync requires an unmanaged collection`)
  }
}

async function syncUnmanagedCollection(collectionEnv, fieldSpecs, documents, toItem, {dryRun, batchSize, sessionSize, pruneStale}) {
  const {fieldIds, plan} = await withCollection(async (collection) => {
    assertUnmanagedCollection(collection)
    const fieldIds = await getFieldIds(collection, fieldSpecs)
    const existingItems = await collection.getItems()
    const plan = planCollectionSync(documents, existingItems, fieldIds, toItem)
    return {fieldIds, plan}
  }, collectionEnv)

  const summary = {
    fetched: documents.length,
    upserted: plan.items.length,
    skipped: plan.skipped,
    staleDetected: plan.staleItemIds.length,
    staleRemoved: pruneStale ? plan.staleItemIds.length : 0,
  }
  if (dryRun) return summary

  const staleItemIds = pruneStale ? plan.staleItemIds : []
  for (let index = 0; index < staleItemIds.length; index += batchSize) {
    const staleIds = staleItemIds.slice(index, index + batchSize)
    await withCollection(async (collection) => {
      assertUnmanagedCollection(collection)
      await collection.removeItems(staleIds)
    }, collectionEnv)
  }

  for (let sessionStart = 0; sessionStart < plan.items.length; sessionStart += sessionSize) {
    const sessionEnd = Math.min(sessionStart + sessionSize, plan.items.length)
    await withCollection(async (collection) => {
      assertUnmanagedCollection(collection)
      const currentFieldIds = await getFieldIds(collection, fieldSpecs)
      if (JSON.stringify(currentFieldIds) !== JSON.stringify(fieldIds)) {
        throw new Error('Framer collection fields changed during full sync; rerun after fields stabilize')
      }

      for (let index = sessionStart; index < sessionEnd; index += batchSize) {
        await collection.addItems(plan.items.slice(index, Math.min(index + batchSize, sessionEnd)))
        console.log(`  Framer ${collection.name}: ${Math.min(index + batchSize, plan.items.length)}/${plan.items.length}`)
      }
    }, collectionEnv)
  }

  const missingIds = await withCollection(async (collection) => {
    assertUnmanagedCollection(collection)
    const finalItems = await collection.getItems()
    const finalIds = new Set(finalItems.map((item) => readSanityId(item, fieldIds.sanityId)).filter(Boolean))
    return documents.filter((document) => document._id && !finalIds.has(document._id)).map((document) => document._id)
  }, collectionEnv)
  summary.verified = summary.upserted - missingIds.length
  if (missingIds.length) {
    throw new Error(
      `Framer full sync wrote ${summary.verified}/${summary.upserted} ${fieldSpecs === FRAMER_FIELDS ? 'article' : 'author'} item(s); missing ${missingIds.length} Sanity ID(s), e.g. ${missingIds.slice(0, 5).join(', ')}`
    )
  }

  return summary
}

export async function fullSyncFramer({articles, authors, dryRun = false, batchSize = 25, sessionSize = 100, pruneStale = true}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer')
  }
  if (!Number.isInteger(sessionSize) || sessionSize < batchSize) {
    throw new Error('sessionSize must be an integer greater than or equal to batchSize')
  }

  const result = {}
  if (articles !== undefined) {
    result.articles = await syncUnmanagedCollection(
      'FRAMER_COLLECTION_ID', FRAMER_FIELDS, articles, articleToFramerItem,
      {dryRun, batchSize, sessionSize, pruneStale},
    )
  }
  if (authors !== undefined) {
    result.authors = await syncUnmanagedCollection(
      'FRAMER_AUTHORS_COLLECTION_ID', AUTHOR_FIELDS, authors, authorToFramerItem,
      {dryRun, batchSize, sessionSize, pruneStale},
    )
  }
  return result
}