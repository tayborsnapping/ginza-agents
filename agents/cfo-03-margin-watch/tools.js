// agents/cfo-03-margin-watch/tools.js — Shopify data pull and margin calculation
// Fetches orders and product costs from Shopify, computes per-category gross margins.
// Note: Shopify line items don't carry product_type — we build a lookup from the products API.
// Note: Cost-per-item lives on the InventoryItem, not the variant — we batch-fetch via inventoryItem.list().

import { getOrders, getProducts } from '../../shared/shopify.js';
import ShopifyApi from 'shopify-api-node';

// Minimum acceptable gross margin — categories below this trigger alerts
export const MARGIN_THRESHOLD = 0.30;

/** Get the shared Shopify client (same credentials as shared/shopify.js) */
function getShopifyClient() {
  return new ShopifyApi({
    shopName: process.env.SHOPIFY_STORE,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    autoLimit: { calls: 2, interval: 1000 },
  });
}

/**
 * Fetch all products and build two lookup maps:
 *   - productTypeMap: product_id → product_type (for categorizing order line items)
 *   - inventoryItemIds: array of inventory_item_id values (for cost lookup)
 *   - variantToProduct: inventory_item_id → product_id (for joining cost back)
 *
 * Then batch-fetch InventoryItems to get cost-per-item.
 * Returns { costsByProduct, productTypeMap, totalProducts, missingCostCount }
 *
 * @param {object} ctx - Runner context
 */
export async function pullProductCosts(ctx) {
  ctx.log('Fetching all products for type and cost data');

  const products = await getProducts();
  ctx.log(`Fetched ${products.length} products`);

  const productTypeMap = {};      // product_id → product_type
  const invItemToProduct = {};    // inventory_item_id → product_id
  const allInvItemIds = [];

  for (const product of products) {
    productTypeMap[product.id] = product.product_type || 'Uncategorized';

    for (const variant of product.variants || []) {
      if (variant.inventory_item_id) {
        invItemToProduct[variant.inventory_item_id] = product.id;
        allInvItemIds.push(variant.inventory_item_id);
      }
    }
  }

  // Batch-fetch inventory items in chunks of 100 (Shopify API limit)
  const shopify = getShopifyClient();
  const costsByProduct = {};
  let missingCostCount = 0;
  const CHUNK_SIZE = 100;

  ctx.log(`Fetching cost data for ${allInvItemIds.length} inventory items`);

  for (let i = 0; i < allInvItemIds.length; i += CHUNK_SIZE) {
    const chunk = allInvItemIds.slice(i, i + CHUNK_SIZE);
    try {
      const items = await shopify.inventoryItem.list({
        ids: chunk.join(','),
        limit: CHUNK_SIZE,
      });

      for (const item of items) {
        const productId = invItemToProduct[item.id];
        const cost = item.cost ? parseFloat(item.cost) : null;

        if (productId && cost && cost > 0) {
          // If multiple variants, use the first cost found
          if (!costsByProduct[productId]) {
            costsByProduct[productId] = cost;
          }
        }
      }
    } catch (err) {
      ctx.log(`Warning: failed to fetch inventory items batch ${i}-${i + CHUNK_SIZE}: ${err.message}`);
    }
  }

  // Count products without cost data
  for (const product of products) {
    if (!costsByProduct[product.id]) {
      missingCostCount++;
    }
  }

  ctx.log(`Cost data: ${Object.keys(costsByProduct).length} products with cost, ${missingCostCount} missing`);

  return { costsByProduct, productTypeMap, totalProducts: products.length, missingCostCount };
}

/**
 * Fetch orders for the trailing 7 days, group line items by product_type.
 * Uses productTypeMap to look up types since line items don't carry product_type.
 * Returns { salesByCategory, orderCount, periodStart, periodEnd, orders }
 *
 * @param {object} ctx - Runner context
 * @param {object} productTypeMap - product_id → product_type from pullProductCosts
 */
export async function pullCategorySales(ctx, productTypeMap) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const periodStart = sevenDaysAgo.toISOString();
  const periodEnd = now.toISOString();

  ctx.log(`Fetching orders from ${periodStart} to ${periodEnd}`);

  const orders = await getOrders({
    createdAtMin: periodStart,
    createdAtMax: periodEnd,
    status: 'any',
  });

  ctx.log(`Fetched ${orders.length} orders`);

  // Group line items by product_type (looked up from productTypeMap)
  const salesByCategory = {};

  for (const order of orders) {
    if (order.cancelled_at) continue;

    for (const item of order.line_items || []) {
      const category = productTypeMap[item.product_id] || 'Uncategorized';

      if (!salesByCategory[category]) {
        salesByCategory[category] = {
          revenue: 0,
          quantity: 0,
          productIds: new Set(),
        };
      }

      const lineRevenue = parseFloat(item.price) * item.quantity;
      salesByCategory[category].revenue += lineRevenue;
      salesByCategory[category].quantity += item.quantity;

      if (item.product_id) {
        salesByCategory[category].productIds.add(item.product_id);
      }
    }
  }

  return { salesByCategory, orders, orderCount: orders.length, periodStart, periodEnd };
}

/**
 * Match revenue to COGS by category. Returns the full margin analysis object.
 *
 * @param {object} salesByCategory - From pullCategorySales
 * @param {object} costsByProduct  - From pullProductCosts (map of productId → cost)
 * @param {object} productTypeMap  - product_id → product_type
 * @param {Array}  orders          - Raw orders (to compute per-item COGS)
 * @param {number} missingCostCount - Products without cost data
 */
export function calculateMargins(salesByCategory, costsByProduct, productTypeMap, orders, missingCostCount) {
  const categoryMargins = [];
  let totalRevenue = 0;
  let totalCOGS = 0;

  // Build COGS by category from order line items
  const cogsByCategory = {};

  for (const order of orders) {
    if (order.cancelled_at) continue;

    for (const item of order.line_items || []) {
      const category = productTypeMap[item.product_id] || 'Uncategorized';
      const unitCost = costsByProduct[item.product_id] || 0;
      const lineCOGS = unitCost * item.quantity;

      if (!cogsByCategory[category]) {
        cogsByCategory[category] = 0;
      }
      cogsByCategory[category] += lineCOGS;
    }
  }

  // Build category margin rows
  for (const [category, data] of Object.entries(salesByCategory)) {
    const revenue = Math.round(data.revenue * 100) / 100;
    const cogs = Math.round((cogsByCategory[category] || 0) * 100) / 100;
    const margin = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0;
    const roundedMargin = Math.round(margin * 100) / 100;

    let status = 'healthy';
    if (roundedMargin < 0) {
      status = 'critical';
    } else if (roundedMargin < MARGIN_THRESHOLD * 100) {
      status = 'warning';
    }

    categoryMargins.push({
      category,
      revenue,
      cogs,
      margin: roundedMargin,
      quantity: data.quantity,
      status,
    });

    totalRevenue += revenue;
    totalCOGS += cogs;
  }

  // Sort by revenue descending
  categoryMargins.sort((a, b) => b.revenue - a.revenue);

  const overallMargin = totalRevenue > 0
    ? Math.round(((totalRevenue - totalCOGS) / totalRevenue) * 10000) / 100
    : 0;

  return {
    categoryMargins,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    overallMargin,
    missingCostCount,
  };
}
