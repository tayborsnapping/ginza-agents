// agents/coo-03-descriptions/tools.js — Product description generation tools
// Reads COO-02 output, fetches product details from Shopify, performs web search
// for product context, and updates Shopify listings with generated descriptions.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  getProduct,
  updateProduct as shopifyUpdateProduct,
} from '../../shared/shopify.js';
import { webSearch } from '../../shared/brave-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const EXPORTS_DIR = join(PROJECT_ROOT, 'data', 'exports');

// Product types that should be skipped (singles don't get descriptions)
const SKIP_PREFIXES = ['Single:'];

/**
 * Check if a product type should be skipped.
 * @param {string} productType
 * @returns {boolean}
 */
export function shouldSkipProductType(productType) {
  if (!productType) return false;
  return SKIP_PREFIXES.some(prefix => productType.startsWith(prefix));
}

/**
 * Read the latest shopify_entries output from COO-02 via agent_outputs.
 * Returns the output data or null.
 */
export function readShopifyEntries(ctx) {
  const data = ctx.readOutput('shopify_entries');
  if (!data) {
    ctx.log('No shopify_entries found in agent_outputs');
    return null;
  }
  ctx.log(`Read shopify_entries: ${data.created?.length || 0} created, ${data.updated?.length || 0} updated`);
  return data;
}

/**
 * Fetch full product details from Shopify for a given product ID.
 * Returns the product object with all fields (title, body_html, tags, etc.).
 * @param {object} ctx - Runner context
 * @param {string|number} shopifyId
 * @returns {object|null}
 */
export async function getProductDetails(ctx, shopifyId) {
  try {
    return await getProduct(shopifyId);
  } catch (err) {
    ctx.log(`Failed to fetch product ${shopifyId}: ${err.message}`);
    return null;
  }
}

// webSearch is now imported from shared/brave-search.js
// Re-export for backward compatibility with COO-03's internal usage
export { webSearch };

/**
 * Build a search query for a product to find relevant details.
 * @param {object} product - Product object with title, productType, vendor
 * @returns {string}
 */
export function buildSearchQuery(product) {
  const parts = [product.title];

  // Add product type context for better results
  if (product.productType) {
    if (product.productType.includes('Sealed')) {
      parts.push('contents set list');
    } else if (product.productType === 'Figures' || product.productType === 'Model Kits') {
      parts.push('figure details specs');
    } else if (product.productType === 'Plushes') {
      parts.push('plush details');
    } else if (product.productType === 'Blind Boxes') {
      parts.push('blind box lineup');
    }
  }

  return parts.join(' ');
}

/**
 * Update a Shopify product with generated description, SEO fields, and metafields.
 * @param {object} ctx - Runner context
 * @param {string|number} productId - Shopify product ID
 * @param {object} descriptionData - Generated description data
 * @param {boolean} dryRun - If true, log only without updating
 * @returns {object} Result of the update
 */
export async function updateProductDescription(ctx, productId, descriptionData, dryRun) {
  const { bodyHtml, seoTitle, seoDescription, metafields } = descriptionData;

  const updatePayload = {
    body_html: bodyHtml,
  };

  // SEO fields via metafields_global (Shopify REST API pattern)
  if (seoTitle) {
    updatePayload.metafields_global_title_tag = seoTitle;
  }
  if (seoDescription) {
    updatePayload.metafields_global_description_tag = seoDescription;
  }

  // Custom metafields for discovery
  const metafieldPayloads = [];
  if (metafields?.product_highlight) {
    metafieldPayloads.push({
      namespace: 'ginza',
      key: 'product_highlight',
      value: metafields.product_highlight,
      type: 'single_line_text_field',
    });
  }
  if (metafields?.target_audience) {
    metafieldPayloads.push({
      namespace: 'ginza',
      key: 'target_audience',
      value: metafields.target_audience,
      type: 'single_line_text_field',
    });
  }
  if (metafieldPayloads.length > 0) {
    updatePayload.metafields = metafieldPayloads;
  }

  if (dryRun) {
    const preview = bodyHtml.substring(0, 120).replace(/<[^>]+>/g, '');
    ctx.log(`[DRY RUN] Would update product ${productId}: "${preview}..." | SEO: "${seoTitle}" | Meta: "${seoDescription}"`);
    return { action: 'dry-run', productId };
  }

  try {
    await shopifyUpdateProduct(productId, updatePayload);
    ctx.log(`Updated product ${productId}: description + SEO fields`);
    return { action: 'updated', productId };
  } catch (err) {
    ctx.log(`Failed to update product ${productId}: ${err.message}`);
    throw err;
  }
}

/**
 * Check if a product already has a description (body_html).
 * @param {object} product - Full Shopify product object
 * @returns {boolean}
 */
export function hasExistingDescription(product) {
  const html = product?.body_html;
  if (!html) return false;
  // Consider empty or whitespace-only HTML as no description
  const stripped = html.replace(/<[^>]+>/g, '').trim();
  return stripped.length > 20; // Ignore trivially short content
}

/**
 * Read shopify_entries to get processedEmailMessageIds and invoicesProcessed.
 * Used by COO-03 to carry forward pipeline metadata into its output.
 */
export function readShopifyEntriesMetadata(ctx) {
  const data = ctx.readOutput('shopify_entries');
  if (!data) return { processedEmailMessageIds: [], invoicesProcessed: [] };
  return {
    processedEmailMessageIds: data.processedEmailMessageIds || [],
    invoicesProcessed: data.invoicesProcessed || [],
  };
}

/**
 * Escape a value for CSV — wraps in double quotes if it contains commas,
 * quotes, or newlines. Internal double quotes are escaped as "".
 */
function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Slugify a title into a Shopify-compatible handle.
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a Shopify-format CSV from described products.
 * Each product should have: title, bodyHtml, seoTitle, seoDescription,
 * vendor, productType, tags, sku, price, barcode, quantity, cost.
 *
 * @param {Array} products - Product objects with description data
 * @param {string} [outputPath] - Optional custom path. Defaults to data/exports/shopify-import-YYYY-MM-DD.csv
 * @returns {string} Absolute path to the generated CSV file
 */
export function generateShopifyCSV(products, outputPath) {
  if (!existsSync(EXPORTS_DIR)) {
    mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const filePath = outputPath || join(EXPORTS_DIR, `shopify-import-${today}.csv`);

  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Grams',
    'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service',
    'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping',
    'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position',
    'Image Alt Text', 'SEO Title', 'SEO Description', 'Cost per item', 'Status',
  ];

  const rows = [headers.map(csvEscape).join(',')];

  for (const p of products) {
    const row = [
      slugify(p.title || ''),
      p.title || '',
      p.bodyHtml || '',
      p.vendor || '',
      p.productType || '',
      p.tags || '',
      'TRUE',
      'Title',                        // Option1 Name
      'Default Title',                // Option1 Value
      p.sku || '',
      '',                             // Variant Grams
      'shopify',                      // Variant Inventory Tracker
      p.quantity || 0,
      'deny',                         // Variant Inventory Policy
      'manual',                       // Variant Fulfillment Service
      p.price || 0,
      '',                             // Variant Compare At Price
      'TRUE',                         // Variant Requires Shipping
      'TRUE',                         // Variant Taxable
      p.barcode || '',
      '',                             // Image Src
      '',                             // Image Position
      '',                             // Image Alt Text
      p.seoTitle || '',
      p.seoDescription || '',
      p.cost || 0,
      'draft',
    ];
    rows.push(row.map(csvEscape).join(','));
  }

  writeFileSync(filePath, rows.join('\n'), 'utf-8');
  return filePath;
}
