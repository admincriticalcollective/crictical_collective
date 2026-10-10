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

export function fetchAllAuthors() {
  return sanity.fetch(
    `*[_type == "author" && !(_id in path("drafts.**"))] ${AUTHOR_PROJECTION}`
  )
}

export function fetchArticleById(id) {
  return sanity.fetch(
    `*[_type == "article" && _id == $id][0] ${ARTICLE_PROJECTION}`,
    {id}
  )
}

export function fetchProtectedArticleBySlug(slug) {
  if (!process.env.SANITY_API_READ_TOKEN) throw new Error('Sanity read token is required')
  return sanity.withConfig({
    perspective: 'published',
    timeout: 6000,
    maxRetries: 0,
  }).fetch(
    `*[_type == "article" && slug.current == $slug &&
      !(_id in path("drafts.**")) && !(_id in path("versions.**"))][0]{
      _id, title, "slug": slug.current, accessTier,
      body[]{..., _type == "image" => { ..., "url": asset->url }}
    }`,
    {slug},
  )
}

export const AUTHOR_PROJECTION = `{
  _id,
  name,
  "slug": slug.current,
  "avatar": avatar.asset->url,
  bio
}`

export function fetchAuthorById(id) {
  return sanity.fetch(
    `*[_type == "author" && _id == $id && !(_id in path("drafts.**"))][0] ${AUTHOR_PROJECTION}`,
    {id}
  )
}
