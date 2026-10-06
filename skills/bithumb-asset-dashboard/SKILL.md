---
name: bithumb-asset-dashboard
description: Explain a user's Bithumb balances, valuation, allocation, daily P&L, and read-only order or transfer history, and build or open their personal asset dashboard, using the Bithumb Asset Kit MCP server (bithumb-asset-kit) or its CLI. Does not execute trades, cancellations, or transfers.
---

# Bithumb asset dashboard

Use the `bithumb-asset-kit` MCP server's tools. It is separate from the official Bithumb Trade Kit, which can trade; this kit only reads account data and stores local dashboard layouts.

## 1. Establish the data source

1. Call `system_diagnose` (mode, active modules, key status, API connectivity). `mode=demo` means synthetic data; say so in every answer, chart, or export.
2. If `auth.configured` is false, tell the user to run `asset-kit config init` (or `node <kit>/cli/asset-kit.js config init`) in their own terminal, then `asset-kit doctor`. Never ask for key values in chat and never pass keys as tool input.
3. Never substitute demo data for a failed live call. Report the error code and message.

## 2. Answer questions

| Question | Tool |
| --- | --- |
| Total value, unrealized P&L, top assets | `portfolio_get_summary` (`symbols` narrows the scope) |
| Per-asset quantity, cost, price, value | `portfolio_get_holdings` |
| Allocation | `portfolio_get_allocation` |
| Value trend / daily P&L calendar | `portfolio_get_history` (`days` 1–365, `daily: true`) |
| Price chart of a coin | `market_get_candles` |
| Orders or deposits/withdrawals over a period | `account_get_records` (`kind`, `from`, `to` as YYYY-MM-DD, KST, ≤366 days) |
| One page with cursors | `account_get_orders`, `account_get_transfers` |
| Everything at once | `portfolio_get_report` |

Preserve meaning:

- Amounts and quantities are decimal strings. Do not recompute totals with floating point; reuse returned totals.
- Quantity = available + locked. Missing values are `null`, not zero. Pass on `warnings`, `valuationComplete`, `profitComplete`, `mode`, and `asOf`.
- Unrealized P&L uses the API average cost of current holdings; it excludes fees and realized P&L.
- History and daily P&L are recorded portfolio values and include deposits/withdrawals. Never call them investment returns or back-fill history from today's holdings.
- If `coverage.complete` is false, only some pages were collected. Never present a first page as full history.

## 3. Build the user's dashboard

1. `dashboard_list_boards` → see existing layouts.
2. `dashboard_save_board` → create (no `id`) or update (`id` + `revision`; omitted fields keep their values). Widgets: `summary`, `trend`, `allocation`, `holdings`, `activity` (array order = screen order). `symbols` empty = whole account. `days` 7/30/90/365, `refreshSeconds` 0/30/60/300.
3. `dashboard_open` → returns a local URL (127.0.0.1). Give it to the user; the board appears as a tab.
4. For a completely custom screen, call `dashboard_get_template`, save the edited files to a folder, and run `asset-kit dashboard --web-dir <folder>`.

Without MCP, the CLI equivalents are `asset-kit portfolio|explain|history|market|records|report|boards|dashboard`; data commands print JSON.

The dashboard is a single-user loopback app. Do not publish account snapshots as a website; a shared deployment needs separate authentication and data isolation. State whether live account access was actually verified.
