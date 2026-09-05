// Sanity client + the article projection used for the Framer bridge.
// NOTE: the gated `body` is intentionally NOT fetched — only public/meta fields
// go to the bridge; body is served later via the authenticated API (Phase 8).
import {createClient} from '@sanity/client'

export const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_READ_TOKEN,
  useCdn: false,
})

// Matches the corrected article schema (section/author references, year, readingTimeMins…)
export const ARTICLE_PROJECTION = `{
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

export function fetchAllArticles() {
  return sanity.fetch(
    `*[_type == "article" && !(_id in path("drafts.**"))] ${ARTICLE_PROJECTION}`
  )
}

export function fetchArticleById(id) {
  return sanity.fetch(
    `*[_type == "article" && _id == $id][0] ${ARTICLE_PROJECTION}`,
    {id}
  )
}
