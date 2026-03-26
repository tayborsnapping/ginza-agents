# Session 8: Full System Audit & Bug Fix

## Objective
Review every agent, every shared module, and every data flow in the Ginza Agents system. Find bugs, inconsistencies, and reliability gaps. Fix everything you find. This is a hardening session before we build the next agent (COO-02).

## How to Work
1. Read every file listed below
2. Run each agent manually (`node agents/<id>/index.js`) and inspect the output
3. Check the database for data quality issues
4. Fix bugs in-place — don't just flag them, actually fix them
5. Commit fixes as you go

## Files to Read (in order)

### Shared Framework (read these first — everything depends on them)
```
shared/runner.js
shared/db.js
shared/anthropic.js
shared/discord.js
shared/gmail.js
shared/shopify.js
shared/utils.js
```

### Database
```
db/schema.sql
```
Then query the live DB:
```sql
-- Check recent runs for all agents
SELECT agent_id, status, summary, error, tokens_in, tokens_out, duration_ms, created_at
FROM agent_runs ORDER BY id DESC LIMIT 30;

-- Check outputs
SELECT id, agent_id, output_key, substr(data, 1, 200), created_at
FROM agent_outputs ORDER BY id DESC LIMIT 10;

-- Check unsent alerts
SELECT * FROM alerts WHERE sent = 0;

-- Check alert history
SELECT source_agent, priority, title, substr(message, 1, 100), sent, created_at
FROM alerts ORDER BY id DESC LIMIT 20;
```

### Agents (read index.js, tools.js, and prompt.md for each)
```
agents/cto-01-health/     — Health monitor (every 30 min)
agents/cto-04-alerts/     — Discord alert bot (always-on)
agents/cfo-01-weekly-report/  — Monday morning report
agents/cfo-03-margin-watch/   — Daily margin check
agents/coo-01-invoice/        — Invoice parser (daily 8 AM)
  parsers/southern-hobby.js
  parsers/gts.js
  parsers/peachstate.js
  parsers/japanese-imports.js
```

### Config
```
ecosystem.config.js
package.json
.env.example (compare against actual .env keys)
```

---

## Known Bugs to Investigate & Fix

### 1. CTO-01 Hardcoded Agent Registry
**File:** `agents/cto-01-health/tools.js`
**Issue:** AGENT_REGISTRY is hardcoded. COO-01 was added in Session 7 but CTO-01 may not know about it. Check if the registry includes all agents currently in ecosystem.config.js. If not, add the missing ones.

### 2. Markdown Fence Stripping is Duplicated Everywhere
**Files:** Every agent's index.js has this same regex:
```js
const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
if (fenceMatch) jsonStr = fenceMatch[1].trim();
```
**Fix:** Extract to `shared/utils.js` as `stripCodeFences(str)` and replace all occurrences.

### 3. Missing Cost Data Silently Inflates Margins
**Files:** `agents/cfo-03-margin-watch/tools.js`, `agents/cfo-01-weekly-report/tools.js`
**Issue:** When a Shopify variant has no cost set, `costsByVariant[variant_id] || 0` treats it as $0 COGS, making margin appear as 100%. The `missingCostCount` is tracked but not prominently surfaced.
**Fix:** If >20% of line items in a period have missing costs, the agent should queue a warning alert saying "X% of products have no cost data — margin calculations may be unreliable."

### 4. COO-01 Duplicate Invoice Risk
**Issue:** If COO-01 runs and the Gmail label step fails (addLabel throws), the email stays unprocessed and will be parsed again on the next run, creating duplicate agent_outputs rows. COO-02 (when built) will see duplicates.
**Fix:** Check for existing parsed_invoices output containing the same email messageId before parsing. Or catch labeling errors and still track the messageId.

### 5. Alert Loss on Discord Delivery Failure
**File:** `agents/cto-04-alerts/index.js`
**Issue:** Alerts are marked `sent=1` before Discord delivery. If sendEmbed/sendToChannel throws, the alert is lost forever.
**Fix:** Only mark `sent=1` after successful delivery. Add a try/catch around delivery that logs the error but leaves `sent=0` for retry on next poll cycle. Add a max_retries or staleness check (don't retry alerts older than 24 hours).

### 6. No Validation on ctx.readOutput Consumer Side
**Issue:** When an agent calls `ctx.readOutput('some_key')`, it gets whatever JSON blob was last written. There's no schema validation. If the producing agent changes its output format, the consumer silently gets wrong data.
**Fix:** Not a code fix — just verify that every readOutput call in the codebase actually matches what the producer writes. Document the contracts.

### 7. runner.js Error Exit
**File:** `shared/runner.js`
**Issue:** On failure, runner calls `process.exit(1)`. With PM2 cron + `autorestart: false`, this is correct. But verify that the error is fully written to the DB before exit. Check if there's a race condition between `updateRun()` (synchronous SQLite) and `process.exit(1)`.

### 8. Duplicate Docs
**Issue:** `/Docs/` contains copies of `specs/architecture.md`, `specs/session-plan.md`, `db/schema.sql`, and `CLAUDE.md`. These can drift from the originals.
**Fix:** Delete the duplicates in `/Docs/` (keep the session prompt files). The originals in `specs/` and root are the source of truth.

---

## Verification Checklist

After fixing bugs, verify each agent works:

### CTO-04 (Alert Bot)
```bash
# Insert a test alert
sqlite3 db/ginza.db "INSERT INTO alerts (source_agent, priority, title, message) VALUES ('test', 'info', 'Debug Test', 'Testing alert delivery');"
# Run the bot briefly and check Discord
node agents/cto-04-alerts/index.js
# Verify the alert was sent (sent=1, sent_at populated)
sqlite3 db/ginza.db "SELECT * FROM alerts WHERE title = 'Debug Test';"
```

### CTO-01 (Health Monitor)
```bash
node agents/cto-01-health/index.js
# Check output
sqlite3 db/ginza.db "SELECT substr(data, 1, 500) FROM agent_outputs WHERE output_key = 'health_status' ORDER BY created_at DESC LIMIT 1;"
```

### CFO-03 (Margin Watch)
```bash
node agents/cfo-03-margin-watch/index.js
# Check output
sqlite3 db/ginza.db "SELECT substr(data, 1, 500) FROM agent_outputs WHERE output_key = 'margin_alerts' ORDER BY created_at DESC LIMIT 1;"
```

### CFO-01 (Weekly Report)
```bash
node agents/cfo-01-weekly-report/index.js
# Check output
sqlite3 db/ginza.db "SELECT substr(data, 1, 500) FROM agent_outputs WHERE output_key = 'weekly_snapshot' ORDER BY created_at DESC LIMIT 1;"
```

### COO-01 (Invoice Parser)
```bash
node agents/coo-01-invoice/index.js
# Check output
sqlite3 db/ginza.db "SELECT substr(data, 1, 500) FROM agent_outputs WHERE output_key = 'parsed_invoices' ORDER BY created_at DESC LIMIT 1;"
# Verify emails were labeled (check Gmail for 'agent-processed' label)
```

---

## Data Quality Checks

Run these SQL queries and investigate any anomalies:

```sql
-- Agents with recent failures
SELECT agent_id, COUNT(*) as failures, MAX(created_at) as last_failure
FROM agent_runs WHERE status = 'failure'
GROUP BY agent_id;

-- Token usage trends (are any agents using way more tokens than expected?)
SELECT agent_id, AVG(tokens_in) as avg_in, AVG(tokens_out) as avg_out,
       MAX(tokens_in) as max_in, MAX(duration_ms) as max_duration
FROM agent_runs WHERE status = 'success'
GROUP BY agent_id;

-- Orphaned outputs (output without a matching run)
SELECT o.id, o.agent_id, o.output_key, o.run_id
FROM agent_outputs o
LEFT JOIN agent_runs r ON o.run_id = r.id
WHERE r.id IS NULL;

-- Alerts that were never sent
SELECT * FROM alerts WHERE sent = 0 AND created_at < datetime('now', '-1 hour');

-- Duplicate outputs (same key written multiple times in short window)
SELECT output_key, COUNT(*) as cnt, MIN(created_at), MAX(created_at)
FROM agent_outputs
GROUP BY output_key
HAVING cnt > 3;
```

---

## Exit Criteria
- [ ] Every known bug above is either fixed or documented with a reason it's acceptable
- [ ] All 5 agents run successfully (manual test)
- [ ] Database has no orphaned records or data quality issues
- [ ] Duplicate docs cleaned up
- [ ] Shared utility functions extracted (stripCodeFences at minimum)
- [ ] CTO-01 agent registry includes all current agents
- [ ] Changes committed to git
