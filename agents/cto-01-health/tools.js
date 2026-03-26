// agents/cto-01-health/tools.js — Health check functions
// Queries agent_runs to build health data for all registered agents.

import { getDetroitTime } from '../../shared/utils.js';

// Known agent registry with expected schedules
const AGENT_REGISTRY = [
  { id: 'cto-01-health',       schedule: 'every-30-min', intervalMs: 30 * 60_000 },
  { id: 'cto-03-dashboard',    schedule: 'always-on',    intervalMs: null },
  { id: 'cto-04-alerts',       schedule: 'always-on',    intervalMs: null },
  { id: 'coo-01-invoice',      schedule: 'daily-8am',    intervalMs: 24 * 60 * 60_000 },
  { id: 'coo-02-shopify',      schedule: 'on-demand',    intervalMs: null },
  { id: 'coo-03-descriptions', schedule: 'on-demand',    intervalMs: null },
  { id: 'cfo-01-weekly',       schedule: 'monday-7am',   intervalMs: 7 * 24 * 60 * 60_000 },
  { id: 'cfo-03-margin',       schedule: 'daily-6am',    intervalMs: 24 * 60 * 60_000 },
];

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
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    detroitTime: getDetroitTime(),
    agents,
  };
}
