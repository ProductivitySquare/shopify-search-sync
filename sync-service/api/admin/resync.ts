import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAllProducts } from "../../lib/shopify.js";
import { upsertProducts, configureIndex, algolia, INDEX_NAME } from "../../lib/algolia.js";

const STOREFRONT_DOMAIN = process.env.STOREFRONT_DOMAIN as string;
const SECRET = process.env.RESYNC_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!SECRET) {
    res.status(500).json({ error: "RESYNC_SECRET is not set on the server." });
    return;
  }
  if (req.query.secret !== SECRET) {
    res.status(401).json({ error: "Invalid or missing secret." });
    return;
  }
  if (!STOREFRONT_DOMAIN) {
    res.status(500).json({ error: "STOREFRONT_DOMAIN is not set." });
    return;
  }

  try {
    await algolia.clearObjects({ indexName: INDEX_NAME });
    await configureIndex();

    let total = 0;
    for await (const batch of fetchAllProducts(STOREFRONT_DOMAIN)) {
      await upsertProducts(batch);
      total += batch.length;
    }

    res.status(200).json({ ok: true, indexed: total });
  } catch (err) {
    console.error("Resync failed:", err);
    res.status(500).json({ error: String(err) });
  }
}
