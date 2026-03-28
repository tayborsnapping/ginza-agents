// Peachstate Hobby Distribution
// PDF invoices, USD pricing. Primarily Pokemon and anime-adjacent products.

export default {
  name: 'Peachstate Hobby',
  senderPatterns: ['peachstate', 'phdgames'],
  attachmentTypes: ['pdf'],
  currency: 'USD',

  match(sender, subject) {
    const s = (sender || '').toLowerCase();
    const sub = (subject || '').toLowerCase();
    return s.includes('peachstate') || s.includes('phdgames') || sub.includes('peachstate');
  },

  formatHints: `
    Peachstate invoices are PDF format with a table of line items.
    Columns typically include: SKU, Description, Quantity, Price, Extended.
    Peachstate primarily carries Pokemon products and anime-adjacent items.
    The invoice number and date appear at the top of the document.
    Look for "Invoice Total" or "Total" at the bottom.
    If UPC/EAN barcodes appear as a column or within product data, extract them.
  `,

  markupRules: {
    default: 1.5,
    singles: 2.0,
    sealed: 1.35,
    supplies: 1.5,
  },

  typeDetectionHints: `
    IMPORTANT: Peachstate is a US distributor. ALL sealed TCG products from Peachstate are English-language unless explicitly labeled Japanese.

    Map products to Ginza's Shopify product types based on the description:
    - Booster boxes, ETBs, collection boxes, tins, bundles, start decks, starter kits, league battle decks → "TCG Sealed - English"
    - Hololive OCG, Weiss Schwarz, or any other TCG sold by Peachstate → "TCG Sealed - English" (US distributor = English edition)
    - Counter sets, dice sets, playmats with TCG branding → "TCG Supplies"
    - Individual cards or "single" → "Single: Pokemon Eng" (Peachstate is primarily Pokemon)
    - Sleeves, binders, deck boxes, playmats, toploaders → "TCG Supplies"
    - Gundam, Gunpla, model kits, HG, MG, RG, PG grade kits → "Model Kits" (most Gundam products are model kits)
    - Metal Robot Spirits, Robot Spirits, action figures, statues, figurines → "Figures"
    - Plushes, plush toys → "Plushes"
    - Blind boxes, mystery boxes → "Blind Boxes"
    - Stickers, pins, keychains → "Stickers" or "Pins"
    - Apparel, clothing → "Apparel"
  `,
};
