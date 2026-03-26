// Japanese import suppliers (multiple possible senders)
// PDF invoices, JPY pricing. Japanese TCG sealed, singles, figures, anime goods.
// JPY invoices need manual exchange rate confirmation.

export default {
  name: 'Japanese Imports',
  senderPatterns: ['japan', 'jp', 'nippon', 'tokyo', 'osaka', 'tenso', 'buyee', 'zenmarket'],
  attachmentTypes: ['pdf'],
  currency: 'JPY',

  match(sender, subject) {
    const s = (sender || '').toLowerCase();
    const sub = (subject || '').toLowerCase();
    const patterns = ['japan', '.jp', 'nippon', 'tokyo', 'osaka', 'tenso', 'buyee', 'zenmarket'];
    return patterns.some(p => s.includes(p) || sub.includes(p));
  },

  formatHints: `
    Japanese supplier invoices vary in format but are typically PDF.
    Prices are in JPY (Japanese Yen) — ALL prices must be flagged for USD conversion.
    Product names may be in Japanese or English. Look for product codes/SKUs.
    The invoice may reference shipping costs separately — extract these if present.
    Common columns: Product Name, Quantity, Unit Price (JPY), Total (JPY).
    Note: Exchange rate fluctuates. Flag all JPY invoices for manual exchange rate confirmation.
    Current approximate rate: ~150 JPY per 1 USD (but this MUST be confirmed manually).
  `,

  markupRules: {
    default: 1.5,
    singles: 2.5,
    sealed: 1.4,
    supplies: 1.5,
    figures: 1.6,
  },

  typeDetectionHints: `
    Map products to Ginza's Shopify product types — use Japanese-specific types where applicable:
    - Booster boxes, expansion packs (Japanese) → "TCG Sealed - Japanese"
    - Individual cards, singles (Japanese) → "Single: Pokemon Jp" (or other game-specific Japanese single type)
    - English sealed products → "TCG Sealed - English"
    - Sleeves, deck boxes, playmats → "TCG Supplies"
    - Figures, statues, figurines, nendoroid, figma → "Figures"
    - Model kits, gunpla → "Model Kits"
    - Plushes, plush toys → "Plushes"
    - Blind boxes, gashapon, mystery boxes → "Blind Boxes"
    - Apparel → "Apparel"
    - Bags, tote bags → "Bags"
    - Food items, snacks, candy → "Food & Drink"
    - Home goods, household items → "Home Goods"
  `,
};
