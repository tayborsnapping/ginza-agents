# Ginza Agents — Architecture Specification

## Overview

Ginza Marketplace's AI C-Suite is a hierarchical multi-agent system. Five parent officers (CFO, COO, CTO, CMO, CSO) each have sub-agents. Agents are triggered by PM2 cron schedules, call the Anthropic API (claude-sonnet-4-20250514) for reasoning, and share data through a SQLite database. The system runs on a Hostinger KVM VPS (Ubuntu 24.04, 2 cores, 8GB RAM, 100GB disk).

---

## Folder Structure

```
/home/ginza-agents/
├── CLAUDE.md
├── package.json
├── .env
├── .gitignore
├── ecosystem.config.js
│
├── shared/
│   ├── runner.js              # Agent execution framework
│   ├── db.js                  # SQLite connection + query helpers
│   ├── anthropic.js           # Anthropic API wrapper with token tracking
│   ├── discord.js             # Discord bot client (discord.js)
│   ├── shopify.js             # Shopify REST/GraphQL client
│   ├── gmail.js               # Gmail API client
│   └── utils.js               # Timezone, date formatting, JSON helpers
│
├── db/
│   ├── schema.sql             # Database creation script
│   └── ginza.db               # SQLite database file (gitignored)
│
├── agents/
│   ├── cto-01-health/
│   │   ├── index.js           # Entry point — PM2 runs this
│   │   ├── prompt.md          # System prompt (<150 lines)
│   │   └── tools.js           # Agent-specific functions
│   ├── cto-03-dashboard/
│   │   ├── index.js           # Express server (PM2 keeps alive)
│   │   ├── prompt.md
│   │   └── app/               # React SPA (shadcn/ui, built with Vite)
│   ├── cto-04-alerts/
│   │   ├── index.js           # Discord bot (PM2 keeps alive)
│   │   ├── prompt.md
│   │   └── tools.js
│   ├── coo-01-invoice/
│   │   ├── index.js
│   │   ├── prompt.md
│   │   ├── tools.js
│   │   └── parsers/           # Supplier-specific parsing configs
│   │       ├── southern-hobby.js
│   │       ├── gts.js
│   │       ├── peachstate.js
│   │       └── japanese-imports.js
│   ├── coo-02-shopify-entry/
│   │   ├── index.js
│   │   ├── prompt.md
│   │   └── tools.js
│   ├── cfo-01-weekly-report/
│   │   ├── index.js
│   │   ├── prompt.md
│   │   └── tools.js
│   └── cfo-03-margin-watch/
│       ├── index.js
│       ├── prompt.md
│       └── tools.js
│
├── bot/
│   └── commands/              # Discord slash commands (future)
│       └── status.js
│
└── logs/                      # Rotated file logs (backup)
```

---

## Database Schema (SQLite)

File: `db/schema.sql`

```sql
-- Agent execution log — every run gets a row
CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',   -- running | success | failure
    summary TEXT,                              -- Human-readable result
    error TEXT,                                -- Error message if failed
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Agent-to-agent data handoff — the universal communication layer
CREATE TABLE IF NOT EXISTS agent_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    run_id INTEGER REFERENCES agent_runs(id),
    output_key TEXT NOT NULL,                  -- e.g. 'weekly_snapshot', 'margin_alerts'
    data TEXT NOT NULL,                        -- JSON blob
    created_at TEXT DEFAULT (datetime('now'))
);

-- Notification queue — agents push alerts, CTO-04 consumes and sends to Discord
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_agent TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'info',     -- info | warning | critical
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    sent INTEGER DEFAULT 0,                    -- 0=pending, 1=sent
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_key ON agent_outputs(output_key);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_agent ON agent_outputs(agent_id);
CREATE INDEX IF NOT EXISTS idx_alerts_sent ON alerts(sent);
CREATE INDEX IF NOT EXISTS idx_alerts_priority ON alerts(priority);
```

### Data Flow Pattern

Agents never import from each other. All inter-agent communication flows through `agent_outputs`:

```
CFO-01 runs → writes output_key='weekly_snapshot' with JSON data
CSO-03 runs → reads: SELECT data FROM agent_outputs WHERE output_key='weekly_snapshot'
              ORDER BY created_at DESC LIMIT 1
```

This decouples agents completely. Any agent can be rebuilt without affecting others. New agents can consume existing outputs without modifying the producing agent.

### Output Key Registry (Phase 1)

| Agent  | output_key           | Data Shape                                          |
|--------|----------------------|-----------------------------------------------------|
| CFO-01 | weekly_snapshot      | { revenue, units, topSellers[], wow_change }        |
| CFO-03 | margin_alerts        | { alerts[], categoryMargins[], timestamp }          |
| COO-01 | parsed_invoices      | { invoices[{ supplier, products[], totalCost }] }   |
| COO-02 | shopify_entries      | { created[], updated[], skipped[], errors[] }       |
| COO-03 | product_descriptions | { described[], skipped[], errors[], dryRun }         |
| CTO-01 | health_status        | { agents[{ id, lastRun, status, duration }] }       |

---

## Shared Module Specifications

### runner.js — Agent Execution Framework

Every agent calls `runner.run()` with its config. The runner handles the full lifecycle:

```javascript
// Usage in any agent's index.js:
import { run } from '../../shared/runner.js';
import { getMarginData } from './tools.js';

await run({
  agentId: 'cfo-03',
  async execute(ctx) {
    // ctx provides: db, anthropic, discord, alert, readOutput, writeOutput, log
    const shopifyData = await getMarginData(ctx);
    
    const response = await ctx.anthropic(shopifyData);
    
    await ctx.writeOutput('margin_alerts', response.alerts);
    
    if (response.alerts.some(a => a.severity === 'critical')) {
      await ctx.alert('warning', 'Margin Alert', response.summary);
    }
    
    return response.summary; // Stored as run summary
  }
});
```

Runner lifecycle (in order):
1. Load .env, initialize DB connection, read system clock (America/Detroit)
2. Insert new row in agent_runs (status='running')
3. Read agent's prompt.md from disk
4. Read this agent's most recent agent_outputs row (last_run context)
5. Inject current datetime and last_run_summary into system prompt
6. Call execute() callback — agent does its specific work
7. Update agent_runs with status='success', duration, token counts
8. On ANY error: catch, log, set status='failure', queue critical alert, exit

### anthropic.js — API Wrapper

```javascript
// Wraps @anthropic-ai/sdk with:
// - Automatic token counting (input + output)
// - System prompt assembly (prompt.md + datetime + last_run context)
// - Retry with exponential backoff (3 attempts)
// - Returns { content, tokensIn, tokensOut }
```

Model: `claude-sonnet-4-20250514` for all agents (cost-effective for scheduled tasks).
Max tokens: 4096 default, configurable per agent.

### discord.js — Discord Bot Client

```javascript
// Uses discord.js library (not webhooks — full bot for future two-way commands)
// Channels map to agent domains:
//   #cto-system, #cfo-reports, #coo-ops, #cmo-content, #cso-intel, #c-suite-general
// Priority formatting:
//   info    → plain message
//   warning → ⚠️ yellow embed
//   critical → 🚨 red embed with @here mention
// Batch mode: non-critical alerts batched every 30 min to prevent spam
```

### shopify.js — Shopify Client

```javascript
// REST Admin API client for Shopify
// Auth: OAuth access token (already configured) stored in .env
// Key endpoints used:
//   GET /orders.json — CFO-01, CFO-03
//   GET /products.json — CFO-03, COO-02, COO-03
//   POST /products.json — COO-02
//   PUT /products/{id}.json — COO-02, COO-03
//   GET /inventory_levels.json — COO-03
// Rate limiting: 2 calls/second with automatic queue
// Pagination: auto-follows Link headers for full dataset retrieval
```

### gmail.js — Gmail API Client

```javascript
// Gmail API via googleapis npm package
// Auth: OAuth2 (service account or user consent — setup required)
// Scoped to info@ginzatcg.com inbox only
// Key operations:
//   List messages with label/query filter
//   Get message content + attachments (PDF invoices)
//   Mark as processed (add label 'agent-processed')
// Used by: COO-01 (Invoice Parser)
```

---

## PM2 Configuration

File: `ecosystem.config.js`

```javascript
export default {
  apps: [
    // === ALWAYS-ON SERVICES ===
    {
      name: 'cto-04-alerts',
      script: 'agents/cto-04-alerts/index.js',
      // Discord bot — runs continuously
    },
    {
      name: 'cto-03-dashboard',
      script: 'agents/cto-03-dashboard/index.js',
      // Express server — runs continuously
    },

    // === SCHEDULED AGENTS ===
    {
      name: 'cto-01-health',
      script: 'agents/cto-01-health/index.js',
      cron_restart: '5,35 * * * *',   // Every 30 min (offset from agent schedules)
      autorestart: false,
    },
    {
      name: 'cfo-01-weekly',
      script: 'agents/cfo-01-weekly-report/index.js',
      cron_restart: '0 7 * * 1',      // Monday 7:00 AM ET
      autorestart: false,
    },
    {
      name: 'cfo-03-margin',
      script: 'agents/cfo-03-margin-watch/index.js',
      cron_restart: '0 6 * * *',       // Daily 6:00 AM ET
      autorestart: false,
    },
    {
      name: 'coo-01-invoice',
      script: 'agents/coo-01-invoice/index.js',
      cron_restart: '0 8 * * *',       // Daily 8:00 AM ET
      autorestart: false,
    },
    {
      name: 'coo-02-shopify',
      script: 'agents/coo-02-shopify-entry/index.js',
      // Triggered after COO-01 completes (runner handles this)
      autorestart: false,
    },
  ]
};
```

Note: COO-02 is triggered by COO-01's completion rather than a fixed cron. The runner supports this via a `triggerAgent(agentId)` function that spawns a child process.

---

## Environment Variables (.env)

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Shopify
SHOPIFY_STORE=ginzatcg.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...

# Discord Bot
DISCORD_BOT_TOKEN=...
DISCORD_ADMIN_GUILD_ID=...
DISCORD_CHANNEL_CTO=...
DISCORD_CHANNEL_CFO=...
DISCORD_CHANNEL_COO=...
DISCORD_CHANNEL_CMO=...
DISCORD_CHANNEL_CSO=...
DISCORD_CHANNEL_GENERAL=...

# Gmail (COO-01)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_TARGET_EMAIL=info@ginzatcg.com

# VPS
TZ=America/Detroit
NODE_ENV=production
```

---

## Agent Prompt Design Rules

Each agent's `prompt.md` follows this structure:

```markdown
# Role
You are [agent name] for Ginza Marketplace, a Japanese TCG and anime lifestyle store
in Ann Arbor, Michigan.

# Context
Current date/time: {{datetime}}  ← injected by runner
Last run summary: {{last_run}}   ← injected by runner

# Your Job
[2-3 sentences on what this agent does]

# Data You Receive
[Description of the input data that will follow the system prompt]

# Output Format
[Exact JSON schema this agent must return]

# Rules
- [Concise list of business rules and constraints]
```

Total: under 150 lines per agent. No fluff. The runner injects `{{datetime}}` and `{{last_run}}` at runtime.

---

## Security Notes

- .env is gitignored — secrets never in repo
- Discord bot restricted to Admin server only (guild-locked)
- Gmail API scoped to info@ginzatcg.com inbox (read-only for invoices)
- Shopify OAuth token has specific scopes (read_orders, write_products, read_inventory)
- VPS SSH key auth only — no password login
- SQLite file not exposed to web — dashboard reads via API route only
- Nginx reverse proxy with HTTPS (Let's Encrypt) for dashboard
