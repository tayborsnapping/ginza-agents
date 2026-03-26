# Ginza Agents — Sessions 1–3 Audit

You are auditing the Ginza Agents project to verify that everything from Sessions 1 through 3 is complete and working correctly. This is a multi-agent AI system for Ginza Marketplace (Japanese TCG & anime retail store).

## Step 1: Read these files first

Read every file listed below before doing anything else. Do not skim — read fully.

**Architecture & planning:**
- `Docs/architecture.md` — full system architecture
- `Docs/session-plan.md` — session build plan (focus on Sessions 1–3)
- `Docs/CLAUDE.md` — project conventions and rules

**Shared framework (Session 2):**
- `shared/runner.js` — agent execution lifecycle
- `shared/db.js` — SQLite connection + query helpers
- `shared/anthropic.js` — Anthropic API wrapper
- `shared/discord.js` — Discord bot client
- `shared/shopify.js` — Shopify REST client
- `shared/gmail.js` — Gmail API client
- `shared/utils.js` — timezone, formatting, JSON helpers

**Test agent (Session 2):**
- `agents/test-agent/index.js`
- `agents/test-agent/prompt.md`

**CTO-04 Alert Bot (Session 3):**
- `agents/cto-04-alerts/index.js`
- `agents/cto-04-alerts/prompt.md`

**Config files:**
- `package.json`
- `.gitignore`
- `.env` (check it exists and has the required keys — do NOT print secrets)
- `ecosystem.config.js`
- `db/schema.sql`
- `deploy.sh`

## Step 2: Verify against the session exit criteria

### Session 1 — VPS Foundation
Check that the following are in place:
- [ ] package.json exists with `"type": "module"` and required dependencies (@anthropic-ai/sdk, better-sqlite3, discord.js, dotenv)
- [ ] .gitignore excludes: node_modules/, .env, db/ginza.db*, Credentials/
- [ ] .env exists with keys: ANTHROPIC_API_KEY, SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN, DISCORD_BOT_TOKEN, DISCORD_CHANNEL_CTO/CFO/COO/CMO/CSO/GENERAL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- [ ] db/schema.sql defines 3 tables (agent_runs, agent_outputs, alerts) + 6 indexes
- [ ] Git repo initialized, remote set to github.com/tayborsnapping/ginza-agents, main branch

### Session 2 — Shared Framework
Verify each shared module exports what the architecture doc specifies:
- [ ] `db.js`: insertRun, updateRun, getLatestOutput, insertOutput, insertAlert, getRecentRuns, getLatestRunSummary, getDb
- [ ] `anthropic.js`: callAnthropic with retry logic (3 attempts, exponential backoff), returns { content, tokensIn, tokensOut }
- [ ] `discord.js`: connectBot, sendToChannel, sendEmbed, getChannelIdForAgent, formatAlert, sendAlert
- [ ] `shopify.js`: has Shopify client functions with rate limiting
- [ ] `gmail.js`: has Gmail API client functions
- [ ] `utils.js`: getDetroitTime, getDetroitISO, formatCurrency, parseJSON, sleep
- [ ] `runner.js`: implements the 8-step lifecycle (env → insert run → read prompt → inject vars → execute → record success → catch errors → alert on failure), exposes run() and triggerAgent()
- [ ] Test agent exists at agents/test-agent/ with index.js and prompt.md
- [ ] Test agent uses runner.run(), calls ctx.anthropic(), ctx.writeOutput(), ctx.alert()
- [ ] prompt.md uses {{datetime}} and {{last_run}} template variables

### Session 3 — CTO-04 Discord Alert Bot
- [ ] agents/cto-04-alerts/index.js exists as an always-on service (NOT using runner.js — it's a long-lived bot)
- [ ] Connects to Discord via shared/discord.js connectBot()
- [ ] Polls alerts table every 30 seconds for unsent alerts (sent=0)
- [ ] Routes alerts to correct channel based on source_agent prefix (cto→CTO, cfo→CFO, coo→COO, etc.)
- [ ] Formats by priority: info=plain text, warning=yellow embed, critical=red embed + @here
- [ ] Marks alerts as sent (sent=1, sent_at=timestamp) after processing
- [ ] Batches info alerts into a digest every 30 minutes
- [ ] Deduplicates identical alerts within a 5-minute window
- [ ] ecosystem.config.js has cto-04-alerts entry (always-on, no cron)
- [ ] prompt.md documents the bot's routing and formatting rules

## Step 3: Look for problems

After verifying completeness, look for:
1. **Missing dependencies** — are any imports referencing packages not in package.json?
2. **Broken imports** — do all relative import paths resolve correctly?
3. **Schema mismatches** — does the code match the DB schema column names exactly?
4. **Env var mismatches** — does the code reference env vars that aren't in .env?
5. **Architecture violations** — does any agent import directly from another agent? (They shouldn't — only via agent_outputs table)
6. **Error handling gaps** — does runner.js catch all errors and record them?
7. **Graceful degradation** — do shared modules handle missing credentials without crashing?

## Step 4: Report

Give me a single report with:
1. **Status:** PASS or FAIL for each session
2. **Issues found:** List any bugs, missing pieces, or mismatches (with file:line references)
3. **Recommendations:** Quick fixes for any issues found
4. **Ready for Session 4?** Yes or no, and what (if anything) needs to be fixed first
