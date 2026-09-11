import crypto from "node:crypto";

const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

/**
 * Shopify signs every webhook body with HMAC-SHA256 using your app's
 * secret, base64-encoded in the X-Shopify-Hmac-Sha256 header. Reject
 * anything that doesn't match — otherwise anyone who finds the
 * endpoint URL could push arbitrary data into your index.
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | undefined | null
): boolean {
  if (!SECRET) {
    throw new Error("SHOPIFY_WEBHOOK_SECRET must be set (see .env.example)");
  }
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
