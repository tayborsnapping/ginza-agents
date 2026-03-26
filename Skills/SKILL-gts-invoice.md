---
name: gts-invoice
description: Parse GTS Distribution invoice PDFs and produce Shopify-ready product listing drafts identical in format to Southern Hobby and Peachstate outputs. Use whenever a GTS Sales Invoice PDF is attached or referenced, or when Taybor says anything like "process this GTS invoice", "new GTS shipment", or "GTS invoice". GTS invoice emails come from billing@gtsdistribution.com with subject "GTS Sales Invoice INV########".
---

# Skill: GTS Invoice → Shopify Draft

## Overview

GTS Distribution (GAMUS LLC DBA GTS DISTRIBUTION) sends invoice PDFs via email from `billing@gtsdistribution.com`. This skill parses those PDFs and produces Shopify product listing drafts in the same format as Southern Hobby and Peachstate invoices.

## How to Trigger

- Taybor uploads or forwards a GTS PDF invoice
- Subject line matches: `GTS Sales Invoice INV########`
- Taybor says "process the GTS invoice" / "new GTS order came in"

---

## Step 1: Get the PDF

**Primary method — `ginza_tools.py` (fast, direct):**
```bash
# Search for the GTS invoice email
python3 Scripts/ginza_tools.py gmail-search 'subject:"GTS Sales Invoice INV01085285"' --max-results 1

# Download the PDF attachment (~1 second)
python3 Scripts/ginza_tools.py gmail-download <messageId> --output-dir ./invoices/
```

If Taybor uploads the PDF directly to the project folder, skip the above and use the file path directly.

---

## Step 2: Run the Parser

Use the bundled script at `Skills/scripts/parse_gts_pdf.py`:

```bash
pip install pdfplumber --break-system-packages -q
python3 "Skills/scripts/parse_gts_pdf.py" path/to/gts_INVXXXXXXXX.pdf
```

The script outputs a JSON array of line items to stdout. Capture it:

```bash
python3 Skills/scripts/parse_gts_pdf.py gts_INV01085285.pdf > /tmp/gts_items.json
```

---

## Step 3: Map Product Types and Expand Descriptions

For each parsed line item, apply these rules:

### SKU Prefix → Game Identification
| Prefix | Game |
|--------|------|
| `PKU`  | Pokémon TCG |
| `MTG` or `WOCD` | Magic: The Gathering |
| `OP`   | One Piece TCG |
| `DBZ` or `DBS` | Dragon Ball Super TCG |
| `WS`   | Weiss Schwarz |
| `BS`   | Bushiroad / misc |

### Description Abbreviation Expansion
GTS descriptions are heavily abbreviated. Expand them:

| Abbreviation | Meaning |
|---|---|
| `PU` | Pokémon |
| `S&V` | Scarlet & Violet |
| `ME01` / `ME02.5` / `ME03` | Mega Evolutions (promotional set codes) |
| `BB` | Booster Box |
| `WF` | WinFun / Display |
| `ETB` | Elite Trainer Box |
| `PRK` | Promo Retail Kit |
| `TechStickerC` | Tech Sticker Collection |
| `PosterColl` | Poster Collection |
| `TMT` | Teenage Mutant Ninja Turtles |
| `W2` | Wave 2 |
| `12ct` / `6ct` / `Xct` etc. | **Display count** — how many individual products are inside the package. A "TechStickerC 12ct" is a display box containing 12 individual Tech Sticker Collections. Always include this in the Shopify title so Taybor knows exactly what he's receiving and listing. |
| `(FREE)` | Free promotional item — $0 cost |

When the description is ambiguous, search the GTS website or ask Taybor. It is better to flag and ask than to guess a product name wrong.

### Display Count (`Xct`) Rule

When a GTS description includes a count like `6ct`, `12ct`, `4ct`, etc., this means the shipped unit is a **display box containing X individual products**. This is important for both the title and for Taybor's pricing decisions.

- Always include the count in the Shopify title — e.g. `Pokémon TCG: Tech Sticker Collection — Display (12-Count)`
- **Shopify Quantity = qty_shipped × display_count** — if 2 displays of 6 were shipped, Shopify quantity = 12
- The parser extracts the display count from the description automatically (e.g. `6ct` → 6)
- Flag it in the draft so Taybor is aware: "📦 2 displays × 6 units = 12 total"

**Examples:**
- `PosterColl6ct` → `Poster Collection — Display (6-Count)`
- `TechStickerC 12ct` → `Tech Sticker Collection — Display (12-Count)`
- `BB/WF` in context of a display → `Booster Box Display`

### Product Type Mapping
- `Booster Box`, `Booster Display`, `PRK`, `ETB`, `Elite Trainer Box`, `Bundle`, `Collector Box`, `Starter Deck`, `Trial Deck`, `Commander Deck`, `Play Booster` → **TCG Sealed - English**
- Explicitly Japanese language products → **TCG Sealed - Japanese**
- Explicitly Chinese language products → **TCG Sealed - CHINA**
- `Sleeve`, `Deck Box`, `Binder`, `Playmat`, `Toploader`, `Penny Sleeve`, `Dice` → **TCG Supplies**
- `Figure`, `Nendoroid`, `POP UP PARADE`, `Ichiban Kuji` → **Figures**
- `Model Kit`, `HG`, `MG`, `RG`, `MODEROID` → **Model Kits**
- `Plush` → **Plush**
- `Blind Box` → **Blind Boxes**
- Uncertain → flag with best guess and ask Taybor

---

## Step 4: Draft Shopify Listings

Use the standard Ginza listing format for each line item:

```
PRODUCT [n] of [total]
──────────────────────
Title:           [Clean, expanded product title — no abbreviations]
Product Type:    [From mapping above]
Description:     [2–4 sentences, SEO-optimized, no pricing]
Vendor:          GTS Distribution
Distributor SKU: [Item No from invoice]
Barcode:         [Leave blank — GTS invoices do not include UPC/JAN]
Quantity:        [Shipped qty — NOT Ordered qty]
Cost:            $[Price field from invoice — wholesale unit cost]
Price:           [BLANK — Taybor sets all prices]
Tags:            [IP name, product type, set name, "New Arrival"]
Release Date:    [Released field — flag with 📅 if future street date]
Status:          Draft
```

### Key rules
- **Never fill in Price** for GTS products — Taybor sets all prices via market research
- **Use Shipped qty**, not Ordered qty
- **Free items** (`(FREE)` in description or $0.000 Price): still create the listing, add ⚠️ flag: "Received free/promotional. No wholesale cost."
- **Future street dates**: add `📅 Street date: [date] — do not sell before this date`
- **Abbreviations**: always expand — never put abbreviated GTS descriptions into Shopify titles

---

## Step 5: Present for Approval

```
📦 PRODUCT ENTRY BATCH
Vendor: GTS Distribution
Invoice: INV########
Items: [count]
Date: [invoice date]

[All products listed here]

───────────────────────
SUMMARY
• Total items: [n]
• Product types: [list]
• Items needing your price: [n]
• ⚠️ Flags: [any free items, ambiguous descriptions, future street dates]

Reply with:
✅ to approve all and push to Shopify
✏️ [product #] to edit a specific item
❌ [product #] to skip an item
```

---

## Known Format Details (from real invoice analysis)

Confirmed from INV01085285 (Mar 2026):

- **Column x-positions** (pdfplumber `x0`): Item No ~16, Description ~98, Released ~317, Ordered ~361, Shipped ~407, SRP ~451, Price ~492, Amount ~554
- **Amount column gap**: Free items ($0.000 Price) have **no Amount entry** in the PDF. The parser handles this — do not treat missing Amount as a parsing error.
- **Price format**: Values appear as `$120.000` (3 decimal places) — strip trailing zero and treat as standard dollar amount.
- **SRP**: This is the MSRP/suggested retail. Capture it in the Cost field for context but do not use as Shopify price.
- **Released field**: This is the street date. If it is in the future relative to today, flag it.
- **Invoice totals row**: Rows containing `Product Total`, `TERMSNONCASH`, `HANDFEE`, `Tax`, `PAID AMOUNT`, `NET PAYABLE` are footer rows — skip them.
