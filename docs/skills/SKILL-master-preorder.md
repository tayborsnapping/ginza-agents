# SKILL-master-preorder
## Purpose: Managing the Ginza Master Pre-Order Sheet

---

## What This Skill Does

When Taybor uploads a new pre-order export from any distributor, this skill merges new products into `Ginza_Master_PreOrder_Sheet.xlsx`. Existing rows are never deleted — new products are appended and existing products are updated if quantities or dates have changed.

---

## The Spreadsheet: `Ginza_Master_PreOrder_Sheet.xlsx`

**3 tabs:**

1. **Master Pre-Orders** — One row per pre-ordered product. All three distributors combined. Columns: SKU, Product Name, Vendor, Product Line/Type, Release Date, Order Due Date, Qty Ordered, Qty Confirmed, Price, Extended Price, Status, Notes.
2. **Monthly Spend Summary** — Pivot: Month (by Release Date), Total Products Releasing, Total Expected Spend. Auto-calculated.
3. **Distributor Summary** — One row per vendor: Total SKUs on order, Total Spend, Next Release Date.

**Current state (as of March 21, 2026):**
- 138 products: GTS (50), Southern Hobby (46), Peachstate (42)
- Known issue: some 2022–2025 historical release dates need cleanup/archiving

---

## Trigger

Run this skill when Taybor uploads a pre-order export file from any distributor. He will say something like "here's the new GTS pre-order sheet" or "updated Southern pre-orders."

Also run the monthly reminder check on the 1st of each month (see Monthly Reminder section below).

---

## Input File Formats

**Southern Hobby** (Excel, 8 columns):
`Product Name | Item # (SKU) | Qty | Price | Extended Price | List Price | Release Date (MM/DD/YYYY) | Order Due`
- Skip rows where Qty = 0 AND Order Due = "Now" (already fulfilled)

**GTS Distribution** (CSV, 11 columns):
`SALES_ORDER_NUMBER | SKU | NAME | PRE-ORDER QTY | ALLOCATED | DAYS REMAINING | PRE-ORDER DUE DATE | RELEASE DATE | PRODUCT LINE | MANUFACTURER | GROSS PRICE`
- **IGNORE the ALLOCATED column** — unreliable per GTS rep David Lipowski
- PRODUCT LINE: CG = card game, SU = supplies
- NAME is ALL CAPS — convert to title case for display

**Peachstate Hobby** (Excel, 7 columns):
`SKU | Name | Release Date (MM/DD/YYYY) | Price | MSRP | Qty | Total`

---

## Step-by-Step Merge Process

### 1. Load existing spreadsheet
Read `Ginza_Master_PreOrder_Sheet.xlsx` from the working folder.

### 2. Parse the uploaded export
Extract all products from the incoming file using the format rules above.

### 3. For each product in the new export:

**Check if SKU already exists in Master Pre-Orders for that vendor:**

- **If SKU exists:** Compare key fields. If Release Date, Qty, or Price has changed, update those fields and add a note like "Updated [date]: qty changed 5→8". Do not delete the old row — update in place.
- **If SKU is new:** Append a new row with Status = "On Order".

### 4. Map fields to Master Pre-Orders columns

| Master Column | Southern Source | GTS Source | Peachstate Source |
|---|---|---|---|
| SKU | Item # | SKU | SKU |
| Product Name | Product Name | NAME (title-cased) | Name |
| Vendor | "Southern Hobby" | "GTS Distribution" | "Peachstate" |
| Product Line/Type | Classify per 25 Shopify types | PRODUCT LINE (CG/SU → map to type) | Classify per 25 Shopify types |
| Release Date | Release Date | RELEASE DATE | Release Date |
| Order Due Date | Order Due | PRE-ORDER DUE DATE | blank |
| Qty Ordered | Qty | PRE-ORDER QTY | Qty |
| Qty Confirmed | blank (fill when allocation confirmed) | blank | blank |
| Price | Price | GROSS PRICE | Price |
| Extended Price | Extended Price | Qty × Price | Total |
| Status | "On Order" | "On Order" | "On Order" |
| Notes | blank | MANUFACTURER | blank |

### 5. Flag anomalies
Before saving, flag any of the following to Taybor:
- Release dates in the past (already released — may need to be archived)
- Products with Qty = 0 that aren't "Now" fulfillments
- Duplicate SKUs within the same vendor
- Price changes on existing products (show old vs. new)

### 6. Save and overwrite
Save updated file to working folder as `Ginza_Master_PreOrder_Sheet.xlsx`. Always overwrite — no versioned copies.

### 7. Report to Taybor
Surface a summary in the conversation:
> "Pre-Order Sheet updated: [X] new products added, [Y] existing products updated, [Z] flagged for review. Next release: [product name] on [date]."

---

## Status Values

| Status | Meaning |
|---|---|
| On Order | Pre-ordered, not yet confirmed |
| Confirmed | Allocation confirmed — update Qty Confirmed |
| Shipped | Invoice received, product in transit |
| Received | Product arrived in store |
| Archived | Released and sold through, or cancelled |

---

## Cleanup: Archiving Historical Entries

**Known issue:** The current sheet has 2022–2025 release dates from historical distributor exports.

**Rule:** Any product with Release Date before January 1, 2026 should be flagged for archiving. When Taybor confirms, move those rows to a hidden "Archive" tab (create if it doesn't exist) rather than deleting them.

Do not auto-archive — always confirm with Taybor first.

---

## Monthly Reminder (1st of Each Month)

On the 1st of every month, prompt Taybor:
> "It's the 1st — time to upload new pre-order sheets from GTS, Southern Hobby, and Peachstate. Drop them here when you have them and I'll merge everything in."

---

## Confirmed Allocation Workflow

When Taybor receives a confirmed allocation from a distributor (usually a separate file or email):
1. Match products by SKU and vendor
2. Update the Qty Confirmed column
3. Calculate delta: Qty Confirmed vs. Qty Ordered
4. Surface a delta summary:
   > "Allocation confirmed for [X] products. [Y] received full qty, [Z] short-shipped. Total spend delta: $[amount]. Details: [table of changes]."
5. Update Status to "Confirmed" for those rows

---

## Error Handling

| Problem | Action |
|---|---|
| SKU appears in both GTS and Southern | Keep as separate rows (different vendors) — this is normal |
| Release date is in the past | Flag for archiving — do not auto-delete |
| GTS ALLOCATED column present | Ignore it entirely |
| Price blank in source file | Leave blank, add note "Price TBD" |
| Qty = 0, Order Due ≠ "Now" (Southern) | Keep row, flag as "Zero qty — confirm with Taybor" |
