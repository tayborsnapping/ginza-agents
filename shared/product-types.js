// shared/product-types.js — Single source of truth for Shopify product types
// Used by COO-01 (validation), COO-02 (safety net), and any agent that needs type enforcement.
// Includes fuzzy matching and LLM classification for correcting invalid types.

/**
 * Ginza's 26 valid Shopify product types.
 * Every product entering Shopify MUST use one of these exactly.
 */
export const SHOPIFY_PRODUCT_TYPES = [
  'Single: Pokemon Eng', 'Single: Pokemon Jp', 'Single: One Piece', 'Single: MTG',
  'Single: Dragon Ball', 'Single: Yu-Gi-Oh', 'Single: Lorcana', 'Single: Flesh and Blood',
  'Single: Union Arena', 'Single: Digimon', 'Single: Weiss Schwarz', 'Single: Vanguard',
  'TCG Sealed - English', 'TCG Sealed - Japanese',
  'TCG Supplies', 'Blind Boxes', 'Model Kits', 'Figures', 'Plushes',
  'Apparel', 'Bags', 'Stickers', 'Pins', 'Food & Drink', 'Home Goods', 'Other',
];

// Pre-compute lowercase map for case-insensitive exact matching
const TYPES_LOWER = new Map(SHOPIFY_PRODUCT_TYPES.map(t => [t.toLowerCase(), t]));

/**
 * Case-insensitive exact match against the valid types list.
 * @param {string} type
 * @returns {boolean}
 */
export function isValidProductType(type) {
  if (!type) return false;
  return TYPES_LOWER.has(type.toLowerCase());
}

/**
 * Get the correctly-cased version of a type (case-insensitive lookup).
 * @param {string} type
 * @returns {string|null}
 */
export function getCanonicalType(type) {
  if (!type) return null;
  return TYPES_LOWER.get(type.toLowerCase()) || null;
}

// --- Fuzzy matching (bigram Dice coefficient) ---

/**
 * Normalize a string for fuzzy comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(str) {
  return str.toLowerCase().replace(/[-:,./()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generate character bigrams from a string.
 * @param {string} str
 * @returns {Map<string, number>} bigram → count
 */
function bigrams(str) {
  const map = new Map();
  for (let i = 0; i < str.length - 1; i++) {
    const pair = str.substring(i, i + 2);
    map.set(pair, (map.get(pair) || 0) + 1);
  }
  return map;
}

/**
 * Dice coefficient between two strings (2 * shared bigrams / total bigrams).
 * Returns 0–1, where 1 is identical.
 */
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersection = 0;
  for (const [pair, countA] of bigramsA) {
    const countB = bigramsB.get(pair) || 0;
    intersection += Math.min(countA, countB);
  }

  const totalA = a.length - 1;
  const totalB = b.length - 1;
  return (2 * intersection) / (totalA + totalB);
}

// Pre-compute normalized versions of all valid types
const NORMALIZED_TYPES = SHOPIFY_PRODUCT_TYPES.map(t => ({
  original: t,
  normalized: normalize(t),
}));

const FUZZY_THRESHOLD = 0.6;

/**
 * Attempt to fuzzy-match a candidate string to the closest valid product type.
 *
 * @param {string} candidate - The invalid type string to match
 * @returns {{ match: string|null, score: number }}
 *   match is the valid type string if score >= threshold, null otherwise
 */
export function fuzzyMatchProductType(candidate) {
  if (!candidate) return { match: null, score: 0 };

  // First try case-insensitive exact match
  const canonical = getCanonicalType(candidate);
  if (canonical) return { match: canonical, score: 1.0 };

  const normalizedCandidate = normalize(candidate);
  let bestMatch = null;
  let bestScore = 0;

  for (const { original, normalized } of NORMALIZED_TYPES) {
    const score = diceCoefficient(normalizedCandidate, normalized);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = original;
    }
  }

  if (bestScore >= FUZZY_THRESHOLD) {
    return { match: bestMatch, score: bestScore };
  }

  return { match: null, score: bestScore };
}

/**
 * LLM fallback: classify a product into one of the 26 valid types.
 * Uses ctx.anthropic() — only called when fuzzy matching fails.
 *
 * @param {object} ctx - Agent context (from runner.js)
 * @param {string} productTitle - The product name
 * @param {string} invalidType - The incorrect type the initial parse returned
 * @returns {Promise<string>} A valid product type (defaults to "Other" on failure)
 */
export async function classifyProductType(ctx, productTitle, invalidType) {
  const typeList = SHOPIFY_PRODUCT_TYPES.join('\n');

  const prompt = `You are a product classifier for Ginza Marketplace, a Japanese TCG and anime retail store in Ann Arbor, Michigan.

Given a product title and an invalid product type, pick the single best match from this list:

${typeList}

## Domain Knowledge (use these rules):
- Gundam, Gunpla, HG, MG, RG, PG grade → "Model Kits" (most Gundam products are model kits)
- Metal Robot Spirits, Robot Spirits, S.H.Figuarts, action figures, statues → "Figures"
- Hololive OCG, Weiss Schwarz, or any TCG from US distributors → "TCG Sealed - English"
- Only use "TCG Sealed - Japanese" for products explicitly imported from Japan or labeled as Japanese-language
- Booster boxes, ETBs, tins, bundles, start decks, starter kits, league battle decks → "TCG Sealed - English"
- Sleeves, binders, deck boxes, playmats, counter sets, dice → "TCG Supplies"
- Blind boxes, mystery figures, gacha → "Blind Boxes"

Product title: "${productTitle}"
Invalid type given: "${invalidType}"

Respond with ONLY the exact product type string from the list above, nothing else.
If nothing fits, respond with: Other`;

  const result = await ctx.anthropic(prompt, { maxTokens: 100 });
  const classified = result.content.trim();

  // Validate the LLM returned a valid type (case-insensitive)
  const canonical = getCanonicalType(classified);
  if (canonical) return canonical;

  // If LLM returned something still invalid, default to Other
  ctx.log(`LLM classification returned invalid type "${classified}" — defaulting to Other`);
  return 'Other';
}
