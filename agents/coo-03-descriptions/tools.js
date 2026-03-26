// agents/coo-03-descriptions/tools.js — Product description generation tools
// Reads COO-02 output, fetches product details from Shopify, performs web search
// for product context, and updates Shopify listings with generated descriptions.

import {
  getProducts,
  updateProduct as shopifyUpdateProduct,
} from '../../shared/shopify.js';

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
    // getProducts with specific IDs — Shopify REST API supports ids filter
    const products = await getProducts({ limit: 1 });
    // Actually, shopify-api-node has a .get() method. Let's use a targeted approach.
    // We'll search by ID via the products list with ids param.
    const { default: ShopifyApi } = await import('shopify-api-node');
    const shopify = new ShopifyApi({
      shopName: process.env.SHOPIFY_STORE,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
      autoLimit: { calls: 2, interval: 1000 },
    });
    const product = await shopify.product.get(shopifyId);
    return product;
  } catch (err) {
    ctx.log(`Failed to fetch product ${shopifyId}: ${err.message}`);
    return null;
  }
}

/**
 * Search the web for product information using Brave Search API.
 * Falls back gracefully if no API key is configured.
 * @param {object} ctx - Runner context
 * @param {string} query - Search query
 * @returns {string} Concatenated search snippets, or empty string if unavailable
 */
export async function webSearch(ctx, query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    ctx.log('BRAVE_SEARCH_API_KEY not set — skipping web search, using AI knowledge only');
    return '';
  }

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '3');
    url.searchParams.set('text_decorations', 'false');

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      ctx.log(`Brave Search returned ${response.status} for "${query}"`);
      return '';
    }

    const data = await response.json();
    const results = (data.web?.results || []).slice(0, 3);

    if (results.length === 0) {
      ctx.log(`No web results for "${query}"`);
      return '';
    }

    const snippets = results.map(r => `${r.title}: ${r.description}`).join('\n');
    ctx.log(`Web search for "${query}": ${results.length} results`);
    return snippets;
  } catch (err) {
    ctx.log(`Web search error for "${query}": ${err.message}`);
    return '';
  }
}

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
