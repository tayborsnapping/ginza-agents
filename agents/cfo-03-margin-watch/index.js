// agents/cfo-03-margin-watch/index.js — CFO-03 Margin Watch Agent
// Daily agent (6 AM ET). Pulls Shopify sales + cost data, computes gross margins
// by product category, sends to Anthropic for analysis, writes margin_alerts output.
// Run with: node agents/cfo-03-margin-watch/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import { parseJSON } from '../../shared/utils.js';
import { pullCategorySales, pullProductCosts, calculateMargins, MARGIN_THRESHOLD } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

await run({
  agentId: 'cfo-03-margin',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log('Starting margin watch — pulling Shopify data');

    // Step 1: Pull product data first (need productTypeMap for categorizing orders)
    const { costsByProduct, productTypeMap, totalProducts, missingCostCount } = await pullProductCosts(ctx);

    // Step 2: Pull sales data (trailing 7 days), using productTypeMap for categories
    const { salesByCategory, orders, orderCount, periodStart, periodEnd } = await pullCategorySales(ctx, productTypeMap);

    ctx.log(`Sales: ${Object.keys(salesByCategory).length} categories from ${orderCount} orders`);
    ctx.log(`Costs: ${Object.keys(costsByProduct).length}/${totalProducts} products have cost data`);

    // Step 3: Calculate margins
    const marginData = calculateMargins(salesByCategory, costsByProduct, productTypeMap, orders, missingCostCount);
    marginData.orderCount = orderCount;
    marginData.periodStart = periodStart;
    marginData.periodEnd = periodEnd;

    ctx.log(`Overall margin: ${marginData.overallMargin}% | Revenue: $${marginData.totalRevenue} | COGS: $${marginData.totalCOGS}`);

    // Step 4: Send to Anthropic for analysis
    const result = await ctx.anthropic(
      `Analyze the following margin data for the past 7 days and return your assessment:\n\n${JSON.stringify(marginData, null, 2)}`
    );

    ctx.log(`Anthropic response received (${result.tokensIn} in, ${result.tokensOut} out)`);

    // Step 5: Parse response (strip markdown fences if present)
    let jsonStr = result.content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const analysis = parseJSON(jsonStr);
    if (!analysis) {
      throw new Error(`Invalid margin analysis response: ${result.content.substring(0, 200)}`);
    }

    // Step 6: Write full analysis to agent_outputs
    const output = {
      ...analysis,
      rawData: marginData,
      analyzedAt: new Date().toISOString(),
    };
    ctx.writeOutput('margin_alerts', output);
    ctx.log('Margin analysis written to agent_outputs');

    // Step 7: Queue Discord alerts based on margin thresholds
    const warningCategories = marginData.categoryMargins.filter(c => c.status === 'warning');
    const criticalCategories = marginData.categoryMargins.filter(c => c.status === 'critical');

    if (criticalCategories.length > 0) {
      const names = criticalCategories.map(c => `${c.category} (${c.margin}%)`).join(', ');
      ctx.alert(
        'critical',
        'Negative Margin Alert',
        `Categories selling below cost: ${names}`
      );
      ctx.log(`Critical alert queued: ${names}`);
    }

    if (warningCategories.length > 0) {
      const names = warningCategories.map(c => `${c.category} (${c.margin}%)`).join(', ');
      ctx.alert(
        'warning',
        'Low Margin Warning',
        `Categories below ${MARGIN_THRESHOLD * 100}% threshold: ${names}`
      );
      ctx.log(`Warning alert queued: ${names}`);
    }

    if (criticalCategories.length === 0 && warningCategories.length === 0) {
      ctx.log('All categories above margin threshold — no alerts needed');
    }

    // Return summary for agent_runs
    const summary = analysis.summary
      || `Margin watch complete: ${marginData.overallMargin}% overall margin, ${orderCount} orders, ${warningCategories.length} warnings, ${criticalCategories.length} critical`;
    return summary;
  },
});
