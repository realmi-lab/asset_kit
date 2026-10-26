---
name: bithumb-asset-dashboard
description: Explain a user's Bithumb balances, valuation, allocation, daily asset changes, and read-only order or transfer history, and build or open their personal asset dashboard, using the Bithumb Asset Kit MCP server (bithumb-asset-kit) or its CLI. Does not execute trades, cancellations, or transfers.
---

# Bithumb asset dashboard

Use the `bithumb-asset-kit` MCP server's tools. It is separate from the official Bithumb Trade Kit, which can trade; this kit only reads account data and stores local dashboard layouts.

## 1. Establish the data source

1. On first use or after a connection error, call `system_diagnose` (mode, active modules, key status and expiry, API connectivity). Relay its `warnings` (for example a key expiring within 14 days). Do not repeat these probes for every question. `mode=demo` means synthetic data; say so in every answer, chart, or export.
2. If `auth.configured` is false, tell the user to run `asset-kit config init` (or `node <kit>/cli/asset-kit.js config init`) in their own terminal, then `asset-kit doctor`. Never ask for key values in chat and never pass keys as tool input.
3. Never substitute demo data for a failed live call. Report the error code and message.

## 2. Answer questions

| Question | Tool |
| --- | --- |
| Show or draw a dashboard / chart of my assets | `dashboard_snapshot` (one call: summary, top holdings + `others`, columnar trend; `boardId`, `days`, `daily`) |
| Total value, unrealized P&L, top assets | `portfolio_get_summary` (`symbols` narrows the scope) |
| Per-asset quantity, cost, price, value | `portfolio_get_holdings` (search/filter/sort, `fields`, `limit`, `offset`) |
| Allocation | `portfolio_get_allocation` |
| Value trend / daily asset changes calendar | `portfolio_get_history` (`days` 1–365, `daily: true`) |
| Price chart of a coin | `market_get_candles` (`interval` 1m…4h/day/week/month, `ohlc: true` for candlesticks, `to` for older ranges) |
| Top movers, traded value, market vs my coins | `market_get_tickers` (`scope: all` needs no key; `held` marks my assets) |
| Exchange alerts or caution-designated coins | `market_get_warnings` (`scope: holdings` by default) |
| Orders or deposits/withdrawals over a period | `account_get_records` (`kind`, `from`, `to` as YYYY-MM-DD, KST, ≤366 days) |
| One page with cursors | `account_get_orders`, `account_get_transfers` |
| Selected report sections | `portfolio_get_report` (`sections`; empty array skips account history calls) |

Preserve meaning:

- Amounts and quantities are decimal strings. Do not recompute totals with floating point; reuse returned totals.
- Quantity = available + locked. Missing values are `null`, not zero. Pass on `warnings`, `valuationComplete`, `profitComplete`, `mode`, and `asOf`.
- Unrealized P&L uses the API average cost of current holdings; it excludes fees and realized P&L.
- History and daily asset changes are recorded portfolio values and include deposits/withdrawals. Never call them investment returns or back-fill history from today's holdings.
- Start with the summary. Select only needed `symbols`, `fields`, and `limit`; use `force:true` when the user asks for fresh data. Identity, warnings and quality flags survive field selection.
- `account_get_records` returns at most 50 rows/5 upstream pages by default. Continue using the same `kind` and `pagination.nextCursor` as `cursor`, even after empty rows. Keep the original filters; repeat `fields` if needed. Stop when nextCursor is null, and still report incomplete coverage if unknown timestamps were excluded.
- Record `totals` cover only the returned rows. `coverage.complete` is the exhaustion state of the entire continuation chain, not a claim that the final response contains every row. A retried cursor replays the same page: do not double-count it.
- Cursors are process-local, last 10 minutes and may be evicted. On `CURSOR_EXPIRED`, restart the period without a cursor; do not append the restarted run to old totals. Split the period on `QUERY_LIMIT`. Changing account pages are not an atomic snapshot.
- To draw anything (an inline chart, an artifact, a dashboard answer) call `dashboard_snapshot` once instead of summary + allocation + history. `trend.at[i]` pairs with `trend.valueKrw[i]`; `holdings` plus `others` add up exactly to `summary.totalValueKrw`; `trend.omitted` counts unpriced points left out. In MCP Apps clients the result is already drawn in the conversation, so do not redraw it; summarize the numbers instead.
- For output reduction use `portfolio_get_history.maxPoints` on trends, report `sections`, and template `manifest:true` followed by specific `paths`. Report symbols narrow the portfolio only, not the account-history sections.
- Use `retryable` and `recovery` in tool errors. Invalid input includes a `path` without echoing its value. MCP progress and cancellation are client protocol features, not extra tools.

## 3. Build the user's dashboard

1. `dashboard_list_boards` → see existing layouts.
2. `dashboard_save_board` with `open: true` → create (no `id`) or update (`id` + `revision`; omitted fields keep their values), start the local dashboard and get `url` (127.0.0.1, `?board=<id>` selects the new board) in one call. Widgets: `summary`, `trend`, `allocation`, `holdings`, `activity` (array order = screen order). `symbols` empty = whole account. `days` 7/30/90/365, `refreshSeconds` 0/30/60/300.
3. Give the `url` to the user. Use `dashboard_open` (optionally with `boardId`) only to reopen. A dashboard already open in the browser picks up saved boards within seconds; do not ask the user to reload.
4. To preview the board in the conversation, call `dashboard_snapshot` with its `boardId`.
5. For a completely custom screen, call `dashboard_get_template` with `manifest:true`, then request needed `paths`. Save edited files to a folder and run `asset-kit dashboard --web-dir <folder>`. Do not fetch source files for ordinary asset questions.

Without MCP, the CLI equivalents are `asset-kit portfolio|explain|history|market|records|report|boards|dashboard`; data commands print JSON.

The dashboard is a single-user loopback app. Do not publish account snapshots as a website; a shared deployment needs separate authentication and data isolation. State whether live account access was actually verified.
