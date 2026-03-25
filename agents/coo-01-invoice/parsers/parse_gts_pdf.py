#!/usr/bin/env python3
"""
parse_gts_pdf.py — GTS Distribution invoice PDF parser for Ginza Marketplace
Outputs JSON array of line items to stdout.

Usage:
    python3 parse_gts_pdf.py path/to/gts_INVXXXXXXXX.pdf

Requires: pdfplumber
    pip install pdfplumber --break-system-packages
"""

import sys
import json
import re
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    print("ERROR: pdfplumber not installed. Run: pip install pdfplumber --break-system-packages", file=sys.stderr)
    sys.exit(1)


# ── Column x-position boundaries (confirmed from real invoices) ──────────────
# These are the left-edge x0 values for each column.
# Words are assigned to a column if their x0 falls within the column's range.
COLUMNS = {
    "item_no":     (0,    97),
    "description": (98,   316),
    "released":    (317,  360),
    "ordered":     (361,  406),
    "shipped":     (407,  450),
    "srp":         (451,  491),
    "price":       (492,  553),
    "amount":      (554,  9999),
}

# Footer keywords that signal the end of line items
FOOTER_KEYWORDS = {
    "Product", "Total", "TERMSNONCASH", "HANDFEE", "Tax",
    "PAID", "AMOUNT", "NET", "PAYABLE", "Any", "invoice",
    "Damages", "pending", "Please", "remember", "gtsdistribution",
    "Tracking", "Page", "DO", "NOT", "PAY", "FROM", "YOUR", "FINAL",
}

# Header row keywords — the row containing these is the column header row
HEADER_KEYWORDS = {"Item", "No", "Description", "Released", "Ordered", "Shipped", "SRP", "Price", "Amount"}


def assign_column(x0):
    """Return column name for a given x0 position."""
    for col, (lo, hi) in COLUMNS.items():
        if lo <= x0 <= hi:
            return col
    return None


def extract_display_count(description):
    """
    Extract the display count from a description like 'TechStickerC 12ct W2' → 12.
    Returns 1 if no count found (single unit).
    """
    match = re.search(r'(\d+)\s*ct\b', description, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return 1


def parse_price(text):
    """Parse a price string like '$120.000' or '$49.99' to float."""
    cleaned = re.sub(r'[^\d.]', '', text)
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return 0.0


def is_footer_row(row_words):
    """Return True if this row looks like invoice footer content."""
    first_word = row_words[0]['text'] if row_words else ''
    return first_word in FOOTER_KEYWORDS


def extract_invoice_meta(words_by_row):
    """Pull invoice number and date from header rows."""
    meta = {"invoice_number": None, "invoice_date": None, "your_reference": None}
    rows = sorted(words_by_row.keys())
    for y in rows[:25]:  # Only look in top portion
        texts = [w['text'] for w in words_by_row[y]]
        joined = ' '.join(texts)
        if 'INV' in joined and meta["invoice_number"] is None:
            for t in texts:
                if t.startswith('INV') and len(t) > 5:
                    meta["invoice_number"] = t
        if re.search(r'\d{2}-\w{3}-\d{4}', joined) and meta["invoice_date"] is None:
            for t in texts:
                if re.match(r'\d{2}-\w{3}-\d{4}', t):
                    meta["invoice_date"] = t
        if 'pkmnascendhero' in joined.lower() or (meta.get("your_reference") is None and 'Reference' in texts):
            # Next token after 'Reference' and ':' is the reference value
            for i, t in enumerate(texts):
                if t == ':' and i > 0 and texts[i-1] == 'Reference':
                    if i + 1 < len(texts):
                        meta["your_reference"] = texts[i + 1]
    return meta


def parse_gts_pdf(pdf_path):
    """
    Parse a GTS Distribution invoice PDF.

    Returns a dict with:
        meta: {invoice_number, invoice_date, your_reference}
        items: list of line item dicts
    """
    with pdfplumber.open(pdf_path) as pdf:
        all_words = []
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=3, y_tolerance=3)
            all_words.extend(words)

    # Group words into rows by y-position (round to nearest 6pt)
    rows_raw = defaultdict(list)
    for w in all_words:
        row_key = round(w['top'] / 6) * 6
        rows_raw[row_key].append(w)

    # Sort each row by x position
    words_by_row = {y: sorted(ws, key=lambda w: w['x0']) for y, ws in rows_raw.items()}

    # Extract invoice metadata
    meta = extract_invoice_meta(words_by_row)

    # Find the header row (contains "Item", "No", "Description")
    header_y = None
    for y in sorted(words_by_row.keys()):
        row_texts = {w['text'] for w in words_by_row[y]}
        if len(row_texts & HEADER_KEYWORDS) >= 3:
            header_y = y
            break

    if header_y is None:
        raise ValueError("Could not find column header row in PDF. Is this a GTS invoice?")

    # Parse line items — all rows after the header row until footer
    items = []
    sorted_rows = sorted(words_by_row.keys())
    in_items = False

    for y in sorted_rows:
        if y == header_y:
            in_items = True
            continue
        if not in_items:
            continue

        row_words = words_by_row[y]
        if not row_words:
            continue

        # Stop at footer rows
        if is_footer_row(row_words):
            break

        # Assign each word to a column by x-position
        cols = defaultdict(list)
        for w in row_words:
            col = assign_column(w['x0'])
            if col:
                cols[col].append(w['text'])

        # Must have at least item_no and description to be a valid line item
        if not cols.get('item_no') or not cols.get('description'):
            continue

        # Skip if item_no looks like garbage (e.g. the watermark token)
        item_no = ' '.join(cols['item_no'])
        if '~~' in item_no or '[' in item_no:
            continue

        description = ' '.join(cols['description'])
        released    = ' '.join(cols.get('released', []))
        ordered     = ' '.join(cols.get('ordered', []))
        shipped     = ' '.join(cols.get('shipped', []))
        srp_raw     = ' '.join(cols.get('srp', []))
        price_raw   = ' '.join(cols.get('price', []))
        amount_raw  = ' '.join(cols.get('amount', []))

        # Parse numeric fields
        try:
            qty_ordered = int(ordered) if ordered else 0
        except ValueError:
            qty_ordered = 0
        try:
            qty_shipped = int(shipped) if shipped else 0
        except ValueError:
            qty_shipped = 0

        price  = parse_price(price_raw)  if price_raw  else 0.0
        srp    = parse_price(srp_raw)    if srp_raw    else 0.0
        # Amount: if missing (free item gap), calculate from shipped * price
        if amount_raw:
            amount = parse_price(amount_raw)
        else:
            amount = round(qty_shipped * price, 2)

        is_free = price == 0.0

        # Display count: if description contains "Xct", each shipped unit
        # is a display of X individual products. Shopify quantity = shipped × count.
        display_count = extract_display_count(description)
        shopify_qty   = qty_shipped * display_count

        items.append({
            "item_no":       item_no,
            "description":   description,
            "released":      released,
            "qty_ordered":   qty_ordered,
            "qty_shipped":   qty_shipped,    # raw displays shipped
            "display_count": display_count,  # units per display (1 if not a display)
            "shopify_qty":   shopify_qty,    # qty_shipped × display_count → use this in Shopify
            "srp":           srp,
            "price":         price,          # wholesale unit cost
            "amount":        amount,         # extended price
            "is_free":       is_free,
        })

    return {"meta": meta, "items": items}


def format_summary(result):
    """Print a human-readable summary to stderr for debugging."""
    meta = result['meta']
    items = result['items']
    print(f"\nInvoice: {meta['invoice_number']}  |  Date: {meta['invoice_date']}", file=sys.stderr)
    print(f"Items parsed: {len(items)}\n", file=sys.stderr)
    print(f"{'SKU':<15} {'Description':<45} {'Ship':>4} {'Disp':>4} {'Shopify Qty':>11} {'Price':>9} {'Amount':>10} {'Street Date':<12}", file=sys.stderr)
    print("-" * 122, file=sys.stderr)
    for item in items:
        flag = " ⚠️FREE" if item['is_free'] else ""
        display_note = f"×{item['display_count']}" if item['display_count'] > 1 else "  "
        print(
            f"{item['item_no']:<15} {item['description'][:44]:<45} "
            f"{item['qty_shipped']:>4} {display_note:>4} {item['shopify_qty']:>11} "
            f"{item['price']:>9.2f} {item['amount']:>10.2f} "
            f"{item['released']:<12}{flag}",
            file=sys.stderr
        )
    total = sum(i['amount'] for i in items)
    print(f"\nTotal: ${total:,.2f}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 parse_gts_pdf.py <invoice.pdf>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = parse_gts_pdf(pdf_path)
    format_summary(result)
    print(json.dumps(result, indent=2))
