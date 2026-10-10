# Framer Subscribe button: Chargebee test checkout

## What this update does

The existing Subscribe button opens Memberstack login when needed, then calls
`POST /api/checkout`. The backend verifies the member, creates or reuses a
Chargebee customer with that exact member ID, and returns a hosted checkout URL.
Chargebee collects the test payment and returns to your existing homepage.

No Stripe/Razorpay connection is needed for this test: use the Chargebee Test
Gateway you have already configured. Never enter real card details. This update
does not deploy Vercel, edit your Framer project, or change Chargebee settings.

The article API continues to read current Chargebee subscription state.
No Chargebee-to-Vercel webhook is required for this first access test. A return
URL or `state=succeeded` query parameter never grants access.

## 1. Update the actual backend source

This delivery updates the attached copy under Downloads, not the running project
on your other computer. Overlay the backend files from the checkout update ZIP
onto the actual `cc-sync` source used by Vercel, preserving environment files and
`.vercel`. The ZIP contains no credentials, node_modules, or deployment metadata.

New runtime files:

- `api/checkout.js`
- `lib/checkout.js`
- `lib/checkoutHandler.js`

New tests: `tests/checkout.test.js` and `tests/checkoutHandler.test.js`.
The existing article backend and its dependencies must already be installed.
`framer/ChargebeeSubscribe.tsx` is source for Framer's code editor, not an API route.

From the backend root, use Node 22 and run `npm ci` then `npm test`.

## 2. Configure the Vercel test deployment

In Vercel, open your backend project -> Settings -> Environment Variables.
Choose the environment serving the backend URL you will actually use. A stable
staging URL is preferable to a changing deployment URL. An authentication-protected
Vercel preview will block browser API requests; use a reachable test endpoint,
without embedding any Vercel protection-bypass secret in Framer.

Set these values. Preserve any other existing allowed origins and sync settings.

```dotenv
ALLOWED_ORIGINS=https://first-actions-189325.framer.app
CHARGEBEE_PREMIUM_PRICE_IDS=cc-premium-INR-yearly,cc-premium-USD-Yearly
CHARGEBEE_CHECKOUT_ENABLED=true
CHARGEBEE_INR_PRICE_ID=cc-premium-INR-yearly
CHARGEBEE_USD_PRICE_ID=cc-premium-USD-Yearly
CHARGEBEE_CHECKOUT_RETURN_URL=https://first-actions-189325.framer.app/
```

Also confirm these server-only settings:

| Variable | Required setting |
| --- | --- |
| `CHARGEBEE_SITE` | Your exact TEST site name, without scheme or `.chargebee.com` |
| `CHARGEBEE_API_KEY` | Existing read-only TEST key with subscription access |
| `CHARGEBEE_CHECKOUT_API_KEY` | A separate TEST key allowed to read subscriptions/customers and create customers/hosted checkout pages |
| `MEMBERSTACK_APP_ID` | The app used by your published Framer login |
| `MEMBERSTACK_SECRET_KEY` | Server key for the same Memberstack app/environment as the Framer public key |

Create the checkout key under Chargebee -> Settings -> Configure Chargebee ->
API Keys and Events (or API Keys and Webhooks) -> API Keys. A Full Access TEST
key supports this test if granular write permissions are not offered. Store it
only in Vercel. Keep the read-only access key separate. Do not share key values
or put either secret into Framer. Rotate any previously exposed key.

In Chargebee, verify both annual prices are active, their amounts/currencies are
correct, and the Test Gateway supports the selected currency/payment method.
For this flow, trials are explicitly disabled and automatic collection is on.
Use ordinary non-consolidated billing and an immediate paid invoice for the test.
Configure checkout to collect the customer's email and required billing details.
The server uses Memberstack ID, not the entered billing email, for ownership.

Redeploy the backend after code and environment changes. Do not use live
Chargebee keys or switch the site to live for this test. `CHECKOUT_ENABLED`
is a feature switch, not automatic proof that credentials are test credentials.

Opening `/api/checkout` directly in a browser should return HTTP 405. That is
expected: the button must send an authenticated POST, not navigate to this API.

## 3. Connect the existing Framer button

1. Open Framer -> Assets -> Code -> create a code override file named
   `ChargebeeSubscribe.tsx`.
2. Use the full contents of the supplied `framer/ChargebeeSubscribe.tsx`.
3. Change only `BACKEND_URL` near the top to your actual public Vercel backend
   origin, for example `https://your-backend.vercel.app`. Do not use the Vercel
   dashboard URL or add `/api/checkout` to this value.
4. Keep the existing Memberstack install script and working login overrides.
   Do not install Memberstack a second time or add a Memberstack paid plan.
5. Select the actual clickable Subscribe layer in your header. If necessary,
   edit the header component and its desktop/mobile variants.
6. Leave its normal Link unset. Remove any competing tap navigation action.
   Under Code Overrides, choose `ChargebeeSubscribe` -> `withSubscribeINR`.
7. Publish and test on `https://first-actions-189325.framer.app`, not just the
   editor canvas. Existing Memberstack domain authorization must include it.

For the initial header test, use INR. To test USD, select `withSubscribeUSD`
instead, republish, and use a different test member. These are two fixed
currency actions, not automatic country detection or a currency selector.
Use clearly labeled INR/USD buttons on a future pricing page for a public flow.

Expected behavior:

- Signed out: Subscribe opens login with the existing free signup option.
- After successful email/password login: the modal closes and checkout opens.
- Signed in: Subscribe proceeds directly to Chargebee checkout.
- If social login or your global login settings redirect the browser, click
  Subscribe again after returning; cross-page checkout resumption is not added.
- Repeated clicks while the request is pending are ignored.
- Configuration/network errors are shown without exposing secrets.

No Chargebee.js script is required because this flow redirects to a full-page
hosted checkout rather than embedding a checkout modal.

## 4. Run the end-to-end test

1. Create a new Memberstack test member with no previous Chargebee subscription.
   Its Memberstack environment must match the frontend public key and backend key.
2. While signed in, verify a known Premium article is denied (HTTP 403).
3. Click Subscribe. In browser Developer Tools -> Network, `/api/checkout`
   should return 200 with a Chargebee hosted URL. Never share the Authorization
   header or hosted checkout URL in screenshots; both are sensitive.
4. Confirm checkout displays the expected annual amount, INR, and test mode.
   Use a success card from the Chargebee Test Gateway's test-card instructions,
   a future expiry, and the specified test CVV. Do not use a real card.
5. Complete checkout. You should return to the Framer homepage. This is not yet
   a confirmation page, and it does not show a Premium badge automatically.
6. In Chargebee, verify the customer ID is exactly the Memberstack member ID
   (`mem_...`), the subscription contains `cc-premium-INR-yearly`, its status
   is active, the invoice is paid, and there are no outstanding dues.
7. Open the same Premium article while signed in as that member. Its API should
   now return 200. Newly created subscriptions may take a short time to appear
   in Chargebee's list index; retry the article request before treating this
   as a failed purchase. Do not pay again to fix an access delay.
8. Sign out. Premium must return 401 and free articles must remain public (200).
9. Sign in as a different unpaid member. Premium must return 403.
10. Repeat with USD using a fresh test member and the `withSubscribeUSD` override.

If the article-body UI is not wired yet, run this in Developer Tools on the
published Framer page to test the API directly. Set the backend and an actual
published Premium article slug. It logs only status/error, not tokens or bodies.

```javascript
const backend = 'https://YOUR-BACKEND.vercel.app'
const slug = 'YOUR-PREMIUM-ARTICLE-SLUG'
const token = window.$memberstackDom?.getMemberCookie()
const response = await fetch(`${backend}/api/article?${new URLSearchParams({slug})}`, {
  headers: token ? {Authorization: `Bearer ${token}`} : {},
  cache: 'no-store',
})
const result = await response.json()
console.log({status: response.status, error: result.error || null})
```

Also test cancellation before payment, a gateway-declined payment, and a double
click. They must not grant Premium or produce two paid subscriptions. Opening
two checkout tabs concurrently should still produce at most one subscription:
the server sends the same immutable subscription ID for the member in both.
Verify this provider behavior in the test site before going live.

## 5. Troubleshooting

| Result | Check |
| --- | --- |
| Nothing on click | Override is attached to the clickable layer in every header variant; site was published |
| POST 404 | New checkout route not deployed, wrong backend URL, or wrong Vercel project |
| POST 401 | Sign out/in; public and secret Memberstack keys must use the same app/environment |
| POST 403 `origin_not_allowed` | Exact published origin is missing from `ALLOWED_ORIGINS`; no trailing slash |
| POST 409 `subscription_exists` | Account already has a subscription record; use a fresh test member, not another purchase |
| POST 409 `checkout_in_progress` | Provider is still processing a concurrent request; retry shortly |
| POST 503 `checkout_not_configured` | Enable switch, write key, price mapping, read allowlist, and return URL/origin must agree |
| POST 503 `checkout_unavailable` | Inspect Vercel/Chargebee request logs privately for key permissions, test site, catalog, or gateway configuration |
| Browser CORS/network failure | Backend is reachable without Vercel login; published Framer origin matches allowlist |
| Checkout succeeds, article 403 | Customer/member IDs, exact approved price, active term, paid invoice, dues, and list-index delay |
| Article 503 | Check Sanity/Memberstack/read-only Chargebee configuration independently |

The backend intentionally does not return raw provider errors or log keys.

## Boundaries before launch

This is a first-purchase test flow. Any existing subscription record, including
a cancelled one, blocks another purchase for that member. Reactivation, plan
changes, a customer portal, currency switching on an existing subscription,
confirmation UX, and automatic retries after social login are not implemented.
Do not delete customer/subscription records to work around this in production.

Chargebee retains idempotency responses for 30 minutes. Stable subscription IDs
provide a separate uniqueness constraint across clicks/tabs/currency choices;
there are no process-local locks. Other admin-created/legacy subscriptions are
checked through the list API and its eventual-consistency limitation still
applies. Do not use other subscription creation paths during this test.

Rate limiting at the edge and live provider/concurrency QA are required before
public launch. A public Sanity dataset still exposes protected article bodies;
this payment test does not resolve that source-privacy blocker. Single-active-
session enforcement and refund-driven access policy remain separate work.

References:

- https://apidocs.chargebee.com/docs/api/hosted_pages/create-checkout-for-a-new-subscription#subscription_id
- https://apidocs.chargebee.com/docs/api/customers/create-a-customer
- https://apidocs.chargebee.com/docs/api/idempotency
- https://www.memberstack.com/llms-full.txt