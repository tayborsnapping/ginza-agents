// shared/runner.js — Agent execution framework
// Every agent calls run() with its config. The runner handles the full lifecycle:
// env loading → DB row → prompt assembly → execute → success/failure recording.
// Agents never manage DB rows or error handling directly.

import dotenv from 'dotenv';
dotenv.config({ override: true });
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import * as db from './db.js';
import { callAnthropic } from './anthropic.js';
import { getDetroitTime } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

/**
 * Run an agent through its full lifecycle.
 *
 * @param {object} config
 * @param {string}   config.agentId    - Agent identifier, e.g. 'cfo-03'
 * @param {string}   config.promptPath - Absolute path to this agent's prompt.md
 * @param {Function} config.execute    - Async function receiving ctx, returns summary string
 */
export async function run({ agentId, promptPath, execute }) {
  const startTime = Date.now();
  let runId;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  // Step 1: dotenv is loaded via top-level import above.
  // Step 2: Insert run record with status='running'.
  runId = db.insertRun(agentId);
  console.log(`[${agentId}] Run started (id=${runId})`);

  try {
    // Step 3: Read the agent's system prompt from disk.
    const resolvedPromptPath = resolve(promptPath);
    let systemPrompt = await readFile(resolvedPromptPath, 'utf-8');

    // Step 4/5: Get last run summary and inject template variables.
    const lastRunSummary = db.getLatestRunSummary(agentId);
    systemPrompt = systemPrompt
      .replace(/\{\{datetime\}\}/g, getDetroitTime())
      .replace(/\{\{last_run\}\}/g, lastRunSummary ?? 'No previous runs');

    // Step 6: Build the context object passed to execute().
    const ctx = {
      // Raw DB module — for agents that need custom queries (e.g. CTO-01 health monitor)
      db,

      /**
       * Call the Anthropic API using this agent's assembled system prompt.
       * Accumulates token counts across multiple calls in one run.
       *
       * @param {string} userMessage
       * @param {{ maxTokens?: number }} [opts]
       * @returns {{ content: string, tokensIn: number, tokensOut: number }}
       */
      async anthropic(userMessage, opts = {}) {
        const result = await callAnthropic({
          systemPrompt,
          userMessage,
          maxTokens: opts.maxTokens,
        });
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        return result;
      },

      /**
       * Queue a Discord alert via the alerts table (CTO-04 picks it up).
       * @param {'info'|'warning'|'critical'} priority
       * @param {string} title
       * @param {string} message
       */
      alert(priority, title, message) {
        db.insertAlert(agentId, priority, title, message);
      },

      /**
       * Read the most recent output for a given key from agent_outputs.
       * Returns parsed JSON or null.
       * @param {string} outputKey
       */
      readOutput(outputKey) {
        return db.getLatestOutput(outputKey);
      },

      /**
       * Write structured data to agent_outputs for this run.
       * @param {string} outputKey
       * @param {any} data  - Will be JSON.stringify'd automatically
       */
      writeOutput(outputKey, data) {
        db.insertOutput(agentId, runId, outputKey, data);
      },

      /**
       * Prefixed console.log with [agentId] [timestamp].
       * @param {string} message
       */
      log(message) {
        console.log(`[${agentId}] [${getDetroitTime()}] ${message}`);
      },
    };

    // Step 6 (continued): Call the agent's execute function.
    const summary = await execute(ctx);

    // Step 7: Record success.
    const durationMs = Date.now() - startTime;
    db.updateRun(runId, {
      status: 'success',
      summary: typeof summary === 'string' ? summary : JSON.stringify(summary),
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      durationMs,
    });

    console.log(`[${agentId}] Completed successfully in ${durationMs}ms (in=${totalTokensIn} out=${totalTokensOut})`);
  } catch (error) {
    // Step 8: Record failure, queue critical alert, exit non-zero.
    const durationMs = Date.now() - startTime;
    console.error(`[${agentId}] FAILED: ${error.message}`);
    if (error.stack) console.error(error.stack);

    try {
      db.updateRun(runId, {
        status: 'failure',
        error: error.message,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        durationMs,
      });
      db.insertAlert(agentId, 'critical', `Agent Failure: ${agentId}`, error.message);
    } catch (dbError) {
      console.error(`[${agentId}] Failed to record error in DB: ${dbError.message}`);
    }

    process.exit(1);
  }
}

/**
 * Spawn another agent as a detached child process.
 * Used by COO-01 to trigger COO-02 after invoice parsing completes.
 *
 * @param {string} agentId  - e.g. 'coo-02-shopify-entry'
 */
export function triggerAgent(agentId) {
  const scriptPath = join(PROJECT_ROOT, 'agents', agentId, 'index.js');
  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    cwd: PROJECT_ROOT,
  });
  child.unref();
  console.log(`[runner] Triggered agent '${agentId}' (pid=${child.pid})`);
}
