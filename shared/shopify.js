// shared/shopify.js — Shopify REST Admin API client
// Uses shopify-api-node with built-in rate limiting.
// Auto-paginates all list calls to retrieve full datasets.
// Gracefully throws descriptive errors if credentials are missing.

import ShopifyApi from 'shopify-api-node';

const RATE_LIMIT = { calls: 2, interval: 1000 }; // 2 calls/second

let _shopify = null;

function getClient() {
  if (!process.env.SHOPIFY_ACCESS_TOKEN) {
    throw new Error('SHOPIFY_ACCESS_TOKEN not set — Shopify integration unavailable');
  }
  if (!process.env.SHOPIFY_STORE) {
    throw new Error('SHOPIFY_STORE not set — Shopify integration unavailable');
  }
  if (!_shopify) {
    _shopify = new ShopifyApi({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
      autoLimit: RATE_LIMIT,
    });
    console.log(`[shopify] Client initialized for ${process.env.SHOPIFY_STORE}`);
  }
  return _shopify;
}

/**
 * Auto-paginate a Shopify list call.
 * shopify-api-node attaches nextPageParameters to the result array when more pages exist.
 *
 * @param {Function} listFn - Bound method, e.g. shopify.order.list.bind(shopify.order)
 * @param {object} params   - Initial query params
 * @returns {Array}         - All items across all pages
 */
async function paginate(listFn, params = {}) {
  const allItems = [];
  let pageParams = { ...params, limit: 250 };

  do {
    const items = await listFn(pageParams);
    allItems.push(...items);
    // shopify-api-node attaches nextPageParameters when cursor pagination is available
    pageParams = items.nextPageParameters ?? null;
  } while (pageParams);

  return allItems;
}

/**
 * Fetch orders with optional filters.
 * @param {{ createdAtMin?: string, createdAtMax?: string, status?: string, limit?: number }} params
 */
export async function getOrders({ createdAtMin, createdAtMax, status, limit } = {}) {
  if (!process.env.SHOPIFY_ACCESS_TOKEN) {
    console.warn('[shopify] SHOPIFY_ACCESS_TOKEN not set — skipping getOrders');
    throw new Error('SHOPIFY_ACCESS_TOKEN not set');
  }
  const shopify = getClient();
  const params = {};
  if (createdAtMin) params.created_at_min = createdAtMin;
  if (createdAtMax) params.created_at_max = createdAtMax;
  if (status) params.status = status;

  if (limit) {
    return shopify.order.list({ ...params, limit });
  }
  return paginate(shopify.order.list.bind(shopify.order), params);
}

/**
 * Fetch products with optional filters.
 * @param {{ limit?: number, productType?: string, fields?: string }} params
 */
export async function getProducts({ limit, productType, fields } = {}) {
  if (!process.env.SHOPIFY_ACCESS_TOKEN) {
    console.warn('[shopify] SHOPIFY_ACCESS_TOKEN not set — skipping getProducts');
    throw new Error('SHOPIFY_ACCESS_TOKEN not set');
  }
  const shopify = getClient();
  const params = {};
  if (productType) params.product_type = productType;
  if (fields) params.fields = fields;

  if (limit) {
    return shopify.product.list({ ...params, limit });
  }
  return paginate(shopify.product.list.bind(shopify.product), params);
}

/**
 * Create a new Shopify product.
 * @param {object} productData - Shopify product object
 * @returns {object} Created product
 */
export async function createProduct(productData) {
  const shopify = getClient();
  return shopify.product.create(productData);
}

/**
 * Update an existing Shopify product.
 * @param {number|string} productId
 * @param {object} productData - Fields to update
 * @returns {object} Updated product
 */
export async function updateProduct(productId, productData) {
  const shopify = getClient();
  return shopify.product.update(productId, productData);
}

/**
 * Fetch inventory levels for a list of inventory item IDs.
 * @param {{ inventoryItemIds: Array<number|string> }} params
 * @returns {Array} Inventory level objects
 */
export async function getInventoryLevels({ inventoryItemIds }) {
  const shopify = getClient();
  if (!inventoryItemIds?.length) return [];
  return paginate(shopify.inventoryLevel.list.bind(shopify.inventoryLevel), {
    inventory_item_ids: inventoryItemIds.join(','),
  });
}

/**
 * Set inventory level for a specific inventory item at a location.
 * @param {{ inventoryItemId: number|string, locationId: number|string, available: number }} params
 * @returns {object} Updated inventory level
 */
export async function setInventoryLevel({ inventoryItemId, locationId, available }) {
  const shopify = getClient();
  return shopify.inventoryLevel.set({
    inventory_item_id: inventoryItemId,
    location_id: locationId,
    available,
  });
}

/**
 * Search products by title (exact match via Shopify REST API).
 * @param {string} title
 * @returns {Array} Matching products
 */
export async function searchProductsByTitle(title) {
  const shopify = getClient();
  return shopify.product.list({ title, limit: 10 });
}

/**
 * Get Shopify shop locations.
 * @returns {Array} Location objects
 */
export async function getLocations() {
  const shopify = getClient();
  return shopify.location.list();
}
