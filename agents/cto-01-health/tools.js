// agents/cto-01-health/tools.js — Health check functions
// Queries agent_runs to build health data for all registered agents.
// Agent registry is auto-derived from ecosystem.config.cjs so new agents
// are automatically monitored without manual updates.

import { createRequire } from 'module';
import { getDetroitTime } from '../../shared/utils.js';

const require = createRequire(import.meta.url);
const ecosystem = require('../../ecosystem.config.cjs');

/**
 * Parse a cron expression to estimate the interval in milliseconds.
 * Handles common patterns: every-N-min, daily, weekly.
 */
function cronToIntervalMs(cronExpr) {
  if (!cronExpr) return null;
  const parts = cronExpr.split(/\s+/);
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Weekly (specific day of week, e.g. "0 7 * * 1")
  if (dayOfWeek !== '*') return 7 * 24 * 60 * 60_000;

  // Daily (specific hour, e.g. "15 6 * * *")
  if (hour !== '*') return 24 * 60 * 60_000;

  // Sub-hourly (e.g. "5,35 * * * *" → every 30 min)
  if (minute.includes(',')) {
    const mins = minute.split(',').map(Number).sort((a, b) => a - b);
    if (mins.length >= 2) {
      const gap = mins[1] - mins[0];
      return gap * 60_000;
    }
  }

  // Every N minutes via */N
  const stepMatch = minute.match(/^\*\/(\d+)$/);
  if (stepMatch) return Number(stepMatch[1]) * 60_000;

  // Hourly (minute is a number, hour is *)
  if (hour === '*' && /^\d+$/.test(minute)) return 60 * 60_000;

  return null;
}

/**
 * Derive schedule label from a cron expression.
 */
function cronToScheduleLabel(cronExpr) {
  if (!cronExpr) return null;
  const parts = cronExpr.split(/\s+/);
  const [minute, hour, , , dayOfWeek] = parts;

  if (dayOfWeek !== '*') return `weekly`;
  if (hour !== '*') return `daily-${hour}:${minute.padStart(2, '0')}`;
  if (minute.includes(',') || minute.includes('/')) return `every-${cronToIntervalMs(cronExpr) / 60_000}-min`;
  return 'hourly';
}

// Auto-derive agent registry from ecosystem.config.cjs
const AGENT_REGISTRY = ecosystem.apps.map(app => {
  const hasCron = !!app.cron_restart;
  const isAlwaysOn = app.autorestart !== false && !hasCron;

  let schedule, intervalMs;
  if (hasCron) {
    schedule = cronToScheduleLabel(app.cron_restart);
    intervalMs = cronToIntervalMs(app.cron_restart);
  } else if (isAlwaysOn) {
    schedule = 'always-on';
    intervalMs = null;
  } else {
    schedule = 'on-demand';
    intervalMs = null;
  }

  return { id: app.name, schedule, intervalMs };
});

/**
 * Gather health data for all registered agents.
 * @param {object} ctx - Runner context (ctx.db has raw DB access)
 * @returns {object} Health data object with per-agent status
 */
export function getHealthData(ctx) {
  const db = ctx.db.getDb();
  const now = Date.now();
  const agents = [];

  for (const entry of AGENT_REGISTRY) {
    // Get the most recent runs for this agent
    const recentRuns = db.prepare(`
      SELECT * FROM agent_runs
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(entry.id);

    const lastRun = recentRuns[0] || null;

    // Calculate failure streak (consecutive failures from most recent)
    let failureStreak = 0;
    for (const run of recentRuns) {
      if (run.status === 'failure') {
        failureStreak++;
      } else {
        break;
      }
    }

    // Calculate average duration from successful runs
    const successfulRuns = recentRuns.filter(r => r.status === 'success' && r.duration_ms);
    const avgDuration = successfulRuns.length > 0
      ? Math.round(successfulRuns.reduce((sum, r) => sum + r.duration_ms, 0) / successfulRuns.length)
      : null;

    // Check for missed schedule
    let missedSchedule = false;
    if (entry.intervalMs && lastRun?.completed_at) {
      const lastRunTime = new Date(lastRun.completed_at).getTime();
      const timeSinceLastRun = now - lastRunTime;
      missedSchedule = timeSinceLastRun > entry.intervalMs * 2;
    } else if (entry.intervalMs && !lastRun) {
      // Agent has a schedule but has never run
      missedSchedule = true;
    }

    const lastError = lastRun?.status === 'failure' && lastRun?.error
      ? lastRun.error.substring(0, 500)
      : null;

    agents.push({
      id: entry.id,
      schedule: entry.schedule,
      lastRun: lastRun?.completed_at || lastRun?.started_at || null,
      lastRunStatus: lastRun?.status || 'none',
      duration: lastRun?.duration_ms || null,
      avgDuration,
      failureStreak,
      missedSchedule,
      totalRuns: recentRuns.length,
      recentFailures: recentRuns.filter(r => r.status === 'failure').length,
      lastError,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    detroitTime: getDetroitTime(),
    agents,
  };
}
