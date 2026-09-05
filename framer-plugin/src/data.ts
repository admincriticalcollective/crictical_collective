import {
  framer,
  type FieldDataInput,
  type ManagedCollection,
  type ManagedCollectionFieldInput,
  type ManagedCollectionItemInput,
  type ProtectedMethod,
} from "@framer/plugin"

export const CONFIG_KEY = "sanityConfig"

export interface SanityConfig {
  projectId: string
  dataset: string
  token: string
}

interface Article {
  _id: string
  title?: string
  slug?: string
  kicker?: string
  subtitle?: string
  articleType?: string
  teaser?: string
  accessTier?: string
  year?: number | null
  readingTimeMins?: number | null
  publishedAt?: string | null
  section?: string
  sectionSlug?: string
  subsection?: string
  author?: string
  authorSlug?: string
  tags?: string[]
  heroImage?: string
  seoTitle?: string
  seoDescription?: string
}

const articleProjection = `{
  _id,
  title,
  kicker,
  subtitle,
  "slug": slug.current,
  articleType,
  teaser,
  accessTier,
  year,
  readingTimeMins,
  publishedAt,
  subsection,
  "section": section->title,
  "sectionSlug": section->slug.current,
  "author": coalesce(author->name, authorNameFallback),
  "authorSlug": author->slug.current,
  "tags": tags[]->title,
  "heroImage": heroImage.asset->url,
  seoTitle,
  seoDescription
}`

export const articleFields: ManagedCollectionFieldInput[] = [
  { id: "sanityId", name: "Sanity ID", type: "string" },
  { id: "title", name: "Title", type: "string" },
  { id: "slug", name: "Slug", type: "string" },
  { id: "kicker", name: "Kicker", type: "string" },
  { id: "subtitle", name: "Subtitle", type: "string" },
  { id: "articleType", name: "Article Type", type: "string" },
  { id: "teaser", name: "Teaser", type: "string" },
  { id: "accessTier", name: "Access Tier", type: "string" },
  { id: "year", name: "Year", type: "number" },
  { id: "readingTime", name: "Reading Time", type: "number" },
  { id: "publishedAt", name: "Published At", type: "date" },
  { id: "section", name: "Section", type: "string" },
  { id: "sectionSlug", name: "Section Slug", type: "string" },
  { id: "subsection", name: "Subsection", type: "string" },
  { id: "authorName", name: "Author Name", type: "string" },
  { id: "authorSlug", name: "Author Slug", type: "string" },
  { id: "tags", name: "Tags", type: "string" },
  { id: "heroImage", name: "Hero Image", type: "image" },
  { id: "seoTitle", name: "SEO Title", type: "string" },
  { id: "seoDescription", name: "SEO Description", type: "string" },
  { id: "status", name: "Status", type: "string" },
]

export const syncMethods = [
  "ManagedCollection.setFields",
  "ManagedCollection.removeItems",
  "ManagedCollection.addItems",
  "ManagedCollection.setPluginData",
] as const satisfies ProtectedMethod[]

export async function getConfig(collection: ManagedCollection): Promise<SanityConfig | null> {
  const stored = await collection.getPluginData(CONFIG_KEY)
  if (!stored) return null

  try {
    const config = JSON.parse(stored) as Partial<SanityConfig>
    if (!config.projectId || !config.dataset || !config.token) return null
    return config as SanityConfig
  } catch {
    return null
  }
}

export async function fetchArticles(config: SanityConfig, signal?: AbortSignal): Promise<Article[]> {
  const query = `*[_type == "article" && !(_id in path("drafts.**"))] ${articleProjection}`
  const url = new URL(`https://${config.projectId}.api.sanity.io/v2024-01-01/data/query/${encodeURIComponent(config.dataset)}`)
  url.searchParams.set("query", query)

  const response = await fetch(url, {
    signal,
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!response.ok) {
    throw new Error(`Sanity request failed (${response.status})`)
  }

  const payload = (await response.json()) as { result?: Article[] }
  return payload.result ?? []
}

function value(
  value: string | number | null,
  type: "string" | "number" | "date" | "image",
): FieldDataInput[string] {
  return { type, value } as unknown as FieldDataInput[string]
}

function articleToItem(article: Article): ManagedCollectionItemInput | null {
  if (!article._id || !article.slug || !article.title) return null

  const fieldData: FieldDataInput = {
    sanityId: value(article._id, "string"),
    title: value(article.title, "string"),
    slug: value(article.slug, "string"),
    kicker: value(article.kicker ?? article.section ?? "", "string"),
    subtitle: value(article.subtitle ?? "", "string"),
    articleType: value(article.articleType ?? "", "string"),
    teaser: value(article.teaser ?? "", "string"),
    accessTier: value(article.accessTier ?? "free", "string"),
    year: value(article.year ?? null, "number"),
    readingTime: value(article.readingTimeMins ?? null, "number"),
    publishedAt: value(article.publishedAt ?? null, "date"),
    section: value(article.section ?? "", "string"),
    sectionSlug: value(article.sectionSlug ?? "", "string"),
    subsection: value(article.subsection ?? "", "string"),
    authorName: value(article.author ?? "", "string"),
    authorSlug: value(article.authorSlug ?? "", "string"),
    tags: value((article.tags ?? []).filter(Boolean).join(", "), "string"),
    heroImage: value(article.heroImage ?? "", "image"),
    seoTitle: value(article.seoTitle ?? "", "string"),
    seoDescription: value(article.seoDescription ?? "", "string"),
    status: value("live", "string"),
  }

  return {
    id: article._id,
    slug: article.slug,
    draft: false,
    fieldData,
  }
}

export async function syncCollection(collection: ManagedCollection, config: SanityConfig) {
  const articles = await fetchArticles(config)
  const items = articles
    .map(articleToItem)
    .filter((item): item is ManagedCollectionItemInput => item !== null)

  const currentIds = new Set(await collection.getItemIds())
  for (const item of items) currentIds.delete(item.id)

  await collection.setFields(articleFields)
  if (currentIds.size > 0) await collection.removeItems(Array.from(currentIds))
  await collection.addItems(items)
  await collection.setPluginData(CONFIG_KEY, JSON.stringify(config))

  return { fetched: articles.length, synced: items.length, removed: currentIds.size }
}

export async function syncExistingCollection(collection: ManagedCollection) {
  const config = await getConfig(collection)
  if (!config || framer.mode !== "syncManagedCollection" || !framer.isAllowedTo(...syncMethods)) {
    return false
  }

  await syncCollection(collection, config)
  return true
}
