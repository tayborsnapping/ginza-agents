// shared/anthropic.js — Anthropic API wrapper
// Handles token counting, retry with exponential backoff, and model config.
// All agents call this via ctx.anthropic() — never import @anthropic-ai/sdk directly in agents.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

let _client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment — cannot call Anthropic API');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Call the Anthropic API with retry logic.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt  - Assembled system prompt (runner injects datetime + last_run)
 * @param {string} opts.userMessage   - The user-turn message for this call
 * @param {number} [opts.maxTokens]   - Override default max_tokens (default: 4096)
 * @returns {{ content: string, tokensIn: number, tokensOut: number }}
 */
export async function callAnthropic({ systemPrompt, userMessage, maxTokens = DEFAULT_MAX_TOKENS }) {
  const client = getClient();

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const content = response.content.find(b => b.type === 'text')?.text ?? '';
      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;

      return { content, tokensIn, tokensOut };
    } catch (error) {
      lastError = error;
      // Only retry on rate limits (429), server errors (5xx), or network errors (no status)
      const status = error.status ?? error.statusCode;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable) {
        throw new Error(`Anthropic API non-retryable error (${status}): ${error.message}`);
      }
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(`[anthropic] Attempt ${attempt}/${MAX_RETRIES} failed (${status || 'network'}): ${error.message}. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  throw new Error(`Anthropic API failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}
