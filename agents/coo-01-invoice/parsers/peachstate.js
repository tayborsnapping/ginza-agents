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
  `,

  markupRules: {
    default: 1.5,
    singles: 2.0,
    sealed: 1.35,
    supplies: 1.5,
  },

  typeDetectionHints: `
    Map products to Ginza's Shopify product types based on the description:
    - Booster boxes, ETBs, collection boxes, tins, bundles → "TCG Sealed - English"
    - Individual cards or "single" → "Single: Pokemon Eng" (Peachstate is primarily Pokemon)
    - Sleeves, binders, deck boxes, playmats → "TCG Supplies"
    - Figures, statues → "Figures"
    - Plushes, plush toys → "Plushes"
    - Blind boxes, mystery boxes → "Blind Boxes"
    - Stickers, pins, keychains → "Stickers" or "Pins"
    - Apparel, clothing → "Apparel"
  `,
};
