import type { ProductDoc } from "./algolia.js";

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2024-10";

if (!STORE || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    "SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set (see .env.example)"
  );
}

const GRAPHQL_URL = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
const TOKEN_URL = `https://${STORE}/admin/oauth/access_token`;

/**
 * Custom apps created via the Dev Dashboard (as opposed to the older
 * admin-generated "custom apps") don't hand out a permanent static
 * token. Instead, the client credentials grant issues a token that's
 * valid for 24h (expires_in is always 86399s) — so we fetch and cache
 * one in memory, and transparently refetch when it's close to expiry.
 * See: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const SAFETY_MARGIN_MS = 60_000; // refresh a minute before it actually expires
  if (cachedToken && cachedToken.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID as string,
      client_secret: CLIENT_SECRET as string,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Shopify token request failed: HTTP ${res.status}: ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ShopifyProductNode {
  id: string; // gid://shopify/Product/123
  title: string;
  handle: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  featuredImage: { url: string } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
  };
  totalInventory: number;
}

function toDoc(node: ShopifyProductNode, storefrontDomain: string): ProductDoc {
  const numericId = node.id.split("/").pop() as string;
  return {
    objectID: numericId,
    title: node.title,
    handle: node.handle,
    description: stripHtml(node.descriptionHtml),
    productType: node.productType ?? "",
    vendor: node.vendor ?? "",
    tags: node.tags ?? [],
    price: Number(node.priceRangeV2.minVariantPrice.amount),
    currency: node.priceRangeV2.minVariantPrice.currencyCode,
    imageUrl: node.featuredImage?.url ?? null,
    url: `https://${storefrontDomain}/products/${node.handle}`,
    available: node.status === "ACTIVE" && node.totalInventory > 0,
  };
}

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        descriptionHtml
        productType
        vendor
        tags
        status
        featuredImage {
          url
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        totalInventory
      }
    }
  }
`;

/**
 * Pulls the entire catalog, page by page. Used for the initial
 * backfill and for periodic full re-syncs (e.g. a nightly cron)
 * that self-heal any webhook you might have missed.
 *
 * `storefrontDomain` is your public shop domain (e.g. habitatvita.com),
 * used to build canonical product URLs — separate from SHOPIFY_STORE_DOMAIN
 * which is the .myshopify.com admin domain.
 */
export async function* fetchAllProducts(
  storefrontDomain: string
): AsyncGenerator<ProductDoc[]> {
  let cursor: string | null = null;
  while (true) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ShopifyProductNode[];
      };
    } = await shopifyGraphQL(PRODUCTS_QUERY, { cursor });

    yield data.products.nodes.map((n) => toDoc(n, storefrontDomain));

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
}

const SINGLE_PRODUCT_QUERY = /* GraphQL */ `
  query Product($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      productType
      vendor
      tags
      status
      featuredImage {
        url
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      totalInventory
    }
  }
`;

/**
 * Used by the webhook handler on products/create and products/update —
 * refetches the full product (webhook payloads are minimal/legacy REST
 * shaped) so the index always reflects current Admin API data.
 */
export async function fetchProductById(
  numericId: string,
  storefrontDomain: string
): Promise<ProductDoc | null> {
  const gid = `gid://shopify/Product/${numericId}`;
  const data = await shopifyGraphQL<{ product: ShopifyProductNode | null }>(
    SINGLE_PRODUCT_QUERY,
    { id: gid }
  );
  if (!data.product) return null;
  return toDoc(data.product, storefrontDomain);
}
