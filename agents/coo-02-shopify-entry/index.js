// agents/coo-02-shopify-entry/index.js — COO-02 Shopify Product Entry Agent
// Triggered after COO-01 completes. Reads parsed invoices, deduplicates against
// Shopify, creates/updates products. Dry-run mode enabled by default (COO02_DRY_RUN=true).
// Run with: node agents/coo-02-shopify-entry/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run, triggerAgent } from '../../shared/runner.js';
import {
  readParsedInvoices,
  extractApprovedProducts,
  prefetchProducts,
  checkExistingProduct,
  createNewProduct,
  updateExistingProduct,
} from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.env.COO02_DRY_RUN !== 'false'; // Default ON
const BATCH_OVERRIDE = process.env.COO02_BATCH_OVERRIDE === 'true';
const BATCH_THRESHOLD = 50;

await run({
  agentId: 'coo-02-shopify-entry',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log(`Starting Shopify product entry (dry_run=${DRY_RUN})`);

    // Step 1: Read parsed invoices from COO-01
    const parsedData = readParsedInvoices(ctx);
    if (!parsedData) {
      return 'No parsed invoice data available';
    }

    // Step 2: Extract only approved products
    const { products, skippedInvoices, processedInvoiceNumbers, processedEmailMessageIds } = extractApprovedProducts(ctx, parsedData);

    if (products.length === 0) {
      const skipSummary = skippedInvoices.map(s => `${s.supplier} #${s.invoiceNumber}: ${s.reason}`).join('; ');
      ctx.log(`No approved products to process. Skipped: ${skipSummary}`);
      return `No approved products. ${skippedInvoices.length} invoices skipped (not approved).`;
    }

    // Step 3: Filter out zero-cost products
    const validProducts = [];
    const skippedProducts = [];

    for (const product of products) {
      if (!product.unitCost || product.unitCost <= 0) {
        skippedProducts.push({
          title: product.title,
          sku: product.sku,
          reason: 'Zero or negative cost (promo item)',
        });
        ctx.log(`Skipping zero-cost product: "${product.title}" ($${product.unitCost})`);
        continue;
      }
      validProducts.push(product);
    }

    ctx.log(`${validProducts.length} products to process (${skippedProducts.length} zero-cost skipped)`);

    // Step 4: Batch threshold check — if too many creates, pause for manual approval
    if (validProducts.length > BATCH_THRESHOLD && !BATCH_OVERRIDE) {
      ctx.log(`BATCH THRESHOLD EXCEEDED: ${validProducts.length} products > ${BATCH_THRESHOLD} limit`);
      ctx.alert(
        'warning',
        'COO-02: Batch Approval Required',
        `${validProducts.length} products queued for Shopify entry (threshold: ${BATCH_THRESHOLD}). ` +
        `Invoices: ${processedInvoiceNumbers.join(', ')}. ` +
        `Manual approval required before processing. Re-run with COO02_BATCH_OVERRIDE=true to proceed.`
      );

      const output = {
        summary: `Paused — ${validProducts.length} products exceed batch threshold of ${BATCH_THRESHOLD}`,
        created: [],
        updated: [],
        skipped: skippedProducts,
        errors: [],
        needsApproval: true,
        totalProcessed: 0,
        invoicesProcessed: processedInvoiceNumbers,
        processedEmailMessageIds,
      };
      ctx.writeOutput('shopify_entries', output);
      return output.summary;
    }

    // Step 5: Pre-fetch all Shopify products once (avoids per-product API calls + 429s)
    await prefetchProducts(ctx);

    // Step 6: Process each product — dedup, create, or update
    const created = [];
    const updated = [];
    const errors = [];
    // Track titles/SKUs seen within this run to catch cross-invoice duplicates
    const seenInRun = new Map(); // title (lowercased) → { product, index in created[] }

    for (const product of validProducts) {
      try {
        // In-run dedup: if we already plan to create this product in this batch,
        // merge quantities instead of creating a duplicate
        const titleKey = product.title.toLowerCase().trim();
        if (seenInRun.has(titleKey)) {
          const prev = seenInRun.get(titleKey);
          prev.quantity += product.quantity || 0;
          ctx.log(`In-run dedup: "${product.title}" from invoice ${product.invoiceNumber} merged with earlier entry (total qty: ${prev.quantity})`);
          skippedProducts.push({
            title: product.title,
            sku: product.sku,
            reason: `Duplicate within batch — merged qty +${product.quantity} into existing entry`,
          });
          continue;
        }

        // Check for existing product in Shopify
        const existing = await checkExistingProduct(ctx, product.title, product.sku);

        if (existing.exists) {
          // Update existing product
          const result = await updateExistingProduct(ctx, existing.product, product, DRY_RUN);
          updated.push({
            shopifyId: existing.product.id,
            title: existing.product.title,
            matchType: existing.matchType,
            action: result.action,
            sku: product.sku,
          });
        } else {
          // Create new product
          const newProduct = await createNewProduct(ctx, product, DRY_RUN);
          created.push({
            shopifyId: newProduct.id,
            title: product.title,
            sku: product.sku,
            price: product.suggestedRetail,
            quantity: product.quantity,
            productType: product.productType,
          });
          // Track for in-run dedup
          seenInRun.set(titleKey, created[created.length - 1]);
        }
      } catch (err) {
        ctx.log(`Error processing "${product.title}": ${err.message}`);
        errors.push({
          title: product.title,
          sku: product.sku,
          invoiceNumber: product.invoiceNumber,
          error: err.message,
        });
      }
    }

    // Step 6: Build output
    const output = {
      summary: `Created ${created.length}, updated ${updated.length}, skipped ${skippedProducts.length}, errors ${errors.length}${DRY_RUN ? ' [DRY RUN]' : ''}`,
      created,
      updated,
      skipped: skippedProducts,
      errors,
      needsApproval: false,
      totalProcessed: created.length + updated.length,
      invoicesProcessed: processedInvoiceNumbers,
      processedEmailMessageIds,
      dryRun: DRY_RUN,
    };

    ctx.writeOutput('shopify_entries', output);
    ctx.log(`Output written: ${output.summary}`);

    // Step 7: Queue alerts
    if (DRY_RUN) {
      ctx.alert(
        'info',
        'COO-02: Dry Run Complete',
        `${output.summary}. Set COO02_DRY_RUN=false to execute for real.`
      );
    } else {
      ctx.alert(
        'info',
        'COO-02: Shopify Entry Complete',
        output.summary
      );
    }

    if (errors.length > 0) {
      ctx.alert(
        'warning',
        'COO-02: Entry Errors',
        `${errors.length} products failed: ${errors.map(e => `"${e.title}": ${e.error}`).join('; ')}`
      );
    }

    // Step 8: Send summary to Anthropic for analysis (optional — enriches the run summary)
    const analysisPayload = JSON.stringify({
      ...output,
      skippedInvoices,
    }, null, 2);

    const analysis = await ctx.anthropic(
      `Analyze these Shopify product entry results and provide a concise summary:\n\n${analysisPayload}`
    );

    // Step 9: Trigger COO-03 (Product Descriptions) if we created products
    if (created.length > 0) {
      try {
        triggerAgent('coo-03-descriptions');
        ctx.log('Triggered COO-03 (Product Descriptions)');
      } catch (triggerErr) {
        ctx.log(`Warning: failed to trigger COO-03: ${triggerErr.message}`);
        ctx.alert('warning', 'COO-03 Trigger Failed', `Could not auto-trigger COO-03: ${triggerErr.message}. Run manually.`);
      }
    }

    return analysis.content || output.summary;
  },
});
