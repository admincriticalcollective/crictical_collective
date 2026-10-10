# Free and Premium article access

## Implemented

`GET /api/article?slug=<article-slug>` returns the article body as Portable Text.
Free articles are public and need no login or Authorization header. Only Premium
requests need `Authorization: Bearer <Memberstack member JWT>` and eligible billing.
Free requests skip authentication and billing, even if an expired token is supplied.

| Reader | Free article | Premium article |
| --- | --- | --- |
| Signed out | 200 | 401 |
| Signed in without eligible billing | 200 | 403 |
| Signed in with eligible Premium billing | 200 | 200 |

An unknown or missing tier denies access. Drafts and release-version documents
are excluded. Essays stored as article documents use the same endpoint.
Newsletters are not implemented; they need their own schema and content endpoint.

This changes the attached backend copy only. It does not change the running
backend on another computer, your Vercel deployment, Sanity settings, or Framer UI.

## 1. Secure the source before launch

Your dataset is currently public. Anyone who knows the project and dataset can
query full bodies directly, bypassing this API. CORS cannot fix this.

In the Sanity project management console, open Datasets and change the content
dataset to private using the dataset settings. Current Sanity documentation lists
private datasets as a Growth-plan feature. Check the client's plan first. A trial
can revert a private dataset to public when it ends.

Keep the Sanity read token in Vercel, never in published Framer code. The existing
server sync already uses `SANITY_API_READ_TOKEN` and excludes bodies. After making
the dataset private, confirm sync still works and an anonymous query for a known
published article cannot return its body. Private queries may return HTTP 200
with empty data: inspect the body, not just the status code.

The supplied Framer editor plugin stores a Sanity token in collection plugin
data. Treat that as trusted-editor-only tooling; never expose that token through
CMS fields or published browser code. Audit any other browser-to-Sanity calls.

Private dataset access does not establish private delivery of image/PDF asset
URLs. This endpoint protects article JSON, not downloaded or shared assets. Do not
host full premium PDFs at public asset URLs; private media needs a separate design.

If a private dataset is not available, stop the paywall rollout. Move protected
bodies to a private store as a separate migration; do not rely on this API alone.

## 2. Find the access-tier values

Open the Sanity Studio project on the other computer, not this sync project.
Search its source for `accessTier` using VS Code workspace search. The schema is
commonly under `schemaTypes/article.ts`, `schemas/article.ts`, or a JavaScript
equivalent. In an options entry, `title` is the display label and `value` is the
stored value used by authorization.

Alternatively, if the Studio has a Vision tab, run:

```groq
array::unique(*[_type == "article" && !(_id in path("drafts.**"))].accessTier)
```

Or inspect one published document as JSON and find `accessTier`.
The defaults are `free` and `plan-3`, but those are not yet confirmed for your
deployed dataset. Set the two tier environment variables to the exact strings.
Do not give both variables the same value. Missing tiers stay denied.

## 3. Configure and deploy

Merge the updated backend into the actual Vercel source project on the other
computer. Preserve that computer's local environment files and deployment link.
Do not transfer secrets or `.vercel` metadata from this attached copy.

From the backend root on Node 22:

```powershell
npm ci
npm test
```

Add these server-side variables in the Vercel project's environment settings:

| Variable | Value |
| --- | --- |
| `SANITY_PROJECT_ID` | Existing project ID |
| `SANITY_DATASET` | Existing content dataset |
| `SANITY_API_READ_TOKEN` | Viewer token with access to the private dataset |
| `MEMBERSTACK_APP_ID` | Your Memberstack app ID |
| `MEMBERSTACK_SECRET_KEY` | Test secret key for testing, live key for production |
| `ALLOWED_ORIGINS` | Exact published Framer/custom-domain origins, comma separated |
| `SANITY_FREE_TIER` | Confirmed stored free value, provisionally `free` |
| `SANITY_PREMIUM_TIER` | Confirmed stored premium value, provisionally `plan-3` |

An origin includes the scheme and hostname, with no path or trailing slash.
Do not use `*`. Include the actual published staging origin for browser testing.
Keep the existing sync environment variables unchanged. Redeploy using the
project's existing deployment workflow after adding the new code and variables.

Leave all three `CHARGEBEE_*` variables blank until billing is ready. Free
articles will work for everyone; Premium articles will return 401 when signed out
or 403 for authenticated members without eligible billing.
Partial billing configuration or a billing outage returns 503 for Premium, never
full content. Free reads do not depend on Memberstack or Chargebee.

## 4. Framer integration contract

Keep metadata and teasers in Framer CMS. Fetch free article bodies without waiting
for Memberstack initialization or requiring sign-in:

```http
GET /api/article?slug=example-free-article
```

For Premium content, use the current Memberstack member token, not the member ID
or email. The authenticated request must look like:

```http
GET /api/article?slug=example-article
Authorization: Bearer <current-member-jwt>
```

The response is:

```json
{
  "article": {
    "_id": "article-example",
    "slug": "example-article",
    "title": "Example article",
    "accessTier": "free",
    "body": []
  }
}
```

Use `URLSearchParams` to encode the actual CMS slug. Render `body` with a Portable
Text renderer, not raw HTML. Image blocks include a resolved `url` when present.
Do not store returned bodies in Framer CMS, localStorage, or a service-worker
cache. Clear displayed Premium bodies on logout or account change and abort pending
Premium requests so an old response cannot repopulate them. Free articles can
remain visible after logout. No Framer component has been
changed in this delivery; the article-body component is needed for that step.

| Response | Frontend behavior |
| --- | --- |
| 200 | Render the body |
| 401 | Show sign-in |
| 403 `premium_required` | Show Premium subscription prompt |
| 403 `access_tier_not_supported` | Show unavailable content; fix editorial tier |
| 404 | Show article not found |
| 503 | Show temporary unavailability; do not use a public-body fallback |

CORS restricts browser reads; it is not authentication. Requests without an Origin
header are allowed for nonbrowser clients, with the same tier-based access rules.
Every response remains marked no-store for browsers and CDNs, including free
articles, to avoid retaining a public cached copy after a tier change to Premium.

## 5. Connect Chargebee later

The first-purchase test checkout is now documented in `CHECKOUT_SETUP.md`.
Follow that guide for the authenticated Subscribe button and checkout write key;
the billing-read policy below still applies to article access.

The adapter uses Product Catalog 2.0. Once you create the test account and prices:

- Set `CHARGEBEE_SITE` to the site name, without `https://` or `.chargebee.com`.
- Set `CHARGEBEE_API_KEY` to a server-side key permitted to read subscriptions.
- Set `CHARGEBEE_PREMIUM_PRICE_IDS` to the exact allowed price IDs, comma separated.
  These are monthly/annual price IDs, not the Premium plan ID.
- Create customers with `customer.id` equal to the verified Memberstack member ID.
  The future server-side checkout must enforce this mapping, never accept an
  arbitrary customer ID from the browser, and prevent duplicate active subscriptions.
  Customers created with unrelated auto-generated IDs will not match this API.

The API reads Chargebee on each Premium request. It lists candidate subscriptions
for that customer, then retrieves the current candidate before granting access.
List indexing can delay new access; a stale list alone cannot authorize a
cancelled subscription. Calls share an eight-second timeout and bounded pagination.
There is no process-local entitlement cache or mutable session state.

Current billing policy:

- Allowed statuses: `active`, or `non_renewing` until the current term ends.
- Current term must have started and must not have ended.
- A plan item must match an explicitly approved Premium price ID.
- `due_invoices_count` and `total_dues` must both be present and zero.
- Deleted, decommissioned, paused, cancelled, future, and trial subscriptions deny.
- No payment grace period. Consolidated/hierarchy billing that omits dues fields
  is unsupported and denies. Confirm this strict policy before launch.
- Refunds do not necessarily cancel a Chargebee subscription. Decide the refund
  policy and revoke/cancel entitlement in the billing workflow when required.

Checkout creation is a separate endpoint described in `CHECKOUT_SETUP.md`.
Billing portal, webhook processing, and newsletter delivery remain unimplemented.
Current-state reads let access work without
a webhook-maintained entitlement database, at the cost of billing API calls.
Review provider rate limits and add edge rate limiting before high-volume launch.

## 6. Verification and remaining gates

`npm test` uses local RSA-signed tokens and mocked provider responses. It does not
use `.env.local` or real member/payment data. Test the deployed integration too:

1. Anonymous requests receive free bodies (200) but not Premium bodies (401).
2. A signed-in free member receives a free body but not a Premium body.
3. Wrong-app, expired, or tampered member tokens return 401 for Premium content.
  Free articles remain readable regardless of the supplied token.
4. After Chargebee setup, a matching eligible subscription can read both tiers.
5. Immediate cancellation removes Premium access; end-of-term cancellation keeps
   access only until the term boundary. Unpaid, paused, and expired states deny.
6. Request a known body directly from Sanity without a token and verify it is absent.
7. Test the real published Framer origin and inspect network responses for leaks.
8. Verify a newly published article still syncs without its body.

The verifier uses HTTPS signing keys, issuer/audience checks, RS256 signatures,
mandatory expiry, and a Memberstack Admin lookup for the member's existence in
the configured environment. The official Admin SDK 1.7.0 was inspected but is not
used because its verifier fetches JWKS over plain HTTP. This implementation uses
the corresponding public `jwks.json` object over HTTPS with `jose`.

JWT validity and member existence do not prove the session is still the latest
login. Immediate logout revocation and one-active-session enforcement are NOT
implemented by this endpoint. Test Memberstack's concurrent-login behavior and
add server-side session enforcement before claiming that requirement is met.

References:

- https://developers.memberstack.com/admin-node-package/verification
- https://developers.memberstack.com/admin-node-package/member-actions
- https://member-jwt.s3.us-east-1.amazonaws.com/jwks.json
- https://apidocs.chargebee.com/docs/api/subscriptions/list-subscriptions
- https://www.sanity.io/docs/content-lake/datasets