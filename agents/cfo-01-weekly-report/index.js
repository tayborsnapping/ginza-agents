// agents/cfo-01-weekly-report/index.js — CFO-01 Weekly Report Agent
// Scheduled Monday 7 AM ET. Pulls Wed-Sun business week data (current + previous),
// computes WoW trends, sends to Anthropic for analysis and narrative, writes
// weekly_snapshot output, queues Discord alerts.
// Run with: node agents/cfo-01-weekly-report/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import { parseJSON, stripCodeFences } from '../../shared/utils.js';
import { pullProductCosts, pullWeeklyOrders, pullTopSellers, calculateWoW } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

await run({
  agentId: 'cfo-01-weekly',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log('Starting weekly report — pulling Shopify data');

    // Step 1: Pull product data (type map + variant-level costs)
    const { costsByVariant, productTypeMap } = await pullProductCosts(ctx);

    // Step 2: Pull Wed-Sun business week orders (current + previous)
    const { currentWeek, previousWeek, currentWeekOrders, weekLabel } = await pullWeeklyOrders(ctx, productTypeMap, costsByVariant);
    ctx.log(`Report: ${weekLabel}`);

    ctx.log(`Current week: $${currentWeek.totalRevenue} revenue, ${currentWeek.totalUnits} units, ${currentWeek.totalOrders} orders`);
    ctx.log(`Previous week: $${previousWeek.totalRevenue} revenue, ${previousWeek.totalUnits} units, ${previousWeek.totalOrders} orders`);

    // Step 3: Top sellers from current week
    const topSellers = pullTopSellers(ctx, currentWeekOrders);

    // Step 4: Week-over-week changes
    const wow = calculateWoW(currentWeek, previousWeek);

    ctx.log(`WoW: revenue ${wow.totals.revenue > 0 ? '+' : ''}${wow.totals.revenue}%, units ${wow.totals.units > 0 ? '+' : ''}${wow.totals.units}%, ${wow.flags.length} flagged categories`);

    // Step 5: Send combined data to Anthropic for analysis
    const payload = {
      currentWeek,
      previousWeek,
      wow,
      topSellers,
      flags: wow.flags,
    };

    const result = await ctx.anthropic(
      `Analyze the following weekly sales data and generate the Monday report:\n\n${JSON.stringify(payload, null, 2)}`
    );

    ctx.log(`Anthropic response received (${result.tokensIn} in, ${result.tokensOut} out)`);

    // Step 6: Parse response (strip markdown fences if present)
    const analysis = parseJSON(stripCodeFences(result.content));
    if (!analysis) {
      throw new Error(`Invalid weekly report response: ${result.content.substring(0, 200)}`);
    }

    // Step 7: Write full report to agent_outputs
    const output = {
      ...analysis,
      weekLabel,
      rawData: payload,
      generatedAt: new Date().toISOString(),
    };
    ctx.writeOutput('weekly_snapshot', output);
    ctx.log('Weekly snapshot written to agent_outputs');

    // Step 8: Queue Discord info alert with the week label and formatted summary
    const discordText = analysis.report?.discordText
      || analysis.discordText
      || `${weekLabel}: $${currentWeek.totalRevenue} revenue (${wow.totals.revenue > 0 ? '+' : ''}${wow.totals.revenue}% WoW), ${currentWeek.totalOrders} orders`;

    ctx.alert('info', `Weekly Report — ${weekLabel}`, discordText);
    ctx.log('Discord info alert queued');

    // Step 9: If revenue dropped >20% WoW, queue a warning alert
    if (wow.totals.revenue < -20) {
      ctx.alert(
        'warning',
        `Revenue Drop Alert — ${weekLabel}`,
        `Revenue dropped ${Math.abs(wow.totals.revenue)}% week-over-week ($${previousWeek.totalRevenue} → $${currentWeek.totalRevenue}). Review the weekly report for details.`
      );
      ctx.log(`Warning alert queued: revenue dropped ${wow.totals.revenue}%`);
    }

    // Step 10: Warn if >20% of line items have no cost data
    if (currentWeek.missingCostPct > 20) {
      ctx.alert(
        'warning',
        `Missing Cost Data — ${weekLabel}`,
        `${currentWeek.missingCostPct}% of line items (${currentWeek.missingCostLineItems}/${currentWeek.totalLineItems}) have no cost data — margin calculations may be unreliable.`
      );
      ctx.log(`Warning: ${currentWeek.missingCostPct}% of line items missing cost data`);
    }

    // Return summary for agent_runs
    const summary = analysis.summary
      || `${weekLabel}: $${currentWeek.totalRevenue} revenue (${wow.totals.revenue > 0 ? '+' : ''}${wow.totals.revenue}% WoW), ${currentWeek.totalUnits} units, ${currentWeek.totalOrders} orders`;
    return summary;
  },
});
