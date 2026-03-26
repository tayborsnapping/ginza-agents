// shared/utils.js — Utility functions
// All timezone operations use America/Detroit. Dates stored as UTC ISO 8601 in DB,
// displayed/injected as Detroit local time in prompts and logs.

const DETROIT_TZ = 'America/Detroit';

/**
 * Get current time formatted as 'YYYY-MM-DD HH:mm:ss' in America/Detroit timezone.
 * Used for {{datetime}} injection in system prompts and console log prefixes.
 */
export function getDetroitTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DETROIT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Get current time as an ISO 8601 string anchored to Detroit's UTC offset.
 * e.g. "2025-06-01T14:30:00-04:00"
 */
export function getDetroitISO() {
  const now = new Date();
  // Get the UTC offset for Detroit at this moment (handles DST automatically)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DETROIT_TZ,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(now);
  const offset = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';

  // Convert "GMT-4" → "-04:00"
  const offsetFormatted = offset.replace('GMT', '').replace(/^([+-])(\d)$/, '$10$2:00').replace(/^([+-]\d{2})$/, '$1:00');

  const local = getDetroitTime();
  return `${local.replace(' ', 'T')}${offsetFormatted}`;
}

/**
 * Format a number of cents as a USD currency string.
 * e.g. formatCurrency(12350) → "$123.50"
 * e.g. formatCurrency(1000000) → "$10,000.00"
 *
 * @param {number} cents - Amount in cents
 * @returns {string}
 */
export function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * Safe JSON parse — returns null instead of throwing on malformed input.
 * @param {string} str
 * @returns {any|null}
 */
export function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Promisified sleep.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
