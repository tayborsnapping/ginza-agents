// agents/cto-01-health/index.js — CTO-01 Health Monitor
// Cron-scheduled agent (every 30 min). Checks all agent health via agent_runs,
// sends data to Anthropic for analysis, writes health_status output, and queues alerts.
// Run with: node agents/cto-01-health/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import { parseJSON, stripCodeFences } from '../../shared/utils.js';
import { getHealthData } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

await run({
  agentId: 'cto-01-health',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log('Gathering health data for all registered agents');

    // Step 1: Collect health data from agent_runs
    const healthData = getHealthData(ctx);

    ctx.log(`Health data collected for ${healthData.agents.length} agents`);

    // Step 2: Send to Anthropic for analysis
    const result = await ctx.anthropic(
      `Analyze this agent health data and return your assessment:\n\n${JSON.stringify(healthData, null, 2)}`
    );

    ctx.log(`Anthropic response received (${result.tokensIn} in, ${result.tokensOut} out)`);

    // Step 3: Parse the structured response (strip markdown fences if present)
    const analysis = parseJSON(stripCodeFences(result.content));
    if (!analysis || !analysis.agents) {
      throw new Error(`Invalid health analysis response: ${result.content.substring(0, 200)}`);
    }

    // Step 4: Write health status to agent_outputs
    ctx.writeOutput('health_status', analysis);
    ctx.log(`Health status written: ${analysis.overallStatus}`);

    // Step 5: Queue alerts for any warnings or critical issues
    if (analysis.alerts && analysis.alerts.length > 0) {
      for (const alert of analysis.alerts) {
        ctx.alert(
          alert.severity,
          `Health: ${alert.agentId}`,
          alert.message
        );
        ctx.log(`Alert queued: [${alert.severity}] ${alert.agentId} — ${alert.message}`);
      }
    }

    return analysis.summary || `System ${analysis.overallStatus}: ${analysis.agents.length} agents checked`;
  },
});
