# Session 4 — CTO-01 Health Monitor

Read these files before writing any code:
- `CLAUDE.md` — project conventions
- `Docs/architecture.md` — full system architecture, DB schema, shared module specs
- `Docs/session-plan.md` — Session 4 scope and exit criteria
- `shared/runner.js` — the agent execution framework (CTO-01 uses this)
- `shared/db.js` — database helpers (CTO-01 needs custom queries via ctx.db)
- `agents/test-agent/index.js` — reference for how a runner-based agent is structured
- `agents/cto-04-alerts/index.js` — reference for the always-on bot pattern (CTO-01 is NOT this — it's cron-scheduled)

## What to build

**agents/cto-01-health/** with three files:

### 1. `prompt.md` — System prompt for health analysis
- Role: CTO-01, Health Monitor for Ginza Marketplace
- Uses `{{datetime}}` and `{{last_run}}` template variables
- Tell the LLM it receives JSON with all agent run data
- Output format: JSON with `agents[]` array (each: id, lastRun, status, duration, failureStreak, missedSchedule)
- Rules: alert on any failure (warning), missed schedule (warning), 3+ consecutive failures (critical)

### 2. `tools.js` — Health check functions
- `getHealthData(ctx)` — queries agent_runs for all known agent IDs
- Known agent registry with expected schedules:
  - `cto-04-alerts`: always-on (check last heartbeat or skip)
  - `cto-01-health`: every 30 min
  - `cfo-03-margin`: daily 6 AM ET
  - `cfo-01-weekly`: Monday 7 AM ET
  - `coo-01-invoice`: daily 8 AM ET
  - `test-agent`: on-demand (no schedule check)
- For each agent: last run time, last status, failure streak count, average duration
- Detect missed schedules: if time since last run > 2x expected interval, flag as missed

### 3. `index.js` — Runner-based agent
- Uses `run()` from `shared/runner.js`
- Calls `getHealthData(ctx)` to gather status
- Sends data to Anthropic for analysis
- Writes `output_key='health_status'` with the full status object
- Queues alerts: warning for failures/missed, critical for 3+ consecutive failures

### 4. Update `ecosystem.config.js`
- Uncomment the cto-01-health entry (it's already there commented out)

## Testing
- Run the test-agent first so there's a run record: `node agents/test-agent/index.js`
- Then run CTO-01: `node agents/cto-01-health/index.js`
- Verify: `sqlite3 db/ginza.db "SELECT * FROM agent_outputs WHERE output_key='health_status' ORDER BY created_at DESC LIMIT 1"`
- Verify alerts: `sqlite3 db/ginza.db "SELECT * FROM alerts ORDER BY created_at DESC LIMIT 5"`

## Exit criteria
- Health status written to agent_outputs with output_key='health_status'
- Status includes data for all registered agents
- Alerts fire on failures (test by inserting a fake failure row)
- PM2 config updated and uncommented
- Code committed to git
