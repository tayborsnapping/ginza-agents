// agents/coo-01-invoice/index.js — COO-01 Invoice Parser Agent
// Daily agent (8 AM ET). Checks Gmail for unprocessed supplier invoices,
// downloads attachments, detects supplier, parses via LLM, validates results,
// writes parsed_invoices output for COO-02 consumption.
// Run with: node agents/coo-01-invoice/index.js

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../shared/runner.js';
import { parseJSON } from '../../shared/utils.js';
import { checkGmail, downloadAttachment, detectSupplier, parseInvoice, markProcessed } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

await run({
  agentId: 'coo-01-invoice',
  promptPath: join(__dirname, 'prompt.md'),

  async execute(ctx) {
    ctx.log('Starting invoice parser — checking Gmail');

    // Step 1: Check Gmail for unprocessed invoices
    const emails = await checkGmail(ctx);

    if (emails.length === 0) {
      ctx.log('No new invoices found');
      return 'No new invoices';
    }

    ctx.log(`Processing ${emails.length} invoice emails`);
    const parsedInvoices = [];
    const errors = [];

    // Step 2: Process each invoice email
    for (const email of emails) {
      ctx.log(`Processing: "${email.subject}" from ${email.sender}`);

      try {
        // Step 2a: Download attachment
        const attachment = await downloadAttachment(ctx, email.messageId);
        if (!attachment) {
          ctx.log(`Skipping "${email.subject}" — no PDF/CSV attachment found`);
          errors.push({ subject: email.subject, error: 'No valid attachment' });
          continue;
        }

        // Step 2b: Detect supplier
        const supplier = detectSupplier(email.sender, email.subject);
        if (!supplier) {
          ctx.log(`Unknown supplier for "${email.subject}" from ${email.sender}`);
          ctx.alert(
            'warning',
            'Unknown Invoice Supplier',
            `Could not identify supplier for invoice email: "${email.subject}" from ${email.sender}. Manual review needed.`
          );
          errors.push({ subject: email.subject, error: 'Unknown supplier' });
          continue;
        }

        ctx.log(`Detected supplier: ${supplier.name}`);

        // Step 2c: Parse the invoice
        const result = await parseInvoice(ctx, supplier, attachment.buffer, attachment.mimeType, email.subject);

        // Step 2d: Check confidence and warn if low
        if (result.confidence === 'low') {
          ctx.alert(
            'warning',
            `Low Confidence Invoice: ${supplier.name}`,
            `Invoice "${email.subject}" parsed with LOW confidence. ${result.confidenceNotes || 'Manual review recommended.'} (${result.products.length} products, $${result.totalCost})`
          );
        }

        // Step 2e: Mark email as processed
        await markProcessed(ctx, email.messageId);

        parsedInvoices.push({
          ...result,
          emailSubject: email.subject,
          emailDate: email.date,
          emailMessageId: email.messageId,
          filename: attachment.filename,
        });

        ctx.log(`Parsed ${result.products.length} products from ${supplier.name} (confidence: ${result.confidence})`);
      } catch (err) {
        ctx.log(`Error processing "${email.subject}": ${err.message}`);
        errors.push({ subject: email.subject, error: err.message });
        ctx.alert(
          'warning',
          'Invoice Parse Error',
          `Failed to parse invoice "${email.subject}": ${err.message}`
        );
      }
    }

    // Step 3: If we parsed any invoices, send to Anthropic for validation
    if (parsedInvoices.length === 0) {
      const errSummary = errors.map(e => `"${e.subject}": ${e.error}`).join('; ');
      ctx.log(`No invoices successfully parsed. Errors: ${errSummary}`);
      return `No invoices parsed. ${errors.length} errors: ${errSummary}`;
    }

    ctx.log(`Sending ${parsedInvoices.length} parsed invoices to Anthropic for validation`);
    const validationPayload = { invoices: parsedInvoices };

    const result = await ctx.anthropic(
      `Validate and sanity-check the following parsed invoice data:\n\n${JSON.stringify(validationPayload, null, 2)}`
    );

    ctx.log(`Validation response received (${result.tokensIn} in, ${result.tokensOut} out)`);

    // Step 4: Parse validation response
    let jsonStr = result.content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const validation = parseJSON(jsonStr);
    if (!validation) {
      throw new Error(`Invalid validation response: ${result.content.substring(0, 200)}`);
    }

    // Step 5: Write output
    const output = {
      ...validation,
      parsedAt: new Date().toISOString(),
      rawInvoices: parsedInvoices,
      parseErrors: errors,
    };
    ctx.writeOutput('parsed_invoices', output);
    ctx.log('Parsed invoices written to agent_outputs');

    // Step 6: Queue summary alert
    const totalProducts = parsedInvoices.reduce((sum, inv) => sum + inv.products.length, 0);
    const suppliers = [...new Set(parsedInvoices.map(inv => inv.supplier))].join(', ');
    ctx.alert(
      'info',
      'Invoices Parsed',
      `Parsed ${parsedInvoices.length} invoices: ${totalProducts} products from ${suppliers}`
    );

    // Step 7: Queue warnings for any issues
    if (errors.length > 0) {
      ctx.alert(
        'warning',
        'Invoice Parse Issues',
        `${errors.length} emails could not be parsed: ${errors.map(e => e.error).join(', ')}`
      );
    }

    const lowConfidence = parsedInvoices.filter(inv => inv.confidence === 'low');
    if (lowConfidence.length > 0) {
      ctx.alert(
        'warning',
        'Low Confidence Invoices',
        `${lowConfidence.length} invoices parsed with low confidence — manual review recommended`
      );
    }

    // Return summary
    const summary = validation.summary
      || `Parsed ${parsedInvoices.length} invoices: ${totalProducts} products from ${suppliers}`;
    return summary;
  },
});
