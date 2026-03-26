# Ginza Agents — Multi-Agent AI System

Autonomous AI agent system for Ginza Marketplace (Japanese TCG & anime retail, Ann Arbor MI).
Agents run headless on Hostinger VPS via PM2 cron, call Anthropic API for reasoning, communicate via shared SQLite DB.

## Directory Structure
```
shared/          → Reusable framework (runner, DB, API clients) — ALL agents import from here
agents/<id>/     → One folder per agent (index.js, prompt.md, tools.js)
db/              → SQLite schema and database file
specs/           → Architecture docs, session plans (read before major changes)
logs/            → Rotated file logs (backup only — primary logging is in DB)
```

## Key Commands
```bash
pm2 start ecosystem.config.js          # Start all agents
pm2 restart <agent-id>                  # Restart specific agent
pm2 logs <agent-id>                     # Tail agent logs
node agents/<agent-id>/index.js         # Manual test run
sqlite3 db/ginza.db                     # Query shared database
```

## Architecture Rules
- **Every agent** uses shared/runner.js — never write standalone Anthropic API calls
- **Agent communication** happens ONLY through the agent_outputs table — never direct imports between agents
- **System prompts** live in each agent's prompt.md — keep under 150 lines
- **Secrets** live in .env (gitignored) — never hardcode API keys
- **Timezone** is America/Detroit — injected by runner.js into every prompt
- **Error handling** is the runner's job — agents throw, runner catches and alerts
- **Discord notifications** go through shared/discord.js — never call Discord API directly from agents

## Conventions
- Node.js (ES modules with .js extension, "type": "module" in package.json)
- SQLite via better-sqlite3 (synchronous API — simpler for cron-triggered agents)
- All dates stored as ISO 8601 strings in UTC, displayed in America/Detroit
- Agent IDs follow pattern: department-number (e.g., cfo-01, cto-03)
- JSON blobs in agent_outputs.data — no schema enforcement, consumers validate

## Phase 1 Agents (current build)
CTO-01 (Health Monitor), CTO-03 (Dashboard), CTO-04 (Alerts/Discord Bot),
COO-01 (Invoice Parser), COO-02 (Shopify Entry), CFO-01 (Weekly Report), CFO-03 (Margin Watch)

## Reference Docs
- specs/architecture.md — Full DB schema, runner framework, shared module specs
- specs/session-plan.md — Build order and per-session scope
- agents/<id>/prompt.md — Read before modifying any agent
