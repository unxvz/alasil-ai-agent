// Shopify Admin API client — RICHER data than Storefront:
//   - real inventory_quantity per location (not just a boolean)
//   - metafields (merchant-maintained structured attributes)
//   - collections membership (merchant-curated product groups)
//   - variants with SKU / inventory_item_id / barcode
//   - draft products if we ever want them
//
// Gated by config.SHOPIFY_ADMIN_TOKEN. If that's missing, the caller should
// fall back to the Storefront API (src/modules/shopify.js).
//
// SECURITY: Admin API token grants merchant-level access. Never log it,
// never expose it client-side, never commit it.

import { config } from '../config.js';
import { logger } from '../logger.js';
import { UpstreamError } from '../utils/errors.js';

const API_VERSION = config.SHOPIFY_API_VERSION || '2024-01';
const TIMEOUT_MS = 15_000;

function shopDomain() {
  const h = String(config.SHOPIFY_ADMIN_SHOP_HANDLE || '').trim();
  if (!h) return null;
  return h.endsWith('.myshopify.com') ? h : `${h}.myshopify.com`;
}

function adminEnabled() {
  return Boolean(config.SHOPIFY_ADMIN_TOKEN && shopDomain());
}

async function gql(query, variables) {
  if (!adminEnabled()) {
    throw new UpstreamError('Shopify Admin API not configured');
  }
  const url = `https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-Shopify-Access-Token': config.SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new UpstreamError(`Shopify Admin HTTP ${resp.status}`, { body: text.slice(0, 200) });
    }
    const data = await resp.json();
    if (data.errors) {
      throw new UpstreamError('Shopify Admin GraphQL error', { errors: data.errors });
    }
    return data.data;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('Shopify Admin request failed', { cause: String(err?.message || err) });
  } finally {
    clearTimeout(timer);
  }
}

// Minimal smoke test — returns shop name if the token is valid.
export async function pingAdmin() {
  if (!adminEnabled()) return { enabled: false };
  try {
    const data = await gql('{ shop { name primaryDomain { url } } }');
    return { enabled: true, shop: data?.shop?.name, domain: data?.shop?.primaryDomain?.url };
  } catch (err) {
    return { enabled: true, error: String(err?.message || err) };
  }
}

const ADMIN_PRODUCT_FIELDS = `
  id
  legacyResourceId
  handle
  title
  vendor
  productType
  tags
  status
  onlineStoreUrl
  createdAt
  updatedAt
  publishedAt
  description
  category { id name fullName }
  options { id name position values }
  featuredImage { url }
  collections(first: 10) {
    edges { node { id handle title } }
  }
  metafields(first: 20) {
    edges {
      node {
        namespace
        key
        type
        value
      }
    }
  }
  variants(first: 100) {
    edges {
      node {
        id
        sku
        barcode
        title
        price
        compareAtPrice
        availableForSale
        inventoryQuantity
        selectedOptions { name value }
        inventoryItem {
          id
          tracked
          measurement { weight { value unit } }
          inventoryLevels(first: 10) {
            edges {
              node {
                location { id name }
                quantities(names: ["available", "committed", "on_hand"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }
`;

// Paginate through ALL products. Admin API GraphQL cost ≈ 10 per product ×
// 250 per page = 2500 cost per page; default cost bucket is 1000/sec with
// 2000/sec burst — we pace requests conservatively.
export async function fetchAllProductsAdmin({ max = config.SHOPIFY_CATALOG_MAX || 5000 } = {}) {
  const out = [];
  let cursor = null;
  let hasNext = true;
  const pageSize = 50; // smaller page keeps Admin cost per request well under the limit
  while (hasNext && out.length < max) {
    const q = `
      query($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges { cursor node { ${ADMIN_PRODUCT_FIELDS} } }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await gql(q, { first: pageSize, after: cursor });
    const edges = data.products.edges || [];
    for (const e of edges) {
      out.push(normalizeAdminProduct(e.node));
      if (out.length >= max) break;
    }
    hasNext = Boolean(data.products.pageInfo?.hasNextPage) && edges.length > 0;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    // tiny pace so we don't trip the leaky-bucket cost limit on bulk pulls
    if (hasNext) await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

// Single-product live refresh — used by the verifyStock tool to bypass the
// 5-minute catalog cache and hit the Admin API for the freshest inventory.
export async function fetchProductAdmin(handle) {
  if (!adminEnabled()) return null;
  const q = `
    query($handle: String!) {
      productByHandle(handle: $handle) { ${ADMIN_PRODUCT_FIELDS} }
    }
  `;
  const data = await gql(q, { handle });
  if (!data?.productByHandle) return null;
  return normalizeAdminProduct(data.productByHandle);
}

export async function fetchProductByIdAdmin(id) {
  if (!adminEnabled()) return null;
  const q = `
    query($id: ID!) {
      product(id: $id) { ${ADMIN_PRODUCT_FIELDS} }
    }
  `;
  const data = await gql(q, { id });
  if (!data?.product) return null;
  return normalizeAdminProduct(data.product);
}

// Flatten the Admin GraphQL response into the same shape our catalog.js
// enrichment layer expects — PLUS new fields only Admin exposes.
function normalizeAdminProduct(node) {
  const variantEdges = node.variants?.edges || [];
  const firstVar = variantEdges[0]?.node || null;
  const price = parseFloat(firstVar?.price || '0');
  const compareAt = firstVar?.compareAtPrice ? parseFloat(firstVar.compareAtPrice) : null;

  // Sum inventoryQuantity across all variants as a simple "total stock".
  // Per-variant details preserved in the variants array below.
  let totalQty = 0;
  const variants = [];
  for (const e of variantEdges) {
    const v = e.node;
    const locEdges = v.inventoryItem?.inventoryLevels?.edges || [];
    const perLocation = locEdges.map((le) => {
      const levels = le.node.quantities || [];
      const avail = levels.find((q) => q.name === 'available');
      return {
        location: le.node.location?.name,
        available: Number.isFinite(avail?.quantity) ? avail.quantity : null,
      };
    });
    const variantQty = perLocation.reduce((a, b) => a + (b.available || 0), 0);
    totalQty += variantQty;
    variants.push({
      id: v.id,
      sku: v.sku || '',
      barcode: v.barcode || null,
      title: v.title,
      price: parseFloat(v.price || '0'),
      compare_at: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
      available_for_sale: Boolean(v.availableForSale),
      inventory_quantity: Number.isFinite(v.inventoryQuantity) ? v.inventoryQuantity : variantQty,
      per_location: perLocation,
      options: (v.selectedOptions || []).reduce((acc, o) => {
        acc[o.name] = o.value;
        return acc;
      }, {}),
    });
  }

  const metafields = {};
  for (const e of node.metafields?.edges || []) {
    const m = e.node;
    const k = `${m.namespace}.${m.key}`;
    metafields[k] = { value: m.value, type: m.type };
  }

  const collections = (node.collections?.edges || []).map((e) => ({
    id: e.node.id,
    handle: e.node.handle,
    title: e.node.title,
  }));

  return {
    // Storefront-shape fields so downstream enrichProduct keeps working:
    id: node.id,
    legacyId: node.legacyResourceId,
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || '',
    productType: node.productType || '',
    tags: Array.isArray(node.tags) ? node.tags : [],
    status: node.status,
    url: node.onlineStoreUrl || `https://${config.SHOPIFY_SHOP_DOMAIN}/products/${node.handle}`,
    image_url: node.featuredImage?.url || null,
    price_aed: Number.isFinite(price) ? price : 0,
    compare_at_aed: Number.isFinite(compareAt) ? compareAt : null,
    sku: firstVar?.sku || '',
    in_stock: Boolean(firstVar?.availableForSale) && totalQty > 0,

    // Admin-only richer fields the bot can use:
    category_shopify: node.category || null, // Shopify standardized taxonomy
    options: node.options || [],             // [{name:"Color", values:["Silver","Deep Blue",…]}]
    collections,                             // merchant-curated groups
    metafields,                              // merchant attributes
    variants,                                // per-variant inventory, options, per-location stock
    inventory_total: totalQty,
    description: node.description || '',
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    published_at: node.publishedAt,
    _source: 'admin',
  };
}

// Re-export the gating helper so catalog.js can decide which client to use.
export { adminEnabled };
