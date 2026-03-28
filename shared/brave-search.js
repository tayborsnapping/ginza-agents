// shared/brave-search.js — Brave Search API wrapper
// Used by COO-03 (descriptions) and COO-04 (UPC lookup).
// Falls back gracefully if BRAVE_SEARCH_API_KEY is not configured.

/**
 * Search the web using Brave Search API.
 * @param {object} ctx - Runner context (for logging)
 * @param {string} query - Search query
 * @param {number} [count=3] - Number of results to fetch (max 20)
 * @returns {Promise<string>} Concatenated search snippets, or empty string if unavailable
 */
export async function webSearch(ctx, query, count = 3) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    ctx.log('BRAVE_SEARCH_API_KEY not set — skipping web search');
    return '';
  }

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    url.searchParams.set('text_decorations', 'false');

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      ctx.log(`[WARN] Brave Search HTTP ${response.status} for "${query}" — falling back to LLM-only`);
      return '';
    }

    const data = await response.json();
    const results = (data.web?.results || []).slice(0, count);

    if (results.length === 0) {
      ctx.log(`No web results for "${query}"`);
      return '';
    }

    const snippets = results.map(r => `${r.title}: ${r.description}`).join('\n');
    ctx.log(`Web search for "${query}": ${results.length} results`);
    return snippets;
  } catch (err) {
    ctx.log(`[WARN] Web search failed for "${query}": ${err.message} — falling back to LLM-only`);
    return '';
  }
}
