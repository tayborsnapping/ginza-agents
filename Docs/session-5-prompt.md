# Session 5 — CFO-03 Margin Watch Agent

Read these files before writing any code:
- `CLAUDE.md` — project conventions
- `Docs/architecture.md` — full system architecture, DB schema, shared module specs
- `Docs/session-plan.md` — Session 5 scope and exit criteria
- `shared/runner.js` — the agent execution framework (CFO-03 uses this)
- `shared/shopify.js` — Shopify REST client (CFO-03 calls getOrders and getProducts)
- `shared/db.js` — database helpers
- `agents/test-agent/index.js` — reference for how a runner-based agent is structured
- `agents/cto-01-health/index.js` — reference for a recent runner-based agent (strips markdown fences from Anthropic response)

## What to build

**agents/cfo-03-margin-watch/** with three files:

### 1. `prompt.md` — System prompt for margin analysis
- Role: CFO-03, Margin Watch Agent for Ginza Marketplace
- Uses `{{datetime}}` and `{{last_run}}` template variables (injected by runner)
- Tell the LLM it receives JSON with sales and cost data by product type
- Ginza's product categories — the store uses Shopify product types, main ones include:
  - Trading Cards (Pokémon, One Piece, Dragon Ball, Yu-Gi-Oh, etc.)
  - Sealed Products (booster boxes, ETBs, collection boxes)
  - Singles (individual cards)
  - Accessories (sleeves, binders, playmats, deck boxes)
  - Figures & Collectibles
  - Apparel
  - Other / Miscellaneous
- Margin threshold: 30% minimum gross margin (configurable in tools.js)
- Output format: JSON with `categoryMargins[]` array and `alerts[]` array
- Rules: flag any category below 30% threshold, note week-over-week margin trends if possible, highlight any product type with negative margin

### 2. `tools.js` — Shopify data pull and margin calculation
- `pullCategorySales(ctx)` — Uses `shared/shopify.js` `getOrders()` to fetch orders for the trailing 7 days. Groups line items by product_type. Calculates total revenue per category. Note: Shopify orders contain `line_items[]`, each with `product_id`, `title`, `quantity`, `price`.
- `pullProductCosts(ctx)` — Uses `shared/shopify.js` `getProducts()` to fetch all products. Extracts `variants[].cost` (the cost-per-item field) to build a cost lookup map by product_id. Note: not all products have cost data — handle gracefully.
- `calculateMargins(salesByCategory, costsByProduct, orders)` — Matches revenue to COGS by category. Returns `{ categoryMargins[], totalRevenue, totalCOGS, overallMargin, missingCostCount }`.

Important implementation notes:
- Shopify `getOrders()` accepts `{ createdAtMin, createdAtMax, status: 'any' }` — use ISO 8601 date strings
- Shopify `getProducts()` returns products with `variants[]` — cost is in `variants[].cost` (may be null or "0.00")
- Line items in orders have `product_id` to join against products
- Some products won't have cost data — count these as `missingCostCount` and note in output
- Use 7-day trailing window for sales (not calendar week)

### 3. `index.js` — Runner-based agent
- Uses `run()` from `shared/runner.js`
- Calls `pullCategorySales(ctx)` and `pullProductCosts(ctx)` to gather data
- Calls `calculateMargins()` to compute margins
- Sends combined data to Anthropic for analysis (trends, anomalies, recommendations)
- Strip markdown fences from Anthropic response before parsing (same pattern as CTO-01)
- Writes `output_key='margin_alerts'` with the full margin analysis object
- Queues Discord alerts: warning if any category below 30% threshold, critical if any category has negative margin
- Returns a summary string

### 4. Update `ecosystem.config.js`
- Add the cfo-03-margin entry (daily 6 AM ET cron): `cron_restart: '0 6 * * *'`
- Set `autorestart: false`

## Testing
- Run CFO-03: `node agents/cfo-03-margin-watch/index.js`
- This hits live Shopify data — verify the output makes sense against what you see in Shopify admin
- Verify: `sqlite3 db/ginza.db "SELECT * FROM agent_outputs WHERE output_key='margin_alerts' ORDER BY created_at DESC LIMIT 1"`
- Verify: `sqlite3 db/ginza.db "SELECT * FROM alerts WHERE source_agent='cfo-03-margin' ORDER BY created_at DESC LIMIT 5"`
- Run CTO-01 after to confirm it picks up CFO-03's run: `node agents/cto-01-health/index.js`

## Exit criteria
- Margin data written to agent_outputs with output_key='margin_alerts'
- Category breakdown includes revenue, COGS, and margin percentage per product type
- Alerts fire if any category is below 30% margin threshold
- Missing cost data is tracked and reported (not silently ignored)
- PM2 config updated with cfo-03-margin entry
- CTO-01 can see this agent's run status in its next health check
- Code committed to git
