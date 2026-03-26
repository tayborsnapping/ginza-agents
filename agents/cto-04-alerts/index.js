// agents/cto-04-alerts/index.js — Discord Alert Bot
// Always-on service (PM2 keeps alive). Polls the alerts table every 30s,
// routes alerts to the correct Discord channel, and batches info-level alerts.
// Run with: node agents/cto-04-alerts/index.js

import 'dotenv/config';
import * as db from '../../shared/db.js';
import {
  connectBot,
  formatAlert,
  sendAlert,
  sendToChannel,
} from '../../shared/discord.js';
import { getDetroitTime } from '../../shared/utils.js';

// --- Config ---
const POLL_INTERVAL_MS = 30_000;           // Check for new alerts every 30s
const BATCH_INTERVAL_MS = 30 * 60_000;     // Flush info digest every 30 min
const DEDUP_WINDOW_MS = 5 * 60_000;        // Ignore duplicate alerts within 5 min

// --- State ---
const infoBatch = [];                       // Queued info alerts waiting for digest
const recentAlerts = new Map();             // key → timestamp for dedup

function log(msg) {
  console.log(`[cto-04] [${getDetroitTime()}] ${msg}`);
}

// --- DB helpers (CTO-04 reads alerts directly, not via runner) ---

function getPendingAlerts() {
  return db.getDb().prepare(`
    SELECT * FROM alerts
    WHERE sent = 0
    ORDER BY created_at ASC
  `).all();
}

function markAlertSent(alertId) {
  db.getDb().prepare(`
    UPDATE alerts SET sent = 1, sent_at = ? WHERE id = ?
  `).run(new Date().toISOString(), alertId);
}

// --- Deduplication ---

function isDuplicate(alert) {
  const key = `${alert.source_agent}:${alert.title}:${alert.message}`;
  const lastSeen = recentAlerts.get(key);
  const now = Date.now();

  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
    return true;
  }

  recentAlerts.set(key, now);
  return false;
}

function cleanupDedupCache() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, timestamp] of recentAlerts) {
    if (timestamp < cutoff) {
      recentAlerts.delete(key);
    }
  }
}

// --- Alert processing ---

async function processAlerts() {
  const pending = getPendingAlerts();
  if (pending.length === 0) return;

  log(`Processing ${pending.length} pending alert(s)`);

  for (const alert of pending) {
    // Always mark as sent in DB (even if deduped) to prevent re-processing
    markAlertSent(alert.id);

    if (isDuplicate(alert)) {
      log(`Deduped: [${alert.source_agent}] ${alert.title}`);
      continue;
    }

    if (alert.priority === 'info') {
      // Batch info alerts for digest
      infoBatch.push(alert);
      log(`Batched info: [${alert.source_agent}] ${alert.title}`);
    } else {
      // Send warning/critical immediately
      const formatted = formatAlert(alert);
      await sendAlert(formatted);
      log(`Sent ${alert.priority}: [${alert.source_agent}] ${alert.title}`);
    }
  }
}

// --- Info digest ---

async function flushInfoDigest() {
  if (infoBatch.length === 0) return;

  log(`Flushing info digest (${infoBatch.length} alert(s))`);

  // Group by channel
  const byChannel = new Map();
  for (const alert of infoBatch) {
    const formatted = formatAlert(alert);
    const channelId = formatted.channelId;
    if (!channelId) continue;

    if (!byChannel.has(channelId)) {
      byChannel.set(channelId, []);
    }
    byChannel.get(channelId).push(alert);
  }

  // Send one digest message per channel
  for (const [channelId, alerts] of byChannel) {
    const lines = alerts.map(
      (a) => `• **[${a.source_agent}] ${a.title}** — ${a.message}`
    );
    const digest = `📋 **Info Digest** (${alerts.length} alert${alerts.length > 1 ? 's' : ''})\n${lines.join('\n')}`;
    await sendToChannel(channelId, digest);
  }

  infoBatch.length = 0;
  log('Info digest sent');
}

// --- Main ---

async function main() {
  log('Starting CTO-04 Alert Agent...');

  const client = await connectBot();
  if (!client) {
    console.error('[cto-04] Cannot start without Discord bot token. Exiting.');
    process.exit(1);
  }

  log(`Bot online as ${client.user.tag}`);

  // Poll for alerts every 30s
  setInterval(async () => {
    try {
      await processAlerts();
      cleanupDedupCache();
    } catch (err) {
      console.error(`[cto-04] Poll error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);

  // Flush info digest every 30 min
  setInterval(async () => {
    try {
      await flushInfoDigest();
    } catch (err) {
      console.error(`[cto-04] Digest error: ${err.message}`);
    }
  }, BATCH_INTERVAL_MS);

  // Run once immediately on startup
  await processAlerts();

  log('Alert loop running. Polling every 30s, digest every 30min.');
}

main().catch((err) => {
  console.error(`[cto-04] Fatal: ${err.message}`);
  process.exit(1);
});
