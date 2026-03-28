// agents/coo-04-upc/tools.js — UPC barcode lookup tools
// Reads parsed invoices from COO-01, searches for UPC barcodes via web search + LLM,
// writes enriched data for COO-02 consumption.

import { webSearch } from '../../shared/brave-search.js';
import { parseJSON, stripCodeFences } from '../../shared/utils.js';

/**
 * Read the latest parsed_invoices output from COO-01.
 * @param {object} ctx - Runner context
 * @returns {object|null}
 */
export function readParsedInvoices(ctx) {
  const data = ctx.readOutput('parsed_invoices');
  if (!data) {
    ctx.log('No parsed_invoices found in agent_outputs');
    return null;
  }
  ctx.log(`Read parsed_invoices: ${data.rawInvoices?.length || 0} invoices, parsed at ${data.parsedAt}`);
  return data;
}

/**
 * Write enriched invoice data (with barcodes) to agent_outputs.
 * @param {object} ctx - Runner context
 * @param {object} data - Enriched invoice data
 */
export function writeEnrichedInvoices(ctx, data) {
  ctx.writeOutput('enriched_invoices', data);
  ctx.log('Enriched invoices written to agent_outputs');
}

/**
 * Validate a barcode string (UPC-A: 12 digits, EAN-13: 13 digits).
 * Checks format and the check digit.
 * @param {string} code - Barcode string to validate
 * @returns {{ valid: boolean, type: string|null }}
 */
export function validateBarcode(code) {
  if (!code || typeof code !== 'string') return { valid: false, type: null };

  // Strip whitespace
  const cleaned = code.trim();

  // Must be exactly 12 or 13 digits
  if (!/^\d{12,13}$/.test(cleaned)) return { valid: false, type: null };

  const digits = cleaned.split('').map(Number);
  const type = digits.length === 12 ? 'UPC-A' : 'EAN-13';

  // Verify check digit (same algorithm for UPC-A and EAN-13)
  const checkDigit = digits.pop();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  const calculated = (10 - (sum % 10)) % 10;

  return { valid: calculated === checkDigit, type };
}

/**
 * Check if a product type should skip UPC lookup (singles don't have barcodes).
 * @param {string} productType
 * @returns {boolean}
 */
export function shouldSkipUPC(productType) {
  if (!productType) return false;
  return productType.startsWith('Single:');
}

/**
 * Search the web for a product's UPC barcode.
 * @param {object} ctx - Runner context
 * @param {string} productTitle - Product name
 * @returns {Promise<string>} Search snippets or empty string
 */
export async function searchForUPC(ctx, productTitle) {
  // Try a targeted barcode search
  const query = `"${productTitle}" UPC barcode`;
  return webSearch(ctx, query, 5);
}

/**
 * Use LLM to extract a UPC barcode from web search results.
 * @param {object} ctx - Runner context
 * @param {string} productTitle - Product name
 * @param {string} searchResults - Concatenated web search snippets
 * @returns {Promise<{ barcode: string|null, confidence: string, source: string }>}
 */
export async function extractUPCFromResults(ctx, productTitle, searchResults) {
  const prompt = `Extract the UPC/EAN barcode for this product from the search results below.

Product: "${productTitle}"

Search results:
${searchResults}

Return ONLY a JSON object:
{"barcode": "012345678901" or null, "confidence": "high|medium|low", "source": "where you found it"}

If no reliable barcode is found, return {"barcode": null, "confidence": "low", "source": "not found in search results"}.`;

  const result = await ctx.anthropic(prompt, { maxTokens: 150 });
  const parsed = parseJSON(stripCodeFences(result.content));

  if (!parsed) {
    ctx.log(`Failed to parse UPC extraction response for "${productTitle}"`);
    return { barcode: null, confidence: 'low', source: 'parse error' };
  }

  return {
    barcode: parsed.barcode || null,
    confidence: parsed.confidence || 'low',
    source: parsed.source || 'unknown',
  };
}

/**
 * Process a single product: attempt to find/validate its barcode.
 * @param {object} ctx - Runner context
 * @param {object} product - Product object (may already have a barcode from invoice)
 * @param {boolean} dryRun - If true, log only without making web/LLM calls
 * @returns {Promise<{ barcode: string|null, source: string }>}
 */
export async function lookupProductUPC(ctx, product, dryRun) {
  // Skip singles — they don't have UPCs
  if (shouldSkipUPC(product.productType)) {
    return { barcode: null, source: 'skipped (single)' };
  }

  // Check if invoice already provided a barcode
  if (product.barcode) {
    const validation = validateBarcode(product.barcode);
    if (validation.valid) {
      ctx.log(`Invoice barcode valid for "${product.title}": ${product.barcode} (${validation.type})`);
      return { barcode: product.barcode, source: `invoice (${validation.type})` };
    }
    ctx.log(`Invoice barcode invalid for "${product.title}": ${product.barcode} — will search web`);
  }

  if (dryRun) {
    ctx.log(`[DRY RUN] Would search web for UPC: "${product.title}"`);
    return { barcode: null, source: 'dry-run (would search web)' };
  }

  // Web search for UPC
  const searchResults = await searchForUPC(ctx, product.title);
  if (!searchResults) {
    ctx.log(`No web results for UPC lookup: "${product.title}"`);
    return { barcode: null, source: 'no web results' };
  }

  // LLM extraction from search results
  const extraction = await extractUPCFromResults(ctx, product.title, searchResults);

  if (extraction.barcode) {
    const validation = validateBarcode(extraction.barcode);
    if (validation.valid) {
      ctx.log(`Found UPC for "${product.title}": ${extraction.barcode} (${validation.type}, confidence: ${extraction.confidence})`);
      return { barcode: extraction.barcode, source: `web search (${extraction.source})` };
    }
    ctx.log(`Extracted barcode failed validation for "${product.title}": ${extraction.barcode}`);
  }

  return { barcode: null, source: 'not found' };
}
