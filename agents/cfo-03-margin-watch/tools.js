// agents/cfo-03-margin-watch/tools.js — Shopify data pull and margin calculation
// Fetches orders and product costs from Shopify, computes per-category gross margins.
// Note: Shopify line items don't carry product_type — we build a lookup from the products API.
// Note: Cost-per-item lives on the InventoryItem, not the variant — we batch-fetch via inventoryItem.list().
// Note: Cost is keyed by variant_id (not product_id) because multi-variant products
//       (e.g. box vs. pack) have different costs per variant.

import { getOrders, pullProductCosts } from '../../shared/shopify.js';

export { pullProductCosts };

// Minimum acceptable gross margin — categories below this trigger alerts
export const MARGIN_THRESHOLD = 0.30;

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
