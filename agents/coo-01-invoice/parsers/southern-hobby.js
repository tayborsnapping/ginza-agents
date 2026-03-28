// Southern Hobby Supply — major US TCG distributor
// PDF invoices, USD pricing. Pokemon, MTG, Yu-Gi-Oh, Dragon Ball, One Piece sealed + accessories.

export default {
  name: 'Southern Hobby',
  senderPatterns: ['southernhobby'],
  attachmentTypes: ['pdf'],
  currency: 'USD',

  match(sender, subject) {
    const s = (sender || '').toLowerCase();
    const sub = (subject || '').toLowerCase();
    return s.includes('southernhobby') || sub.includes('southern hobby') || sub.includes('oe invoice for order');
  },

  formatHints: `
    Southern Hobby invoices are typically PDF with a table of line items.
    Columns usually include: Item Number, Description, Qty Ordered, Qty Shipped, Unit Price, Extended Price.
    Product descriptions include the product line (Pokemon, Magic, Yu-Gi-Oh, etc.).
    Look for "Invoice Total" at the bottom for the total.
    The invoice number and date are usually at the top of the document.
    If UPC/EAN barcodes appear as a column or within product descriptions, extract them.
  `,

  markupRules: {
    default: 1.5,
    singles: 2.0,
    sealed: 1.35,
    supplies: 1.5,
  },

  typeDetectionHints: `
    IMPORTANT: Southern Hobby is a US distributor. ALL sealed TCG products from Southern Hobby are English-language unless explicitly labeled Japanese.

    Map products to Ginza's Shopify product types based on the description:
    - Booster boxes, ETBs, collection boxes, tins, bundles, start decks, starter kits, league battle decks → "TCG Sealed - English"
    - Hololive OCG, Weiss Schwarz, or any other TCG sold by Southern Hobby → "TCG Sealed - English" (US distributor = English edition)
    - Individual cards or "single" → match to game: "Single: Pokemon Eng", "Single: MTG", "Single: Yu-Gi-Oh", "Single: One Piece", "Single: Dragon Ball", etc.
    - Sleeves, binders, deck boxes, playmats, toploaders, card savers → "TCG Supplies"
    - Gundam, Gunpla, model kits, HG, MG, RG, PG grade kits → "Model Kits" (most Gundam products are model kits)
    - Metal Robot Spirits, Robot Spirits, action figures, statues, figurines → "Figures"
    - Plushes, plush toys → "Plushes"
    - Blind boxes, mystery boxes → "Blind Boxes"
  `,
};
