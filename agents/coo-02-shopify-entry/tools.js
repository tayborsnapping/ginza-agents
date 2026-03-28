// agents/coo-02-shopify-entry/tools.js — Shopify product entry tool functions
// Reads parsed invoices from COO-01, deduplicates against Shopify, creates/updates products.
// Uses shared/shopify.js for all Shopify API calls.

import {
  getProducts,
  createProduct as shopifyCreateProduct,
  updateProduct as shopifyUpdateProduct,
  setInventoryLevel,
  searchProductsByTitle,
  getLocations,
} from '../../shared/shopify.js';
import { isValidProductType } from '../../shared/product-types.js';

// Cache for Shopify location ID (fetched once per run)
let _primaryLocationId = null;

// Cache for all Shopify products (fetched once per run for SKU dedup)
let _allProductsCache = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Delay between Shopify API calls to avoid 429s
const API_DELAY_MS = 600;

/**
 * Get the primary Shopify location ID (for inventory operations).
 * Cached after first call.
 */
export async function getPrimaryLocationId(ctx) {
  if (_primaryLocationId) return _primaryLocationId;
  const locations = await getLocations();
  if (!locations.length) throw new Error('No Shopify locations found');
  // Use the first (primary) location
  _primaryLocationId = locations[0].id;
  ctx.log(`Primary location: ${locations[0].name} (id=${_primaryLocationId})`);
  return _primaryLocationId;
}

/**
 * Read invoice data — prefers enriched_invoices (from COO-04 with barcodes),
 * falls back to parsed_invoices (from COO-01) for backward compatibility.
 * Returns the full data or null if none exists.
 */
export function readParsedInvoices(ctx) {
  // Prefer enriched data (COO-04 adds barcodes)
  const enriched = ctx.readOutput('enriched_invoices');
  if (enriched) {
    ctx.log(`Read enriched_invoices: ${enriched.rawInvoices?.length || 0} invoices, enriched at ${enriched.enrichedAt}`);
    return enriched;
  }

  // Fall back to raw parsed data (if COO-04 was skipped or failed)
  const data = ctx.readOutput('parsed_invoices');
  if (!data) {
    ctx.log('No invoice data found in agent_outputs (checked enriched_invoices and parsed_invoices)');
    return null;
  }
  ctx.log(`Read parsed_invoices (fallback): ${data.rawInvoices?.length || 0} invoices, parsed at ${data.parsedAt}`);
  return data;
}

/**
 * Extract approved products from parsed invoice data.
 * Merges invoice-level validation status with raw product data.
 * Returns { products[], skippedInvoices[] }
 */
export function extractApprovedProducts(ctx, parsedData) {
  const products = [];
  const skippedInvoices = [];
  const processedInvoiceNumbers = [];
  const processedEmailMessageIds = [];

  const validatedMap = new Map();
  for (const inv of (parsedData.invoices || [])) {
    const key = `${inv.supplier}:${inv.invoiceNumber}`;
    validatedMap.set(key, inv);
  }

  for (const rawInv of (parsedData.rawInvoices || [])) {
    const key = `${rawInv.supplier}:${rawInv.invoiceNumber}`;
    const validated = validatedMap.get(key);
    const status = validated?.status || 'needs_review';

    if (status !== 'approved') {
      ctx.log(`Skipping invoice ${rawInv.invoiceNumber} (${rawInv.supplier}): status=${status}`);
      skippedInvoices.push({
        invoiceNumber: rawInv.invoiceNumber,
        supplier: rawInv.supplier,
        status,
        productCount: rawInv.products?.length || 0,
        reason: `Invoice status: ${status}`,
      });
      continue;
    }

    processedInvoiceNumbers.push(rawInv.invoiceNumber);
    if (rawInv.emailMessageId) {
      processedEmailMessageIds.push(rawInv.emailMessageId);
    }

    for (const product of (rawInv.products || [])) {
      // Safety net: ensure product type is valid before Shopify entry
      if (!isValidProductType(product.productType)) {
        ctx.log(`Safety net: invalid type "${product.productType}" for "${product.title}" → defaulting to "Other"`);
        product.productType = 'Other';
      }
      products.push({
        ...product,
        supplier: rawInv.supplier,
        invoiceNumber: rawInv.invoiceNumber,
        invoiceDate: rawInv.invoiceDate,
        currency: rawInv.currency,
      });
    }
  }

  ctx.log(`Extracted ${products.length} products from ${processedInvoiceNumbers.length} approved invoices`);
  return { products, skippedInvoices, processedInvoiceNumbers, processedEmailMessageIds };
}

/**
 * Pre-fetch and cache all Shopify products for dedup lookups.
 * Called once at the start of a run to avoid repeated API calls.
 */
export async function prefetchProducts(ctx) {
  if (_allProductsCache) return _allProductsCache;
  ctx.log('Pre-fetching all Shopify products for dedup lookups');
  try {
    _allProductsCache = await getProducts({ fields: 'id,title,variants' });
    ctx.log(`Cached ${_allProductsCache.length} existing Shopify products`);
  } catch (err) {
    ctx.log(`Warning: failed to pre-fetch products: ${err.message}`);
    _allProductsCache = [];
  }
  return _allProductsCache;
}

/**
 * Check if a product already exists in Shopify by title or SKU.
 * Uses the pre-fetched product cache — no extra API calls per product.
 * Returns { exists: boolean, product?: object, matchType?: 'title'|'sku' }
 */
export async function checkExistingProduct(ctx, title, sku) {
  // Ensure cache is loaded
  const allProducts = _allProductsCache || await prefetchProducts(ctx);

  // Search by title (case-insensitive)
  const titleLower = title.toLowerCase().trim();
  for (const product of allProducts) {
    if (product.title && product.title.toLowerCase().trim() === titleLower) {
      ctx.log(`Found existing product by title: "${title}" (id=${product.id})`);
      return { exists: true, product, matchType: 'title' };
    }
  }

  // Search by SKU (case-insensitive)
  if (sku) {
    const skuLower = sku.toLowerCase();
    for (const product of allProducts) {
      for (const variant of (product.variants || [])) {
        if (variant.sku && variant.sku.toLowerCase() === skuLower) {
          ctx.log(`Found existing product by SKU "${sku}": "${product.title}" (id=${product.id})`);
          return { exists: true, product, matchType: 'sku' };
        }
      }
    }
  }

  return { exists: false };
}

/**
 * Create a new Shopify product from parsed invoice data.
 * Returns the created product object.
 */
export async function createNewProduct(ctx, product, dryRun) {
  const supplierSlug = product.supplier.toLowerCase().replace(/\s+/g, '-');
  const tags = [`supplier:${supplierSlug}`, `invoice:${product.invoiceNumber}`, 'auto-entry'];

  const productData = {
    title: product.title,
    vendor: product.supplier,
    product_type: product.productType,
    tags: tags.join(', '),
    status: 'draft',
    variants: [{
      sku: product.sku || '',
      barcode: product.barcode || '',
      price: String(product.suggestedRetail || 0),
      cost: String(product.unitCost || 0),
      inventory_management: 'shopify',
      inventory_quantity: product.quantity || 0,
      requires_shipping: true,
      taxable: true,
    }],
  };

  if (dryRun) {
    ctx.log(`[DRY RUN] Would create: "${product.title}" (${product.productType}) — $${product.suggestedRetail} x ${product.quantity}`);
    return { id: `dry-run-${Date.now()}`, title: product.title, variants: [{ sku: product.sku }] };
  }

  await sleep(API_DELAY_MS);
  const created = await shopifyCreateProduct(productData);
  ctx.log(`Created product: "${created.title}" (id=${created.id})`);
  return created;
}

/**
 * Update an existing Shopify product — adjust inventory and update cost/price if changed.
 * Returns a description of what was updated.
 */
export async function updateExistingProduct(ctx, existingProduct, invoiceProduct, dryRun) {
  const variant = existingProduct.variants?.[0];
  if (!variant) {
    ctx.log(`No variant found on existing product "${existingProduct.title}" — skipping update`);
    return { action: 'skipped — no variant' };
  }

  const actions = [];

  // Update cost if changed
  const currentCost = parseFloat(variant.cost || 0);
  if (invoiceProduct.unitCost && Math.abs(currentCost - invoiceProduct.unitCost) > 0.01) {
    actions.push(`cost ${currentCost} → ${invoiceProduct.unitCost}`);
  }

  // Update price if our suggested retail differs
  const currentPrice = parseFloat(variant.price || 0);
  if (invoiceProduct.suggestedRetail && Math.abs(currentPrice - invoiceProduct.suggestedRetail) > 0.01) {
    actions.push(`price ${currentPrice} → ${invoiceProduct.suggestedRetail}`);
  }

  // Always add inventory from invoice
  actions.push(`inventory +${invoiceProduct.quantity}`);

  if (dryRun) {
    ctx.log(`[DRY RUN] Would update "${existingProduct.title}" (id=${existingProduct.id}): ${actions.join(', ')}`);
    return { action: actions.join(', ') };
  }

  // Update product variant cost/price
  if (actions.some(a => a.startsWith('cost') || a.startsWith('price'))) {
    const variantUpdate = {};
    if (invoiceProduct.unitCost) variantUpdate.cost = String(invoiceProduct.unitCost);
    if (invoiceProduct.suggestedRetail) variantUpdate.price = String(invoiceProduct.suggestedRetail);

    await sleep(API_DELAY_MS);
    await shopifyUpdateProduct(existingProduct.id, {
      variants: [{ id: variant.id, ...variantUpdate }],
    });
  }

  // Adjust inventory
  try {
    const locationId = await getPrimaryLocationId(ctx);
    const inventoryItemId = variant.inventory_item_id;
    if (inventoryItemId) {
      const currentQty = variant.inventory_quantity || 0;
      const newQty = currentQty + (invoiceProduct.quantity || 0);
      await setInventoryLevel({
        inventoryItemId,
        locationId,
        available: newQty,
      });
      ctx.log(`Inventory updated: ${currentQty} → ${newQty} for "${existingProduct.title}"`);
    }
  } catch (err) {
    ctx.log(`Inventory update failed for "${existingProduct.title}": ${err.message}`);
    actions.push(`inventory update failed: ${err.message}`);
  }

  ctx.log(`Updated product "${existingProduct.title}" (id=${existingProduct.id}): ${actions.join(', ')}`);
  return { action: actions.join(', ') };
}
