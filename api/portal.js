import {createMemberAuthenticator} from '../lib/memberstack.js'
import {createPremiumChecker} from '../lib/chargebee.js'
import {createPortalHandler, createPortalSession} from '../lib/membership.js'

const splitValues = value => (value || '').split(',').map(item => item.trim()).filter(Boolean)
const allowedOrigins = splitValues(process.env.ALLOWED_ORIGINS)

export default createPortalHandler({
  allowedOrigins,
  authenticate: createMemberAuthenticator({
    appId: process.env.MEMBERSTACK_APP_ID,
    secretKey: process.env.MEMBERSTACK_SECRET_KEY,
  }),
  hasPremiumAccess: createPremiumChecker({
    site: process.env.CHARGEBEE_SITE,
    apiKey: process.env.CHARGEBEE_API_KEY,
    priceIds: splitValues(process.env.CHARGEBEE_PREMIUM_PRICE_IDS),
  }),
  openPortal: createPortalSession({
    site: process.env.CHARGEBEE_SITE,
    apiKey: process.env.CHARGEBEE_CHECKOUT_API_KEY,
    returnUrl: process.env.CHARGEBEE_PORTAL_RETURN_URL || process.env.CHARGEBEE_CHECKOUT_RETURN_URL,
    allowedOrigins,
  }),
})