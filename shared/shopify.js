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
 * Fetch a single product by ID.
 * @param {number|string} productId
 * @returns {object} Product object
 */
export async function getProduct(productId) {
  const shopify = getClient();
  return shopify.product.get(productId);
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

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch inventory item costs for a list of inventory item IDs with retry + exponential backoff.
 * Handles Shopify 429 rate limits by waiting and retrying (up to 3 attempts per batch).
 * Returns a map of inventoryItemId → cost.
 *
 * @param {Array<number|string>} inventoryItemIds
 * @param {{ log?: Function }} [opts] - Optional logger (e.g. ctx.log)
 * @returns {Object<string, number>} Map of inventoryItemId → cost
 */
export async function getInventoryCosts(inventoryItemIds, opts = {}) {
  const log = opts.log || (() => {});
  if (!inventoryItemIds?.length) return {};

  const shopify = getClient();
  const costsById = {};
  const CHUNK_SIZE = 100;
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;

  for (let i = 0; i < inventoryItemIds.length; i += CHUNK_SIZE) {
    const chunk = inventoryItemIds.slice(i, i + CHUNK_SIZE);
    let success = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const items = await shopify.inventoryItem.list({
          ids: chunk.join(','),
          limit: CHUNK_SIZE,
        });

        for (const item of items) {
          const cost = item.cost ? parseFloat(item.cost) : null;
          if (cost && cost > 0) {
            costsById[item.id] = cost;
          }
        }
        success = true;
        break;
      } catch (err) {
        if (err.statusCode === 429 || err.message?.includes('429')) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          log(`Rate limited on batch ${i}-${i + CHUNK_SIZE}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await sleep(delay);
        } else {
          log(`Warning: failed to fetch inventory items batch ${i}-${i + CHUNK_SIZE}: ${err.message}`);
          break; // Non-retryable error
        }
      }
    }

    if (!success) {
      log(`Warning: gave up on batch ${i}-${i + CHUNK_SIZE} after ${MAX_RETRIES} retries`);
    }

    // Small delay between batches to stay under rate limits
    if (i + CHUNK_SIZE < inventoryItemIds.length) {
      await sleep(500);
    }
  }

  return costsById;
}

/**
 * Fetch all products and build cost/type lookup maps.
 * Returns productTypeMap (product_id → product_type) and costsByVariant (variant_id → cost).
 * Used by CFO-01 and CFO-03 for margin calculations.
 *
 * @param {{ log?: Function }} [opts] - Optional logger (e.g. ctx.log)
 * @returns {{ costsByVariant: Object, productTypeMap: Object, totalProducts: number, missingCostCount: number }}
 */
export async function pullProductCosts(opts = {}) {
  const log = opts.log || (() => {});

  log('Fetching all products for type and cost data');
  const products = await getProducts();
  log(`Fetched ${products.length} products`);

  const productTypeMap = {};        // product_id → product_type
  const invItemToVariant = {};      // inventory_item_id → variant_id
  const allInvItemIds = [];

  for (const product of products) {
    productTypeMap[product.id] = product.product_type || 'Uncategorized';

    for (const variant of product.variants || []) {
      if (variant.inventory_item_id) {
        invItemToVariant[variant.inventory_item_id] = variant.id;
        allInvItemIds.push(variant.inventory_item_id);
      }
    }
  }

  log(`Fetching cost data for ${allInvItemIds.length} inventory items`);
  const costsById = await getInventoryCosts(allInvItemIds, { log });

  // Map inventoryItemId → variantId costs
  const costsByVariant = {};
  for (const [invItemId, cost] of Object.entries(costsById)) {
    const variantId = invItemToVariant[invItemId];
    if (variantId) {
      costsByVariant[variantId] = cost;
    }
  }

  // Count products where no variant has cost data
  let missingCostCount = 0;
  for (const product of products) {
    const hasCost = (product.variants || []).some(v => costsByVariant[v.id]);
    if (!hasCost) missingCostCount++;
  }

  log(`Cost data: ${Object.keys(costsByVariant).length} variants with cost, ${missingCostCount} products fully missing cost`);

  return { costsByVariant, productTypeMap, totalProducts: products.length, missingCostCount };
}
