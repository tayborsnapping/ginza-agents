# Ginza Agents — Multi-Agent AI System

Autonomous AI agent system for Ginza Marketplace (Japanese TCG & anime retail, Ann Arbor MI).
Agents run headless on Hostinger VPS via PM2 cron, call Anthropic API for reasoning, communicate via shared SQLite DB.

## Directory Structure
```
shared/          → Reusable framework (runner, DB, API clients) — ALL agents import from here
agents/<id>/     → One folder per agent (index.js, prompt.md, tools.js)
db/              → SQLite schema and database file
data/exports/    → Generated CSV files (Shopify import CSVs from COO-03)
specs/           → Architecture docs, session plans (read before major changes)
Assets/Brand/    → Brand reference (BRAND.md, logos, fonts, mockups)
docs/            → Voice/soul guide, Claude Code skill files, archived session prompts
```

## VPS Deployment
```bash
# Project lives at /home/ginza-agents on VPS (srv1360935, Hostinger)
# SSH port 22 may be firewalled — use Hostinger hpanel browser terminal if blocked
# Deploy: push to GitHub, then on VPS:
cd /home/ginza-agents && git pull origin main && pm2 restart all
```

## Key Commands
```bash
pm2 start ecosystem.config.cjs          # Start all agents
pm2 restart <agent-id>                  # Restart specific agent
pm2 logs <agent-id>                     # Tail agent logs
node agents/<agent-id>/index.js         # Manual test run
sqlite3 db/ginza.db                     # Query shared database
```

## Architecture Rules
- **Every agent** uses shared/runner.js — never write standalone Anthropic API calls
- **Agent communication** happens ONLY through the agent_outputs table — never direct imports between agents
- **agent_outputs is append-only** — INSERT new rows, never UPDATE. Use new output keys to track state changes
- **System prompts** live in each agent's prompt.md — keep under 150 lines
- **Secrets** live in .env (gitignored) — never hardcode API keys
- **Timezone** is America/Detroit — injected by runner.js into every prompt
- **Error handling** is the runner's job — agents throw, runner catches and alerts
- **Discord notifications** go through shared/discord.js — never call Discord API directly from agents
- **Gmail operations** go through shared/gmail.js — supports label management (addLabel creates if missing, idempotent)

## Shared Modules
- **shared/runner.js** — Agent execution framework, triggerAgent() for fire-and-forget chaining
- **shared/db.js** — SQLite via better-sqlite3 (synchronous API)
- **shared/discord.js** — Discord bot client with reaction support, sendEmbed() with file attachments
- **shared/gmail.js** — Gmail API client (listMessages, getMessage, getAttachment, addLabel)
- **shared/brave-search.js** — Brave Search API client for product lookups
- **shared/product-types.js** — TCG/anime product type classification and mapping
- **shared/utils.js** — getDetroitTime() and other helpers

## Conventions
- Node.js (ES modules with .js extension, "type": "module" in package.json)
- SQLite via better-sqlite3 (synchronous API — simpler for cron-triggered agents)
- All dates stored as ISO 8601 strings in UTC, displayed in America/Detroit
- Agent IDs follow pattern: department-number (e.g., cfo-01, cto-03)
- JSON blobs in agent_outputs.data — no schema enforcement, consumers validate

## Agents

### CTO Department
- **CTO-01** (Health Monitor) — Checks agent health every 30 min, alerts on failures
- **CTO-03** (Dashboard) — Always-on Express server at port 3737, serves React SPA + API routes
  - Tabs: Dashboard, Invoices, Alerts, Stats
  - `/api/invoices` — Invoice pipeline status overview
  - `/api/invoices/csv` — Download Shopify import CSV
- **CTO-04** (Alerts/Discord Bot) — Always-on Discord bot, polls alerts table every 30s
  - Posts CSV embed to #coo-ops when COO-03 finishes descriptions
  - Listens for ✅ reaction → applies `shopify-added` Gmail label to invoice emails
  - Writes `pending_shopify_confirm` and `shopify_confirmed` output keys

### COO Department (Invoice Pipeline)
Pipeline order: **COO-01 → COO-04 → COO-02 → COO-03 → CSV + Discord → User ✅ → Gmail labels**

- **COO-01** (Invoice Parser) — Parses supplier invoices from Gmail, outputs `parsed_invoices`
- **COO-04** (UPC/Barcode) — Enriches products with UPC barcodes, outputs `enriched_invoices`
- **COO-02** (Shopify Entry) — Creates products in Shopify API, outputs `shopify_entries`
  - Passes `processedEmailMessageIds` through pipeline for Gmail label tracking
- **COO-03** (Descriptions) — Writes AI product descriptions, generates Shopify import CSV
  - Outputs `product_descriptions` with `csvPath`, `processedEmailMessageIds`, `invoicesProcessed`
  - CSV saved to `data/exports/shopify-import-YYYY-MM-DD.csv`

### CFO Department
- **CFO-01** (Weekly Report) — Generates weekly financial summary (Wed-Sun boundaries)
- **CFO-03** (Margin Watch) — Daily margin analysis and alerts

## Gmail Label Flow
Invoices go through a 3-state label progression in Gmail:
1. No label → email discovered by COO-01
2. `agent-processed` → COO-01 has parsed the invoice
3. `shopify-added` → User confirmed via ✅ in Discord that products are in Shopify

## Dashboard
- React SPA built with Vite, served by CTO-03 Express server
- Rebuild after frontend changes: `cd agents/cto-03-dashboard/app && npm run build`
- Auth via DASHBOARD_TOKEN query param or Bearer header
- Accessible at ginzatcg.com/dashboard on VPS (Nginx reverse proxy)

## Reference Docs
- specs/architecture.md — Full DB schema, runner framework, shared module specs
- specs/session-plan.md — Build order and per-session scope
- Assets/Brand/BRAND.md — Colors, typography, logos, dashboard design tokens
- docs/ginza-voice-SOUL.md — Brand voice and tone guide
- agents/<id>/prompt.md — Read before modifying any agent
