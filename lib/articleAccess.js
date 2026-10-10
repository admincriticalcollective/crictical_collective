export function createArticleHandler({
  authenticate,
  fetchArticle,
  hasPremiumAccess,
  allowedOrigins,
  freeTier = 'free',
  premiumTier = 'plan-3',
  logError = () => console.error('article access dependency failed'),
}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('CDN-Cache-Control', 'no-store')
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
    res.setHeader('Vary', 'Origin, Authorization')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (!allowedOrigins.length || !freeTier || !premiumTier || freeTier === premiumTier) {
      return res.status(503).json({error: 'access_not_configured'})
    }

    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({error: 'origin_not_allowed'})
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization')

    if (req.method === 'OPTIONS') return res.status(204).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS')
      return res.status(405).json({error: 'method_not_allowed'})
    }

    const slug = req.query?.slug
    if (typeof slug !== 'string' || !slug.trim() || slug.length > 512) {
      return res.status(400).json({error: 'invalid_slug'})
    }

    try {
      const article = await fetchArticle(slug)
      if (!article) return res.status(404).json({error: 'article_not_found'})

      const isPremium = article.accessTier === premiumTier
      if (article.accessTier !== freeTier && !isPremium) {
        return res.status(403).json({error: 'access_tier_not_supported'})
      }
      if (isPremium) {
        const authorization = req.headers.authorization
        const token = typeof authorization === 'string'
          ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1]
          : undefined
        if (!token) return res.status(401).json({error: 'login_required'})

        const member = await authenticate(token)
        if (!member?.id) return res.status(401).json({error: 'invalid_session'})
        if (!await hasPremiumAccess(member.id)) {
          return res.status(403).json({error: 'premium_required'})
        }
      }

      return res.status(200).json({article: {
        _id: article._id,
        slug: article.slug,
        title: article.title,
        accessTier: article.accessTier,
        body: article.body ?? [],
      }})
    } catch {
      logError()
      return res.status(503).json({error: 'content_temporarily_unavailable'})
    }
  }
}