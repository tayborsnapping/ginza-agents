// shared/db.js — SQLite connection + query helpers
// Uses better-sqlite3 (synchronous API — simpler for cron-triggered agents)

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '../db/ginza.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/**
 * Insert a new agent run with status='running'. Returns the new row ID.
 */
export function insertRun(agentId) {
  const stmt = getDb().prepare(`
    INSERT INTO agent_runs (agent_id, started_at, status)
    VALUES (?, ?, 'running')
  `);
  const result = stmt.run(agentId, new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * Update an existing run row with final status, metrics, and completed_at.
 */
export function updateRun(runId, { status, summary = null, error = null, tokensIn = 0, tokensOut = 0, durationMs = null }) {
  const stmt = getDb().prepare(`
    UPDATE agent_runs
    SET status = ?,
        summary = ?,
        error = ?,
        tokens_in = ?,
        tokens_out = ?,
        duration_ms = ?,
        completed_at = ?
    WHERE id = ?
  `);
  stmt.run(status, summary, error, tokensIn, tokensOut, durationMs, new Date().toISOString(), runId);
}

/**
 * Get the most recent output for a given key. Returns parsed JSON or null.
 */
export function getLatestOutput(outputKey) {
  const row = getDb().prepare(`
    SELECT data FROM agent_outputs
    WHERE output_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(outputKey);

  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Insert an agent output (JSON data). data is JSON-stringified automatically.
 */
export function insertOutput(agentId, runId, outputKey, data) {
  const stmt = getDb().prepare(`
    INSERT INTO agent_outputs (agent_id, run_id, output_key, data)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(agentId, runId, outputKey, JSON.stringify(data));
}

/**
 * Queue a Discord alert with sent=0 (pending).
 */
export function insertAlert(sourceAgent, priority, title, message) {
  const stmt = getDb().prepare(`
    INSERT INTO alerts (source_agent, priority, title, message)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(sourceAgent, priority, title, message);
}

/**
 * Get recent runs for an agent, newest first.
 */
export function getRecentRuns(agentId, limit = 10) {
  return getDb().prepare(`
    SELECT * FROM agent_runs
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, limit);
}

/**
 * Get the summary string from the most recent successful run for an agent.
 * Used by runner.js to inject {{last_run}} into system prompts.
 * Returns null if no previous successful runs.
 */
export function getLatestRunSummary(agentId) {
  const row = getDb().prepare(`
    SELECT summary FROM agent_runs
    WHERE agent_id = ? AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(agentId);
  return row?.summary ?? null;
}

/**
 * Expose the raw DB connection for agents that need custom queries (via ctx.db).
 */
export { getDb };
