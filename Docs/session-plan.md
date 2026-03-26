# Ginza Agents — Session Build Plan

Each session below is a single focused Claude Code session. Do not combine sessions.
Read specs/architecture.md before starting any session.

---

## Session 1 — VPS Foundation

**Goal:** Clean Ubuntu server ready for Node.js development.

**Deliverables:**
- Node.js 22 LTS installed (via nodesource)
- PM2 installed globally
- SQLite3 installed (apt + better-sqlite3 npm later)
- Nginx installed (configured later in Session 7)
- Project directory created at /home/ginza-agents
- Git repo initialized, .gitignore configured
- package.json created with "type": "module"
- .env file created with placeholder keys
- SSH hardened (key-only, no root login)
- Firewall (ufw) configured: allow SSH, HTTP, HTTPS only
- Timezone set to America/Detroit

**Dependencies installed (package.json):**
- @anthropic-ai/sdk
- better-sqlite3
- discord.js
- dotenv
- shopify-api-node (or @shopify/shopify-api)
- googleapis (for Gmail)

**Exit criteria:** `node -v`, `pm2 -v`, `sqlite3 --version` all succeed. `npm test` runs (even if no tests yet). Git repo has initial commit.

---

## Session 2 — Shared Framework

**Goal:** The reusable engine every agent imports. This is the most important session.

**Deliverables:**
- db/schema.sql created and executed (3 tables + indexes)
- shared/db.js — SQLite connection with query helpers (getLatestOutput, insertRun, updateRun, insertAlert, insertOutput)
- shared/anthropic.js — Anthropic API wrapper (system prompt assembly, token counting, retry logic)
- shared/discord.js — Discord bot client (connect, sendToChannel, sendEmbed, formatAlert)
- shared/shopify.js — Shopify REST client (getOrders, getProducts, createProduct, updateProduct, getInventory) with rate limiting and pagination
- shared/utils.js — getDetroitTime(), formatCurrency(), parseJSON(), sleep()
- shared/runner.js — Full agent lifecycle (see architecture.md for the 8-step flow)

**Testing approach:** Create a dummy agent (agents/test-agent/) that:
1. Starts via runner.run()
2. Reads a mock prompt
3. Calls Anthropic with a simple test prompt ("respond with OK")
4. Writes an output to agent_outputs
5. Queues an info alert
6. Verify: agent_runs has a success row, agent_outputs has data, alerts table has pending alert

**Exit criteria:** Test agent completes full lifecycle. DB has correct rows. Token counts recorded. Errors caught and logged properly when intentionally broken.

---

## Session 3 — CTO-04 Alert Agent + Discord Bot

**Goal:** Discord bot running in Admin server. Can receive alerts from DB and post to channels.

**Deliverables:**
- Discord bot application created (Developer Portal — manual step by Taybor)
- Bot invited to Admin server with required permissions
- agents/cto-04-alerts/index.js — Discord.js bot that:
  - Connects on startup and stays alive (PM2 keeps running)
  - Polls alerts table every 30 seconds for unsent alerts
  - Routes alerts to correct channel based on source_agent prefix (cto→#cto-system, cfo→#cfo-reports, etc.)
  - Formats by priority (info=plain, warning=yellow embed, critical=red embed + @here)
  - Marks alerts as sent (sent=1, sent_at=timestamp)
  - Batches non-critical alerts (groups info alerts into digest every 30 min)
  - Deduplicates identical alerts within 5-minute window
- Discord channels created in Admin server (manual step by Taybor):
  #cto-system, #cfo-reports, #coo-ops, #cmo-content, #cso-intel, #c-suite-general
- PM2 config entry for cto-04-alerts (always-on, no cron)

**Testing:** Manually insert alerts into DB with different priorities and source agents. Verify they appear in correct Discord channels with correct formatting.

**Exit criteria:** Bot online in Discord. Test alerts delivered. PM2 keeps bot alive after restart.

**PREREQUISITE — Taybor must do before this session:**
1. Go to https://discord.com/developers/applications → New Application → "Ginza C-Suite"
2. Bot tab → Reset Token → copy to .env as DISCORD_BOT_TOKEN
3. Turn on MESSAGE CONTENT INTENT under Privileged Gateway Intents
4. OAuth2 → URL Generator → Scopes: bot → Permissions: View Channels, Send Messages, Read Message History, Embed Links, Mention Everyone → Copy URL → Open → Add to Admin server
5. Create the 6 channels listed above in Admin server
6. Copy each channel ID to .env

---

## Session 4 — CTO-01 Health Monitor

**Goal:** Agent that monitors all other agents and reports status to shared DB.

**Deliverables:**
- agents/cto-01-health/prompt.md — System prompt for health analysis
- agents/cto-01-health/tools.js — Functions to query agent_runs for each registered agent
- agents/cto-01-health/index.js — Runner-based agent that:
  - Reads agent_runs for all known agent IDs
  - Checks: did each agent run on schedule? Did it succeed or fail?
  - Calculates: time since last successful run, failure streaks, average duration
  - Writes output_key='health_status' with full status for all agents
  - Alerts on: any agent failure (warning), agent missed schedule (warning), 3+ consecutive failures (critical)
- Config: list of all agent IDs and their expected schedules (used to detect missed runs)
- PM2 config: runs every 30 min (offset 5 min from agent schedules)

**Testing:** Run CFO-03 (or test agent) once so there's a run record. Run CTO-01. Verify health_status output includes the agent. Intentionally create a failure record and verify alert is queued.

**Exit criteria:** Health status written to DB. Alerts fire on failures. Dashboard can later read this data.

---

## Session 5 — CFO-03 Margin Watch Agent

**Goal:** First business-value agent. Monitors gross margins by product category daily.

**Why CFO-03 before CFO-01:** CFO-03 runs daily (more testing opportunities) and has zero dependencies (direct Shopify pull). CFO-01 runs weekly and we want daily validation of the framework first.

**Deliverables:**
- agents/cfo-03-margin-watch/prompt.md — System prompt including:
  - Ginza's product categories and the 26 product types
  - Margin threshold rules (configurable, start with 30% minimum)
  - Output format specification (JSON with alerts array and category breakdown)
- agents/cfo-03-margin-watch/tools.js — Functions:
  - pullCategorySales() — Shopify orders by product type for trailing 7 days
  - pullProductCosts() — Shopify product costs (cost_per_item field)
  - calculateMargins() — Revenue minus COGS by category
- agents/cfo-03-margin-watch/index.js — Runner-based agent that:
  - Pulls sales and cost data from Shopify
  - Sends to Anthropic for analysis (trends, anomalies, recommendations)
  - Writes output_key='margin_alerts' with category margins and any alerts
  - Queues Discord alert if any category below threshold

**Testing:** Run against live Shopify data. Verify margin calculations match manual spot-check. Test alert threshold triggers.

**Exit criteria:** Margin data in DB. Discord alert received (if any categories below threshold). CTO-01 can see this agent's run status.

---

## Session 6 — CFO-01 Weekly Report Agent

**Goal:** Automated Monday morning Nils meeting snapshot.

**Deliverables:**
- agents/cfo-01-weekly-report/prompt.md — System prompt including:
  - Report format (revenue, units, top sellers, week-over-week trends)
  - Nils meeting context (what Nils cares about: revenue trends, margin health, inventory moves)
  - Output format (structured JSON + formatted text summary)
- agents/cfo-01-weekly-report/tools.js — Functions:
  - pullWeeklyOrders() — Shopify orders for current + previous week
  - pullTopSellers() — Products ranked by revenue and units
  - calculateWoW() — Week-over-week percentage changes
- agents/cfo-01-weekly-report/index.js — Runner-based agent that:
  - Pulls last 14 days of Shopify order data (current week + comparison week)
  - Sends to Anthropic for analysis and narrative summary
  - Writes output_key='weekly_snapshot'
  - Posts formatted report to Discord #cfo-reports
  - (Future: also saves to Google Drive — skip for now, add in Phase 2)

**Testing:** Run against live Shopify data. Compare output to what Taybor normally presents to Nils. Adjust prompt until output quality matches expectations.

**Exit criteria:** Weekly snapshot in DB. Formatted report in Discord. Data matches Shopify admin spot-check.

---

## Session 7 — COO-01 Invoice Parser

**Goal:** Auto-parse supplier invoices from Gmail inbox.

**PREREQUISITE — Taybor must do before this session:**
1. Go to Google Cloud Console → Create project "Ginza Agents"
2. Enable Gmail API
3. Create OAuth2 credentials (Desktop app type)
4. Run consent flow to get refresh token for info@ginzatcg.com
5. Save credentials to .env

**Deliverables:**
- shared/gmail.js finalized with real credentials
- agents/coo-01-invoice/parsers/ — Supplier-specific parsing configs:
  - southern-hobby.js — Column mappings, pricing rules, product type detection
  - gts.js — Same structure, GTS-specific format
  - peachstate.js — Same structure, Peachstate-specific format
  - japanese-imports.js — Japanese product naming conventions, yen-to-usd handling
- agents/coo-01-invoice/prompt.md — System prompt including:
  - Each supplier's invoice format description
  - Product type mapping rules (26 Shopify types)
  - Pricing rules (cost → retail markup formulas)
  - Output format (parsed product array as JSON)
- agents/coo-01-invoice/tools.js — Functions:
  - checkGmail() — Query for unprocessed invoice emails
  - downloadAttachment() — Get PDF/CSV attachment
  - detectSupplier() — Identify which supplier sent the invoice
  - parseInvoice() — Extract product data using supplier-specific config
  - markProcessed() — Label email as 'agent-processed' in Gmail
- agents/coo-01-invoice/index.js — Runner-based agent that:
  - Checks Gmail for new invoices (unread, has attachment, not labeled 'agent-processed')
  - For each invoice: detect supplier, parse, validate output
  - Writes output_key='parsed_invoices' with parsed product array
  - Queues alert with summary (X products parsed from supplier Y)
  - If parsing fails or confidence is low: queues warning alert for manual review

**Testing:** Forward a known invoice to info@ginzatcg.com. Run agent. Compare parsed output to manual parsing. Test each supplier format separately.

**Exit criteria:** Invoice parsed correctly for at least one supplier. Gmail labeled. Data in DB. COO-02 can read the output.

---

## Session 8 — COO-02 Shopify Product Entry

**Goal:** Auto-create/update Shopify listings from parsed invoice data.

**Deliverables:**
- agents/coo-02-shopify-entry/prompt.md — System prompt including:
  - Shopify product creation rules (handle format, title format, tags, product types)
  - The 26 product types and how to assign them
  - Dedup rules (check existing products before creating)
  - Pricing rules (markup from cost, compare-at pricing)
  - Inventory tracking settings
- agents/coo-02-shopify-entry/tools.js — Functions:
  - readParsedInvoices() — Get latest COO-01 output from agent_outputs
  - checkExistingProduct() — Search Shopify for duplicates by title/SKU
  - createProduct() — Create new Shopify listing
  - updateProduct() — Update existing listing (price, inventory)
  - updateInventory() — Set inventory levels
- agents/coo-02-shopify-entry/index.js — Runner-based agent that:
  - Reads latest parsed_invoices from COO-01
  - For each product: check if exists → create or update
  - Writes output_key='shopify_entries' with results (created/updated/skipped/errors)
  - Queues alert with summary
  - Triggered by COO-01 completion (not cron — runner's triggerAgent function)

**SAFETY:** This agent WRITES to production Shopify. Build with:
- Dry-run mode (default on first deploy — logs what it WOULD do without actually creating)
- Confirmation threshold (if >20 products, pause and alert for manual approval)
- Rollback capability (track created product IDs for deletion if needed)

**Testing:** Run in dry-run mode first. Review output. Enable live mode for a small batch (1-2 products). Verify in Shopify admin.

**Exit criteria:** Products created/updated in Shopify matching parsed invoice data. Dry-run and live modes both work. Safety guardrails tested.

---

## Session 9 — CTO-03 Mission Control Dashboard

**Goal:** Web dashboard showing system status, agent health, recent outputs, and build progress.

**Why last:** The dashboard reads data from all other agents. Building it last means there's real data to display.

**Deliverables:**
- Express server with API routes:
  - GET /api/health — All agent statuses from CTO-01's health_status output
  - GET /api/runs — Recent agent_runs with pagination
  - GET /api/outputs/:key — Latest output for a given key
  - GET /api/alerts — Recent alerts with filter by priority/agent
  - GET /api/stats — Token usage, cost estimates, run counts
- React SPA (Vite + shadcn/ui) with pages:
  - Dashboard home — Agent status cards (running/success/failure/idle), last run times, build phase progress tracker
  - Agent detail — Run history, recent outputs, error logs for specific agent
  - Alerts — Filterable alert log
  - System stats — Token usage over time, API cost estimates, agent performance
- Nginx reverse proxy config (HTTPS via Let's Encrypt)
- PM2 config entry for cto-03-dashboard (always-on)
- Basic auth or token-based auth (don't expose dashboard publicly without auth)

**Testing:** Visit dashboard in browser. Verify all panels show real data from existing agents. Test responsive layout on mobile.

**Exit criteria:** Dashboard accessible via VPS URL. Shows live agent data. Auto-refreshes. Auth protects access.

---

## Post-Phase-1 Checklist

Before moving to Phase 2, validate:
- [ ] All 7 agents running on schedule via PM2
- [ ] CTO-01 catching failures and alerting
- [ ] CTO-04 delivering alerts to correct Discord channels
- [ ] CFO-03 producing daily margin data
- [ ] CFO-01 producing Monday reports
- [ ] COO-01 parsing at least 2 supplier formats reliably
- [ ] COO-02 creating Shopify listings in live mode
- [ ] Dashboard showing all agent statuses
- [ ] Token usage tracked and within budget
- [ ] Git repo up to date with all code committed

---

## Notes on Claude Code Session Management

- Start each session by telling Claude Code to read CLAUDE.md and the relevant spec section
- Name sessions clearly: "Session 2 — Shared Framework" so you can resume with `claude --resume`
- At end of each session, ask Claude Code to generate a handoff summary
- If a session runs long (>60 min), consider splitting remaining work into a new session
- Always test deliverables before ending a session — don't leave untested code
