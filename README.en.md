English | [한국어](./README.md)

# Bithumb Asset Dashboard Kit

An **MCP server** that connects a Bithumb account's balances, valuation, allocation, daily P&L, orders, and deposit/withdrawal history to AI clients. Ask “build a dashboard from my assets” and the AI saves a layout and opens a local dashboard.

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

14 tools: `portfolio_get_summary`, `portfolio_get_holdings`, `portfolio_get_allocation`, `portfolio_get_history` (`daily: true` for daily P&L), `portfolio_get_report`, `market_get_candles`, `account_get_records` (whole period, ≤366 days), `account_get_orders`, `account_get_transfers`, `system_diagnose`, `dashboard_list_boards`, `dashboard_save_board`, `dashboard_open` (starts the local dashboard and returns its URL), `dashboard_get_template`.

## Keys

Create a **read-only** API key with an allowed IP at [Bithumb API management](https://www.bithumb.com/react/api-support/management-api), then run `node cli/asset-kit.js config init` (hidden input, saved with 0600 permissions) and `node cli/asset-kit.js doctor`. `BITHUMB_ACCESS_KEY`/`BITHUMB_SECRET_KEY` environment variables take precedence. Never paste keys into AI chat.

## Dashboard and CLI

```bash
npm run demo     # synthetic data at http://127.0.0.1:4319
npm start        # live account
node cli/asset-kit.js --help
```

Multiple dashboards (tabs) with per-board widgets, asset scope, period (7/30/90 days, 1 year), and refresh; value trend ↔ daily P&L calendar; asset detail with 30-day prices; range queries for orders and transfers. `examples/sample-dashboard.html` opens without a server (`npm run sample` rebuilds it with synthetic data).

## Scope

Quantities include locked balances; amounts use exact BigInt decimals and are returned as decimal strings; unknown values are `null`. Unrealized P&L uses the API average cost of current holdings and excludes fees and realized P&L. Recorded history includes deposits/withdrawals and is never back-filled. Compatibility with the official MCP SDK client (1.32.1) was verified; **live account access with real API keys has not been verified yet.**

## License

[MIT](./LICENSE)
