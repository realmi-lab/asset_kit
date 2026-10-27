import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHoldings, filterActivity, csvText, recordDates, dateRangeError } from '../web/dashboard-utils.js';

const holdings = Object.freeze([
  Object.freeze({ symbol: 'KRW', name: '원화', valueKrw: '100', profitKrw: null, profitRatePct: null, priceChangePct: null }),
  Object.freeze({ symbol: 'BTC', name: '비트코인', valueKrw: '300', profitKrw: '40', profitRatePct: '15.4', priceChangePct: '-1.5' }),
  Object.freeze({ symbol: 'ETH', name: '이더리움', valueKrw: '200', profitKrw: '-20', profitRatePct: '-9.1', priceChangePct: '2.1' }),
  Object.freeze({ symbol: 'SOL', name: '솔라나', valueKrw: '200', profitKrw: '0', profitRatePct: '0', priceChangePct: '0' }),
  Object.freeze({ symbol: 'AAA', name: 'Unknown Asset', valueKrw: null, profitKrw: null, profitRatePct: null, priceChangePct: null }),
]);
const symbols = rows => rows.map(row => row.symbol);

test('holdings search covers Korean names and case-insensitive symbols without changing the source', () => {
  assert.deepEqual(symbols(filterHoldings(holdings, { search: ' bTc ' })), ['BTC']);
  assert.deepEqual(symbols(filterHoldings(holdings, { search: '이더' })), ['ETH']);
  assert.deepEqual(symbols(filterHoldings(holdings, { search: 'unknown asset' })), ['AAA']);
  assert.deepEqual(symbols(filterHoldings(holdings)), ['BTC', 'ETH', 'SOL', 'KRW', 'AAA']);
  assert.deepEqual(symbols(holdings), ['KRW', 'BTC', 'ETH', 'SOL', 'AAA']);
  assert.notEqual(filterHoldings(holdings), holdings);
});

test('gain, loss and unknown filters exclude cash and do not count break-even as gain or loss', () => {
  assert.deepEqual(symbols(filterHoldings(holdings, { performance: 'gain' })), ['BTC']);
  assert.deepEqual(symbols(filterHoldings(holdings, { performance: 'loss' })), ['ETH']);
  assert.deepEqual(symbols(filterHoldings(holdings, { performance: 'unknown' })), ['AAA']);
  assert.deepEqual(symbols(filterHoldings(holdings, { excludeCash: true })), ['BTC', 'ETH', 'SOL', 'AAA']);
  assert.deepEqual(filterHoldings(holdings, { excludeCash: true, search: '원화' }), []);
});

test('each numeric sort uses its own data field, keeps missing values last, and breaks ties by symbol', () => {
  assert.deepEqual(symbols(filterHoldings(holdings, { sort: 'value', direction: 'asc' })), ['KRW', 'ETH', 'SOL', 'BTC', 'AAA']);
  assert.deepEqual(symbols(filterHoldings(holdings, { sort: 'profit' })), ['BTC', 'SOL', 'ETH', 'AAA', 'KRW']);
  assert.deepEqual(symbols(filterHoldings(holdings, { sort: 'pnl', direction: 'asc' })), ['ETH', 'SOL', 'BTC', 'AAA', 'KRW']);
  assert.deepEqual(symbols(filterHoldings(holdings, { sort: 'change' })), ['ETH', 'SOL', 'BTC', 'AAA', 'KRW']);
  assert.deepEqual(symbols(filterHoldings(holdings, { sort: 'change', direction: 'asc' })), ['BTC', 'SOL', 'ETH', 'AAA', 'KRW']);
  assert.deepEqual(symbols(filterHoldings([{ symbol: 'ZZZ', valueKrw: '' }, { symbol: 'AAA', valueKrw: 'bad' }, { symbol: 'BTC', valueKrw: '-1' }], { direction: 'asc' })), ['BTC', 'AAA', 'ZZZ']);
});

test('decimal sorting preserves amounts beyond Number precision and tiny profit signs', () => {
  const precise = [
    { symbol: 'AAA', valueKrw: '9007199254740992.00000001', profitKrw: '1e-400' },
    { symbol: 'BBB', valueKrw: '9007199254740992.00000002', profitKrw: '-1e-400' },
    { symbol: 'CCC', valueKrw: '0.0000000000000000002', profitKrw: '-0.0000' },
    { symbol: 'DDD', valueKrw: '-0.0000000000000000001', profitKrw: null },
  ];
  assert.deepEqual(symbols(filterHoldings(precise)), ['BBB', 'AAA', 'CCC', 'DDD']);
  assert.deepEqual(symbols(filterHoldings(precise, { performance: 'gain' })), ['AAA']);
  assert.deepEqual(symbols(filterHoldings(precise, { performance: 'loss' })), ['BBB']);
  assert.deepEqual(symbols(filterHoldings([{ symbol: 'B', valueKrw: '-1.20' }, { symbol: 'A', valueKrw: '-1.2' }, { symbol: 'C', valueKrw: '-1.19' }])), ['C', 'A', 'B']);
});

test('name sort follows its direction but equal names still use ascending symbols', () => {
  const rows = [{ symbol: 'B', name: 'Beta' }, { symbol: 'Z', name: 'Alpha' }, { symbol: 'A', name: 'Alpha' }];
  assert.deepEqual(symbols(filterHoldings(rows, { sort: 'name', direction: 'asc' })), ['A', 'Z', 'B']);
  assert.deepEqual(symbols(filterHoldings(rows, { sort: 'name', direction: 'desc' })), ['B', 'A', 'Z']);
});

test('activity filters combine board scope, text, state and side without mutating order or input', () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'a', market: 'KRW-BTC', state: 'done', side: 'bid' }),
    Object.freeze({ id: 'b', market: 'BTC-ETH', state: 'wait', side: 'ask' }),
    Object.freeze({ id: 'c', currency: 'BTC', state: 'ACCEPTED' }),
    Object.freeze({ id: 'd', market: 'KRW-BTC', state: 'cancel', side: 'ask' }),
    Object.freeze({ id: 'e', currency: 'KRW', state: 'ACCEPTED' }),
  ]);
  const ids = options => filterActivity(rows, options).map(row => row.id);
  assert.deepEqual(ids({ symbols: ['btc'] }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ symbols: ['BTC'], search: 'KRW-btc', status: 'done', side: 'bid' }), ['a']);
  assert.deepEqual(ids({ search: 'accepted' }), ['c', 'e']);
  assert.deepEqual(ids({ symbols: ['ETH'], search: 'btc' }), ['b']);
  assert.deepEqual(ids({ status: 'ACCEPTED', side: 'ask' }), []);
  assert.deepEqual(ids({ status: 'accepted' }), []);
  assert.notEqual(filterActivity(rows), rows);
  assert.deepEqual(filterActivity(rows), rows);
});

test('CSV retains Unicode, nulls and numeric losses with BOM, CRLF and escaped quoted cells', () => {
  const rows = [['자산', '내용', '금액'], ['BTC', '쉼표, "인용"\n다음 줄', '-123.4500'], ['ETH', null, -0.002]];
  assert.equal(csvText(rows), '\uFEFF"자산","내용","금액"\r\n"BTC","쉼표, ""인용""\n다음 줄","-123.4500"\r\n"ETH","","-0.002"');
  assert.equal(csvText([]), '\uFEFF');
});

test('CSV neutralizes formula injection and leading whitespace/control bypasses', () => {
  const dangerous = ['=1+1', '+SUM(A1)', '@SUM(A1)', '-SUM(A1)', '  =HYPERLINK("example")', '\t=1', '\r=1', '\n=1', '  \tBTC', '\uFEFF+1', '  -1+2', '-1.2.3'];
  for (const value of dangerous) assert.equal(csvText([[value]]), `\uFEFF"'${value.replace(/"/g, '""')}"`, value);
  for (const value of ['-1', '-0.12', '-.5', '-1e-8', ' -12.50 ', 'BTC', "'=1+1", 'a=b']) assert.equal(csvText([[value]]), `\uFEFF"${value}"`, value);
});

test('inclusive KST presets handle UTC midnight boundaries, months and leap days', () => {
  const boundary = Date.parse('2026-10-25T15:00:00.000Z');
  assert.deepEqual(recordDates(7, boundary), { from: '2026-10-20', to: '2026-10-26' });
  assert.deepEqual(recordDates('7', boundary - 1), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(recordDates('30', Date.parse('2024-03-01T00:00:00Z')), { from: '2024-02-01', to: '2024-03-01' });
  assert.deepEqual(recordDates('month', Date.parse('2026-10-31T15:00:00Z')), { from: '2026-11-01', to: '2026-11-01' });
  assert.throws(() => recordDates('year', boundary), RangeError);
  assert.throws(() => recordDates(7, NaN), RangeError);
});

test('date validation rejects invalid calendar dates, malformed input and reversed ranges', () => {
  for (const value of ['', '2026-2-01', '2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-01-01T00:00:00Z', null, undefined]) {
    assert.match(dateRangeError(value, '2026-10-26'), /실제 날짜/, String(value));
    assert.match(dateRangeError('2026-01-01', value), /실제 날짜/, String(value));
  }
  assert.match(dateRangeError('2026-10-27', '2026-10-26'), /종료일보다/);
  assert.equal(dateRangeError('2024-02-29', '2024-02-29'), '');
  assert.equal(dateRangeError('2026-10-26', '2026-10-26'), '');
});

test('maximum date range counts both endpoints and matches leap/non-leap year boundaries', () => {
  assert.equal(dateRangeError('2024-01-01', '2024-12-31'), '');
  assert.match(dateRangeError('2024-01-01', '2025-01-01'), /366일/);
  assert.equal(dateRangeError('2025-01-01', '2026-01-01'), '');
  assert.match(dateRangeError('2025-01-01', '2026-01-02'), /366일/);
});

test('moving averages start once a full window is available', async () => {
  const { movingAverage } = await import('../web/dashboard-utils.js');
  assert.deepEqual(movingAverage([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('averaging down: new average, and the quantity a target average needs', async () => {
  const { averageAfterBuy, quantityForTarget } = await import('../web/dashboard-utils.js');
  // 10 at 100 plus 10 at 50 → 20 at 75.
  assert.deepEqual(averageAfterBuy({ quantity: 10, average: 100, buyQuantity: 10, buyPrice: 50 }), { quantity: 20, cost: 1500, average: 75 });
  assert.equal(quantityForTarget({ quantity: 10, average: 100, price: 50, target: 75 }), 10);
  assert.equal(quantityForTarget({ quantity: 10, average: 100, price: 50, target: 40 }), null, 'cannot average below the buy price');
  // (10×100 + x×150) / (10 + x) = 120 → x = 200/30.
  assert.ok(Math.abs(quantityForTarget({ quantity: 10, average: 100, price: 150, target: 120 }) - 200 / 30) < 1e-9, 'averaging up works the same way');
});

test('rebalancing trades reach each target share including new cash', async () => {
  const { rebalance } = await import('../web/dashboard-utils.js');
  const result = rebalance([{ symbol: 'BTC', value: 600, price: 100, target: 50 }, { symbol: 'KRW', value: 400, price: 1, target: 50 }], 200);
  assert.equal(result.total, 1200);
  assert.deepEqual(result.rows.map(r => [r.symbol, r.targetValue, r.diff, r.quantity]), [['BTC', 600, 0, 0], ['KRW', 600, 200, 200]]);
  assert.equal(rebalance([{ symbol: 'A', value: 1, price: 1, target: 30 }]).targetSum, 30);
});

test('scenarios move each coin by its own change, cash stays, and P&L uses cost', async () => {
  const { scenario } = await import('../web/dashboard-utils.js');
  const holdings = [{ symbol: 'BTC', valueKrw: '1000', costKrw: '800', currentPriceKrw: '100' }, { symbol: 'ETH', valueKrw: '500', costKrw: '600', currentPriceKrw: '10' }, { symbol: 'KRW', valueKrw: '500', costKrw: null }];
  const result = scenario(holdings, { BTC: 10 }, -20);
  assert.equal(result.total, 1100 + 400 + 500);
  assert.equal(result.change, 0);
  assert.equal(result.profit, 1100 + 400 - 1400);
  assert.ok(Math.abs(result.rows[0].price - 110) < 1e-9);
});

test('alert conditions cover price, daily change, return and total', async () => {
  const { alertMet } = await import('../web/dashboard-utils.js');
  const metrics = { price: 105, changePct: -6, profitPct: 12, total: 1000 };
  assert.equal(alertMet({ type: 'above', value: 100 }, metrics), true);
  assert.equal(alertMet({ type: 'below', value: 100 }, metrics), false);
  assert.equal(alertMet({ type: 'fall', value: 5 }, metrics), true);
  assert.equal(alertMet({ type: 'rise', value: 5 }, metrics), false);
  assert.equal(alertMet({ type: 'profit', value: 10 }, metrics), true);
  assert.equal(alertMet({ type: 'total_below', value: 999 }, metrics), false);
  assert.equal(alertMet({ type: 'above', value: 100 }, { price: null }), null, 'an unknown value neither fires nor re-arms');
});
