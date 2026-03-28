// agents/coo-03-descriptions/index.js — COO-03 Product Description Generator
// Chained from COO-02. Reads newly created Shopify draft products, generates
// rich SEO-optimized descriptions using Anthropic + web search, and updates
// the Shopify listings. Dry-run mode via COO03_DRY_RUN=true (default ON).
// Run with: node agents/coo-03-descriptions/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import {
  readShopifyEntries,
  readShopifyEntriesMetadata,
  getProductDetails,
  webSearch,
  buildSearchQuery,
  updateProductDescription,
  shouldSkipProductType,
  hasExistingDescription,
  generateShopifyCSV,
} from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.env.COO03_DRY_RUN !== 'false'; // Default ON
const BATCH_THRESHOLD = 20;

await run({
  agentId: 'coo-03-descriptions',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log(`Starting product description generation (dry_run=${DRY_RUN})`);

    // Step 1: Read COO-02's output to get newly created products
    const shopifyEntries = readShopifyEntries(ctx);
    if (!shopifyEntries) {
      return 'No shopify_entries data available — nothing to describe';
    }

    // Only process products that were created (new drafts needing descriptions)
    // Updated products likely already have descriptions
    const candidates = shopifyEntries.created || [];
    if (candidates.length === 0) {
      ctx.log('No newly created products to describe');
      return 'No new products from COO-02 — nothing to describe';
    }

    ctx.log(`${candidates.length} candidate products from COO-02`);

    // Step 2: Filter out singles and products that already have descriptions
    const toProcess = [];
    const skipped = [];

    for (const candidate of candidates) {
      // Skip singles
      if (shouldSkipProductType(candidate.productType)) {
        skipped.push({
          shopifyId: candidate.shopifyId,
          title: candidate.title,
          reason: `Singles do not receive descriptions (${candidate.productType})`,
        });
        ctx.log(`Skipping single: "${candidate.title}"`);
        continue;
      }

      // Skip dry-run placeholder IDs (from COO-02 dry runs)
      if (String(candidate.shopifyId).startsWith('dry-run-')) {
        skipped.push({
          shopifyId: candidate.shopifyId,
          title: candidate.title,
          reason: 'COO-02 dry-run product — no real Shopify ID',
        });
        ctx.log(`Skipping dry-run placeholder: "${candidate.title}"`);
        continue;
      }

      // Fetch full product details from Shopify to check for existing description
      const fullProduct = await getProductDetails(ctx, candidate.shopifyId);
      if (!fullProduct) {
        skipped.push({
          shopifyId: candidate.shopifyId,
          title: candidate.title,
          reason: 'Could not fetch product from Shopify',
        });
        continue;
      }

      // Skip if already has a real description
      if (hasExistingDescription(fullProduct)) {
        skipped.push({
          shopifyId: candidate.shopifyId,
          title: candidate.title,
          reason: 'Product already has a description',
        });
        ctx.log(`Already described: "${candidate.title}"`);
        continue;
      }

      toProcess.push({
        ...candidate,
        tags: fullProduct.tags,
        vendor: fullProduct.vendor,
      });
    }

    ctx.log(`${toProcess.length} products need descriptions (${skipped.length} skipped)`);

    if (toProcess.length === 0) {
      const output = {
        summary: `No products need descriptions. ${skipped.length} skipped.`,
        described: [],
        skipped,
        errors: [],
        dryRun: DRY_RUN,
      };
      ctx.writeOutput('product_descriptions', output);
      return output.summary;
    }

    // Step 3: Batch threshold check — warn on large batches but continue processing
    if (toProcess.length > BATCH_THRESHOLD) {
      ctx.log(`Large batch: ${toProcess.length} products > ${BATCH_THRESHOLD} threshold — proceeding with alert`);
      ctx.alert(
        'warning',
        'COO-03: Large Batch Processing',
        `${toProcess.length} products being described (threshold: ${BATCH_THRESHOLD}).`
      );
    }

    // Step 4: For each product, do web search then generate description via Anthropic
    const described = [];
    const errors = [];

    for (const product of toProcess) {
      try {
        ctx.log(`Processing: "${product.title}" (${product.productType})`);

        // Web search for additional product context
        const searchQuery = buildSearchQuery(product);
        const webResults = await webSearch(ctx, searchQuery);

        // Build the prompt payload for Anthropic
        const productPayload = JSON.stringify({
          shopifyId: product.shopifyId,
          title: product.title,
          productType: product.productType,
          vendor: product.vendor,
          price: product.price,
          tags: product.tags,
          webSearchResults: webResults || 'No web results available — use your knowledge of this product.',
        }, null, 2);

        // Call Anthropic to generate description
        const response = await ctx.anthropic(
          `Generate a product description for this Shopify listing. ` +
          `Return ONLY valid JSON matching the output format in your instructions. ` +
          `Do not wrap in markdown code blocks.\n\n${productPayload}`,
          { maxTokens: 2048 }
        );

        // Parse the AI response
        let descriptionData;
        try {
          // Strip markdown code fences if present
          let content = response.content.trim();
          if (content.startsWith('```')) {
            content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          descriptionData = JSON.parse(content);
        } catch (parseErr) {
          ctx.log(`Failed to parse AI response for "${product.title}": ${parseErr.message}`);
          ctx.log(`Raw response: ${response.content.substring(0, 200)}`);
          errors.push({
            shopifyId: product.shopifyId,
            title: product.title,
            error: `JSON parse error: ${parseErr.message}`,
          });
          continue;
        }

        // Handle skip decision from AI
        if (descriptionData.skipped) {
          skipped.push({
            shopifyId: product.shopifyId,
            title: product.title,
            reason: descriptionData.skipReason || 'Skipped by AI',
          });
          ctx.log(`AI skipped "${product.title}": ${descriptionData.skipReason}`);
          continue;
        }

        // Validate required fields
        if (!descriptionData.bodyHtml) {
          errors.push({
            shopifyId: product.shopifyId,
            title: product.title,
            error: 'AI response missing bodyHtml field',
          });
          continue;
        }

        // Update Shopify (or log in dry-run)
        await updateProductDescription(ctx, product.shopifyId, descriptionData, DRY_RUN);

        described.push({
          shopifyId: product.shopifyId,
          title: product.title,
          productType: product.productType,
          vendor: product.vendor,
          tags: product.tags,
          sku: product.sku,
          price: product.price,
          quantity: product.quantity,
          barcode: product.barcode,
          cost: product.cost,
          bodyHtml: descriptionData.bodyHtml,
          seoTitle: descriptionData.seoTitle,
          seoDescription: descriptionData.seoDescription,
          bodyHtmlPreview: descriptionData.bodyHtml.replace(/<[^>]+>/g, '').substring(0, 100),
        });

        ctx.log(`Described: "${product.title}" — SEO: "${descriptionData.seoTitle}"`);
      } catch (err) {
        ctx.log(`Error processing "${product.title}": ${err.message}`);
        errors.push({
          shopifyId: product.shopifyId,
          title: product.title,
          error: err.message,
        });
      }
    }

    // Step 5: Generate Shopify import CSV from described products
    let csvPath = null;
    if (described.length > 0) {
      try {
        csvPath = generateShopifyCSV(described);
        ctx.log(`Generated Shopify CSV: ${csvPath} (${described.length} products)`);
      } catch (csvErr) {
        ctx.log(`Warning: CSV generation failed: ${csvErr.message}`);
      }
    }

    // Step 5b: Read pipeline metadata from COO-02's output
    const shopifyMeta = readShopifyEntriesMetadata(ctx);

    // Step 6: Build output
    const output = {
      summary: `Described ${described.length}, skipped ${skipped.length}, errors ${errors.length}${DRY_RUN ? ' [DRY RUN]' : ''}`,
      described,
      skipped,
      errors,
      needsApproval: false,
      dryRun: DRY_RUN,
      csvPath,
      processedEmailMessageIds: shopifyMeta.processedEmailMessageIds,
      invoicesProcessed: shopifyMeta.invoicesProcessed,
    };

    ctx.writeOutput('product_descriptions', output);
    ctx.log(`Output written: ${output.summary}`);

    // Step 7: Alerts — include CSV Ready indicator for CTO-04 to detect
    if (DRY_RUN) {
      ctx.alert(
        'info',
        'COO-03: Descriptions & CSV Ready',
        `${output.summary}. CSV: ${csvPath || 'none'}. Set COO03_DRY_RUN=false to update Shopify for real.`
      );
    } else {
      ctx.alert(
        'info',
        'COO-03: Descriptions & CSV Ready',
        `${output.summary}. CSV: ${csvPath || 'none'}.`
      );
    }

    if (errors.length > 0) {
      ctx.alert(
        'warning',
        'COO-03: Description Errors',
        `${errors.length} products failed: ${errors.map(e => `"${e.title}": ${e.error}`).join('; ')}`
      );
    }

    // Step 7: Optional analysis summary
    const analysisPayload = JSON.stringify(output, null, 2);
    const analysis = await ctx.anthropic(
      `Summarize these product description generation results in 2-3 sentences:\n\n${analysisPayload}`
    );

    return analysis.content || output.summary;
  },
});
