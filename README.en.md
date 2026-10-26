English | [한국어](./README.md)

# Bithumb Asset Toolkit · MCP

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

15 tools: `dashboard_snapshot` (one compact, chart-ready call; renders inline in MCP Apps clients), `portfolio_get_summary`, `portfolio_get_holdings`, `portfolio_get_allocation`, `portfolio_get_history` (`daily: true` for daily asset changes), `portfolio_get_report`, `market_get_candles`, `account_get_records` (bounded pages and continuation, ≤366 days), `account_get_orders`, `account_get_transfers`, `system_diagnose`, `dashboard_list_boards`, `dashboard_save_board` (`open: true` saves and opens in one call), `dashboard_open` (starts the local dashboard and returns its URL; `boardId` selects a board), `dashboard_get_template`.

**0.5.0 — drawing dashboards:** `dashboard_snapshot` returns the summary, top holdings plus an exact `others` slice, a columnar trend (60 points by default, endpoints preserved) and optional daily changes in one response: about 2.6KB for 30 days and 3.7KB for a year on the demo account, versus four calls (about 6.5KB) or a 32KB year of history before. `boardId` reuses a saved board's scope and period. In MCP Apps clients (Claude, ChatGPT, VS Code, …) the tool's `_meta.ui.resourceUri` points to `ui://bithumb-asset-kit/dashboard.html` (`text/html;profile=mcp-app`), so the dashboard is drawn inside the conversation, with period switching, refresh, hide-amounts and "open local dashboard". The view needs no network access. Local dashboard links accept `?board=<id>`, and an open dashboard picks up boards saved through MCP within seconds.

In 0.4.0, holdings support search, gain/loss filters, exact sorting, fields, limits and offsets. Summary/holdings/allocation/market/report accept `force:true`; reports can select `sections`; history accepts `maxPoints`. Every tool publishes an output schema and actionable tool errors.

**Migration:** `account_get_records` now defaults to at most 50 returned rows and 5 upstream pages per call. Continue with the same `kind` and `pagination.nextCursor` as `cursor`, even if `rows` is empty. Filters stay fixed; fields may be selected on each call. Totals cover only that response's rows; `coverage.complete` describes the entire cursor chain, not just the last page. Tokens are process-local, expire 10 minutes after the query starts, and have a 32-token storage bound. Each chain permits at most 1,000 upstream pages/10,000 matching IDs; narrow the query on `QUERY_LIMIT`. Account changes during paging are not an atomic snapshot. HTTP/CLI collection behavior is unchanged.

Progress uses `_meta.progressToken` and `notifications/progress`; cancellation uses `notifications/cancelled`. Cancelling a private order/transfer request stops its HTTP request and retries. Shared reads continue if another subscriber still needs them. Get dashboard source only when needed: `dashboard_get_template` with `manifest:true`, then selected `paths`.

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

Quantities include locked balances; amounts use exact BigInt decimals and are returned as decimal strings; unknown values are `null`. Unrealized P&L uses the API average cost of current holdings and excludes fees and realized P&L. Recorded history includes deposits/withdrawals and is never back-filled. Compatibility with official MCP SDK 1.32.2 was verified using a real stdio client, all 15 output schemas, the MCP Apps view resource, progress, cancellation and cursor replay. Run `npm run verify:mcp-sdk` with `MCP_SDK_ROOT` pointing to an external SDK installation; normal `npm test` remains dependency-free. **Live account access with real API keys has not been verified yet.**

## License

[MIT](./LICENSE)
