// agents/cfo-03-margin-watch/tools.js — Shopify data pull and margin calculation
// Fetches orders and product costs from Shopify, computes per-category gross margins.
// Note: Shopify line items don't carry product_type — we build a lookup from the products API.
// Note: Cost-per-item lives on the InventoryItem, not the variant — we batch-fetch via inventoryItem.list().
// Note: Cost is keyed by variant_id (not product_id) because multi-variant products
//       (e.g. box vs. pack) have different costs per variant.

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
 * Fetch all products and build lookup maps:
 *   - productTypeMap: product_id → product_type (for categorizing order line items)
 *   - costsByVariant: variant_id → cost (for accurate per-variant COGS)
 *
 * Batch-fetches InventoryItems to get cost-per-item, keyed by variant_id.
 * Returns { costsByVariant, productTypeMap, totalProducts, missingCostCount }
 *
 * @param {object} ctx - Runner context
 */
export async function pullProductCosts(ctx) {
  ctx.log('Fetching all products for type and cost data');

  const products = await getProducts();
  ctx.log(`Fetched ${products.length} products`);

  const productTypeMap = {};        // product_id → product_type
  const invItemToVariant = {};      // inventory_item_id → variant_id
  const allInvItemIds = [];
  let totalVariants = 0;

  for (const product of products) {
    productTypeMap[product.id] = product.product_type || 'Uncategorized';

    for (const variant of product.variants || []) {
      totalVariants++;
      if (variant.inventory_item_id) {
        invItemToVariant[variant.inventory_item_id] = variant.id;
        allInvItemIds.push(variant.inventory_item_id);
      }
    }
  }

  // Batch-fetch inventory items in chunks of 100 (Shopify API limit)
  const shopify = getShopifyClient();
  const costsByVariant = {};        // variant_id → cost
  const CHUNK_SIZE = 100;

  ctx.log(`Fetching cost data for ${allInvItemIds.length} inventory items (${totalVariants} variants)`);

  for (let i = 0; i < allInvItemIds.length; i += CHUNK_SIZE) {
    const chunk = allInvItemIds.slice(i, i + CHUNK_SIZE);
    try {
      const items = await shopify.inventoryItem.list({
        ids: chunk.join(','),
        limit: CHUNK_SIZE,
      });

      for (const item of items) {
        const variantId = invItemToVariant[item.id];
        const cost = item.cost ? parseFloat(item.cost) : null;

        if (variantId && cost && cost > 0) {
          costsByVariant[variantId] = cost;
        }
      }
    } catch (err) {
      ctx.log(`Warning: failed to fetch inventory items batch ${i}-${i + CHUNK_SIZE}: ${err.message}`);
    }
  }

  // Count variants without cost data
  let missingCostCount = 0;
  for (const product of products) {
    // A product is "missing cost" if none of its variants have cost data
    const hasCost = (product.variants || []).some(v => costsByVariant[v.id]);
    if (!hasCost) missingCostCount++;
  }

  ctx.log(`Cost data: ${Object.keys(costsByVariant).length} variants with cost, ${missingCostCount} products fully missing cost`);

  return { costsByVariant, productTypeMap, totalProducts: products.length, missingCostCount };
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
 * Uses variant_id to match costs (not product_id) so multi-variant products
 * (box vs. pack) get the correct per-variant cost.
 *
 * @param {object} salesByCategory  - From pullCategorySales
 * @param {object} costsByVariant   - From pullProductCosts (map of variantId → cost)
 * @param {object} productTypeMap   - product_id → product_type
 * @param {Array}  orders           - Raw orders (to compute per-item COGS)
 * @param {number} missingCostCount - Products without cost data
 */
export function calculateMargins(salesByCategory, costsByVariant, productTypeMap, orders, missingCostCount) {
  const categoryMargins = [];
  let totalRevenue = 0;
  let totalCOGS = 0;

  // Build COGS by category from order line items, using variant_id for cost lookup
  const cogsByCategory = {};
  let totalLineItems = 0;
  let missingCostLineItems = 0;

  for (const order of orders) {
    if (order.cancelled_at) continue;

    for (const item of order.line_items || []) {
      const category = productTypeMap[item.product_id] || 'Uncategorized';
      const unitCost = costsByVariant[item.variant_id] || 0;
      const lineCOGS = unitCost * item.quantity;

      totalLineItems++;
      if (unitCost === 0) missingCostLineItems++;

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

  const missingCostPct = totalLineItems > 0
    ? Math.round((missingCostLineItems / totalLineItems) * 1000) / 10
    : 0;

  return {
    categoryMargins,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    overallMargin,
    missingCostCount,
    totalLineItems,
    missingCostLineItems,
    missingCostPct,
  };
}
