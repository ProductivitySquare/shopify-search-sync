import { algoliasearch } from "algoliasearch";

const APP_ID = process.env.ALGOLIA_APP_ID;
const ADMIN_KEY = process.env.ALGOLIA_ADMIN_KEY;
export const INDEX_NAME = process.env.ALGOLIA_INDEX ?? "products";

if (!APP_ID || !ADMIN_KEY) {
  throw new Error(
    "ALGOLIA_APP_ID and ALGOLIA_ADMIN_KEY must be set (see .env.example)"
  );
}

// Admin client — full read/write access. Server-side only, never expose
// this key to the browser (that's what the search-only key is for).
export const algolia = algoliasearch(APP_ID, ADMIN_KEY);

/**
 * The shape of one searchable record. Keep this flat and small — every
 * field here is what Algolia tokenizes and ranks against. `objectID` is
 * Algolia's required unique identifier (equivalent to a primary key).
 */
export interface ProductDoc {
  objectID: string; // Shopify product's numeric id
  title: string;
  handle: string;
  description: string; // plain text, HTML stripped
  productType: string;
  vendor: string;
  tags: string[];
  price: number; // lowest variant price, for display + optional filtering
  currency: string;
  imageUrl: string | null;
  url: string; // absolute storefront URL, e.g. https://habitatvita.com/products/foo
  available: boolean;
}

/**
 * One-time index configuration. Safe to re-run — Algolia just updates
 * settings in place. Run this once after backfill (the backfill script
 * calls it automatically).
 *
 * Tuning notes:
 * - searchableAttributes order = relevance priority (title beats tags beats description)
 * - typo tolerance is on by default in Algolia and needs no extra config —
 *   this is the whole reason Algolia gets you Searchanise-like fuzzy
 *   matching ("ame" -> "named") with zero relevance tuning of your own
 * - customRanking nudges in-stock products above out-of-stock ones
 */
export async function configureIndex(): Promise<void> {
  await algolia.setSettings({
    indexName: INDEX_NAME,
    indexSettings: {
      searchableAttributes: [
        "title",
        "tags",
        "productType",
        "vendor",
        "description",
      ],
      attributesForFaceting: ["available", "productType", "vendor"],
      customRanking: ["desc(available)"],
    },
  });
}

export async function upsertProduct(doc: ProductDoc): Promise<void> {
  await algolia.saveObject({ indexName: INDEX_NAME, body: doc });
}

export async function deleteProduct(objectID: string): Promise<void> {
  await algolia.deleteObject({ indexName: INDEX_NAME, objectID });
}

export async function upsertProducts(docs: ProductDoc[]): Promise<void> {
  // saveObjects batches internally; chunk defensively for very large catalogs.
  const CHUNK = 1000;
  for (let i = 0; i < docs.length; i += CHUNK) {
    await algolia.saveObjects({
      indexName: INDEX_NAME,
      objects: docs.slice(i, i + CHUNK) as unknown as Record<string, unknown>[],
    });
  }
}
