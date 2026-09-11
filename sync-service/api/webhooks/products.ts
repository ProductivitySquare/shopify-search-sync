import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyShopifyWebhook } from "../../lib/verifyWebhook.js";
import { fetchProductById } from "../../lib/shopify.js";
import { upsertProduct, deleteProduct } from "../../lib/algolia.js";

// Vercel parses JSON by default; we need the raw body to verify the HMAC,
// so this must stay disabled and we parse manually below.
export const config = {
  api: { bodyParser: false },
};

const STOREFRONT_DOMAIN = process.env.STOREFRONT_DOMAIN as string;

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One endpoint handles create/update/delete — Shopify tells us which
 * via the X-Shopify-Topic header, so we register the same URL for all
 * three webhook topics in the Shopify admin.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const hmac = req.headers["x-shopify-hmac-sha256"] as string | undefined;

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    res.status(401).send("Invalid webhook signature");
    return;
  }

  const topic = req.headers["x-shopify-topic"] as string | undefined;
  const payload = JSON.parse(rawBody) as { id: number | string };
  const numericId = String(payload.id);

  try {
    if (topic === "products/delete") {
      await deleteProduct(numericId);
    } else {
      // products/create, products/update — refetch full product via
      // Admin API so we always index complete, current data rather
      // than trusting the (partial) webhook payload shape.
      const doc = await fetchProductById(numericId, STOREFRONT_DOMAIN);
      if (doc) {
        await upsertProduct(doc);
      } else {
        // Product vanished between webhook and fetch (e.g. deleted
        // immediately after) — remove it defensively.
        await deleteProduct(numericId);
      }
    }
    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook processing failed:", err);
    // 500 so Shopify retries with backoff instead of silently dropping it.
    res.status(500).send("processing error");
  }
}
