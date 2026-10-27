import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { validateBoard } from '../src/boards.js';

const source = await readFile(new URL('../examples/fixture.js', import.meta.url), 'utf8');
const snapshot = '2026-10-06T06:21:16.020Z';
const baseBoard = index => ({ id: `board-${index}`, revision: 1, ...validateBoard({ name: `Board ${index}` }) });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(count = 1, extra = {}) {
  const data = { status: { mode: 'demo', configured: true, sample: true }, portfolio: { asOf: snapshot },
    boards: Array.from({ length: count }, (_, index) => baseBoard(index)), ...extra };
  const context = { window: {}, URL, crypto: { randomUUID } };
  runInNewContext(source.replace('/*DATA*/null', () => JSON.stringify(data)), context);
  return context.window.AssetKitFixture.request;
}

test('sample status exposes the synthetic snapshot clock without using today', async () => {
  const request = fixture();
  const status = await request('GET', '/api/status');
  assert.equal(status.mode, 'demo');
  assert.equal(status.sample, true);
  assert.equal(status.sampleAsOf, snapshot);
  status.sampleAsOf = 'changed';
  assert.equal((await request('GET', '/api/status')).sampleAsOf, snapshot);
});

test('sample boards use the same defaults and normalization as BoardStore', async () => {
  const request = fixture();
  for (const input of [{ name: ' Default ' }, { name: ' Scoped ', symbols: ['btc', ' ETH ', 'BTC'], widgets: ['holdings', 'summary'], days: 365, refreshSeconds: 0 }]) {
    const result = await request('POST', '/api/boards', input);
    const { id, revision, updatedAt, ...fields } = plain(result);
    assert.deepEqual(fields, validateBoard(input));
    assert.equal(revision, 1);
    assert.ok(id && Number.isFinite(Date.parse(updatedAt)));
  }
});

test('invalid sample board inputs are rejected before changing state', async () => {
  const request = fixture();
  const invalid = [null, {}, { name: 3 }, { name: ' ' }, { name: 'x'.repeat(49) },
    { name: 'x', symbols: null }, { name: 'x', symbols: ['BTC-USD'] }, { name: 'x', symbols: [12] },
    { name: 'x', symbols: ['X'.repeat(31)] }, { name: 'x', symbols: Array(101).fill('BTC') },
    { name: 'x', widgets: null }, { name: 'x', widgets: [] }, { name: 'x', widgets: ['bad'] },
    { name: 'x', widgets: ['summary', 'summary'] }, { name: 'x', days: '30' },
    { name: 'x', days: 31 }, { name: 'x', refreshSeconds: -1 }, { name: 'x', refreshSeconds: '60' }];
  for (const input of invalid) {
    assert.throws(() => validateBoard(input), { code: 'INVALID_BOARD' });
    await assert.rejects(request('POST', '/api/boards', input), { code: 'INVALID_BOARD', status: 400 });
  }
  assert.equal((await request('GET', '/api/boards')).boards.length, 1);
});

test('sample imports reject malformed batches and leave valid preceding entries unapplied', async () => {
  const request = fixture();
  const before = plain(await request('GET', '/api/boards'));
  for (const body of [null, {}, { boards: {} }, { boards: [] }, { boards: Array.from({ length: 51 }, () => ({ name: 'x' })) },
    { boards: [{ name: 'valid' }, { name: 'invalid', widgets: ['bad'] }] }]) {
    await assert.rejects(request('POST', '/api/boards/import', body), { code: 'INVALID_BOARD', status: 400 });
    assert.deepEqual(plain(await request('GET', '/api/boards')), before);
  }
  const result = await request('POST', '/api/boards/import', { boards: [{ name: 'Imported' }, { name: 'BTC', symbols: ['btc'] }] });
  assert.equal(result.boards.length, 2);
  assert.equal((await request('GET', '/api/boards')).boards.length, 3);
});

test('sample create and import enforce the 50-board capacity atomically', async () => {
  const request = fixture(49);
  await assert.rejects(request('POST', '/api/boards/import', { boards: [{ name: 'fiftieth' }, { name: 'overflow' }] }), { code: 'BOARD_LIMIT', status: 400 });
  assert.equal((await request('GET', '/api/boards')).boards.length, 49);
  await request('POST', '/api/boards', { name: 'fiftieth' });
  await assert.rejects(request('POST', '/api/boards', { name: 'overflow' }), { code: 'BOARD_LIMIT', status: 400 });
  await assert.rejects(request('POST', '/api/boards/import', { boards: [{ name: 'overflow' }] }), { code: 'BOARD_LIMIT', status: 400 });
  assert.equal((await request('GET', '/api/boards')).boards.length, 50);
});

test('sample updates preserve revision and contents on validation failure or conflict', async () => {
  const request = fixture();
  const before = plain(await request('GET', '/api/boards'));
  await assert.rejects(request('PUT', '/api/boards/board-0', { name: 'invalid', widgets: ['bad'], revision: 1 }), { code: 'INVALID_BOARD' });
  assert.deepEqual(plain(await request('GET', '/api/boards')), before);
  const updated = await request('PUT', '/api/boards/board-0', { name: 'Changed', revision: 1 });
  assert.equal(updated.revision, 2);
  await assert.rejects(request('PUT', '/api/boards/board-0', { name: 'Stale', revision: 1 }), { code: 'CONFLICT', status: 409 });
  assert.equal((await request('GET', '/api/boards')).boards[0].name, 'Changed');
  await assert.rejects(request('DELETE', '/api/boards/board-0', { revision: 2 }), { code: 'LAST_BOARD', status: 400 });
});

test('sample market data follows the server sorting, scope and limit rules', async () => {
  const rows = [
    { symbol: 'A', name: '가', priceKrw: '10', changePct: '1', value24hKrw: '5', held: true },
    { symbol: 'B', name: '나', priceKrw: '20', changePct: '-3', value24hKrw: '9', held: false },
    { symbol: 'C', name: '다', priceKrw: '30', changePct: '7', value24hKrw: '1', held: true },
  ];
  const request = fixture(1, { tickers: { mode: 'demo', asOf: snapshot, scope: 'all', total: 3, rows },
    warnings: { mode: 'demo', asOf: snapshot, scope: 'all', total: 2, rows: [{ symbol: 'B', held: false }, { symbol: 'C', held: true }], note: '경보' } });
  const movers = plain(await request('GET', '/api/tickers?scope=all&sort=change&direction=desc&limit=2'));
  assert.deepEqual([movers.rows.map(row => row.symbol), movers.total, movers.sort], [['C', 'A'], 3, 'change']);
  assert.deepEqual(plain(await request('GET', '/api/tickers?scope=all&sort=change&direction=asc&limit=1')).rows.map(row => row.symbol), ['B']);
  assert.deepEqual(plain(await request('GET', '/api/tickers?scope=holdings')).rows.map(row => row.symbol), ['A', 'C']);
  const fallback = plain(await request('GET', '/api/tickers?scope=evil&sort=evil&limit=999'));
  assert.deepEqual([fallback.scope, fallback.sort, fallback.rows.map(row => row.symbol)], ['all', 'value24h', ['B', 'A', 'C']]);
  assert.deepEqual(plain(await request('GET', '/api/warnings?scope=holdings')).rows.map(row => row.symbol), ['C']);
  assert.equal((await request('GET', '/api/warnings')).total, 2);
});

test('sample answers chart, returns and market-list calls and simulates live prices like the demo server', async () => {
  const minute = Date.parse('2026-10-27T00:00:00Z') / 60000;
  const portfolio = { asOf: snapshot, mode: 'demo', scope: [],
    summary: { totalValueKrw: '1100', cashKrw: '100', cryptoValueKrw: '1000', profitKrw: '100', profitRatePct: '11.1111', comparableCostKrw: '900', assetCount: 1, valuationComplete: true },
    holdings: [
      { symbol: 'BTC', name: '비트코인', quantity: '0.00001', currentPriceKrw: '100000000', valueKrw: '1000', costKrw: '900', profitKrw: '100', profitRatePct: '11.1111', priceChangePct: '1.0000', allocationPct: '90.9091' },
      { symbol: 'KRW', name: '원화', quantity: '100', currentPriceKrw: '1', valueKrw: '100', costKrw: null, profitKrw: null, profitRatePct: null, priceChangePct: null, allocationPct: '9.0909' }] };
  const data = { status: { mode: 'demo', configured: true, sample: true }, boards: [baseBoard(0)], portfolio,
    marketList: [{ symbol: 'BTC', name: '비트코인', marketWarning: null }],
    candles: { BTC: { day: { mode: 'demo', symbol: 'BTC', name: '비트코인', market: 'KRW-BTC', interval: 'day', priceKrw: '100000000', changePct: '1.0000', rows: [[minute - 1440, 1, 3, 0.5, 2, 10], [minute, 2, 4, 1, 3, 20]] } } },
    returns: { 3: { months: 3 }, 6: { months: 6 }, 12: { months: 12 } },
    tickers: { mode: 'demo', rows: [
      { symbol: 'BTC', name: '비트코인', priceKrw: '100000000', changePct: '1.0000', highKrw: '101000000', lowKrw: '99000000', value24hKrw: '5', held: true },
      { symbol: 'ETH', name: '이더리움', priceKrw: '4000000', changePct: null, highKrw: null, lowKrw: null, value24hKrw: '3', held: false }] } };
  const context = { window: {}, URL, crypto: { randomUUID }, setTimeout, setInterval, clearTimeout, clearInterval };
  runInNewContext(source.replace('/*DATA*/null', () => JSON.stringify(data)), context);
  const { request, stream } = context.window.AssetKitFixture;
  assert.deepEqual(plain(await request('GET', '/api/markets')), { markets: data.marketList });
  const daily = plain(await request('GET', '/api/market?symbol=BTC&interval=day&count=1'));
  assert.deepEqual([daily.interval, daily.candles], ['day', [{ date: '2026-10-27', at: '2026-10-27T09:00:00+09:00', openKrw: '2', highKrw: '4', lowKrw: '1', closeKrw: '3', volume: '20' }]]);
  assert.equal(daily.rows, undefined);
  assert.equal((await request('GET', '/api/market?symbol=BTC&days=30')).candles.length, 2, 'the old daily path still works');
  await assert.rejects(request('GET', '/api/market?symbol=BTC&interval=15m'), { status: 404 });
  await assert.rejects(request('GET', '/api/market?symbol=XRP&interval=day'), { status: 404, code: 'NO_KRW_MARKET' });
  assert.equal((await request('GET', '/api/returns?months=6')).months, 6);
  await assert.rejects(request('GET', '/api/returns?months=5'), { status: 400, code: 'INVALID_RANGE' });
  assert.deepEqual(plain(await request('GET', '/api/tickers?scope=all&symbols=ETH')).rows.map(row => row.symbol), ['ETH']);

  const seen = { status: [], tick: [], portfolio: [] };
  const live = stream({ symbols: '', watch: 'ETH,DOGE' }, { status: value => seen.status.push(plain(value)), tick: value => seen.tick.push(plain(value)), portfolio: value => seen.portfolio.push(plain(value)) });
  await new Promise(resolve => setTimeout(resolve, 2100));
  live.close();
  const count = seen.tick.length;
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(seen.tick.length, count, 'close stops the simulated feed');
  assert.deepEqual(seen.status, [{ live: 'live', mode: 'demo' }]);
  assert.ok(count >= 2);
  const last = seen.tick.at(-1).tickers, btc = last.find(tick => tick.symbol === 'BTC');
  assert.deepEqual(last.map(tick => tick.symbol), ['BTC', 'ETH'], 'held coins plus watched coins the sample knows');
  assert.ok(Number(btc.priceKrw) >= 97000000 && Number(btc.priceKrw) <= 103000000);
  // Simulated time runs on from the sample's snapshot, so the chart's last candle keeps moving instead of jumping to today.
  const offset = Date.parse(btc.at) - Date.parse(data.portfolio.asOf);
  assert.ok(offset >= 1000 && offset < 10000, String(offset));
  const revalued = seen.portfolio.at(-1), holding = revalued.holdings.find(h => h.symbol === 'BTC');
  assert.equal(holding.currentPriceKrw, btc.priceKrw);
  assert.equal(holding.valueKrw, String(Math.round(0.00001 * Number(btc.priceKrw))));
  assert.equal(revalued.summary.totalValueKrw, String(Number(holding.valueKrw) + 100));
  assert.equal(seen.portfolio.length, count);
});
