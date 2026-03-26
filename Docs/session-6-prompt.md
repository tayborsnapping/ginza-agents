# Session 6 — CFO-01 Weekly Report Agent

Read these files before writing any code:
- `CLAUDE.md` — project conventions
- `Docs/architecture.md` — full system architecture, DB schema, shared module specs
- `Docs/session-plan.md` — Session 6 scope and exit criteria
- `shared/runner.js` — the agent execution framework (CFO-01 uses this)
- `shared/shopify.js` — Shopify REST client (CFO-01 calls getOrders and getProducts)
- `shared/db.js` — database helpers
- `agents/cfo-03-margin-watch/index.js` — reference for a Shopify-pulling runner-based agent (most recent build)
- `agents/cfo-03-margin-watch/tools.js` — reference for Shopify data patterns: variant-level cost lookup via inventoryItem API, product_type lookup from products API (line items don't carry product_type)
- `agents/cto-01-health/index.js` — reference for markdown fence stripping on Anthropic response

## Important lessons from Session 5
- Shopify order line items do NOT have `product_type` — you must build a `product_id → product_type` lookup from the products API
- Cost per item is on the **InventoryItem**, not `variant.cost` — batch-fetch via `shopify.inventoryItem.list({ ids })` in chunks of 100
- Cost must be keyed by **variant_id** (not product_id) because multi-variant products (box vs. pack) have different costs per variant
- Use `variant_id` from order line items to join against costs

## What to build

**agents/cfo-01-weekly-report/** with three files:

### 1. `prompt.md` — System prompt for weekly report generation
- Role: CFO-01, Weekly Report Agent for Ginza Marketplace
- Uses `{{datetime}}` and `{{last_run}}` template variables (injected by runner)
- Context: This report is prepared for Taybor's Monday meeting with Nils (business partner). Nils cares about: revenue trends, margin health, top-selling categories, inventory velocity, and anything unusual.
- Tell the LLM it receives JSON with current week vs. previous week sales data
- Ginza's product categories (from Shopify product types — see CFO-03's data for the full list, but the main revenue drivers are):
  - Single: Pokemon Eng, Single: Pokemon Jp, Single: One Piece, Single: MTG
  - TCG Sealed - English, TCG Sealed - Japanese
  - TCG Supplies, Blind Boxes, Model Kits, Figures, Food & Drink
- Output format: JSON with both structured data AND a formatted text summary suitable for Discord posting
- The text summary should be concise, scannable, and highlight what changed week-over-week

### 2. `tools.js` — Shopify data pull and weekly comparison
- `pullWeeklyOrders(ctx)` — Fetch orders for the current 7-day period AND the previous 7-day period (14 days total). Group by product_type using the product lookup pattern from CFO-03. Calculate revenue, units sold, and order count per category for each week.
- `pullTopSellers(ctx, orders)` — From the current week's orders, rank products by revenue and by units sold. Return top 10 each.
- `calculateWoW(currentWeek, previousWeek)` — Calculate week-over-week percentage changes for: total revenue, total units, total orders, and per-category revenue. Flag any category with >20% swing either direction.
- Reuse the variant-level cost lookup pattern from CFO-03 for margin data in the report.

Important implementation notes:
- Use the same `pullProductCosts()` pattern from CFO-03 (variant-level via inventoryItem API) to include margin data in the weekly report
- Shopify `getOrders()` accepts `{ createdAtMin, createdAtMax, status: 'any' }` — use ISO 8601 date strings
- Line items in orders have `variant_id` and `product_id` — use variant_id for cost, product_id for type lookup
- Handle the case where previous week has zero orders (first run) gracefully

### 3. `index.js` — Runner-based agent
- Uses `run()` from `shared/runner.js`
- Calls tools to gather current + previous week data
- Calls `calculateWoW()` to compute trends
- Sends combined data to Anthropic for analysis and narrative summary
- Strip markdown fences from Anthropic response before parsing (same pattern as CTO-01 and CFO-03)
- Writes `output_key='weekly_snapshot'` with the full report object
- Queues a Discord alert with `priority='info'` containing the formatted text summary (this goes to #cfo-reports via CTO-04)
- If revenue dropped >20% week-over-week, queue a `priority='warning'` alert
- Returns a summary string

### 4. Update `ecosystem.config.js`
- The cfo-01-weekly entry should already exist (Monday 7 AM ET cron): `cron_restart: '0 7 * * 1'`
- Verify it's there; if not, add it with `autorestart: false`

## Testing
- Run CFO-01: `node agents/cfo-01-weekly-report/index.js`
- This hits live Shopify data — verify the output makes sense
- Verify: `sqlite3 db/ginza.db "SELECT * FROM agent_outputs WHERE output_key='weekly_snapshot' ORDER BY created_at DESC LIMIT 1"`
- Verify: `sqlite3 db/ginza.db "SELECT * FROM alerts WHERE source_agent='cfo-01-weekly' ORDER BY created_at DESC LIMIT 5"`
- Run CTO-01 after to confirm it picks up CFO-01's run: `node agents/cto-01-health/index.js`

## Exit criteria
- Weekly snapshot written to agent_outputs with output_key='weekly_snapshot'
- Report includes: revenue, units, orders, top sellers, category breakdown, WoW changes
- Margin data included per category (using variant-level costs)
- Formatted text summary suitable for Discord is included in the output
- Discord info alert queued with the summary
- Warning alert fires if revenue dropped >20% WoW
- PM2 config has cfo-01-weekly entry
- CTO-01 can see this agent's run status
- Code committed to git
