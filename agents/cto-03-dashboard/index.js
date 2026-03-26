// agents/cto-03-dashboard/index.js — CTO-03 Mission Control Dashboard
// Always-on Express server serving API routes + React SPA.
// Reads from shared SQLite DB (agent_runs, agent_outputs, alerts).
// Protected by token auth via DASHBOARD_TOKEN env var.
// Run with: node agents/cto-03-dashboard/index.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../shared/db.js';
import { getDetroitTime } from '../../shared/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DASHBOARD_PORT || '3737', 10);
const TOKEN = process.env.DASHBOARD_TOKEN;

const app = express();

// --- Auth middleware ---
// All /api/* routes require token auth if DASHBOARD_TOKEN is set.
// Token can be passed as ?token=xxx query param or Authorization: Bearer xxx header.
function authMiddleware(req, res, next) {
  if (!TOKEN) return next(); // No token configured = open access (dev mode)
  const fromQuery = req.query.token;
  const fromHeader = req.headers.authorization?.replace('Bearer ', '');
  if (fromQuery === TOKEN || fromHeader === TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized — provide valid token' });
}

app.use('/api', authMiddleware);

// --- Known agents registry (must match CTO-01 + ecosystem.config.cjs) ---
const KNOWN_AGENTS = [
  { id: 'cto-01-health',       name: 'Health Monitor',        schedule: 'Every 30 min',            department: 'CTO' },
  { id: 'cto-03-dashboard',    name: 'Mission Control',       schedule: 'Always-on',               department: 'CTO' },
  { id: 'cto-04-alerts',       name: 'Discord Alert Bot',     schedule: 'Always-on',               department: 'CTO' },
  { id: 'coo-01-invoice',      name: 'Invoice Parser',        schedule: 'Daily 8:00 AM',           department: 'COO' },
  { id: 'coo-02-shopify',      name: 'Shopify Entry',         schedule: 'Chained from COO-01',     department: 'COO' },
  { id: 'coo-03-descriptions', name: 'Product Descriptions',  schedule: 'Chained from COO-02',     department: 'COO' },
  { id: 'cfo-01-weekly',       name: 'Weekly Report',         schedule: 'Monday 7:00 AM',          department: 'CFO' },
  { id: 'cfo-03-margin',       name: 'Margin Watch',          schedule: 'Daily 6:00 AM',           department: 'CFO' },
];

// --- API Routes ---

// GET /api/health — Latest health_status from CTO-01
app.get('/api/health', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT data, created_at FROM agent_outputs
    WHERE output_key = 'health_status'
    ORDER BY created_at DESC LIMIT 1
  `).get();

  if (!row) return res.json({ status: 'no_data', message: 'CTO-01 has not run yet' });

  try {
    res.json({ ...JSON.parse(row.data), queriedAt: row.created_at });
  } catch {
    res.json({ status: 'parse_error', raw: row.data });
  }
});

// GET /api/agents — All known agents with their latest run info
app.get('/api/agents', (req, res) => {
  const db = getDb();
  const agents = KNOWN_AGENTS.map(agent => {
    const lastRun = db.prepare(`
      SELECT id, status, summary, started_at, completed_at, duration_ms, tokens_in, tokens_out, error
      FROM agent_runs WHERE agent_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(agent.id);

    const totalRuns = db.prepare(`
      SELECT COUNT(*) as count FROM agent_runs WHERE agent_id = ?
    `).get(agent.id);

    const recentFailures = db.prepare(`
      SELECT COUNT(*) as count FROM agent_runs
      WHERE agent_id = ? AND status = 'failure'
      AND created_at > datetime('now', '-7 days')
    `).get(agent.id);

    return {
      ...agent,
      lastRun: lastRun || null,
      totalRuns: totalRuns?.count || 0,
      recentFailures: recentFailures?.count || 0,
    };
  });

  res.json({ agents, serverTime: getDetroitTime() });
});

// GET /api/runs — Recent agent_runs with pagination and optional agent filter
app.get('/api/runs', (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const offset = (page - 1) * limit;
  const agentFilter = req.query.agent || null;

  let query = 'SELECT * FROM agent_runs';
  let countQuery = 'SELECT COUNT(*) as total FROM agent_runs';
  const params = [];
  const countParams = [];

  if (agentFilter) {
    query += ' WHERE agent_id = ?';
    countQuery += ' WHERE agent_id = ?';
    params.push(agentFilter);
    countParams.push(agentFilter);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const runs = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...countParams)?.total || 0;

  res.json({
    runs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/outputs/:key — Latest output for a given key
app.get('/api/outputs/:key', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT agent_id, output_key, data, created_at FROM agent_outputs
    WHERE output_key = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(req.params.key);

  if (!row) return res.json({ status: 'not_found', key: req.params.key });

  try {
    res.json({
      agentId: row.agent_id,
      outputKey: row.output_key,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    });
  } catch {
    res.json({ agentId: row.agent_id, outputKey: row.output_key, data: row.data, createdAt: row.created_at });
  }
});

// GET /api/alerts — Recent alerts with optional filters
app.get('/api/alerts', (req, res) => {
  const db = getDb();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const priority = req.query.priority || null;
  const agent = req.query.agent || null;

  let query = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];

  if (priority) {
    query += ' AND priority = ?';
    params.push(priority);
  }
  if (agent) {
    query += ' AND source_agent = ?';
    params.push(agent);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const alerts = db.prepare(query).all(...params);
  res.json({ alerts, count: alerts.length });
});

// GET /api/stats — Aggregate statistics
app.get('/api/stats', (req, res) => {
  const db = getDb();

  // Total runs by status
  const runsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM agent_runs GROUP BY status
  `).all();

  // Token usage totals
  const tokenTotals = db.prepare(`
    SELECT
      SUM(tokens_in) as totalTokensIn,
      SUM(tokens_out) as totalTokensOut
    FROM agent_runs WHERE status = 'success'
  `).get();

  // Token usage last 7 days
  const tokenWeek = db.prepare(`
    SELECT
      SUM(tokens_in) as tokensIn,
      SUM(tokens_out) as tokensOut
    FROM agent_runs
    WHERE status = 'success' AND created_at > datetime('now', '-7 days')
  `).get();

  // Runs per agent
  const runsPerAgent = db.prepare(`
    SELECT agent_id, COUNT(*) as count,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failures,
      SUM(tokens_in) as tokensIn,
      SUM(tokens_out) as tokensOut,
      AVG(duration_ms) as avgDuration
    FROM agent_runs GROUP BY agent_id
  `).all();

  // Daily run counts (last 14 days)
  const dailyRuns = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failures
    FROM agent_runs
    WHERE created_at > datetime('now', '-14 days')
    GROUP BY DATE(created_at)
    ORDER BY date
  `).all();

  // Cost estimate: Claude Sonnet pricing ($3/M input, $15/M output)
  const totalIn = tokenTotals?.totalTokensIn || 0;
  const totalOut = tokenTotals?.totalTokensOut || 0;
  const estimatedCost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;
  const weekIn = tokenWeek?.tokensIn || 0;
  const weekOut = tokenWeek?.tokensOut || 0;
  const weekCost = (weekIn / 1_000_000) * 3 + (weekOut / 1_000_000) * 15;

  // Alert counts by priority
  const alertsByPriority = db.prepare(`
    SELECT priority, COUNT(*) as count FROM alerts GROUP BY priority
  `).all();

  res.json({
    runs: {
      byStatus: Object.fromEntries(runsByStatus.map(r => [r.status, r.count])),
      perAgent: runsPerAgent,
      daily: dailyRuns,
    },
    tokens: {
      allTime: { input: totalIn, output: totalOut },
      last7Days: { input: weekIn, output: weekOut },
    },
    cost: {
      allTime: Math.round(estimatedCost * 100) / 100,
      last7Days: Math.round(weekCost * 100) / 100,
      note: 'Estimated using Claude Sonnet pricing: $3/M input, $15/M output',
    },
    alerts: {
      byPriority: Object.fromEntries(alertsByPriority.map(a => [a.priority, a.count])),
    },
    serverTime: getDetroitTime(),
  });
});

// --- Serve React SPA static files ---
// Serve at both root (Nginx strips /dashboard/ prefix on VPS) and /dashboard/ (direct access)
const distPath = join(__dirname, 'app', 'dist');
app.use('/dashboard', express.static(distPath));
app.use(express.static(distPath));

// SPA fallback — serve index.html for all non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(distPath, 'index.html'));
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`[cto-03-dashboard] Mission Control running on port ${PORT}`);
  console.log(`[cto-03-dashboard] Server time: ${getDetroitTime()}`);
  if (!TOKEN) {
    console.log('[cto-03-dashboard] WARNING: No DASHBOARD_TOKEN set — API is unprotected');
  }
});
