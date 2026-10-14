# Instant product search for Shopify (Algolia)

Instant search with an autocomplete dropdown for a Shopify store. A small AI model first tries to understand what the shopper means, and a typo-tolerant Algolia search is the fallback. It replaces a paid search app: the index runs on Algolia's free plan and the sync on Vercel's free tier, so the only running cost is the small AI calls. There is no server to maintain.

Filters and faceted navigation are not part of this project. Shopify's native filters stay as they are. This only replaces the search box and the dropdown.

## How it works

```
Shopify (products) --webhooks--> sync-service (Vercel) --writes--> Algolia
                                                                      ^
                                                                      |
                                          browser (storefront) -- search-only key
                                          via widget/search-widget.js
```

- `sync-service/` is a Node and TypeScript service on Vercel. It indexes the full catalog once (backfill) and keeps the index up to date through Shopify webhooks.
- `widget/` is a single JavaScript file with no dependencies. It goes into the theme and queries Algolia directly from the browser with a search-only key, which is read-only and safe to expose.

Things you own: one Algolia account, one Vercel project, one script tag in the theme.

## Query understanding (AI)

Before a query goes to Algolia, a small model (GPT-4 mini) tries to work out what the shopper means. A short or abbreviated query such as "acca lav" is mapped to the brand Acca Kappa and to its lavender soaps and shower gels. The dropdown then shows only the categories and collections that actually contain matching products.

If the model cannot make sense of the query, the search falls back to the normal typo-tolerant Algolia search, so the search box always returns something.

## Setup

### 1. Algolia

Create an account on the free Build plan (10k records, 100k searches per month). From Settings > API Keys you need:

- Application ID
- Admin API key. Full access. It goes into the sync service environment only, never into the widget.
- Search-only API key. Read-only. It goes into the widget.

### 2. Shopify custom app

1. Create an app in the Shopify dev dashboard with the `read_products` scope, release a version and install it on the store.
2. Note the Client ID and Client secret.
3. This app type has no permanent Admin API token. The sync service gets a short-lived token with the [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant) and caches and refreshes it (`lib/shopify.ts`). To check that your credentials work:

```bash
curl -X POST https://YOUR-STORE.myshopify.com/admin/oauth/access_token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
```

A working response contains an `access_token` and `expires_in`.

### 3. Deploy the sync service

```bash
cd sync-service
npm install
vercel link
```

Add these environment variables in the Vercel project:

```
SHOPIFY_STORE_DOMAIN=YOUR-STORE.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_API_VERSION=2024-10
SHOPIFY_WEBHOOK_SECRET=...      # same value as the client secret
STOREFRONT_DOMAIN=your-store.com

ALGOLIA_APP_ID=...
ALGOLIA_ADMIN_KEY=...           # admin key, not the search-only key
ALGOLIA_INDEX=products
```

Then deploy with `vercel --prod` and note the URL.

### 4. Backfill

Copy `.env.example` to `.env`, fill it in, and run once from your machine:

```bash
npm run backfill
```

This indexes the whole catalog and sets the ranking and searchable fields. Check the product count in the Algolia dashboard.

### 5. Webhooks

Subscribe to `products/create`, `products/update` and `products/delete` (JSON) and point all three to:

```
https://YOUR-VERCEL-URL/api/webhooks/products
```

Requests are verified with the client secret. A product change in Shopify reaches the index within seconds.

### 6. Widget

1. Upload `widget/search-widget.js` as a theme asset.
2. Follow `widget/theme-snippet.liquid`: add the trigger button where the search icon is, and the script tag once before `</body>` in `theme.liquid`, with your search-only key.
3. Load the storefront, open the search and type a query.

## Maintenance

- A nightly re-sync (Vercel Cron) catches webhooks that failed to deliver. It runs the same logic as `npm run backfill`.
- Check Algolia usage after traffic spikes such as sales.
- Update `SHOPIFY_API_VERSION` about twice a year, when Shopify retires old versions.

## Why Algolia

The first plan was self-hosted Meilisearch on a free VM. Free VM hosting turned out to be unreliable: signups failed, or free tiers were removed, or data was lost on restart. Algolia's free plan gives the same typo-tolerant search with nothing to run.

## Cost

| Part | Where | Cost |
|---|---|---|
| Search index | Algolia Build plan | 0, up to 10k records and 100k searches per month |
| Sync service | Vercel free tier | 0 |
| Widget | Shopify theme asset | 0 |
| Query understanding | OpenAI API (GPT-4 mini) | Pay per use, small |
