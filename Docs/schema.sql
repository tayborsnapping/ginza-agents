-- Ginza Agents — Database Schema
-- Run: sqlite3 db/ginza.db < db/schema.sql

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
