/**
 * Run once (and safe to re-run any time as a full self-heal sync):
 *
 *   npm run backfill
 *
 * Pulls the entire Shopify catalog and pushes it into Algolia,
 * then applies the index settings (searchable fields, ranking).
 */
import "dotenv/config";
import { fetchAllProducts } from "../lib/shopify.js";
import { upsertProducts, configureIndex } from "../lib/algolia.js";

const STOREFRONT_DOMAIN = process.env.STOREFRONT_DOMAIN;
if (!STOREFRONT_DOMAIN) {
  throw new Error(
    "Set STOREFRONT_DOMAIN (e.g. habitatvita.com) in your .env — used to build product URLs"
  );
}

async function main() {
  console.log("Configuring Algolia index settings...");
  await configureIndex();

  console.log("Fetching products from Shopify and indexing...");
  let total = 0;
  for await (const batch of fetchAllProducts(STOREFRONT_DOMAIN as string)) {
    await upsertProducts(batch);
    total += batch.length;
    console.log(`  indexed ${total} products so far...`);
  }

  console.log(`Done. ${total} products indexed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
