# Session 7 — COO-01 Invoice Parser

Read these files before writing any code:
- `CLAUDE.md` — project conventions
- `Docs/architecture.md` — full system architecture, DB schema, shared module specs
- `Docs/session-plan.md` — Session 7 scope and exit criteria
- `shared/runner.js` — the agent execution framework (COO-01 uses this)
- `shared/gmail.js` — Gmail API client (already built — COO-01 calls listMessages, getMessage, getAttachment, addLabel)
- `shared/db.js` — database helpers
- `agents/cfo-03-margin-watch/index.js` — reference for a runner-based agent with Anthropic JSON parsing
- `agents/cfo-01-weekly-report/index.js` — reference for markdown fence stripping pattern

## Prerequisites (Taybor must complete before this session)
1. Google Cloud project created with Gmail API enabled
2. OAuth2 credentials (Desktop app type) created
3. Consent flow completed to get refresh token for info@ginzatcg.com
4. `.env` has: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

**Before building the agent, verify Gmail credentials work:**
```bash
node -e "import('./shared/gmail.js').then(g => g.listMessages({ query: 'newer_than:7d', maxResults: 5 }).then(m => console.log('Found', m.length, 'messages')))"
```
If this fails, stop and fix credentials before proceeding.

## Important design decisions

### PDF and CSV parsing
- Install `pdf-parse` for extracting text from PDF attachments
- Install `papaparse` for parsing CSV/Excel-exported CSV attachments
- Run: `npm install pdf-parse papaparse`
- The approach: extract raw text/data from attachments → send to Anthropic with supplier context → get structured JSON back
- The LLM does the heavy lifting of understanding varied invoice formats; supplier configs provide hints and validation rules

### Supplier detection
- Detect supplier from the sender email address and/or email subject line — NOT from the attachment content
- Each supplier config exports a `match()` function that checks the sender/subject

## What to build

### 1. Install dependencies
```bash
npm install pdf-parse papaparse
```

### 2. Supplier parser configs: `agents/coo-01-invoice/parsers/`

Each parser file exports an object with:
```javascript
export default {
  name: 'Southern Hobby',            // Human-readable name
  match(sender, subject) { ... },    // Returns true if this invoice is from this supplier
  senderPatterns: ['southernhobby'], // Email domain substrings
  attachmentTypes: ['pdf', 'csv'],   // Expected attachment formats
  currency: 'USD',
  // Hints for the LLM about this supplier's invoice format:
  formatHints: `
    Southern Hobby invoices are typically PDF with a table of line items.
    Columns usually include: Item Number, Description, Qty Ordered, Qty Shipped, Unit Price, Extended Price.
    Product descriptions include the product line (Pokemon, Magic, Yu-Gi-Oh, etc.).
    Look for "Invoice Total" at the bottom for the total.
  `,
  // Markup rules: cost → retail price
  markupRules: {
    default: 1.5,           // 50% markup as default
    singles: 2.0,           // 100% markup for singles (TCG singles have high margin)
    sealed: 1.35,           // 35% markup for sealed product
    supplies: 1.5,          // 50% markup for supplies
  },
  // Product type detection hints for Anthropic
  typeDetectionHints: `
    Map products to Ginza's Shopify product types based on the description:
    - Booster boxes, ETBs, collection boxes → "TCG Sealed - English"
    - Individual cards or "single" → "Single: Pokemon Eng" (or MTG, One Piece, etc. based on game)
    - Sleeves, binders, deck boxes, playmats → "TCG Supplies"
    - Figures, statues → "Figures"
  `,
};
```

Create these four files:
- **`southern-hobby.js`** — Southern Hobby Supply (major US TCG distributor). Sender contains "southernhobby". Invoices are PDF. USD pricing. Carries Pokemon, MTG, Yu-Gi-Oh, Dragon Ball, One Piece sealed and accessories.
- **`gts.js`** — GTS Distribution (major US hobby distributor). Sender contains "gts". Invoices can be PDF or CSV. USD pricing. Carries all major TCG lines plus board games, figures, and collectibles.
- **`peachstate.js`** — Peachstate Hobby Distribution. Sender contains "peachstate". Invoices are PDF. USD pricing. Primarily Pokemon and anime-adjacent products.
- **`japanese-imports.js`** — Japanese import suppliers (multiple possible senders). Sender may contain common JP distributor domains. Invoices may be PDF. **JPY pricing** — include a `currency: 'JPY'` field and note in formatHints that prices must be converted to USD. Products map to Japanese-specific types ("TCG Sealed - Japanese", "Single: Pokemon Jp"). Include a placeholder exchange rate note — the agent should flag that JPY invoices need manual exchange rate confirmation.

### 3. `tools.js` — Gmail check, attachment download, supplier detection, parsing

Functions to implement:

- **`checkGmail(ctx)`** — Query Gmail for unprocessed invoice emails. Use query: `has:attachment -label:agent-processed subject:(invoice OR order OR shipment) newer_than:30d`. Returns array of `{ messageId, threadId, subject, sender, date }`.

- **`downloadAttachment(ctx, messageId)`** — Get the first PDF or CSV attachment from a message. Use `shared/gmail.js` getMessage to find attachment parts, then getAttachment to download. Returns `{ filename, mimeType, buffer }`. Skip inline images and signatures.

- **`detectSupplier(sender, subject)`** — Import all parser configs from `./parsers/`. Iterate and call each `match(sender, subject)`. Return the matching config object, or `null` if no match (unknown supplier).

- **`parseInvoice(ctx, supplierConfig, attachmentBuffer, mimeType, emailSubject)`** — The core parsing function:
  1. Extract text: if PDF, use `pdf-parse` to get text; if CSV, use `papaparse` to parse rows
  2. Build a prompt for Anthropic that includes:
     - The supplier's `formatHints` and `typeDetectionHints`
     - The extracted text/data
     - The email subject line (often contains invoice # and date)
     - Ginza's full list of Shopify product types (see below)
     - Instructions to return a structured JSON array of products
  3. Call `ctx.anthropic()` with this prompt
  4. Parse the JSON response (strip markdown fences, use parseJSON)
  5. Validate: each product must have at minimum `title`, `quantity`, `unitCost`, `productType`
  6. Apply markup rules from the supplier config to calculate suggested retail price
  7. Return `{ products[], invoiceNumber, invoiceDate, supplier, totalCost, confidence }`

  The `confidence` field should be 'high' if Anthropic found clear tabular data, 'medium' if some fields were ambiguous, 'low' if the format was unexpected.

- **`markProcessed(ctx, messageId)`** — Call `shared/gmail.js` addLabel to tag as 'agent-processed'.

### Ginza's Shopify product types (include in the LLM parsing prompt):
```
Single: Pokemon Eng, Single: Pokemon Jp, Single: One Piece, Single: MTG,
Single: Dragon Ball, Single: Yu-Gi-Oh, Single: Lorcana, Single: Flesh and Blood,
Single: Union Arena, Single: Digimon, Single: Weiss Schwarz, Single: Vanguard,
TCG Sealed - English, TCG Sealed - Japanese,
TCG Supplies, Blind Boxes, Model Kits, Figures, Plushes,
Apparel, Bags, Stickers, Pins, Food & Drink, Home Goods, Other
```

### 4. `prompt.md` — System prompt for invoice parsing oversight

- Role: COO-01, Invoice Parser for Ginza Marketplace
- Uses `{{datetime}}` and `{{last_run}}` template variables
- Context: COO-01 processes supplier invoices arriving at info@ginzatcg.com. Parsed data is consumed by COO-02 (Shopify Product Entry) to create/update listings.
- Tell the LLM it receives a summary of parsed invoices and should validate/sanity-check the results
- Output format: JSON with parsed invoices array, warnings about data quality, and a summary
- Rules:
  - Flag any product with zero or negative cost
  - Flag any invoice where total doesn't match sum of line items (>5% discrepancy)
  - Flag unknown product types that don't match Ginza's list
  - If JPY invoice, note the exchange rate used and flag for manual confirmation
  - Keep the output concise — COO-02 needs clean data

### 5. `index.js` — Runner-based agent

- Uses `run()` from `shared/runner.js`
- Agent ID: `'coo-01-invoice'`
- Flow:
  1. Call `checkGmail()` to find unprocessed invoices
  2. If no invoices found, log and return early with summary "No new invoices"
  3. For each invoice email:
     a. Download attachment via `downloadAttachment()`
     b. Detect supplier via `detectSupplier()`
     c. If unknown supplier: queue warning alert, skip to next
     d. Parse via `parseInvoice()`
     e. If confidence is 'low': queue warning alert for manual review
     f. Mark email as processed via `markProcessed()`
  4. Collect all parsed results
  5. Send combined results to Anthropic for validation/sanity check (using the system prompt)
  6. Strip markdown fences from response, parse JSON
  7. Write `output_key='parsed_invoices'` with the full results
  8. Queue info alert: "Parsed X invoices: Y products from [suppliers]"
  9. If any parsing errors or low-confidence results, queue warning alert
  10. Return summary string

### 6. Update `ecosystem.config.js`
- Verify `coo-01-invoice` entry exists with `cron_restart: '0 8 * * *'` (Daily 8 AM ET)
- If not present, add it with `autorestart: false`

## Testing
1. **Gmail connectivity**: Verify `listMessages` returns results before building the agent
2. **Forward a test invoice**: Send a known invoice (or a sample PDF) to info@ginzatcg.com
3. **Run COO-01**: `node agents/coo-01-invoice/index.js`
4. **Verify DB output**: `sqlite3 db/ginza.db "SELECT * FROM agent_outputs WHERE output_key='parsed_invoices' ORDER BY created_at DESC LIMIT 1"`
5. **Verify alerts**: `sqlite3 db/ginza.db "SELECT * FROM alerts WHERE source_agent='coo-01-invoice' ORDER BY created_at DESC LIMIT 5"`
6. **Run CTO-01**: `node agents/cto-01-health/index.js` — confirm it sees COO-01's run
7. **If no invoices in inbox**: The agent should complete gracefully with "No new invoices" summary — this is a valid test case

## Exit criteria
- Gmail API connection verified and working
- Supplier parser configs created for all 4 suppliers
- Agent processes at least one invoice (or gracefully handles empty inbox)
- parsed_invoices written to agent_outputs with correct structure
- Unknown supplier emails trigger warning alert
- Low-confidence parses trigger warning alert
- Email labeled as 'agent-processed' after successful parsing
- PM2 config has coo-01-invoice entry
- CTO-01 can see this agent's run status
- Code committed to git
