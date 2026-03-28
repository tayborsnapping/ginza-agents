// agents/cto-04-alerts/index.js — Discord Alert Bot
// Always-on service (PM2 keeps alive). Polls the alerts table every 30s,
// routes alerts to the correct Discord channel, and batches info-level alerts.
// Run with: node agents/cto-04-alerts/index.js

import dotenv from 'dotenv';
dotenv.config({ override: true });
import { existsSync } from 'fs';
import * as db from '../../shared/db.js';
import {
  connectBot,
  formatAlert,
  sendAlert,
  sendToChannel,
  sendEmbed,
  getChannelIdForAgent,
} from '../../shared/discord.js';
import { addLabel } from '../../shared/gmail.js';
import { getDetroitTime } from '../../shared/utils.js';

// --- Config ---
const POLL_INTERVAL_MS = 30_000;           // Check for new alerts every 30s
const BATCH_INTERVAL_MS = 30 * 60_000;     // Flush info digest every 30 min
const DEDUP_WINDOW_MS = 5 * 60_000;        // Ignore duplicate alerts within 5 min
const STALE_ALERT_MS = 24 * 60 * 60_000;  // Don't retry alerts older than 24 hours

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

/** Read the latest output for a given key from agent_outputs. */
function readAgentOutput(outputKey) {
  const row = db.getDb().prepare(`
    SELECT data FROM agent_outputs
    WHERE output_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(outputKey);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

/** Write a new agent_output row. */
function writeAgentOutput(agentId, outputKey, data) {
  db.getDb().prepare(`
    INSERT INTO agent_outputs (agent_id, output_key, data, created_at)
    VALUES (?, ?, ?, ?)
  `).run(agentId, outputKey, JSON.stringify(data), new Date().toISOString());
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
    // Skip stale alerts (older than 24 hours) — mark sent to clear the queue
    const alertAge = Date.now() - new Date(alert.created_at).getTime();
    if (alertAge > STALE_ALERT_MS) {
      markAlertSent(alert.id);
      log(`Stale (${Math.round(alertAge / 3600000)}h old), skipping: [${alert.source_agent}] ${alert.title}`);
      continue;
    }

    if (isDuplicate(alert)) {
      markAlertSent(alert.id);
      log(`Deduped: [${alert.source_agent}] ${alert.title}`);
      continue;
    }

    // Special handling: COO-03 CSV Ready → send embed with CSV attachment
    if (
      alert.source_agent === 'coo-03-descriptions' &&
      alert.title.includes('CSV Ready')
    ) {
      try {
        await handleCSVReadyAlert(alert);
        markAlertSent(alert.id);
        log(`Sent CSV embed for: [${alert.source_agent}] ${alert.title}`);
      } catch (err) {
        log(`CSV embed failed: ${err.message} — will retry next cycle`);
      }
      continue;
    }

    if (alert.priority === 'info') {
      // Batch info alerts for digest — mark sent now (digest delivery is best-effort)
      markAlertSent(alert.id);
      infoBatch.push(alert);
      log(`Batched info: [${alert.source_agent}] ${alert.title}`);
    } else {
      // Send warning/critical immediately — only mark sent on success
      try {
        const formatted = formatAlert(alert);
        await sendAlert(formatted);
        markAlertSent(alert.id);
        log(`Sent ${alert.priority}: [${alert.source_agent}] ${alert.title}`);
      } catch (err) {
        log(`Delivery failed for [${alert.source_agent}] ${alert.title}: ${err.message} — will retry next cycle`);
      }
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

// --- CSV Ready embed + ✅ confirmation ---

async function handleCSVReadyAlert(alert) {
  const descriptions = readAgentOutput('product_descriptions');
  if (!descriptions) {
    log('No product_descriptions output found — sending alert as plain text');
    const formatted = formatAlert(alert);
    await sendAlert(formatted);
    return;
  }

  const channelId = getChannelIdForAgent('coo-03-descriptions');
  if (!channelId) throw new Error('No channel configured for COO agents');

  const fields = [
    { name: 'Described', value: String(descriptions.described?.length || 0), inline: true },
    { name: 'Skipped', value: String(descriptions.skipped?.length || 0), inline: true },
    { name: 'Errors', value: String(descriptions.errors?.length || 0), inline: true },
  ];
  if (descriptions.invoicesProcessed?.length) {
    fields.push({ name: 'Invoices', value: descriptions.invoicesProcessed.join(', '), inline: false });
  }
  if (descriptions.dryRun) {
    fields.push({ name: 'Mode', value: '⚠️ DRY RUN — no Shopify changes made', inline: false });
  }

  const files = [];
  if (descriptions.csvPath && existsSync(descriptions.csvPath)) {
    files.push({ attachment: descriptions.csvPath, name: 'shopify-import.csv' });
  }

  const sent = await sendEmbed(channelId, {
    title: '📦 Shopify Import Complete',
    description: alert.message,
    color: 0x00CC88,
    fields,
    footer: 'React ✅ to mark invoices as processed in Gmail',
    files,
  });

  if (sent) {
    writeAgentOutput('cto-04-alerts', 'pending_shopify_confirm', {
      discordMessageId: sent.id,
      channelId,
      processedEmailMessageIds: descriptions.processedEmailMessageIds || [],
      invoicesProcessed: descriptions.invoicesProcessed || [],
      csvPath: descriptions.csvPath || null,
      createdAt: new Date().toISOString(),
    });
    log(`Wrote pending_shopify_confirm (message ${sent.id})`);
  }
}

function registerReactionListener(client) {
  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      // Skip bot's own reactions
      if (user.id === client.user.id) return;

      // Only care about ✅
      if (reaction.emoji.name !== '✅') return;

      // Fetch partials if needed (reactions on old messages)
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const pending = readAgentOutput('pending_shopify_confirm');
      if (!pending) return;

      // Must match the tracked message
      if (reaction.message.id !== pending.discordMessageId) return;

      // Prevent double-confirm
      const existing = readAgentOutput('shopify_confirmed');
      if (existing && existing.discordMessageId === pending.discordMessageId) {
        log('Already confirmed this import — ignoring duplicate ✅');
        return;
      }

      log(`✅ received from ${user.username} — applying Gmail labels`);

      const emailIds = pending.processedEmailMessageIds || [];
      let labeled = 0;
      for (const messageId of emailIds) {
        try {
          await addLabel(messageId, 'shopify-added');
          labeled++;
        } catch (err) {
          log(`Failed to label email ${messageId}: ${err.message}`);
        }
      }

      writeAgentOutput('cto-04-alerts', 'shopify_confirmed', {
        discordMessageId: pending.discordMessageId,
        confirmedBy: user.username,
        confirmedAt: new Date().toISOString(),
        emailsLabeled: labeled,
        totalEmails: emailIds.length,
        invoicesProcessed: pending.invoicesProcessed,
      });

      const channel = await client.channels.fetch(pending.channelId);
      await channel.send(
        `✅ Done — labeled ${labeled}/${emailIds.length} emails as \`shopify-added\` in Gmail. ` +
        `Invoices: ${pending.invoicesProcessed?.join(', ') || 'none'}`
      );

      log(`Confirmed: ${labeled}/${emailIds.length} emails labeled, confirmed by ${user.username}`);
    } catch (err) {
      log(`Reaction handler error: ${err.message}`);
    }
  });

  log('Registered ✅ reaction listener for Shopify confirmation');
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

  // Register ✅ reaction listener for Shopify import confirmation
  registerReactionListener(client);

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
