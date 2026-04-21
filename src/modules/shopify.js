import { config } from '../config.js';
import { logger } from '../logger.js';
import { UpstreamError } from '../utils/errors.js';

const API_URL = `https://${config.SHOPIFY_SHOP_DOMAIN}/api/${config.SHOPIFY_API_VERSION}/graphql.json`;
const TIMEOUT_MS = 10_000;

async function gql(query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-Shopify-Storefront-Access-Token': config.SHOPIFY_STOREFRONT_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new UpstreamError(`Shopify HTTP ${resp.status}`, { body: text.slice(0, 200) });
    }
    const data = await resp.json();
    if (data.errors) {
      throw new UpstreamError('Shopify GraphQL error', { errors: data.errors });
    }
    return data.data;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('Shopify request failed', { cause: String(err?.message || err) });
  } finally {
    clearTimeout(timer);
  }
}

const PRODUCT_FIELDS = `
  id
  title
  handle
  vendor
  productType
  tags
  availableForSale
  onlineStoreUrl
  priceRange {
    minVariantPrice { amount currencyCode }
  }
  compareAtPriceRange {
    maxVariantPrice { amount currencyCode }
  }
  images(first: 1) {
    edges { node { url } }
  }
  variants(first: 1) {
    edges {
      node {
        sku
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        availableForSale
      }
    }
  }
`;

function normalizeEdge(node) {
  const variant = node.variants?.edges?.[0]?.node || null;
  const price = parseFloat(variant?.price?.amount || node.priceRange?.minVariantPrice?.amount || 'NaN');
  const compareAt =
    variant?.compareAtPrice?.amount
      ? parseFloat(variant.compareAtPrice.amount)
      : node.compareAtPriceRange?.maxVariantPrice?.amount
        ? parseFloat(node.compareAtPriceRange.maxVariantPrice.amount)
        : null;
  const image = node.images?.edges?.[0]?.node?.url || null;
  return {
    id:          node.id,
    sku:         variant?.sku || '',
    handle:      node.handle,
    title:       node.title,
    vendor:      node.vendor || '',
    productType: node.productType || '',
    tags:        Array.isArray(node.tags) ? node.tags : [],
    url:         node.onlineStoreUrl || `https://${config.SHOPIFY_SHOP_DOMAIN}/products/${node.handle}`,
    image_url:   image,
    price_aed:   Number.isFinite(price) ? price : 0,
    compare_at_aed: Number.isFinite(compareAt) ? compareAt : null,
    in_stock:    Boolean(node.availableForSale) && Boolean(variant?.availableForSale ?? node.availableForSale),
  };
}

export async function searchProducts(queryString, { limit = 20 } = {}) {
  const safeQuery = String(queryString || '').replace(/"/g, '\\"');
  const q = `
    query($first: Int!, $q: String) {
      products(first: $first, query: $q) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }
  `;
  const data = await gql(q, { first: Math.min(Math.max(1, limit), 50), q: safeQuery });
  return data.products.edges.map((e) => normalizeEdge(e.node));
}

export async function fetchAllProducts({ max = config.SHOPIFY_CATALOG_MAX } = {}) {
  const out = [];
  let cursor = null;
  let hasNext = true;
  const pageSize = 250;
  while (hasNext && out.length < max) {
    const q = `
      query($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges { cursor node { ${PRODUCT_FIELDS} } }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await gql(q, { first: pageSize, after: cursor });
    const edges = data.products.edges || [];
    for (const e of edges) {
      out.push(normalizeEdge(e.node));
      if (out.length >= max) break;
    }
    hasNext = Boolean(data.products.pageInfo?.hasNextPage) && edges.length > 0;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
  }
  return out;
}

export async function verifyStock(handle) {
  const q = `
    query($handle: String!) {
      productByHandle(handle: $handle) { ${PRODUCT_FIELDS} }
    }
  `;
  const data = await gql(q, { handle });
  if (!data.productByHandle) return null;
  return normalizeEdge(data.productByHandle);
}

export async function pingShopify() {
  try {
    const data = await gql('{ shop { name } }');
    return Boolean(data?.shop?.name);
  } catch (err) {
    logger.warn({ err: String(err?.message || err) }, 'Shopify ping failed');
    return false;
  }
}
