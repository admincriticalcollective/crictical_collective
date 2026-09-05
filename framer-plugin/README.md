# Sanity Articles Sync for Framer

This is a Framer Managed Collection plugin that syncs the existing `article` Sanity schema directly into a Framer CMS collection. It reuses the article projection and field mapping from `../lib/sanity.js` and `../lib/airtable.js`, but does not use Airtable.

## Required values

- Sanity project ID
- Sanity dataset, normally `production`
- A Sanity API token with Viewer/read-only access
- A Framer project where the plugin can manage a CMS collection
- Node.js 18 or newer

The token is entered in the plugin UI and stored as collection plugin data. Use a dedicated read-only token. The plugin never requests write access and never syncs the gated `body` field.

## Run locally

```powershell
cd framer-plugin
npm install
npm run dev
```

In Framer, enable Developer Tools and open the local plugin. Create or select a Managed CMS Collection, then choose `Sanity Articles Sync`. The first run configures fields and imports the articles. Later runs use the saved configuration and sync automatically.

## Synced fields

Sanity ID, Title, Slug, Kicker, Subtitle, Article Type, Teaser, Access Tier, Year, Reading Time, Published At, Section, Section Slug, Subsection, Author Name, Author Slug, Tags, Hero Image, SEO Title, SEO Description, and Status.

Articles without a title, slug, or Sanity ID are skipped. Framer items no longer returned by Sanity are removed from the managed collection.
