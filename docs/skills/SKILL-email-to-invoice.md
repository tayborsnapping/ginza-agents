# SKILL-email-to-invoice
## Purpose: Email Monitoring and Invoice Processing Pipeline

---

## What This Skill Does

Monitors `info@ginzatcg.com` for incoming vendor invoice emails. When a new invoice is detected, it downloads the attachment, identifies the vendor, parses the invoice, drafts a Shopify import CSV, and presents everything to Taybor for approval before anything is saved or acted on.

**Nothing is finalized without Taybor's explicit approval.**

---

## Email Account

- **Monitor:** `info@ginzatcg.com` (connected via Gmail MCP)
- **Old address (ignore):** `ginzaclaw@gmail.com` — decommissioned

---

## Vendor Detection: Subject Line Patterns

| Vendor | Subject Pattern | Example |
|---|---|---|
| Southern Hobby | "OE Invoice for Order #:XXXXXXXX-00" | "OE Invoice for Order #:50736552-00" |
| Peachstate | "Peachstate Hobby Distribution, LLC Invoice # XXXXXX" | "Peachstate Hobby Distribution, LLC Invoice # 754426" |
| GTS Distribution | "GTS Sales Invoice INVXXXXXXXX" | "GTS Sales Invoice INV01076993" |
| GTS (forwarded) | "Fwd: GTS Sales Invoice INVXXXXXXXX" | Same, with "Fwd: " prefix |

If the subject doesn't match any pattern, do not process. Flag to Taybor:
> "Unrecognized email in info@ginzatcg.com from [sender] — subject: '[subject]'. Is this an invoice I should process?"

---

## Trigger

This skill runs when Taybor says something like:
- "Check for new invoices"
- "Any new emails?"
- "Did we get anything from [vendor]?"
- "Check the inbox"

Or when Taybor sets up a scheduled check (see Scheduling section below).

---

## Step-by-Step Pipeline

### 1. Search Gmail for unprocessed invoice emails
Use Gmail MCP to search `info@ginzatcg.com` for emails matching vendor subject patterns.

Search query: `subject:(OE Invoice OR "Peachstate Hobby Distribution" OR "GTS Sales Invoice") in:inbox`

Filter to emails not yet processed (check against Invoice History — if invoice # already exists, skip).

### 2. For each new invoice email found:

#### A. Identify vendor and extract invoice number
- Parse subject line to determine vendor
- Extract invoice number from subject

#### B. Download attachment
- Locate the PDF attachment in the email
- Save to working folder with standardized name:
  - Southern Hobby: `southern_{invoice_number}.pdf`
  - Peachstate: `peachstate_{invoice_number}.pdf`
  - GTS: `gts_{invoice_number}.pdf`

#### C. Parse the invoice
Apply the appropriate parsing rules from `SKILL-invoice-to-shopify.md`:
- **Southern Hobby:** Use Shipped qty, expand abbreviations, flag DISP/CASE
- **GTS:** Use CSV summary if PDF parser not available; note summary-only limitation
- **Peachstate:** Parse all fields including UPC barcodes

#### D. Draft the Shopify import CSV
Follow all rules in `SKILL-invoice-to-shopify.md`:
- Product type classification
- SEO title and description formatting
- Price: blank for American distributors
- Barcode: populate from invoice UPC (Peachstate) or JAN lookup (Japanese)
- Exclude Gachapon by default

Save draft as: `{vendor}_{invoice_number}_shopify_import.csv` in working folder.

#### E. Update Invoice History
Run `SKILL-invoice-history` to append the new invoice to `Ginza_Invoice_History.xlsx`.

### 3. Present to Taybor for approval

Surface a summary in the conversation:

```
📬 New invoice detected: [Vendor] Invoice #[number]
Date: [invoice date]
Products: [X] items
Total: $[amount]

Draft Shopify import ready: [X] products
Open questions: [list any flags — missing barcodes, CASE qty, etc.]

[View draft CSV] → [filename]

Ready to import? Say "approve [invoice number]" to confirm, or let me know what needs to change.
```

**Do not save to Google Drive, push to Shopify, or mark as processed until Taybor explicitly approves.**

### 4. On approval
When Taybor says "approve" or "looks good":
- Confirm the Shopify import CSV is final
- Remind Taybor to import via Shopify Admin → Products → Import
- Mark the email as processed (apply a Gmail label: "Vendors/Invoices/Processed")
- Note the approval in the conversation for the record

---

## Scheduling

To run this automatically, use the Cowork scheduled task system. Suggested cadence: daily check, or on-demand only.

When scheduled, if new invoices are found, surface the alert in the Claude mobile app conversation.

If no new invoices: no notification needed (silent pass).

---

## Duplicate Prevention

Before processing any email:
1. Extract invoice number from subject
2. Check `Ginza_Invoice_History.xlsx` Invoice Summary tab for that invoice number
3. If already logged → skip, do not re-process
4. If not found → proceed

---

## Japanese Supplier Invoices

Japanese suppliers do not email invoices in the same format. Taybor handles Japanese invoices manually by uploading his translated spreadsheet. This pipeline does not monitor for Japanese invoices.

When Taybor uploads a Japanese invoice spreadsheet directly, say: "I'll process this as a Japanese supplier invoice" and follow Japanese parsing rules from `SKILL-invoice-to-shopify.md`.

---

## Error Handling

| Problem | Action |
|---|---|
| No PDF attachment found | Flag to Taybor: "Invoice email from [vendor] had no attachment — can you forward the PDF?" |
| Invoice already in history | Skip silently. If Taybor asks, confirm it was already processed. |
| Unrecognized subject line | Flag to Taybor with full subject and sender |
| GTS PDF — parser not available | Process as summary-only, note limitation in draft |
| DISP/CASE unit ambiguity | Include in draft with flag, wait for Taybor to confirm before finalizing |
| Missing barcode | Leave blank, note "Barcode needed — check packaging on arrival" |

---

## Gmail Label Convention

| Label | Meaning |
|---|---|
| `Vendors/Invoices/Processed` | Email has been fully processed and Shopify draft approved |
| `Vendors/Invoices/Pending` | Draft generated, awaiting Taybor approval |
| `Vendors/Invoices/Error` | Processing failed — needs manual attention |
