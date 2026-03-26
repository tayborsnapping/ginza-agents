// agents/test-agent/index.js — Framework validation agent
// Tests the full runner lifecycle: DB row → prompt load → Anthropic call → output write → alert queue
// Run with: node agents/test-agent/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import { parseJSON } from '../../shared/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

await run({
  agentId: 'test-agent',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log('Starting framework validation test');

    // Call Anthropic with a simple user message
    const result = await ctx.anthropic('Run your test and return the JSON response.');

    ctx.log(`Anthropic response received (${result.tokensIn} in, ${result.tokensOut} out)`);
    ctx.log(`Raw response: ${result.content}`);

    // Parse the JSON response
    const parsed = parseJSON(result.content.trim());
    if (!parsed || parsed.status !== 'ok') {
      throw new Error(`Unexpected response from Anthropic: ${result.content}`);
    }

    // Write output to agent_outputs table
    ctx.writeOutput('test_output', {
      status: parsed.status,
      message: parsed.message,
      timestamp: parsed.timestamp,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    ctx.log('Output written to agent_outputs');

    // Queue an info alert to the alerts table
    ctx.alert('info', 'Test Complete', 'Test agent ran successfully — framework is operational');
    ctx.log('Info alert queued');

    return `Framework test passed: ${parsed.message}`;
  },
});
