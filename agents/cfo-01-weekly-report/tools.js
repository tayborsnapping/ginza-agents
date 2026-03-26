// agents/cfo-01-weekly-report/tools.js — Shopify data pull and weekly comparison
// Ginza is open Wed-Sun, so "weekly" means the Wed-Sun business week.
// Fetches current + previous business week orders, builds category breakdowns,
// computes top sellers and week-over-week changes.
// Reuses the variant-level cost lookup pattern from CFO-03 for margin data.

import { getOrders, getProducts } from '../../shared/shopify.js';
import ShopifyApi from 'shopify-api-node';

/** Get the shared Shopify client (same credentials as shared/shopify.js) */
function getShopifyClient() {
  return new ShopifyApi({
    shopName: process.env.SHOPIFY_STORE,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    autoLimit: { calls: 2, interval: 1000 },
  });
}

/**
 * Fetch all products and build lookup maps (same pattern as CFO-03):
 *   - productTypeMap: product_id → product_type
 *   - costsByVariant: variant_id → cost (via InventoryItem API)
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

  for (const product of products) {
    productTypeMap[product.id] = product.product_type || 'Uncategorized';

    for (const variant of product.variants || []) {
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

  ctx.log(`Fetching cost data for ${allInvItemIds.length} inventory items`);

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

  ctx.log(`Cost data: ${Object.keys(costsByVariant).length} variants with cost`);

  return { costsByVariant, productTypeMap };
}

/**
 * Get the Wed-Sun business week boundaries.
 * Ginza is open Wed-Sun, closed Mon-Tue. The report runs Monday morning,
 * so "current week" = the most recently completed Wed-Sun.
 * Returns date ranges for current and previous business weeks plus labels.
 */
function getBusinessWeekBounds() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOfWeek = today.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Find the most recent past Sunday (last completed business day).
  // If today is Sunday, use the previous Sunday so we have a full week.
  const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const lastSunday = new Date(today.getTime() - daysToLastSunday * 24 * 60 * 60 * 1000);

  // Current business week: Wednesday 00:00 UTC → Monday 00:00 UTC (end of Sunday)
  const currentWed = new Date(lastSunday.getTime() - 4 * 24 * 60 * 60 * 1000);
  const currentEnd = new Date(lastSunday.getTime() + 24 * 60 * 60 * 1000);

  // Previous business week: same shape, 7 days earlier
  const prevSunday = new Date(lastSunday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWed = new Date(prevSunday.getTime() - 4 * 24 * 60 * 60 * 1000);
  const prevEnd = new Date(prevSunday.getTime() + 24 * 60 * 60 * 1000);

  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

  return {
    current: { start: currentWed, end: currentEnd, label: `Week of ${fmt(currentWed)} - ${fmt(lastSunday)}` },
    previous: { start: prevWed, end: prevEnd, label: `Week of ${fmt(prevWed)} - ${fmt(prevSunday)}` },
  };
}

/**
 * Fetch orders for the current Wed-Sun business week AND the previous Wed-Sun week.
 * Group by product_type using the product lookup. Calculate revenue, units, orders,
 * and margin per category for each week.
 *
 * @param {object} ctx - Runner context
 * @param {object} productTypeMap - product_id → product_type
 * @param {object} costsByVariant - variant_id → cost
 */
export async function pullWeeklyOrders(ctx, productTypeMap, costsByVariant) {
  const bounds = getBusinessWeekBounds();

  const currentStart = bounds.current.start.toISOString();
  const currentEnd = bounds.current.end.toISOString();
  const previousStart = bounds.previous.start.toISOString();

  ctx.log(`Current business week (${bounds.current.label}): ${currentStart} to ${currentEnd}`);
  ctx.log(`Previous business week (${bounds.previous.label}): ${previousStart} to ${bounds.previous.end.toISOString()}`);

  const allOrders = await getOrders({
    createdAtMin: previousStart,
    createdAtMax: currentEnd,
    status: 'any',
  });

  ctx.log(`Fetched ${allOrders.length} orders (two business weeks)`);

  // Split into current and previous week using the Wednesday boundary
  const splitTime = bounds.current.start.getTime();
  const currentWeekOrders = [];
  const previousWeekOrders = [];

  for (const order of allOrders) {
    if (order.cancelled_at) continue;
    const orderTime = new Date(order.created_at).getTime();
    if (orderTime >= splitTime) {
      currentWeekOrders.push(order);
    } else {
      previousWeekOrders.push(order);
    }
  }

  ctx.log(`Current week: ${currentWeekOrders.length} orders | Previous week: ${previousWeekOrders.length} orders`);

  // Build category breakdowns for each week
  const currentWeek = buildWeekData(currentWeekOrders, productTypeMap, costsByVariant);
  const previousWeek = buildWeekData(previousWeekOrders, productTypeMap, costsByVariant);

  currentWeek.periodStart = currentStart;
  currentWeek.periodEnd = currentEnd;
  currentWeek.label = bounds.current.label;
  previousWeek.periodStart = previousStart;
  previousWeek.periodEnd = bounds.previous.end.toISOString();
  previousWeek.label = bounds.previous.label;

  return { currentWeek, previousWeek, currentWeekOrders, weekLabel: bounds.current.label };
}

/**
 * Build category breakdown from a set of orders.
 * Returns { categories, totalRevenue, totalUnits, totalOrders, totalCOGS, overallMargin }
 */
function buildWeekData(orders, productTypeMap, costsByVariant) {
  const categories = {};
  let totalRevenue = 0;
  let totalUnits = 0;
  let totalCOGS = 0;
  let totalLineItems = 0;
  let missingCostLineItems = 0;

  for (const order of orders) {
    for (const item of order.line_items || []) {
      const category = productTypeMap[item.product_id] || 'Uncategorized';
      const lineRevenue = parseFloat(item.price) * item.quantity;
      const unitCost = costsByVariant[item.variant_id] || 0;
      const lineCOGS = unitCost * item.quantity;

      totalLineItems++;
      if (unitCost === 0) missingCostLineItems++;

      if (!categories[category]) {
        categories[category] = { revenue: 0, units: 0, cogs: 0 };
      }

      categories[category].revenue += lineRevenue;
      categories[category].units += item.quantity;
      categories[category].cogs += lineCOGS;

      totalRevenue += lineRevenue;
      totalUnits += item.quantity;
      totalCOGS += lineCOGS;
    }
  }

  // Round values
  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCOGS = Math.round(totalCOGS * 100) / 100;
  const overallMargin = totalRevenue > 0
    ? Math.round(((totalRevenue - totalCOGS) / totalRevenue) * 1000) / 10
    : 0;

  // Convert categories to sorted array
  const categoryList = Object.entries(categories)
    .map(([name, data]) => ({
      name,
      revenue: Math.round(data.revenue * 100) / 100,
      units: data.units,
      cogs: Math.round(data.cogs * 100) / 100,
      margin: data.revenue > 0
        ? Math.round(((data.revenue - data.cogs) / data.revenue) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const missingCostPct = totalLineItems > 0
    ? Math.round((missingCostLineItems / totalLineItems) * 1000) / 10
    : 0;

  return {
    categories: categoryList,
    totalRevenue,
    totalUnits,
    totalOrders: orders.length,
    totalCOGS,
    overallMargin,
    totalLineItems,
    missingCostLineItems,
    missingCostPct,
  };
}

/**
 * From the current week's orders, rank products by revenue and by units sold.
 * Returns { byRevenue: top10[], byUnits: top10[] }
 *
 * @param {object} ctx - Runner context
 * @param {Array} orders - Current week's orders
 */
export function pullTopSellers(ctx, orders) {
  const productMap = {}; // product title → { revenue, units }

  for (const order of orders) {
    for (const item of order.line_items || []) {
      const title = item.title || item.name || `Product ${item.product_id}`;
      const variantInfo = item.variant_title ? ` (${item.variant_title})` : '';
      const key = `${title}${variantInfo}`;
      const lineRevenue = parseFloat(item.price) * item.quantity;

      if (!productMap[key]) {
        productMap[key] = { title: key, revenue: 0, units: 0 };
      }
      productMap[key].revenue += lineRevenue;
      productMap[key].units += item.quantity;
    }
  }

  const allProducts = Object.values(productMap);

  const byRevenue = [...allProducts]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map(p => ({ title: p.title, revenue: Math.round(p.revenue * 100) / 100 }));

  const byUnits = [...allProducts]
    .sort((a, b) => b.units - a.units)
    .slice(0, 10)
    .map(p => ({ title: p.title, units: p.units }));

  ctx.log(`Top sellers: ${allProducts.length} unique products ranked`);

  return { byRevenue, byUnits };
}

/**
 * Calculate week-over-week percentage changes for totals and per-category revenue.
 * Flags any category with >20% swing in either direction.
 *
 * @param {object} currentWeek - From buildWeekData
 * @param {object} previousWeek - From buildWeekData
 */
export function calculateWoW(currentWeek, previousWeek) {
  const pctChange = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  const totals = {
    revenue: pctChange(currentWeek.totalRevenue, previousWeek.totalRevenue),
    units: pctChange(currentWeek.totalUnits, previousWeek.totalUnits),
    orders: pctChange(currentWeek.totalOrders, previousWeek.totalOrders),
  };

  // Build previous week category lookup
  const prevCategoryMap = {};
  for (const cat of previousWeek.categories) {
    prevCategoryMap[cat.name] = cat;
  }

  // Per-category WoW
  const categoryChanges = [];
  const flags = [];

  for (const cat of currentWeek.categories) {
    const prev = prevCategoryMap[cat.name];
    const prevRevenue = prev ? prev.revenue : 0;
    const change = pctChange(cat.revenue, prevRevenue);

    categoryChanges.push({
      name: cat.name,
      currentRevenue: cat.revenue,
      previousRevenue: prevRevenue,
      change_pct: change,
    });

    // Flag >20% swings
    if (Math.abs(change) > 20) {
      flags.push({
        category: cat.name,
        change_pct: change,
        direction: change > 0 ? 'up' : 'down',
        currentRevenue: cat.revenue,
        previousRevenue: prevRevenue,
      });
    }
  }

  // Check for categories that existed last week but disappeared this week
  for (const cat of previousWeek.categories) {
    const stillExists = currentWeek.categories.some(c => c.name === cat.name);
    if (!stillExists && cat.revenue > 0) {
      flags.push({
        category: cat.name,
        change_pct: -100,
        direction: 'down',
        currentRevenue: 0,
        previousRevenue: cat.revenue,
      });
    }
  }

  return { totals, categoryChanges, flags };
}
