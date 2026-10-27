// 입출금을 뺀 실제 수익, 실현손익, 월별 리포트. 금액은 모두 십진 문자열이고 계산은 BigInt 십진수로 합니다.
import { dec } from './decimal.js';

const DAY = 86400000, KST = 9 * 3600000;
const EPSILON = dec('0.00000001');
// 완료되지 않은 입출금 상태(진행·대기·취소·거절·실패)는 흐름에서 뺍니다.
const UNFINISHED = /PROCESS|WAIT|CANCEL|REJECT|FAIL|HOLD|REFUND|ALMOST/i;
export const kstMonth = time => new Date(time + KST).toISOString().slice(0, 7);
export const kstDate = time => new Date(time + KST).toISOString().slice(0, 10);
export const monthStart = month => Date.parse(`${month}-01T00:00:00+09:00`);
const nextMonth = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
const sum = values => values.reduce((total, value) => total.plus(value ?? 0), dec(0));
const fixed = (value, places = 0) => value === null ? null : value.toFixed(places);
const positive = value => value !== null && value !== undefined && dec(value).gt(0);

/** First day (KST) of the earliest month in a window of `months` calendar months ending now. */
export function returnsWindow(months, now = Date.now()) {
  let month = kstMonth(now);
  for (let i = 1; i < months; i++) { const [y, m] = month.split('-').map(Number); month = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); }
  return { start: monthStart(month), end: now, firstMonth: month };
}

/** Last recorded value at or before `time`; history is sorted oldest first. */
function lastPoint(history, time) {
  let found = null;
  for (const point of history) { if (Date.parse(point.asOf) <= time) found = point; else break; }
  return found;
}

/**
 * Average-cost realized P&L of one coin's sells inside the window, net of the sell fee.
 * The position at the window start is zero when the whole position was built inside the window; otherwise it is worked
 * back from today's quantity and average cost (an average-cost sale never changes the average). From there the window is
 * replayed forward: a buy's fee joins the cost of the coins bought, and coin deposits enter at that day's close.
 * Coins bought before the window keep the exchange's average price, which leaves out their buy fees.
 */
export function realizedFor({ events, quantity, averagePrice }) {
  const sells = events.filter(e => e.type === 'sell');
  if (!sells.length) return { status: 'ok', realized: dec(0), cost: dec(0), sales: [] };
  let start = dec(quantity ?? 0);
  for (const e of events) {
    if (e.type === 'buy' || e.type === 'in') start = start.minus(e.qty);
    else start = start.plus(e.qty);
  }
  const priced = events.every(e => e.type !== 'in' || e.price !== null);
  if (!priced) return { status: 'unknown', reason: '입금된 코인의 그날 가격을 확인할 수 없습니다.' };
  let q = dec(0), c = dec(0);
  // Held before the window: walk back from today's position to the quantity and cost at the window start.
  if (start.cmp(EPSILON) > 0 || start.cmp(EPSILON.times(-1)) < 0) {
    if (start.cmp(0) < 0) return { status: 'unknown', reason: '기간 안의 매수·입금이 현재 수량보다 많습니다. 기록이 일부 빠졌을 수 있습니다.' };
    if (!positive(quantity) || !positive(averagePrice)) return { status: 'unknown', reason: '기간 시작 전에 보유하던 수량의 평균 매수가를 알 수 없습니다.' };
    q = dec(quantity); c = dec(quantity).times(averagePrice);
    for (const e of [...events].reverse()) {
      if (e.type === 'buy') { q = q.minus(e.qty); c = c.minus(e.funds); }
      else if (e.type === 'in') { q = q.minus(e.qty); c = c.minus(dec(e.qty).times(e.price)); }
      else {
        if (q.cmp(EPSILON) <= 0) return { status: 'unknown', reason: '기간 중 전량 매도한 뒤 다시 산 자산이라 당시 평균 매수가를 알 수 없습니다.' };
        c = c.plus(c.times(e.qty).div(q, 8)); q = q.plus(e.qty);
      }
      if (q.cmp(EPSILON.times(-1)) < 0 || c.cmp(dec(-1)) < 0) return { status: 'unknown', reason: '기록과 현재 잔고가 맞지 않습니다.' };
    }
  }
  let realized = dec(0), costTotal = dec(0);
  const sales = [];
  for (const e of events) {
    if (e.type === 'buy') { q = q.plus(e.qty); c = c.plus(e.funds).plus(e.fee ?? 0); }
    else if (e.type === 'in') { q = q.plus(e.qty); c = c.plus(dec(e.qty).times(e.price)); }
    else {
      if (q.cmp(EPSILON) <= 0) return { status: 'unknown', reason: '보유 수량보다 많은 매도·출금이 있습니다.' };
      const cost = c.times(e.qty).div(q, 8);
      if (e.type === 'sell') { const gain = dec(e.funds).minus(e.fee).minus(cost); realized = realized.plus(gain); costTotal = costTotal.plus(cost); sales.push({ at: e.at, realized: gain }); }
      q = q.minus(e.qty); c = c.minus(cost);
    }
  }
  return { status: 'ok', realized, cost: costTotal, sales };
}

/**
 * Flow-adjusted performance over whole KST months.
 * @param {object} input
 * @param {object[]} input.history recorded totals [{ asOf, totalValueKrw }], oldest first
 * @param {(symbol: string, day: string) => string|null} input.closeOn KRW daily close of a coin on a KST day
 */
export function computeReturns({ months, now = Date.now(), holdings = [], currentValueKrw, orders = [], krwDeposits = [], krwWithdrawals = [], coinDeposits = [], coinWithdrawals = [], history = [], closeOn = () => null, names = {} }) {
  const window = returnsWindow(months, now), time = row => Date.parse(row.at);
  // Transfers from the week before the window only carry an earlier valuation up to the window start; they are not the window's flows.
  const known = row => Number.isFinite(time(row)) && time(row) <= now, inWindow = row => known(row) && time(row) >= window.start;
  const finished = row => !UNFINISHED.test(String(row.state ?? ''));
  const skipped = { btcMarketOrders: 0, unpricedFlows: 0 };
  // Cash flows: positive into the account, negative out. Coin transfers are valued at that day's close.
  const flows = [], fees = [];
  for (const row of krwDeposits.filter(r => known(r) && finished(r))) flows.push({ at: time(row), krw: dec(row.amount), kind: 'deposit' });
  for (const row of krwWithdrawals.filter(r => known(r) && finished(r))) {
    flows.push({ at: time(row), krw: dec(row.amount).times(-1), kind: 'withdrawal' });
    if (inWindow(row) && positive(row.fee)) fees.push({ at: time(row), krw: dec(row.fee) });
  }
  const coinEvents = new Map(), event = (symbol, value) => { if (!coinEvents.has(symbol)) coinEvents.set(symbol, []); coinEvents.get(symbol).push(value); };
  for (const [rows, sign] of [[coinDeposits, 1], [coinWithdrawals, -1]]) for (const row of rows.filter(r => known(r) && finished(r) && r.currency !== 'KRW')) {
    const at = time(row), close = closeOn(row.currency, kstDate(at)), windowed = at >= window.start;
    const quantity = sign > 0 ? dec(row.amount) : dec(row.amount).plus(row.fee ?? 0);
    if (windowed) event(row.currency, { type: sign > 0 ? 'in' : 'out', qty: quantity.toFixed(), price: close, at });
    if (close === null) { if (windowed) skipped.unpricedFlows++; continue; }
    flows.push({ at, krw: dec(row.amount).times(close).times(sign), kind: sign > 0 ? 'coinIn' : 'coinOut' });
    if (windowed && sign < 0 && positive(row.fee)) fees.push({ at, krw: dec(row.fee).times(close) });
  }
  const windowFlows = flows.filter(f => f.at >= window.start);
  // Trades: only KRW markets have KRW proceeds; BTC-market trades are counted and left out.
  const trades = [];
  for (const row of orders.filter(r => inWindow(r) && positive(r.executed_volume))) {
    const [quote, symbol] = String(row.market).split('-');
    if (quote !== 'KRW') { skipped.btcMarketOrders++; continue; }
    const at = Date.parse(row.at), side = row.side === 'bid' ? 'buy' : 'sell';
    trades.push({ at, side, funds: dec(row.executed_funds ?? 0), fee: dec(row.paid_fee ?? 0) });
    if (positive(row.paid_fee)) fees.push({ at, krw: dec(row.paid_fee) });
    event(symbol, { type: side, qty: row.executed_volume, funds: row.executed_funds ?? '0', fee: row.paid_fee ?? '0', at });
  }
  // Realized P&L per coin, attributed to the month of each sale.
  const bySymbol = new Map(holdings.map(h => [h.symbol, h])), realized = [], saleGains = [];
  for (const [symbol, events] of coinEvents) {
    events.sort((a, b) => a.at - b.at);
    const sells = events.filter(e => e.type === 'sell');
    if (!sells.length) continue;
    const holding = bySymbol.get(symbol), result = realizedFor({ events, quantity: holding?.quantity ?? '0', averagePrice: holding?.averagePriceKrw ?? null });
    const proceeds = sum(sells.map(e => dec(e.funds).minus(e.fee)));
    realized.push({ symbol, name: holding?.name ?? names[symbol] ?? symbol, sells: sells.length, proceedsKrw: fixed(proceeds),
      costKrw: result.status === 'ok' ? fixed(result.cost) : null, realizedKrw: result.status === 'ok' ? fixed(result.realized) : null,
      status: result.status, ...(result.reason ? { reason: result.reason } : {}) });
    if (result.status === 'ok') for (const sale of result.sales) saleGains.push(sale);
  }
  realized.sort((a, b) => (b.realizedKrw === null) - (a.realizedKrw === null) || dec(b.realizedKrw ?? 0).cmp(a.realizedKrw ?? 0));
  // Month rows.
  const points = history.filter(p => p.totalValueKrw !== null && p.valuationComplete !== false).sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
  // The value at `boundary` (inclusive): the last valuation from the week before it, carried forward by the flows in between
  // (a deposit raises the value by itself, so it never shows up as profit), or today's value for the running month.
  const valueAt = boundary => {
    if (boundary >= now) return currentValueKrw === undefined || currentValueKrw === null ? null : dec(currentValueKrw);
    const point = lastPoint(points, boundary), recorded = point ? Date.parse(point.asOf) : null;
    if (recorded === null || recorded < boundary - 7 * DAY) return null;
    return dec(point.totalValueKrw).plus(sum(flows.filter(f => f.at > recorded && f.at <= boundary).map(f => f.krw)));
  };
  const startValue = valueAt(window.start - 1), monthly = [];
  for (let month = window.firstMonth; monthStart(month) <= now; month = nextMonth(month)) {
    const from = monthStart(month), to = Math.min(monthStart(nextMonth(month)) - 1, now), within = item => item.at >= from && item.at <= to;
    const monthFlows = flows.filter(within), byKind = kind => sum(monthFlows.filter(f => f.kind === kind).map(f => f.krw));
    const netFlow = sum(monthFlows.map(f => f.krw));
    const previous = monthly.at(-1);
    const start = previous ? (previous.endValueKrw === null ? null : dec(previous.endValueKrw)) : startValue;
    const end = valueAt(to);
    const profit = start !== null && end !== null ? end.minus(start).minus(netFlow) : null;
    // Modified Dietz: each flow counts for the part of the month it was invested.
    const weighted = start === null ? null : start.plus(sum(monthFlows.map(f => f.krw.times(Math.max(0, Math.round((to - f.at) / Math.max(to - from, 1) * 10000))).div(10000, 8))));
    monthly.push({ month, depositsKrw: fixed(byKind('deposit')), withdrawalsKrw: fixed(byKind('withdrawal').times(-1)), coinInKrw: fixed(byKind('coinIn')), coinOutKrw: fixed(byKind('coinOut').times(-1)),
      netFlowKrw: fixed(netFlow), buyKrw: fixed(sum(trades.filter(t => t.side === 'buy' && within(t)).map(t => t.funds))), sellKrw: fixed(sum(trades.filter(t => t.side === 'sell' && within(t)).map(t => t.funds))),
      realizedKrw: fixed(sum(saleGains.filter(within).map(s => s.realized))), feesKrw: fixed(sum(fees.filter(within).map(f => f.krw))),
      startValueKrw: fixed(start), endValueKrw: fixed(end), profitKrw: fixed(profit),
      profitRatePct: profit !== null && weighted !== null && weighted.gt(0) ? profit.times(100).div(weighted, 4).toFixed(4) : null });
  }
  // Whole window: from its start when history reaches back that far, otherwise from the first valuation inside it.
  const firstPoint = startValue === null ? points.find(p => Date.parse(p.asOf) >= window.start) ?? null : null;
  const v0 = startValue ?? (firstPoint ? dec(firstPoint.totalValueKrw) : null), t0 = startValue !== null ? window.start : firstPoint ? Date.parse(firstPoint.asOf) : null;
  const v1 = currentValueKrw === undefined || currentValueKrw === null ? null : dec(currentValueKrw);
  const counted = t0 === null ? [] : startValue !== null ? windowFlows : flows.filter(f => f.at > t0);
  const netFlow = sum(counted.map(f => f.krw)), profit = v0 !== null && v1 !== null ? v1.minus(v0).minus(netFlow) : null;
  const weighted = v0 === null ? null : v0.plus(sum(counted.map(f => f.krw.times(Math.max(0, Math.round((now - f.at) / Math.max(now - t0, 1) * 10000))).div(10000, 8))));
  const total = kind => sum(windowFlows.filter(f => f.kind === kind).map(f => f.krw));
  const realizedKnown = realized.filter(r => r.status === 'ok');
  return {
    months, period: { from: new Date(window.start).toISOString(), to: new Date(now).toISOString(), firstMonth: window.firstMonth },
    summary: {
      startValueKrw: fixed(v0), startAt: t0 === null ? null : new Date(t0).toISOString(), endValueKrw: fixed(v1), changeKrw: v0 !== null && v1 !== null ? fixed(v1.minus(v0)) : null,
      netFlowKrw: fixed(netFlow), depositsKrw: fixed(total('deposit')), withdrawalsKrw: fixed(total('withdrawal').times(-1)), coinInKrw: fixed(total('coinIn')), coinOutKrw: fixed(total('coinOut').times(-1)),
      profitKrw: fixed(profit), profitRatePct: profit !== null && weighted !== null && weighted.gt(0) ? profit.times(100).div(weighted, 4).toFixed(4) : null,
      realizedKrw: fixed(sum(realizedKnown.map(r => r.realizedKrw))), realizedComplete: realizedKnown.length === realized.length,
      feesKrw: fixed(sum(fees.map(f => f.krw))), buyKrw: fixed(sum(trades.filter(t => t.side === 'buy').map(t => t.funds))), sellKrw: fixed(sum(trades.filter(t => t.side === 'sell').map(t => t.funds))),
      trades: trades.length, transfers: windowFlows.length,
    },
    monthly, realized, skipped,
    history: { from: points[0]?.asOf ?? null, coversStart: startValue !== null },
  };
}
