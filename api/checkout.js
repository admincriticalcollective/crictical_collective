import {createCheckout} from '../lib/checkout.js'
import {createCheckoutHandler} from '../lib/checkoutHandler.js'
import {createMemberAuthenticator} from '../lib/memberstack.js'

const splitValues = value => (value || '').split(',').map(item => item.trim()).filter(Boolean)
const allowedOrigins = splitValues(process.env.ALLOWED_ORIGINS)
const prices = {
  INR: process.env.CHARGEBEE_INR_PRICE_ID,
  USD: process.env.CHARGEBEE_USD_PRICE_ID,
}
const premiumPrices = splitValues(process.env.CHARGEBEE_PREMIUM_PRICE_IDS)

export default createCheckoutHandler({
  allowedOrigins,
  authenticate: createMemberAuthenticator({
    appId: process.env.MEMBERSTACK_APP_ID,
    secretKey: process.env.MEMBERSTACK_SECRET_KEY,
  }),
  checkout: createCheckout({
    enabled: process.env.CHARGEBEE_CHECKOUT_ENABLED === 'true' &&
      Object.values(prices).every(price => premiumPrices.includes(price)),
    site: process.env.CHARGEBEE_SITE,
    apiKey: process.env.CHARGEBEE_CHECKOUT_API_KEY,
    prices,
    allowedOrigins,
    returnUrl: process.env.CHARGEBEE_CHECKOUT_RETURN_URL,
  }),
})