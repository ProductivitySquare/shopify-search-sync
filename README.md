# HabitatVita instant search — self-hosted-free Searchanise replacement

Typo-tolerant, instant product search for the HabitatVita Shopify store,
built on [Algolia's free tier](https://www.algolia.com/pricing) instead of
a paid app (~€40/month for Searchanise). Target infra cost: **€0/month**,
no server to run or maintain — Algolia's free "Build" plan (10k records,
100k search requests/month) comfortably covers a store this size.

Filters/faceted navigation are intentionally **not** part of this — you're
keeping Shopify's native search/filter for that. This project only replaces
the instant-search box + autocomplete dropdown.

> Note: we originally scoped this on self-hosted Meilisearch (a free Oracle
> Cloud VM), but Oracle's free-tier signup kept failing with no useful
> error, and every other "free" VM host either isn't really free anymore
> (Fly.io) or drops your data on restart (Render free tier). Algolia's
> free tier gets the same typo-tolerant search quality with zero
> infrastructure to run.

## How it fits together

```
Shopify (products) --webhooks--> sync-service (Vercel) --writes--> Algolia (hosted, free tier)
                                                                          ^
                                                                          |
                                              browser (storefront) --search-only key--
                                              via widget/search-widget.js
```

- **`sync-service/`** — Node/TypeScript. Does the initial catalog backfill
  and keeps the index live-updated via Shopify webhooks. Deploys to Vercel
  (free tier).
- **`widget/`** — a single dependency-free JS file you drop into the Shopify
  theme. Queries Algolia directly from the browser with a **search-only**
  key (read-only, safe to expose client-side).

Total moving parts you own: one Algolia account, one Vercel project, one
script tag in the theme. No servers.

---

## Part 1 — Algolia account (already done)

You've already signed up at [dashboard.algolia.com](https://dashboard.algolia.com/)
and skipped the no-code import wizard (we push data via API instead). From
**Settings → API Keys** you need three values:

- **Application ID** — yours is `NTC7X15L5E`
- **Admin API Key** — full read/write access. This goes into the sync
  service's environment variables **only**, never into the widget or
  anywhere client-side.
- **Search-Only API Key** — read-only, safe to expose in the browser. This
  is what goes into the widget's script tag.

If your dashboard defaulted you into a paid "Grow" trial instead of the
free "Build" plan, go to **Billing** and switch/downgrade to Build — Build
is the permanent free tier (10k records / 100k searches per month, no time
limit).

## Part 2 — Create the Shopify custom app

1. [dev.shopify.com](https://dev.shopify.com/dashboard) → **Create app** →
   give it scopes `read_products` (and `read_content` is harmless to
   include too, though unused here).
2. **Release** the version, then **Install app** on the HabitatVita store.
3. Under **App settings**, note the **Client ID** and **Client secret**
   (`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`).
4. This app type doesn't hand out a permanent static Admin API token —
   instead, the sync service fetches a short-lived token itself via the
   [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
   (`lib/shopify.ts` does this automatically, caching and refreshing as
   needed). You can sanity-check it works from your terminal:

   ```bash
   curl -X POST https://habitatvita.myshopify.com/admin/oauth/access_token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
   ```

   A working response looks like
   `{"access_token":"shpua_...","expires_in":86399,"scope":"read_products,read_content"}`.
5. For webhook signature verification, use the same **Client secret** as
   `SHOPIFY_WEBHOOK_SECRET` in Part 3.
6. You'll add the actual webhook subscriptions in Part 4, once the sync
   service has a public URL to point them at.

## Part 3 — Deploy the sync service to Vercel

```bash
cd sync-service
npm install
vercel link      # or: vercel --prod the first time, follow prompts
```

In the Vercel project settings, add these environment variables:

```
SHOPIFY_STORE_DOMAIN=habitatvita.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_API_VERSION=2024-10
SHOPIFY_WEBHOOK_SECRET=...
STOREFRONT_DOMAIN=habitatvita.com

ALGOLIA_APP_ID=NTC7X15L5E
ALGOLIA_ADMIN_KEY=...        # the admin key, NOT the search-only key
ALGOLIA_INDEX=products
```

Deploy:

```bash
vercel --prod
```

Note the deployed URL, e.g. `https://habitatvita-search-sync.vercel.app`.

Run the initial backfill once, from your own machine (uses the same
values — copy `.env.example` to `.env` and fill it in locally too):

```bash
npm run backfill
```

This indexes the full catalog and configures Algolia's ranking/searchable
fields. Check it worked from the Algolia dashboard (**Search → your index**
should show your product count), or:

```bash
curl -X POST "https://NTC7X15L5E-dsn.algolia.net/1/indexes/products/query" \
  -H "X-Algolia-Application-Id: NTC7X15L5E" \
  -H "X-Algolia-API-Key: YOUR_SEARCH_ONLY_KEY" \
  -H "Content-Type: application/json" \
  --data '{"query":"ame"}'
```

## Part 4 — Register the Shopify webhooks

In the custom app's admin (or via the Admin API), add webhook subscriptions
for `products/create`, `products/update`, and `products/delete`, all
pointing to:

```
https://habitatvita-search-sync.vercel.app/api/webhooks/products
```

Format: JSON. From now on, any product change in Shopify updates the index
within seconds.

## Part 5 — Embed the widget in the theme

1. Upload `widget/search-widget.js` as a theme asset (Shopify admin → theme
   editor → Edit code → Assets → Add a new asset, or via Shopify CLI /
   `theme` push if you use one).
2. Follow `widget/theme-snippet.liquid` — add the trigger button where your
   current search icon lives, and the `<script>` tag once near `</body>` in
   `theme.liquid`, filled in with your real `data-algolia-search-key` (the
   **search-only** key from Part 1 — safe to have visible in page source).
3. Load the storefront, click the search trigger, type a query, confirm
   results appear.

## Ongoing maintenance

- **Self-healing re-sync**: consider a nightly cron (Vercel Cron, free tier
  includes a couple of scheduled invocations) that re-runs the equivalent of
  `npm run backfill` to catch any webhook that failed to deliver.
- **Algolia usage**: keep an eye on the dashboard's usage graph — a store
  this size stays far under the free tier's 100k searches/month, but it's
  worth a glance after a traffic spike (e.g. a sale).
- **Shopify API version**: bump `SHOPIFY_API_VERSION` roughly twice a year
  as Shopify deprecates old versions.

## Cost summary

| Component | Where | Cost |
|---|---|---|
| Search index | Algolia Build (free) plan | €0, up to 10k records / 100k searches per month |
| Sync service | Vercel free tier | €0 (well under free-tier limits for a store this size) |
| Widget hosting | Shopify theme asset | €0 (already paying for Shopify) |

No Searchanise subscription, no server to patch or keep alive. The trade
is your time to set this up once and light occasional maintenance, instead
of €40/month indefinitely.
