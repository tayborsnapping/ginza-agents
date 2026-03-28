// agents/coo-04-upc/index.js — COO-04 UPC Barcode Lookup Agent
// Triggered by COO-01 after invoice parsing. Enriches parsed invoices with UPC barcodes
// by checking invoice data first, then web search fallback.
// Writes enriched_invoices for COO-02 consumption, then triggers COO-02.
// Run with: node agents/coo-04-upc/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run, triggerAgent } from '../../shared/runner.js';
import { readParsedInvoices, writeEnrichedInvoices, lookupProductUPC, shouldSkipUPC } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRY_RUN = (process.env.COO04_DRY_RUN || 'true').toLowerCase() === 'true';

// Rate limit delay between web searches (ms) to respect Brave API limits
const SEARCH_DELAY_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

await run({
  agentId: 'coo-04-upc',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log(`Starting UPC barcode lookup (dryRun=${DRY_RUN})`);

    // Step 1: Read parsed invoices from COO-01
    const parsedData = readParsedInvoices(ctx);
    if (!parsedData) {
      ctx.log('No parsed invoices available — nothing to enrich');
      return 'No parsed invoices to process';
    }

    // Step 2: Process each product in raw invoices
    const stats = {
      total: 0,
      fromInvoice: 0,
      fromWeb: 0,
      skipped: 0,
      notFound: 0,
    };

    for (const invoice of (parsedData.rawInvoices || [])) {
      ctx.log(`Processing invoice: ${invoice.invoiceNumber} (${invoice.supplier}) — ${invoice.products?.length || 0} products`);

      for (const product of (invoice.products || [])) {
        stats.total++;

        if (shouldSkipUPC(product.productType)) {
          stats.skipped++;
          continue;
        }

        const result = await lookupProductUPC(ctx, product, DRY_RUN);

        if (result.barcode) {
          product.barcode = result.barcode;
          product.barcodeSource = result.source;
          if (result.source.startsWith('invoice')) {
            stats.fromInvoice++;
          } else {
            stats.fromWeb++;
          }
        } else {
          // Keep barcode as null (or whatever it was)
          product.barcode = product.barcode || null;
          product.barcodeSource = result.source;
          stats.notFound++;
        }

        // Rate limit between web searches (skip delay for invoice barcodes and dry runs)
        if (!DRY_RUN && !result.source.startsWith('invoice') && !result.source.startsWith('skipped')) {
          await sleep(SEARCH_DELAY_MS);
        }
      }
    }

    // Step 3: Write enriched data
    const enrichedData = {
      ...parsedData,
      enrichedAt: new Date().toISOString(),
      upcStats: stats,
    };
    writeEnrichedInvoices(ctx, enrichedData);

    // Step 4: Alert with summary
    const summary = `UPC lookup: ${stats.total} products — ${stats.fromInvoice} from invoice, ${stats.fromWeb} from web, ${stats.skipped} skipped (singles), ${stats.notFound} not found`;
    ctx.log(summary);
    ctx.alert('info', 'UPC Lookup Complete', summary);

    // Step 5: Trigger COO-02 (Shopify Product Entry)
    try {
      triggerAgent('coo-02-shopify-entry');
      ctx.log('Triggered COO-02 (Shopify Product Entry)');
    } catch (triggerErr) {
      ctx.log(`Warning: failed to trigger COO-02: ${triggerErr.message}`);
      ctx.alert('warning', 'COO-02 Trigger Failed', `Could not auto-trigger COO-02: ${triggerErr.message}. Run manually.`);
    }

    return summary;
  },
});
