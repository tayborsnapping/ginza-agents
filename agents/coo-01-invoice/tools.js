// agents/coo-01-invoice/tools.js — Gmail check, attachment download, supplier detection, invoice parsing
// Uses shared/gmail.js for Gmail API, pdf-parse for PDFs, papaparse for CSVs.
// LLM (via ctx.anthropic) does the heavy lifting of understanding varied invoice formats.

import { createRequire } from 'module';
import { listMessages, getMessage, getAttachment, addLabel } from '../../shared/gmail.js';
import { parseJSON, stripCodeFences } from '../../shared/utils.js';
import {
  SHOPIFY_PRODUCT_TYPES,
  isValidProductType,
  fuzzyMatchProductType,
  classifyProductType,
} from '../../shared/product-types.js';
import Papa from 'papaparse';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

// Import all supplier parser configs
import southernHobby from './parsers/southern-hobby.js';
import gts from './parsers/gts.js';
import peachstate from './parsers/peachstate.js';
import japaneseImports from './parsers/japanese-imports.js';

const SUPPLIER_CONFIGS = [southernHobby, gts, peachstate, japaneseImports];

/**
 * Query Gmail for unprocessed invoice emails.
 * Returns array of { messageId, threadId, subject, sender, date }.
 */
export async function checkGmail(ctx) {
  ctx.log('Checking Gmail for unprocessed invoices');
  const query = 'has:attachment -label:agent-processed subject:(invoice OR order OR shipment) newer_than:30d';
  const messages = await listMessages({ query, maxResults: 50 });

  if (messages.length === 0) {
    ctx.log('No unprocessed invoice emails found');
    return [];
  }

  ctx.log(`Found ${messages.length} candidate emails — fetching headers`);
  const results = [];

  for (const msg of messages) {
    const full = await getMessage(msg.id);
    const headers = full.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    results.push({
      messageId: msg.id,
      threadId: msg.threadId,
      subject: getHeader('Subject'),
      sender: getHeader('From'),
      date: getHeader('Date'),
    });
  }

  ctx.log(`Fetched headers for ${results.length} invoice emails`);
  return results;
}

/**
 * Download the first PDF or CSV attachment from a Gmail message.
 * Skips inline images and signatures.
 * Returns { filename, mimeType, buffer } or null if no valid attachment found.
 */
export async function downloadAttachment(ctx, messageId) {
  const message = await getMessage(messageId);
  const parts = message.payload?.parts || [];

  // Find the first PDF or CSV attachment (skip inline images, signatures)
  const validTypes = [
    'application/pdf',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/octet-stream', // sometimes CSVs come as this
  ];
  const skipTypes = ['image/', 'text/html', 'text/plain'];

  let attachmentPart = null;

  for (const part of parts) {
    const mime = (part.mimeType || '').toLowerCase();
    const filename = (part.filename || '').toLowerCase();

    // Skip inline/non-attachment parts
    if (!part.filename || !part.body?.attachmentId) continue;
    if (skipTypes.some(t => mime.startsWith(t))) continue;

    // Accept PDFs
    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      attachmentPart = part;
      break;
    }

    // Accept CSVs
    if (mime.includes('csv') || filename.endsWith('.csv')) {
      attachmentPart = part;
      break;
    }

    // Accept generic octet-stream if filename looks like PDF/CSV
    if (mime === 'application/octet-stream' && (filename.endsWith('.pdf') || filename.endsWith('.csv'))) {
      attachmentPart = part;
      break;
    }
  }

  if (!attachmentPart) {
    ctx.log(`No PDF/CSV attachment found in message ${messageId}`);
    return null;
  }

  ctx.log(`Downloading attachment: ${attachmentPart.filename} (${attachmentPart.mimeType})`);
  const buffer = await getAttachment(messageId, attachmentPart.body.attachmentId);

  // Determine effective mime type from filename if generic
  let mimeType = attachmentPart.mimeType;
  const filename = attachmentPart.filename.toLowerCase();
  if (filename.endsWith('.pdf')) mimeType = 'application/pdf';
  else if (filename.endsWith('.csv')) mimeType = 'text/csv';

  return {
    filename: attachmentPart.filename,
    mimeType,
    buffer,
  };
}

/**
 * Detect which supplier sent the invoice based on sender email and subject.
 * Returns the matching supplier config object, or null if unknown.
 */
export function detectSupplier(sender, subject) {
  for (const config of SUPPLIER_CONFIGS) {
    if (config.match(sender, subject)) {
      return config;
    }
  }
  return null;
}

/**
 * Core invoice parsing function.
 * Extracts text from attachment, sends to Anthropic with supplier context, returns structured data.
 *
 * Returns: { products[], invoiceNumber, invoiceDate, supplier, totalCost, confidence }
 */
export async function parseInvoice(ctx, supplierConfig, attachmentBuffer, mimeType, emailSubject) {
  // Step 1: Extract text/data from the attachment
  let extractedContent;
  const isPdf = mimeType === 'application/pdf';

  if (isPdf) {
    ctx.log('Extracting text from PDF attachment');
    const parser = new PDFParse({ data: attachmentBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    extractedContent = pdfData.text;
    if (!extractedContent || extractedContent.trim().length < 20) {
      return {
        products: [],
        invoiceNumber: null,
        invoiceDate: null,
        supplier: supplierConfig.name,
        totalCost: 0,
        confidence: 'low',
        error: 'PDF text extraction returned very little content — may be a scanned/image PDF',
      };
    }
  } else {
    ctx.log('Parsing CSV attachment');
    const csvText = attachmentBuffer.toString('utf-8');
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 0) {
      ctx.log(`CSV parse warnings: ${parsed.errors.length} errors`);
    }
    extractedContent = JSON.stringify(parsed.data, null, 2);
  }

  // Step 2: Build the LLM prompt
  const prompt = `You are parsing a supplier invoice for Ginza Marketplace, a Japanese TCG and anime retail store in Ann Arbor, Michigan.

## Supplier: ${supplierConfig.name}
## Currency: ${supplierConfig.currency}
## Email Subject: ${emailSubject}

## Supplier Format Hints
${supplierConfig.formatHints}

## Product Type Mapping Rules
${supplierConfig.typeDetectionHints}

## Ginza's Valid Shopify Product Types
${SHOPIFY_PRODUCT_TYPES.join(', ')}

## Instructions
Parse the following invoice data and return a JSON object with this exact structure:

{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD string or null",
  "supplier": "${supplierConfig.name}",
  "currency": "${supplierConfig.currency}",
  "products": [
    {
      "title": "Product name as it should appear in Shopify",
      "sku": "Supplier SKU/item number or null",
      "quantity": 1,
      "unitCost": 10.99,
      "extendedCost": 10.99,
      "productType": "One of Ginza's valid Shopify product types",
      "barcode": "UPC/EAN barcode if visible in invoice data, or null",
      "notes": "Any relevant notes (e.g., pre-order, backorder, special edition)"
    }
  ],
  "subtotal": 0.00,
  "shipping": 0.00,
  "tax": 0.00,
  "totalCost": 0.00,
  "confidence": "high|medium|low",
  "confidenceNotes": "Explain any uncertainty or ambiguity"
}

Rules:
- Every product MUST have title, quantity, unitCost, and productType
- productType MUST be one of Ginza's valid Shopify product types listed above
- If a product doesn't clearly map to a type, use "Other" and add a note
- Extract UPC/EAN barcodes if they appear in the invoice (look for 12-13 digit numeric codes, columns labeled UPC/EAN/Barcode). Set barcode to null if not found.
- unitCost is the per-unit cost FROM THE SUPPLIER (not retail price)
- extendedCost = quantity * unitCost
- Set confidence to "high" if the data is clear tabular data with all fields
- Set confidence to "medium" if some fields required interpretation
- Set confidence to "low" if the format was unexpected or many fields are uncertain
${supplierConfig.currency === 'JPY' ? '- All prices are in JPY. Note this in confidenceNotes and flag for manual USD conversion.' : ''}

Return ONLY the JSON object, no other text.

## Invoice Content
${extractedContent}`;

  // Step 3: Call Anthropic
  ctx.log(`Sending ${extractedContent.length} chars to Anthropic for parsing`);
  const result = await ctx.anthropic(prompt, { maxTokens: 4096 });

  // Step 4: Parse the JSON response (strip markdown fences if present)
  const parsed = parseJSON(stripCodeFences(result.content));
  if (!parsed) {
    throw new Error(`Failed to parse Anthropic invoice response as JSON: ${result.content.substring(0, 200)}`);
  }

  // Step 5: Validate required fields on each product
  const validProducts = [];
  const warnings = [];

  for (let i = 0; i < (parsed.products || []).length; i++) {
    const p = parsed.products[i];
    if (!p.title || p.quantity == null || p.unitCost == null || !p.productType) {
      warnings.push(`Product ${i + 1} missing required fields: ${JSON.stringify(p)}`);
      continue;
    }
    if (p.unitCost <= 0) {
      warnings.push(`Product "${p.title}" has zero or negative cost: $${p.unitCost}`);
    }
    // Type correction cascade: exact match → fuzzy match → LLM classification → "Other"
    if (!isValidProductType(p.productType)) {
      const original = p.productType;

      // Tier 1: Fuzzy match
      const fuzzyResult = fuzzyMatchProductType(p.productType);
      if (fuzzyResult.match) {
        p.productType = fuzzyResult.match;
        warnings.push(`Auto-corrected type for "${p.title}": "${original}" → "${p.productType}" (fuzzy match, score=${fuzzyResult.score.toFixed(2)})`);
      } else {
        // Tier 2: LLM classification
        try {
          const classified = await classifyProductType(ctx, p.title, p.productType);
          p.productType = classified;
          warnings.push(`Auto-corrected type for "${p.title}": "${original}" → "${p.productType}" (LLM classification)`);
        } catch (err) {
          // Tier 3: Hard default
          p.productType = 'Other';
          warnings.push(`Failed to classify type for "${p.title}": "${original}" → defaulted to "Other" (${err.message})`);
        }
      }
    }
    validProducts.push(p);
  }

  if (warnings.length > 0) {
    ctx.log(`Validation warnings: ${warnings.join('; ')}`);
  }

  // Step 6: Apply markup rules to calculate suggested retail prices
  for (const p of validProducts) {
    const type = (p.productType || '').toLowerCase();
    let markup = supplierConfig.markupRules.default;

    if (type.includes('single')) markup = supplierConfig.markupRules.singles || markup;
    else if (type.includes('sealed')) markup = supplierConfig.markupRules.sealed || markup;
    else if (type.includes('supplies')) markup = supplierConfig.markupRules.supplies || markup;
    else if (type.includes('figure')) markup = supplierConfig.markupRules.figures || markup;

    p.suggestedRetail = Math.round(p.unitCost * markup * 100) / 100;
    p.markupApplied = markup;
  }

  // Verify total matches sum of line items
  const calculatedTotal = validProducts.reduce((sum, p) => sum + (p.extendedCost || p.unitCost * p.quantity), 0);
  const reportedTotal = parsed.totalCost || 0;
  if (reportedTotal > 0 && Math.abs(calculatedTotal - reportedTotal) / reportedTotal > 0.05) {
    warnings.push(`Total discrepancy: reported $${reportedTotal} vs calculated $${calculatedTotal.toFixed(2)} (>${5}% difference)`);
  }

  return {
    products: validProducts,
    invoiceNumber: parsed.invoiceNumber || null,
    invoiceDate: parsed.invoiceDate || null,
    supplier: supplierConfig.name,
    currency: supplierConfig.currency,
    totalCost: parsed.totalCost || calculatedTotal,
    subtotal: parsed.subtotal || null,
    shipping: parsed.shipping || null,
    tax: parsed.tax || null,
    confidence: parsed.confidence || 'medium',
    confidenceNotes: parsed.confidenceNotes || null,
    warnings,
  };
}

/**
 * Mark an email as processed by adding the 'agent-processed' label.
 */
export async function markProcessed(ctx, messageId) {
  ctx.log(`Marking message ${messageId} as agent-processed`);
  await addLabel(messageId, 'agent-processed');
}
