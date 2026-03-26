// shared/gmail.js — Gmail API client
// Scoped to info@ginzatcg.com inbox. Used by COO-01 (Invoice Parser).
// Gracefully skips operations if OAuth2 credentials are not set.

import { google } from 'googleapis';

const TARGET_EMAIL = process.env.GMAIL_TARGET_EMAIL || 'info@ginzatcg.com';

function getAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[gmail] Gmail credentials not fully set — Gmail integration disabled');
    return null;
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function getGmailClient() {
  const auth = getAuth();
  if (!auth) throw new Error('Gmail credentials not configured');
  return google.gmail({ version: 'v1', auth });
}

/**
 * List messages matching a Gmail query string.
 * @param {{ query: string, maxResults?: number }} opts
 * @returns {Array<{ id: string, threadId: string }>}
 */
export async function listMessages({ query, maxResults = 50 }) {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.list({
    userId: TARGET_EMAIL,
    q: query,
    maxResults,
  });
  return response.data.messages ?? [];
}

/**
 * Get full message content (headers, body, parts).
 * @param {string} messageId
 * @returns {object} Full Gmail message object
 */
export async function getMessage(messageId) {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.get({
    userId: TARGET_EMAIL,
    id: messageId,
    format: 'full',
  });
  return response.data;
}

/**
 * Download an attachment as a Buffer.
 * @param {string} messageId
 * @param {string} attachmentId
 * @returns {Buffer}
 */
export async function getAttachment(messageId, attachmentId) {
  const gmail = getGmailClient();
  const response = await gmail.users.messages.attachments.get({
    userId: TARGET_EMAIL,
    messageId,
    id: attachmentId,
  });
  // Gmail returns base64url-encoded data
  const base64Data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64Data, 'base64');
}

/**
 * Add a label to a message by label name.
 * Creates the label if it doesn't exist.
 * Used to mark invoices as 'agent-processed'.
 *
 * @param {string} messageId
 * @param {string} labelName  e.g. 'agent-processed'
 */
export async function addLabel(messageId, labelName) {
  const gmail = getGmailClient();

  // Find or create the label
  const labelsResponse = await gmail.users.labels.list({ userId: TARGET_EMAIL });
  let label = labelsResponse.data.labels?.find(l => l.name === labelName);

  if (!label) {
    const createResponse = await gmail.users.labels.create({
      userId: TARGET_EMAIL,
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    label = createResponse.data;
  }

  await gmail.users.messages.modify({
    userId: TARGET_EMAIL,
    id: messageId,
    requestBody: { addLabelIds: [label.id] },
  });
}
