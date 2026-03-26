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

// Cache for Shopify location ID (fetched once per run)
let _primaryLocationId = null;

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
 * Read the latest parsed_invoices output from COO-01 via agent_outputs.
 * Returns the full parsed data or null if none exists.
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
 * Extract approved products from parsed invoice data.
 * Merges invoice-level validation status with raw product data.
 * Returns { products[], skippedInvoices[] }
 */
export function extractApprovedProducts(ctx, parsedData) {
  const products = [];
  const skippedInvoices = [];
  const processedInvoiceNumbers = [];

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

    for (const product of (rawInv.products || [])) {
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
  return { products, skippedInvoices, processedInvoiceNumbers };
}

/**
 * Check if a product already exists in Shopify by title or SKU.
 * Returns { exists: boolean, product?: object, matchType?: 'title'|'sku' }
 */
export async function checkExistingProduct(ctx, title, sku) {
  // Search by title first (Shopify REST API exact match)
  try {
    const titleMatches = await searchProductsByTitle(title);
    if (titleMatches.length > 0) {
      ctx.log(`Found existing product by title: "${title}" (id=${titleMatches[0].id})`);
      return { exists: true, product: titleMatches[0], matchType: 'title' };
    }
  } catch (err) {
    ctx.log(`Title search error for "${title}": ${err.message}`);
  }

  // If SKU provided, search all products for matching variant SKU
  // This is expensive — only do it if title search failed and we have a SKU
  if (sku) {
    try {
      const allProducts = await getProducts({ fields: 'id,title,variants' });
      for (const product of allProducts) {
        for (const variant of (product.variants || [])) {
          if (variant.sku && variant.sku.toLowerCase() === sku.toLowerCase()) {
            ctx.log(`Found existing product by SKU "${sku}": "${product.title}" (id=${product.id})`);
            return { exists: true, product, matchType: 'sku' };
          }
        }
      }
    } catch (err) {
      ctx.log(`SKU search error for "${sku}": ${err.message}`);
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
