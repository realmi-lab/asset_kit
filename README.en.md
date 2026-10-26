English | [한국어](./README.md)

# Bithumb Asset Dashboard Kit

An **MCP server** that connects a Bithumb account's balances, valuation, allocation, daily asset changes, orders, and deposit/withdrawal history to AI clients. Ask “build a dashboard from my assets” and the AI saves a layout and opens a local dashboard.

- **Zero dependencies** — Node.js 22.13+ built-ins only. No `npm install`.
- **Read-only** — no order, cancel, or withdrawal tools. The only writes are local dashboard layouts.
- **Keys stay local** — never accepted as tool input, never sent to the browser or the AI.

Independent single-user prototype; not an official Bithumb package and not published to npm.

## Quick start

```bash
git clone https://github.com/realmi-lab/asset_kit.git
cd asset_kit
npm run demo   # synthetic data at http://127.0.0.1:4319, no install needed
```

## MCP

```json
{
  "mcpServers": {
    "bithumb-assets": { "command": "node", "args": ["/absolute/path/to/asset_kit/mcp/index.js"] }
  }
}
```

Append `"--demo"` to `args` for synthetic data. Full guide (Korean): [mcp/README.md](./mcp/README.md) — client configs, modules, `--modules`/`--read-only`/`--verbose` options, and the dashboard workflow. Codex: `command = "node"`, `args = ["/absolute/path/to/asset_kit/mcp/index.js"]` under `[mcp_servers.bithumb_assets]`.

14 tools: `portfolio_get_summary`, `portfolio_get_holdings`, `portfolio_get_allocation`, `portfolio_get_history` (`daily: true` for daily asset changes), `portfolio_get_report`, `market_get_candles`, `account_get_records` (whole period, ≤366 days), `account_get_orders`, `account_get_transfers`, `system_diagnose`, `dashboard_list_boards`, `dashboard_save_board`, `dashboard_open` (starts the local dashboard and returns its URL), `dashboard_get_template`.

## Keys

Create a **read-only** API key with an allowed IP at [Bithumb API management](https://www.bithumb.com/react/api-support/management-api), then run `node cli/asset-kit.js config init` (hidden input, saved with 0600 permissions) and `node cli/asset-kit.js doctor`. `BITHUMB_ACCESS_KEY`/`BITHUMB_SECRET_KEY` environment variables take precedence. Never paste keys into AI chat.

## Dashboard and CLI

```bash
npm run demo     # synthetic data at http://127.0.0.1:4319
npm start        # live account
node cli/asset-kit.js --help
```

Multiple dashboards (tabs) retain widgets, asset scope, periods (7/30/90 days, 1 year), and refresh settings.

- Search holdings, filter gains/losses/unknown P&L, reverse sorting, and export the exact visible selection. Filters persist per board.
- Explore chart values with the pointer, touch slider, or arrow keys. The calendar labels changes across missing recording days; values include deposits and withdrawals, not investment returns.
- Query orders/transfers with 7-day, 30-day, or current-month presets. Validate dates, cancel a pending view request, search/filter results, and export all matching retrieved rows with coverage metadata.
- Pause/resume automatic refresh, inspect the last retrieval time, and retain the previous snapshot after a refresh failure. Old responses cannot overwrite a different board or query.
- Hide account values and disable CSV exports. Public market prices remain visible.
- Concurrent reads share upstream work. Portfolio/records cache for 30 seconds; markets cache for 60 seconds. Explicit refresh bypasses the cache (`force=1` on the corresponding HTTP endpoints). Record caches retain at most eight query ranges.

`examples/sample-dashboard.html` opens without a server (`npm run sample` rebuilds it with synthetic data). Sample date presets use the captured snapshot date, so older samples remain useful.

## Scope

Quantities include locked balances; amounts use exact BigInt decimals and are returned as decimal strings; unknown values are `null`. Unrealized P&L uses the API average cost of current holdings and excludes fees and realized P&L. Recorded history includes deposits/withdrawals and is never back-filled. Compatibility with the official MCP SDK client (1.32.1) was verified; **live account access with real API keys has not been verified yet.**

## License

[MIT](./LICENSE)
