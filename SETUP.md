# cc-sync — Setup Guide (complete, beginner-friendly)

This walks you through **everything**: where to run it, what to install, **where to get every key
and ID**, how to fill `.env`, how to run it, how to connect Framer, and how to deploy the auto-sync
webhook. Follow top to bottom.

If you only read one thing: automatic Vercel sync requires an **unmanaged Framer CMS collection**.
The existing plugin creates a Managed Collection for manual sync, but Framer does not allow the
separate Server API process to write to that plugin-owned collection. Neither path touches the
gated article body.

For automatic direct sync, create an ordinary CMS collection in Framer, set `FRAMER_COLLECTION_ID`
to its ID, and run `npm run framer:configure` to create the fields. Then deploy this service to
Vercel. You need Node.js 18+, a Framer project/API key, an unmanaged collection ID, and a Sanity
project ID, dataset, Viewer token, and webhook secret.

For Authors, create a second ordinary CMS collection named `Authors`, set
`FRAMER_AUTHORS_COLLECTION_ID` to its ID, and run `npm run framer:configure:authors`. Use the same
Sanity webhook with projection `{ "_id": _id, "_type": _type }` and filter:
`_type in ["article", "author"]`.

To backfill the direct unmanaged collections after a bulk Sanity import, pull the Vercel production
env vars into a separate ignored file (preserving any existing `.env.local`) and run:

```powershell
vercel env pull .env.sync.local --environment=production
$env:SYNC_ENV_FILE = '.env.sync.local'
npm run framer:sync:all -- --dry-run
npm run framer:sync:all
```

The dry run reports Sanity counts and planned stale-item cleanup without writing to Framer. Review
the counts before running the live command. The live run upserts in batches by Sanity ID and prunes
only existing Framer items that carry a Sanity ID but no longer exist in Sanity. It preserves
manually created Framer items without a Sanity ID. Run this from the service project root; it is
separate from `npm run sync:all`, which writes to Airtable.

The command writes 25 items per request and reconnects every 100 items by default to limit the
effect of long-lived Server API connections closing. Both settings can be adjusted with
`--batch-size=N` and `--session-size=N`; rerunning is safe because items are matched by Sanity ID.

---

## 0. What you need before starting

| Thing | Why | Have it? |
|---|---|---|
| **Node.js 18+** | runs the script | check with `node -v` |
| **Sanity project** (already built) | source of content | ✅ you have this |
| **Airtable account** | the bridge Framer reads | free signup at airtable.com |
| **Framer paid site** | the CMS + sync | ✅ you have this |
| **Vercel account** *(for auto-sync only)* | hosts the webhook | free signup at vercel.com |

Install Node if `node -v` fails: download the **LTS** installer from https://nodejs.org and re-open
PowerShell.

---

## 1. Where this lives

The service is already here:

```
c:\Users\elugotiw\Documents\critical-collective\services\cc-sync\
```

Open a terminal there:

```powershell
cd c:\Users\elugotiw\Documents\critical-collective\services\cc-sync
```

Keep it **outside** the `old_a2a` repo (it already is). It's a standalone mini-project.

---

## 2. Get your Sanity values (4 of them)

### 2a. `SANITY_PROJECT_ID` and `SANITY_DATASET`
- Open your Studio project folder → file **`sanity.config.ts`** (or `.js`). You'll see:
  ```ts
  projectId: 'abcd1234',   // <- SANITY_PROJECT_ID
  dataset: 'production',   // <- SANITY_DATASET
  ```
- Or go to **https://manage.sanity.io** → click your project → **Settings** → the **Project ID** is
  shown there. Dataset is almost always `production`.

### 2b. `SANITY_API_READ_TOKEN`
1. Go to **https://manage.sanity.io** → your project → **API** tab (top).
2. Left menu → **Tokens** → **Add API token**.
3. Name: `cc-sync-read`. Permission: **Viewer** (read-only is enough).
4. Click **Save** → **copy the token now** (it's shown only once). It looks like `sk...`.

### 2c. `SANITY_WEBHOOK_SECRET`
- You **invent** this — any long random string. Generate one:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Copy the output. You'll paste the **same value** in `.env` *and* in the Sanity webhook later
  (Step 7). It's what proves a webhook call really came from Sanity.

---

## 3. Get your Airtable values (3 of them) + build the table

### 3a. Create the base and table
1. Sign in at **https://airtable.com** → **Create → Start from scratch** → name it
   **Critical Collective**.
2. Rename the first table to **Articles**.
3. Add these fields (exact names — they must match the script). Delete Airtable's default extra
   columns you don't need:

   | Field | Type |
   |---|---|
   | Sanity ID | Single line text |
   | Title | Single line text |
   | Slug | Single line text |
   | Kicker | Single line text |
   | Subtitle | Single line text |
   | Article Type | Single line text |
   | Teaser | Long text |
   | Access Tier | Single line text |
   | Year | Number (integer) |
   | Reading Time | Number (integer) |
   | Published At | Date |
   | Section | Single line text |
   | Section Slug | Single line text |
   | Subsection | Single line text |
   | Author Name | Single line text |
   | Author Slug | Single line text |
   | Tags | Single line text |
   | Hero Image | URL |
   | SEO Title | Single line text |
   | SEO Description | Long text |
   | Status | Single select → options `live`, `archived` |

   > Tip: make **Sanity ID** the field the script merges on — it must exist and be unique per article.

### 3b. `AIRTABLE_TOKEN` (Personal Access Token)
1. Go to **https://airtable.com/create/tokens** (Account → Developer hub → Personal access tokens).
2. **Create new token** → Name: `cc-sync`.
3. **Scopes** → add:
   - `data.records:read`
   - `data.records:write`
4. **Access** → add your **Critical Collective** base.
5. **Create token** → **copy it now** (shown once). It starts with `pat...`.

### 3c. `AIRTABLE_BASE_ID`
1. Open your base → top-right **Help** → **API documentation** (or go to
   **https://airtable.com/api** and pick the base).
2. The page says: *"The ID of this base is `appXXXXXXXXXXXXXX`."* → that's your base ID.

### 3d. `AIRTABLE_TABLE`
- Just the table name: **`Articles`** (already the default in `.env.example`).

---

## 4. Fill in `.env`

1. Copy the template:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Open `.env` and paste your values:
   ```
   SANITY_PROJECT_ID=abcd1234
   SANITY_DATASET=production
   SANITY_API_READ_TOKEN=sk...          # from 2b
   SANITY_WEBHOOK_SECRET=your_random_hex # from 2c
   AIRTABLE_TOKEN=pat...                 # from 3b
   AIRTABLE_BASE_ID=app...               # from 3c
   AIRTABLE_TABLE=Articles
   ```
3. **Never commit `.env`** or share it — these are secrets.

---

## 5. Install & run the first full sync

```powershell
npm install
npm run sync:all
```

You should see `Fetched N article(s)` then `Upserted N row(s)`. Open your Airtable **Articles**
table — the rows should be there.

**If it errors:**
- `invalid token` / 401 → re-check `SANITY_API_READ_TOKEN`.
- Airtable `422` → a field name in the table doesn't match the list in §3a; fix the name.
- `AIRTABLE_BASE_ID` wrong → double-check it starts with `app`.

---

## 6. Connect Framer to Airtable

1. In Framer: **Assets → CMS → Articles → Sync** (or **+ → Sync from Airtable**).
2. Authorize with your **Airtable token**, pick the **Critical Collective** base and **Articles**
   table.
3. **Map columns** → Framer field ← Airtable field (Title→Title, Slug→Slug, Teaser→Teaser, etc.).
4. Add a Framer **filter** so only `Status = live` items show (hides archived).
5. Save. Your synced articles now appear in the Framer CMS and render through your Article template.

> Framer refreshes on a schedule / on publish. You can also trigger a manual sync from that panel.

---

## 7. Auto-sync on publish (deploy the webhook)

This makes "Publish in Sanity → appears in Framer" automatic. Skip if you're happy running
`npm run sync:all` manually for now.

### 7a. Deploy to Vercel
1. Create a free account at **https://vercel.com** (sign in with GitHub is easiest).
2. Install the CLI and deploy:
   ```powershell
   npm i -g vercel
   vercel        # first run: log in + link/create a project, accept defaults
   vercel --prod # deploys; prints your URL, e.g. https://cc-sync.vercel.app
   ```
   Your webhook endpoint is that URL + **`/api/sync`**.

### 7b. Add the env vars in Vercel
- Vercel dashboard → your project → **Settings → Environment Variables** → add the **same**
  values from your `.env` (all 7). Or via CLI: `vercel env add SANITY_PROJECT_ID` … then
  `vercel --prod` again so they take effect.

### 7c. Register the webhook in Sanity
1. **https://manage.sanity.io** → project → **API** → **Webhooks** → **Create Webhook**.
2. Fill:
   - **Name:** `cc-sync`
   - **URL:** `https://<your-app>.vercel.app/api/sync`
   - **Trigger on:** ✅ Create ✅ Update ✅ Delete
   - **Filter:** `_type == "article"`
   - **Projection:** `{ "_id": _id }`
   - **HTTP method:** POST
   - **Secret:** paste the **same** `SANITY_WEBHOOK_SECRET` from your `.env`
3. Save.

### 7d. Test it
- Edit any article in Sanity → **Publish**. Within a moment:
  - Vercel **Logs** (dashboard → your project → Logs) show `action: upserted`.
  - The Airtable row updates.
  - Framer picks it up on its next sync.
- Delete an article in Sanity → the row's **Status** becomes `archived`.

---

## 8. Scheduled Framer site publish

The Sanity webhook updates CMS items. A GitHub Actions workflow checks hourly and calls the
Vercel publish endpoint; the endpoint republishes Framer when the configured interval is due.
Set `FRAMER_PUBLISH_INTERVAL_HOURS` in Vercel to an integer from `1` to `24`; it defaults to `24`
(once daily).

1. Deploy the latest `cc-sync` code to Vercel. The GitHub workflow calls
   `https://cc-sync-eight.vercel.app/api/publish`.
2. Add `CRON_SECRET` to Vercel Environment Variables as a long random value. Set
   `FRAMER_PUBLISH_INTERVAL_HOURS` to your desired interval, such as `3`, then redeploy.
3. Add an Actions repository secret named `CRON_SECRET` with the exact same value configured
   in Vercel: **Settings → Secrets and variables → Actions → New repository secret**.
4. The production alias currently uses Standard Protection, which allows production URLs through;
   no Vercel protection setting needs to be disabled. If you later protect production URLs, create
   a **Protection Bypass for Automation** secret in Vercel and add it to GitHub as
   `VERCEL_AUTOMATION_BYPASS_SECRET`.
5. Commit and push `.github/workflows/framer-publish.yml` to the repository's default branch. The
   workflow runs hourly; the API uses `FRAMER_PUBLISH_INTERVAL_HOURS` to decide whether to publish.
6. Check the repository's **Actions** tab for workflow results and Vercel Logs for publish details.
   GitHub scheduled workflows may start late during periods of high load.

## 9. Everyday use

| Task | Do this |
|---|---|
| Re-sync everything (after schema change / drift) | `npm run sync:all` |
| Normal editing | just Publish in Sanity — the webhook handles it |
| A publish didn't show | check Vercel Logs, then run `npm run sync:all` |
| Rotated a token | update it in `.env` **and** Vercel env vars |

---

## 9. Important limits & notes
- **Airtable free = 1,000 records/base.** Fine for testing; for the full ~4,300 articles use an
  Airtable **paid** plan, or switch the bridge to **Google Sheets** (free at this size) — ask and
  I'll add `lib/sheets.js`.
- The **gated body is never synced** here (by design). It's served later via the authenticated
  API (Phase 8).
- **Slugs are preserved verbatim** Sanity → Airtable → Framer (your hard requirement).

---

## 10. Where each secret comes from (quick reference)

| Env var | Where to get it |
|---|---|
| `SANITY_PROJECT_ID` | `sanity.config.ts` or manage.sanity.io → Project → Settings |
| `SANITY_DATASET` | usually `production` (same places) |
| `SANITY_API_READ_TOKEN` | manage.sanity.io → API → Tokens → Add (Viewer) |
| `SANITY_WEBHOOK_SECRET` | you generate it (`node -e "..."` above); reuse in the webhook |
| `AIRTABLE_TOKEN` | airtable.com/create/tokens → Create (read+write scopes, your base) |
| `AIRTABLE_BASE_ID` | airtable.com/api → your base → "The ID of this base is app…" |
| `AIRTABLE_TABLE` | your table name (`Articles`) |

---

## 11. Security checklist
- [ ] `.env` is never committed or shared
- [ ] Sanity token is **Viewer** (read-only), not Editor
- [ ] Airtable token is scoped to **only** the Critical Collective base
- [ ] Same `SANITY_WEBHOOK_SECRET` in `.env` and the Sanity webhook
- [ ] Env vars set in Vercel (not hard-coded)
