// GTS Distribution — major US hobby distributor
// PDF or CSV invoices, USD pricing. All major TCG lines plus board games, figures, collectibles.

export default {
  name: 'GTS Distribution',
  senderPatterns: ['gts'],
  attachmentTypes: ['pdf', 'csv'],
  currency: 'USD',

  match(sender, subject) {
    const s = (sender || '').toLowerCase();
    const sub = (subject || '').toLowerCase();
    return s.includes('gts') || sub.includes('gts');
  },

  formatHints: `
    GTS invoices can be PDF or CSV format.
    PDF invoices typically have a table with columns: Item #, Description, Qty, Unit Price, Total.
    CSV invoices have header rows with similar column names.
    GTS carries a wide range of products — TCG, board games, figures, collectibles.
    The invoice number is usually referenced in the subject line or at the top of the document.
    Look for "Total" or "Grand Total" for the invoice total.
  `,

  markupRules: {
    default: 1.5,
    singles: 2.0,
    sealed: 1.35,
    supplies: 1.5,
    figures: 1.5,
    boardGames: 1.4,
  },

  typeDetectionHints: `
    Map products to Ginza's Shopify product types based on the description:
    - Booster boxes, ETBs, collection boxes, tins, bundles → "TCG Sealed - English"
    - Individual cards or "single" → match to game: "Single: Pokemon Eng", "Single: MTG", "Single: Yu-Gi-Oh", "Single: One Piece", "Single: Dragon Ball", "Single: Lorcana", "Single: Flesh and Blood", "Single: Digimon", "Single: Weiss Schwarz", "Single: Vanguard"
    - Sleeves, binders, deck boxes, playmats → "TCG Supplies"
    - Figures, statues → "Figures"
    - Model kits, gunpla → "Model Kits"
    - Plushes → "Plushes"
    - Blind boxes, mystery boxes → "Blind Boxes"
    - Board games, card games (non-TCG) → "Other"
  `,
};
