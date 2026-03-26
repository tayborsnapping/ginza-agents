# Skill: Invoice-to-Shopify Product Entry

## Purpose

Parse supplier invoices, preorder exports, and Japanese order spreadsheets, then draft Shopify-ready product listings for Taybor's approval. This is Ginza Marketplace's primary product intake pipeline.

## When to Trigger

Activate this skill when Taybor:
- Forwards a PDF invoice from a distributor
- Sends an Excel/CSV preorder export
- Sends a Japanese supplier spreadsheet
- Says anything like "new invoice," "product entry," "got a shipment," "preorder update," "new products to upload," or "process this invoice"

## Workflow

```
1. Taybor sends file → 
2. Identify vendor and document type → 
3. Parse line items → 
4. Map each item to a Shopify product type → 
5. Draft Shopify listings (title, description, tags, product type, quantity — NO price) → 
6. Present draft batch to Taybor in conversation for review →
7. Taybor adds prices and approves → 
8. Push to Shopify via API
```

**CRITICAL: Never push anything to Shopify without explicit approval from Taybor. Always draft first.**

---

## Vendor Identification

Identify the vendor by looking at the document format:

### Southern Hobby
- **Invoice PDF:** Header says "Southern Hobby" with St. Louis or New York address. Columns: Line #, Product And Description (SKU on first line, description on second), Quantity Ordered, Quantity B/O, Quantity Shipped, Qty U/M, Unit Price, MSRP, Ext. Price
- **Preorder Excel:** 8 columns — Product Name, Item # (distributor SKU), Qty, Price (string with $), Extended Price (string with $), List Price, Release Date (string MM/DD/YYYY), Order Due (string — either a date or "Now")

### GTS Distribution
- **Invoice PDF:** Header says "GAMUS LLC DBA GTS DISTRIBUTION." Columns: Item No, Description, Released, Ordered, Shipped, SRP, Price, Amount
- **Preorder CSV:** 11 columns — SALES_ORDER_NUMBER, SKU, NAME (all caps, very descriptive), PRE-ORDER QTY, ALLOCATED (Yes/No — **IGNORE THIS COLUMN, it is unreliable per GTS rep**), DAYS REMAINING, PRE-ORDER DUE DATE (YYYY-MM-DD), RELEASE DATE (YYYY-MM-DD), PRODUCT LINE (CG = card game, SU = supplies), MANUFACTURER, GROSS PRICE (numeric)
  - **Important:** The PRODUCT LINE column is a useful shortcut for categorization — "CG" items are almost always TCG Sealed, "SU" items are almost always TCG Supplies.

### Peachstate Hobby (PHD Games)
- **Invoice PDF:** Header says "Peachstate Hobby" with Longwood FL address. Columns: NO., ITEM (SKU: Description format), UPC, QTY, UOM, MSRP, PRICE, EXT PRICE. Includes UPC barcodes.
- **Preorder Excel:** 7 columns — SKU, Name, Release Date (string MM/DD/YYYY), Price (string with $), MSRP (string with $), Qty (numeric), Total (numeric)

### Japanese Suppliers (Taybor's Formatted Spreadsheet)
- **Format:** Taybor's own spreadsheet, already translated from Japanese, with yen converted to USD and shipping costs allocated.
- **Columns:** Order (product name), Category (product type — already mapped to Shopify types), Cost (total USD), Quantity, Cost Per Unit Before Shipping Cost, Shipping Cost Added Per Item, Cost on Arrival Per Item, Item with 30% Mark up (the in-store price)
- **Key difference:** This is the ONLY format where pricing is already determined. Use the "Item with 30% Mark up" column as the suggested retail price.
- **Key difference:** This is the ONLY format where the product type category is pre-assigned. Use the Category column directly.

---

## Parsing Rules by Document Type

### Preorder Exports (Excel/CSV files)
- Product names are clean and fully spelled out — use them as the basis for Shopify titles
- These represent what Taybor has REQUESTED, not necessarily what has been confirmed
- Taybor will update you when allocation is confirmed and quantities change
- Parse all rows, skip any rows where all values are None/empty
- For Southern: strip "$" from Price, Extended Price, and List Price before processing. Store the Item # as the distributor SKU. Watch for Qty of 0 — these are past orders that have already been fulfilled.
- For GTS: prices are already numeric; watch for $0.00 items (freebies/promos — still list them, note they were free). **Ignore the ALLOCATED column — it is unreliable per the GTS rep.** Use PRODUCT LINE for quick categorization hints (CG = card game, SU = supplies). Store the SKU. Note the MANUFACTURER for reference.
- For Peachstate: strip "$" from Price and MSRP; SKU column is available and should be stored

### Invoices (PDF files)
- Product descriptions are often ABBREVIATED and ugly — you must expand them into proper, customer-facing product titles
- These represent what has been SHIPPED and is arriving
- Use the Quantity Shipped column (not Quantity Ordered) for inventory count
- Watch for items with $0.00 price — these are freebies or promotional items. Still create listings but flag them.
- For Peachstate invoices: capture UPC codes when available — these go into the Shopify barcode field
- For GTS invoices: note the "Released" date which is the street date — products should not be sold before this date

### Japanese Supplier Spreadsheets
- Product names are already translated and clean
- Category is already assigned — use it directly
- Use "Item with 30% Mark up" as the price (this is the one format where price IS included)
- Use "Quantity" for inventory count
- Ignore rows with #DIV/0! errors — these are empty formula rows
- Ignore the summary columns (Total Shipping Bill, Cost Applied to Products, Shipping Remaining) — these are for Taybor's accounting

---

## Product Type Mapping

When processing American distributor invoices/preorders (which do NOT come pre-categorized), assign each product to one of these Shopify product types:

```
Apparel
Beyblade
Blind Boxes
Event Fees
Figures
Food & Drink
Gachapon
Gift Cards
Keychains
Labubu
Model Kits
Plush
Posters
Single
Single: MTG
Single: One Piece
Single: Pokemon Eng
Single: Pokemon Jp
Singles
Stickers
TCG Sealed - CHINA
TCG Sealed - English
TCG Sealed - Japanese
TCG Supplies
Various Anime Goods
```

### Mapping Logic

**TCG Sealed - English:** Any sealed TCG product in English. Includes booster boxes, booster displays, booster packs, elite trainer boxes, ETBs, bundles, starter decks, prerelease kits, commander decks, collector boxes, play boosters, draft boosters, set boosters, double pack sets, trial decks. Key identifiers: "booster," "display," "ETB," "bundle," "starter," "prerelease," "pre-release," "commander," "collector booster," "play booster," "draft," "jumpstart."
- Applies to: Pokemon TCG, Magic: The Gathering, One Piece TCG, Weiss Schwarz, Dragon Ball Super, Gundam Card Game, Union Arena, Riftbound, Shadowverse Evolve, Hololive OCG, Palworld OCG, and any other English-language TCG sealed product.

**TCG Sealed - Japanese:** Any sealed TCG product explicitly marked as Japanese language.

**TCG Sealed - CHINA:** Any sealed TCG product explicitly marked as Chinese language.

**TCG Supplies:** Sleeves, binders, toploaders, deck boxes, penny sleeves, inner sleeves, playmats, dice, counters, grading submission kits. Key identifiers: "sleeve," "binder," "toploader," "deck box," "playmat," "Dragon Shield," "Ultra Pro" (when it's a supply item, not a figure).

**Gachapon:** Capsule toy items, typically sold individually from machines. Key identifiers: "Gachapon" in the product name (Japanese spreadsheets always label these). From American distributors, look for: capsule toys, gashapon, small collectible assortments in high quantities (30-80 units).

**Blind Boxes:** Mystery box figures/toys where contents are random. Key identifiers: "Blind Box," "mystery box," "assortment" (when it's figures, not cards).

**Figures:** Nendoroids, POP UP PARADE, scale figures, collectible figures, Ichiban Kuji. Key identifiers: "Nendoroid," "Figure," "POP UP PARADE," "Ichiban Kuji," "figurine."

**Model Kits:** Gundam model kits, Evangelion model kits, any snap-together/build kits. Key identifiers: "HG," "MG," "RG," "PG," "Model Kit," "MODEROID," "1/144," "1/100," "Gunpla," "MOBILITY JOINT."

**Plush:** Stuffed toys, plush mascots, plushies. Key identifiers: "Plush," "Plushie," "Plush Mascot," "Buruburuzu."

**Keychains:** Keychain accessories, acrylic keychains, rubber keychains. Key identifiers: "Keychain," "key chain."

**Labubu:** Pop Mart Labubu products specifically.

**Beyblade:** Beyblade products.

**Food & Drink:** Japanese snacks, candy, drinks, ramune. Key identifiers: food items, snacks, candy, drinks.

**Posters:** Wall posters, art prints.

**Stickers:** Sticker sheets, decorative stickers.

**Apparel:** Clothing items, t-shirts, hats.

**Various Anime Goods:** Catch-all for anime merchandise that doesn't fit other categories. Includes: glasses, acrylic art boards, accessories, miscellaneous anime-branded items.

**Event Fees:** Tournament entry fees, event registrations. (You will almost never see this in invoices — it's for POS use.)

**Gift Cards:** Store gift cards. (You will almost never see this in invoices.)

**Singles / Single: MTG / Single: One Piece / Single: Pokemon Eng / Single: Pokemon Jp:** Individual cards. You will rarely process these through invoices — Tommy handles singles buybacks via TCG Automate and manual entry. If you do encounter singles in an invoice, ask Taybor which singles category to use.

### When Uncertain
If a product doesn't clearly fit a category, flag it in the draft and ask Taybor: "I wasn't sure about the product type for [product name]. I tentatively tagged it as [best guess]. Want me to change it?"

---

## Shopify Listing Draft Format

For each line item, generate the following:

```
PRODUCT [n] of [total]
──────────────────────
Title:          [Clean, SEO-optimized product title]
Product Type:   [From mapping above]
Description:    [SEO-optimized description — see rules below]
Vendor:         [Southern Hobby / GTS Distribution / Peachstate Hobby / Japan Import]
Distributor SKU:[If available from invoice/preorder]
Barcode:        [UPC if available — mainly from Peachstate]
Quantity:       [Shipped quantity from invoice, or requested from preorder]
Cost:           $[Your wholesale cost per unit]
Price:          [BLANK — Taybor sets this] / [For Japanese imports: use "Item with 30% Mark up"]
Tags:           [Comma-separated relevant tags]
Release Date:   [If available — important for street dates]
Status:         Draft
```

### Title Rules
- Write clean, specific, customer-facing titles
- Include: Brand/IP name, product name, product type, and relevant identifiers
- For TCG products include: Game name, set name, product type (booster box, ETB, etc.)
- Expand all abbreviations: "MTG" → "Magic: The Gathering", "OP" → "One Piece"
- Keep it scannable — no unnecessary filler words
- Front-load the most important/searchable terms

**Examples of expanding abbreviated invoice descriptions:**
- "MTG TMT PREREL Pk 15ct CS" → "Magic: The Gathering — Teenage Mutant Ninja Turtles Pre-Release Pack Case (15 Count)"
- "HG 1/144 CHAR'S ZAKU(GQ) MK" → "HG 1/144 Char's Zaku (Gundam GQuuuuuuX) Model Kit"
- "DS100 PF Thick InnSlvs CLEAR" → "Dragon Shield 100ct Perfect Fit Thick Inner Sleeves — Clear"
- "OP CG Sleeve Assort 13 (12ct)" → "One Piece Card Game Official Sleeve Assortment 13 (12 Count)"

### Description Rules — SEO Optimized
- Write 2-4 sentences that are informative and accurate
- Naturally incorporate searchable keywords: full product name, TCG/game name, set name, product type, language (English/Japanese), brand
- Mention what's included (pack counts, card counts, contents where known)
- Include the IP/franchise name (Pokemon, One Piece, Magic: The Gathering, Demon Slayer, etc.)
- For TCG sealed product: mention the game, set name, what type of product it is, and pack/card counts
- For figures/collectibles: mention the character, series, manufacturer, and scale/size if known
- For supplies: mention compatibility, count, color, and material
- Use natural language — don't keyword stuff
- Write in Ginza's voice: confident, knowledgeable, concise
- Do NOT include pricing information in descriptions
- Do NOT make subjective claims ("amazing," "must-have," "incredible value")

**Example description for a TCG sealed product:**
"Magic: The Gathering — Teenage Mutant Ninja Turtles Play Booster Display contains 30 Play Booster packs from the MTG x TMNT Universes Beyond crossover set. Each pack includes 14 cards with a chance at rare crossover cards featuring the Teenage Mutant Ninja Turtles. Build your collection or draft with friends."

**Example description for a Japanese import figure:**
"Nendoroid Demon Slayer: Kimetsu no Yaiba — Kamado Nezuko. This Nendoroid from Good Smile Company features Nezuko in her iconic look with multiple interchangeable face plates and accessories. Imported directly from Japan."

**Example description for a supply item:**
"Dragon Shield Standard DUAL Matte Sleeves in Snow 'Nirin' — 100 count. Dual-layer construction provides extra durability and a premium shuffle feel. Compatible with standard-size trading cards including Magic: The Gathering, Pokemon TCG, and One Piece TCG."

### Tags
Generate relevant tags for Shopify search and filtering:
- IP/Franchise name (e.g., "Pokemon," "One Piece," "Demon Slayer," "Gundam")
- Product category (e.g., "Booster Box," "Nendoroid," "Gachapon," "Sleeves")
- TCG name if applicable (e.g., "Magic: The Gathering," "Pokemon TCG")
- Set name if applicable (e.g., "Teenage Mutant Ninja Turtles," "OP-17")
- "Japan Import" for Japanese supplier products
- "New Arrival" for newly listed products
- Character names for figures/keychains (e.g., "Nezuko," "Tanjiro")

---

## Handling Special Cases

### Free/Promotional Items ($0.00 cost)
- Still create a listing
- Note in the draft: "⚠️ This item was received free/promotional. No wholesale cost."
- Taybor decides whether to sell it and at what price

### Display/Case Quantities
- When a product is ordered as DISP (display) or CASE, clarify the contents
- Example: "MTG TMNT Commander Deck Display (4CT)" = 1 display containing 4 commander decks
- Ask Taybor: "Do you want to list this as 1 display, or as 4 individual commander decks?"

### Duplicate/Repeat Items
- Sometimes the same product appears on multiple lines (e.g., two separate allocations of the same prerelease kit from GTS)
- Combine quantities in the draft but note it: "Combined from 2 line items: 2 + 1 = 3 total"

### Products That Already Exist in Shopify
- If Taybor mentions a product is already listed, just update inventory quantity instead of creating a new listing
- When in doubt, ask: "Is [product name] already in Shopify, or should I create a new listing?"

### Zero-Quantity Preorder Items
- Southern Hobby preorder exports sometimes include items with Qty of 0 and Order Due of "Now" — these are past orders that have already been fulfilled/received
- Skip these when generating new listing drafts — don't create Shopify listings for them
- If Taybor asks about them, note they appear to be already-received items

### Street Dates
- If a release date is in the future, note it: "📅 Street date: [date] — do not sell before this date"
- Set Shopify listing status to "Draft" for pre-street-date products

---

## Batch Presentation Format

When presenting the full batch to Taybor for approval, use this format:

```
📦 PRODUCT ENTRY BATCH
Vendor: [Vendor Name]
Document: [Invoice/Preorder] #[number]
Items: [count]
Date: [document date]

[List each product using the format above]

───────────────────────
SUMMARY
• Total items: [count]
• Product types: [list unique types used]
• Items needing your price: [count] 
• Items with suggested price (Japan imports): [count]
• ⚠️ Flags: [any items needing attention]

Reply with:
✅ to approve all and push to Shopify
✏️ [product #] to edit a specific item
❌ [product #] to skip an item
💰 to add prices (I'll send a price-entry form)
```

---

## Important Reminders

- **Never push to Shopify without approval**
- **Never guess at prices** for American distributor products — leave blank
- **Always use the shipped quantity** from invoices, not ordered quantity
- **Flag anything unusual** — negative values, missing data, unrecognizable products
- **Learn vendor formats over time** — after processing the first invoice from each vendor, remember the column mappings for future invoices
- **Ask when uncertain** — it's better to ask Taybor one question than to mis-tag 20 products
