import {createArticleHandler} from '../lib/articleAccess.js'
import {createMemberAuthenticator} from '../lib/memberstack.js'
import {createPremiumChecker} from '../lib/chargebee.js'
import {fetchProtectedArticleBySlug} from '../lib/sanity.js'

const splitValues = value => (value || '').split(',').map(item => item.trim()).filter(Boolean)

export default createArticleHandler({
  allowedOrigins: splitValues(process.env.ALLOWED_ORIGINS),
  freeTier: process.env.SANITY_FREE_TIER || 'free',
  premiumTier: process.env.SANITY_PREMIUM_TIER || 'plan-3',
  authenticate: createMemberAuthenticator({
    appId: process.env.MEMBERSTACK_APP_ID,
    secretKey: process.env.MEMBERSTACK_SECRET_KEY,
  }),
  fetchArticle: fetchProtectedArticleBySlug,
  hasPremiumAccess: createPremiumChecker({
    site: process.env.CHARGEBEE_SITE,
    apiKey: process.env.CHARGEBEE_API_KEY,
    priceIds: splitValues(process.env.CHARGEBEE_PREMIUM_PRICE_IDS),
  }),
})