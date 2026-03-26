// shared/discord.js — Discord bot client
// Uses discord.js (full bot, not webhooks — supports future two-way commands).
// Gracefully skips all operations if DISCORD_BOT_TOKEN is not set.
// Agents never import discord.js directly — use ctx.alert() or this module.

import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

// Maps agent ID prefixes to the env var holding the channel ID
const PREFIX_TO_ENV = {
  cto: 'DISCORD_CHANNEL_CTO',
  cfo: 'DISCORD_CHANNEL_CFO',
  coo: 'DISCORD_CHANNEL_COO',
  cmo: 'DISCORD_CHANNEL_CMO',
  cso: 'DISCORD_CHANNEL_CSO',
};

let _client = null;

/**
 * Connect the Discord bot. Returns the Client instance or null if no token is set.
 * Call once at startup for always-on services (CTO-04). Runner-based agents don't
 * need to call this — they use ctx.alert() which queues to DB instead.
 */
export async function connectBot() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[discord] DISCORD_BOT_TOKEN not set — Discord integration disabled');
    return null;
  }

  _client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await new Promise((resolve, reject) => {
    _client.once('ready', resolve);
    _client.once('error', reject);
    _client.login(process.env.DISCORD_BOT_TOKEN).catch(reject);
  });

  console.log(`[discord] Bot connected as ${_client.user.tag}`);
  return _client;
}

/**
 * Send a plain text message to a channel.
 */
export async function sendToChannel(channelId, message) {
  if (!_client) {
    console.warn('[discord] Bot not connected — skipping text message');
    return;
  }
  try {
    const channel = await _client.channels.fetch(channelId);
    await channel.send(message);
  } catch (err) {
    console.error(`[discord] Failed to send message to channel ${channelId}: ${err.message}`);
  }
}

/**
 * Send a rich embed message to a channel.
 * @param {string} channelId
 * @param {{ title: string, description: string, color: number, fields?: Array<{name, value, inline?}> }} opts
 */
export async function sendEmbed(channelId, { title, description, color, fields }) {
  if (!_client) {
    console.warn('[discord] Bot not connected — skipping embed');
    return;
  }
  try {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();

    if (fields?.length) {
      embed.addFields(fields);
    }

    const channel = await _client.channels.fetch(channelId);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[discord] Failed to send embed to channel ${channelId}: ${err.message}`);
  }
}

/**
 * Derive the correct channel ID for an agent based on its ID prefix.
 * e.g. 'cfo-01' → process.env.DISCORD_CHANNEL_CFO
 */
export function getChannelIdForAgent(agentId) {
  const prefix = agentId.split('-')[0].toLowerCase();
  const envKey = PREFIX_TO_ENV[prefix] ?? 'DISCORD_CHANNEL_GENERAL';
  return process.env[envKey] ?? process.env.DISCORD_CHANNEL_GENERAL ?? null;
}

/**
 * Format an alert row into a sendable Discord payload.
 * Returns { channelId, type: 'text'|'embed', content, embed? }
 *
 * Used by CTO-04 when processing pending alerts from the DB.
 */
export function formatAlert(alert) {
  const channelId = getChannelIdForAgent(alert.source_agent);

  if (alert.priority === 'info') {
    return {
      channelId,
      type: 'text',
      content: `**[${alert.source_agent}] ${alert.title}**: ${alert.message}`,
    };
  }

  if (alert.priority === 'warning') {
    return {
      channelId,
      type: 'embed',
      content: null,
      embed: {
        title: `⚠️ ${alert.title}`,
        description: `**Source:** \`${alert.source_agent}\`\n\n${alert.message}`,
        color: 0xFFCC00,
      },
    };
  }

  if (alert.priority === 'critical') {
    return {
      channelId,
      type: 'embed',
      content: '@here',
      embed: {
        title: `🚨 ${alert.title}`,
        description: `**Source:** \`${alert.source_agent}\`\n\n${alert.message}`,
        color: 0xFF0000,
      },
    };
  }

  // Fallback for unknown priorities
  return {
    channelId,
    type: 'text',
    content: `**[${alert.source_agent}] ${alert.title}**: ${alert.message}`,
  };
}

/**
 * Send a formatted alert to Discord. Handles both text and embed types.
 * Used by CTO-04's alert loop.
 */
export async function sendAlert(formattedAlert) {
  if (!_client) {
    console.warn('[discord] Bot not connected — cannot send alert');
    return;
  }
  const { channelId, type, content, embed } = formattedAlert;
  if (!channelId) {
    console.warn(`[discord] No channel ID configured for this alert — skipping`);
    return;
  }

  try {
    const channel = await _client.channels.fetch(channelId);
    if (type === 'text') {
      await channel.send(content);
    } else if (type === 'embed') {
      const discordEmbed = new EmbedBuilder()
        .setTitle(embed.title)
        .setDescription(embed.description)
        .setColor(embed.color)
        .setTimestamp();
      await channel.send({ content: content ?? undefined, embeds: [discordEmbed] });
    }
  } catch (err) {
    console.error(`[discord] Failed to send alert to channel ${channelId}: ${err.message}`);
  }
}
