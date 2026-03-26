# SKILL-invoice-history
## Purpose: Maintaining the Ginza Invoice History Spreadsheet

---

## What This Skill Does

Every time a new invoice is processed (any vendor), this skill updates `Ginza_Invoice_History.xlsx` with the new data. The file is a running record — never rebuilt from scratch. New rows are appended to existing data.

---

## The Spreadsheet: `Ginza_Invoice_History.xlsx`

**5 tabs:**

1. **Invoice Summary** — One row per invoice. Columns: Invoice #, Vendor, Invoice Date, Processed Date, Subtotal, Tax/Fees, Total, Line Item Count, Notes.
2. **Line Items** — One row per product per invoice. Columns: Invoice #, Vendor, Invoice Date, SKU, Product Name, Product Type, Qty, Unit Price, Ext Price, COGS (if available).
3. **Monthly Spend** — Pivot summary: Month, Vendor, Total Spend. Auto-calculated from Line Items via formulas.
4. **Product Type Spend** — Pivot summary: Product Type, Total Units, Total Spend. Auto-calculated from Line Items.
5. **Distributor Summary** — One row per vendor: Total Invoices, Total Spend, Avg Invoice Value, Date Range.

**Current state (as of March 21, 2026):**
- 50 invoices: Southern Hobby (24), GTS (23 summary-only), Peachstate (3)
- 305 line items
- Google Drive File ID: `1kF30VjtFA6dnRKOuPS2QkcHbVqJsDMlw`

---

## Trigger

Run this skill immediately after any invoice is parsed and a Shopify import CSV is drafted. Do not wait for Taybor to approve the Shopify import — update the history as soon as line items are confirmed.

---

## Step-by-Step Process

### 1. Load the existing spreadsheet
- Read `Ginza_Invoice_History.xlsx` from the working folder.
- If it doesn't exist locally, note that it needs to be re-imported from Google Drive (File ID: `1kF30VjtFA6dnRKOuPS2QkcHbVqJsDMlw`).

### 2. Check for duplicates
- Before appending, check the Invoice Summary tab for the incoming invoice number.
- If it already exists, **stop and flag to Taybor** — do not create a duplicate entry.

### 3. Append to Invoice Summary tab
Add one row:
| Field | Source |
|---|---|
| Invoice # | From invoice |
| Vendor | Southern Hobby / GTS Distribution / Peachstate / Japanese Supplier |
| Invoice Date | From invoice |
| Processed Date | Today's date |
| Subtotal | Invoice subtotal (before fees) |
| Tax/Fees | Handling + credit card fees (Southern), or 0 if not applicable |
| Total | Invoice total |
| Line Item Count | Count of products shipped (not ordered) |
| Notes | Any flags (e.g., "Gachapon excluded," "CASE qty unconfirmed," "GTS summary-only") |

### 4. Append to Line Items tab
One row per product. Map fields as follows:

**Southern Hobby:**
- SKU: From invoice SKU line
- Product Name: Expanded (no ALL CAPS abbreviations)
- Product Type: Classify per the 25 Shopify product types
- Qty: Shipped qty (not Ordered)
- Unit Price: From invoice
- Ext Price: Calculated (Qty × Unit Price)

**GTS Distribution:**
- If PDF parsed: full line items as above
- If CSV only (summary): one row with SKU="SUMMARY", Product Name="GTS Invoice [#] — Summary Only", Qty=blank, Unit Price=blank, Ext Price=invoice total
- Flag in Notes: "GTS summary-only — line items not available"

**Peachstate:**
- SKU, Product Name, UPC, Qty, Unit Price, Ext Price all available from invoice
- Include UPC in Notes field

**Japanese Suppliers:**
- SKU: JP-[BRAND]-[IDENTIFIER]-[SUFFIX] format
- Product Name: Translated English name from Taybor's spreadsheet
- Product Type: From Category column in Taybor's spreadsheet
- Qty: From spreadsheet
- Unit Price: "Cost on Arrival Per Item" column
- Ext Price: Unit Price × Qty
- Notes: "Gachapon excluded" if applicable

### 5. Save and overwrite
- Save the updated file to the working folder as `Ginza_Invoice_History.xlsx`.
- Always overwrite — do not create versioned copies.

### 6. Report to Taybor
After updating, surface a one-line summary in the conversation:
> "Invoice History updated: [Vendor] Invoice #[number] added — [X] line items, $[total]. Running total: [N] invoices, $[cumulative spend] tracked."

---

## Known Limitations

- **GTS PDF line-item parser not yet complete.** GTS invoices are currently logged as summary-only. When `parse_gts_pdf()` is built, backfill GTS line items from the 23 existing summary rows.
- **COGS column:** Leave blank for now. Will be populated in a future build when Shopify InventoryItem sync is added.

---

## Error Handling

| Problem | Action |
|---|---|
| Duplicate invoice number | Stop. Flag to Taybor. Do not append. |
| Missing Qty Shipped (Southern) | Use Qty Ordered as fallback, flag in Notes |
| DISP/CASE unit ambiguity (Southern) | Log what's on the invoice, flag in Notes for Taybor to confirm |
| #DIV/0! rows (Japanese) | Skip entirely |
| GTS PDF available but parser not built | Log as summary-only, flag in Notes |
