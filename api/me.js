import {createMemberAuthenticator} from '../lib/memberstack.js'
import {createPremiumChecker} from '../lib/chargebee.js'
import {createMeHandler} from '../lib/membership.js'

const splitValues = value => (value || '').split(',').map(item => item.trim()).filter(Boolean)

export default createMeHandler({
  allowedOrigins: splitValues(process.env.ALLOWED_ORIGINS),
  authenticate: createMemberAuthenticator({
    appId: process.env.MEMBERSTACK_APP_ID,
    secretKey: process.env.MEMBERSTACK_SECRET_KEY,
  }),
  hasPremiumAccess: createPremiumChecker({
    site: process.env.CHARGEBEE_SITE,
    apiKey: process.env.CHARGEBEE_API_KEY,
    priceIds: splitValues(process.env.CHARGEBEE_PREMIUM_PRICE_IDS),
  }),
})