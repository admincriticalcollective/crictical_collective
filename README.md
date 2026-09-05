# cc-sync — Phase 3: Sanity → Framer sync

## Direct automatic sync

The Vercel webhook in `api/sync.js` keeps an unmanaged Framer CMS collection updated directly from
Sanity. The Framer plugin remains available for manual synchronization into a Managed Collection,
but the separate Vercel process cannot write to a plugin-owned collection.

After the plugin has created the collection, configure `FRAMER_PROJECT_URL`, `FRAMER_API_KEY`, and
`FRAMER_COLLECTION_ID` in Vercel alongside the Sanity variables. The webhook handles article
publish/update/delete events and never syncs the gated `body`.

## Direct Framer CMS plugin

The `framer-plugin/` folder contains a direct Sanity → Framer Managed Collection plugin. It
reuses the article projection and field mapping from this service, so Airtable is optional rather
than required. See [framer-plugin/README.md](framer-plugin/README.md) for setup and local development.

The plugin requires a Sanity project ID, dataset, and read-only Viewer token. It syncs the same
public/meta fields listed below, excludes the gated `body`, and removes Framer items that are no
longer returned by Sanity. The plugin must be opened from a Framer project with a Managed CMS
Collection and Developer Tools enabled.

The automatic path uses Framer's Server API to write items into an unmanaged collection. The older
Airtable path is still documented below as a fallback. Only public/meta fields
are bridged; the gated `body` stays in Sanity and is served later via the authenticated API
(Phase 8).

```
Sanity  --(webhook / full sync)-->  cc-sync  --(upsert)-->  Airtable  --(Framer native sync)-->  Framer CMS
```

Two entry points:
- `syncAll.js` — one-shot **full re-sync** of every published article.
- `api/sync.js` — **incremental** webhook (Vercel) that syncs one article on publish/delete.

---

## 1. Airtable base

Create a base (e.g. **Critical Collective**) with a table **Articles** and these fields
(names must match `lib/airtable.js`):

| Field | Type |
|---|---|
| Sanity ID | Single line text *(merge key — must exist)* |
| Title | Single line text |
| Slug | Single line text |
| Kicker | Single line text |
| Subtitle | Single line text |
| Article Type | Single line text |
| Teaser | Long text |
| Access Tier | Single line text (or single select) |
| Year | Number |
| Reading Time | Number |
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
| Status | Single select: `live`, `archived` |

Then: **Airtable → Developer hub → Personal access tokens** → create a token with
`data.records:read` + `data.records:write` scoped to this base. Copy the token (`pat…`) and the
**base ID** (`app…`, from the base URL or API docs).

> ⚠️ Airtable free tier caps at **1,000 records/base**. Fine for the 5-item test; for the full
> ~4,300 articles use an Airtable paid plan **or** switch the bridge to Google Sheets (see §7).

## 2. Sanity token

`manage.sanity.io → your project → API → Tokens` → create a **Viewer** token. Note the
**projectId** and **dataset** too.

## 3. Install & configure

```powershell
cd c:\Users\elugotiw\Documents\critical-collective\services\cc-sync
npm install
Copy-Item .env.example .env    # then fill in the values
```

## 4. Initial full sync

```powershell
npm run sync:all
```

Confirm rows appear in the Airtable table.

## 5. Connect Framer → Airtable

In Framer: **Assets → CMS → Articles → Sync → Airtable** → authorize the token → pick the base +
table → **map each column** to a CMS field → enable sync. Your articles now appear in Framer.
(Filter Framer to `Status = live` so archived rows drop off.)

## 6. Incremental webhook (auto-sync on publish)

1. **Deploy** this folder to Vercel (`vercel deploy`), set the same env vars in the Vercel project.
   The endpoint is `https://<app>.vercel.app/api/sync`.
2. **Add the Sanity webhook:** `manage.sanity.io → API → Webhooks → Create`:
   - **URL:** the Vercel endpoint above
   - **Trigger on:** Create, Update, Delete
   - **Filter:** `_type == "article"`
   - **Projection:** `{ "_id": _id }`
   - **HTTP method:** POST
   - **Secret:** the same value as `SANITY_WEBHOOK_SECRET`
3. **Test:** edit an article in Sanity → Publish → within a moment the Vercel log shows
   `action: upserted`, the Airtable row updates, and Framer picks it up on its next sync. Delete an
   article → the row is flagged `archived`.

## 7. Scale option — Google Sheets bridge

For the full 4,300 articles at no cost, swap Airtable for a Google Sheet: replace `lib/airtable.js`
with a `lib/sheets.js` that upserts rows (via a Google service account + `googleapis`), keyed on the
`Sanity ID` column, and connect Framer's **Google Sheets** sync instead. Everything else stays the same.

## Reliability (already built in)
- **Signature-verified** webhook (rejects forged calls).
- **Idempotent** upsert on `Sanity ID` (safe on redelivery/duplicates).
- **Incomplete guard** (skips rows missing slug/title).
- **Archive on delete** (no orphaned live pages).
- **Slug preserved** verbatim (hard requirement).

## Troubleshooting
- *401 from webhook* → `SANITY_WEBHOOK_SECRET` mismatch between `.env`/Vercel and the Sanity webhook.
- *Airtable 422* → a field name in `toFields()` doesn't exist in the table; add it or fix the name.
- *Framer not updating* → check Framer's sync cadence / trigger a manual sync; confirm token scope.
