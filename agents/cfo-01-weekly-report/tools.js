// agents/cfo-01-weekly-report/tools.js — Shopify data pull and weekly comparison
// Ginza is open Wed-Sun, so "weekly" means the Wed-Sun business week.
// Fetches current + previous business week orders, builds category breakdowns,
// computes top sellers and week-over-week changes.

import { getOrders, pullProductCosts } from '../../shared/shopify.js';

export { pullProductCosts };

const DETROIT_TZ = 'America/Detroit';

/**
 * Get the current date components in Detroit timezone.
 * Returns { year, month (1-based), day, dayOfWeek (0=Sun) }.
 */
function getDetroitDateParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DETROIT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const get = (type) => parts.find(p => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

/**
 * Create a Date representing midnight Detroit time for a given local date.
 * Uses the UTC offset for that date in Detroit to anchor correctly.
 */
function detroitMidnight(year, month, day) {
  // Create a rough date, then find the exact Detroit UTC offset for it
  const rough = new Date(Date.UTC(year, month - 1, day, 12)); // noon UTC as anchor
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DETROIT_TZ,
    timeZoneName: 'shortOffset',
  });
  const offsetPart = formatter.formatToParts(rough).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  // Parse "GMT-4" or "GMT-5" → hours offset
  const offsetMatch = offsetPart.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : -5;
  // Midnight Detroit = midnight local = 00:00 + reverse offset in UTC
  return new Date(Date.UTC(year, month - 1, day, -offsetHours, 0, 0));
}

/**
 * Get the Wed-Sun business week boundaries in Detroit time.
 * Ginza is open Wed-Sun, closed Mon-Tue. The report runs Monday morning,
 * so "current week" = the most recently completed Wed-Sun.
 * Returns date ranges for current and previous business weeks plus labels.
 */
function getBusinessWeekBounds() {
  const { year, month, day, dayOfWeek } = getDetroitDateParts();

  // Find the most recent past Sunday (last completed business day).
  // If today is Sunday, use the previous Sunday so we have a full week.
  const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;

  // Build dates relative to today in Detroit time
  const todayMidnight = detroitMidnight(year, month, day);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const lastSunday = new Date(todayMidnight.getTime() - daysToLastSunday * DAY_MS);

  // Current business week: Wednesday 00:00 Detroit → Monday 00:00 Detroit (end of Sunday)
  const currentWed = new Date(lastSunday.getTime() - 4 * DAY_MS);
  const currentEnd = new Date(lastSunday.getTime() + 1 * DAY_MS);

  // Previous business week: same shape, 7 days earlier
  const prevSunday = new Date(lastSunday.getTime() - 7 * DAY_MS);
  const prevWed = new Date(prevSunday.getTime() - 4 * DAY_MS);
  const prevEnd = new Date(prevSunday.getTime() + 1 * DAY_MS);

  // Format dates as Detroit local for labels
  const fmt = (d) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: DETROIT_TZ, month: 'numeric', day: 'numeric' }).formatToParts(d);
    return `${p.find(x => x.type === 'month')?.value}/${p.find(x => x.type === 'day')?.value}`;
  };

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
