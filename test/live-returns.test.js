import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveFeed, LIVE_URL, parseFrame, tickerFrom } from '../src/live.js';
import { computeReturns, kstDate, kstMonth, realizedFor, returnsWindow } from '../src/returns.js';
import { dec } from '../src/decimal.js';
import { DemoProvider } from '../src/demo.js';
import { KitError } from '../src/errors.js';
import { PortfolioService } from '../src/service.js';
import { startDashboard } from '../src/server.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const at = text => Date.parse(text);

async function dashboard(t, provider = new DemoProvider()) {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-live-'));
  const service = new PortfolioService({ provider, directory });
  const { server, url } = await startDashboard(service, { port: 0, collect: false });
  t.after(async () => { service.live.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { service, url };
}

// Reads Server-Sent Events until every wanted event arrived once, then hangs up.
function readEvents(target, wanted, headers = {}) {
  return new Promise((resolve, reject) => {
    const found = {};
    const req = request(target, { headers }, res => {
      Object.assign(found, { $status: res.statusCode, $type: res.headers['content-type'] });
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end), event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
          buffer = buffer.slice(end + 2);
          if (event && data && !(event in found)) found[event] = JSON.parse(data);
        }
        if (res.statusCode !== 200 || wanted.every(name => name in found)) { clearTimeout(timer); req.destroy(); resolve({ ...found, $body: buffer }); }
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`stream timed out with ${Object.keys(found).join(', ')}`)); }, 8000);
    req.on('error', error => { clearTimeout(timer); if (!wanted.every(name => name in found)) reject(error); });
    req.end();
  });
}

test('returns window: whole calendar months in Korean time, ending now', () => {
  const now = at('2026-10-27T05:00:00Z');
  assert.deepEqual(returnsWindow(3, now), { start: at('2026-08-01T00:00:00+09:00'), end: now, firstMonth: '2026-08' });
  assert.equal(returnsWindow(12, now).firstMonth, '2025-11');
  assert.equal(returnsWindow(1, at('2026-01-31T15:30:00Z')).firstMonth, '2026-02', 'already February in Korea');
  assert.equal(kstMonth(at('2026-01-31T14:59:59Z')), '2026-01');
  assert.equal(kstDate(at('2026-01-31T15:00:00Z')), '2026-02-01');
});

test('realized P&L uses average cost: forward for positions opened in the window, backward from today otherwise', () => {
  const day = i => at('2026-09-01T00:00:00Z') + i * 86400000;
  // 1 at 100 and 1 at 200 average 150; selling 1 for 300 with a 3 fee realizes 147.
  const forward = realizedFor({ quantity: '1', averagePrice: '150', events: [
    { type: 'buy', qty: '1', funds: '100', fee: '0', at: day(0) }, { type: 'buy', qty: '1', funds: '200', fee: '0', at: day(1) }, { type: 'sell', qty: '1', funds: '300', fee: '3', at: day(2) }] });
  assert.deepEqual([forward.status, forward.realized.toFixed(), forward.cost.toFixed(), forward.sales.length], ['ok', '147', '150', 1]);
  // Held before the window: today's 1 coin at average 100 means the coin sold for 180 earned 80.
  const backward = realizedFor({ quantity: '1', averagePrice: '100', events: [{ type: 'sell', qty: '1', funds: '180', fee: '0', at: day(3) }] });
  assert.deepEqual([backward.status, backward.realized.toFixed()], ['ok', '80']);
  // A coin deposit enters the average at that day's close.
  const deposited = realizedFor({ quantity: '0', averagePrice: null, events: [{ type: 'in', qty: '2', price: '50', at: day(0) }, { type: 'sell', qty: '2', funds: '160', fee: '0', at: day(1) }] });
  assert.equal(deposited.realized.toFixed(), '60');
  // Unknowable cases say so instead of guessing.
  assert.equal(realizedFor({ quantity: '0', averagePrice: null, events: [{ type: 'sell', qty: '1', funds: '180', fee: '0', at: day(3) }] }).status, 'unknown');
  assert.equal(realizedFor({ quantity: '0', averagePrice: null, events: [{ type: 'in', qty: '1', price: null, at: day(0) }, { type: 'sell', qty: '1', funds: '9', fee: '0', at: day(1) }] }).status, 'unknown');
  assert.equal(realizedFor({ quantity: '0.5', averagePrice: '100', events: [{ type: 'buy', qty: '1', funds: '100', fee: '0', at: day(0) }, { type: 'sell', qty: '0.2', funds: '30', fee: '0', at: day(1) }] }).status, 'unknown', 'buys exceed the current balance');
  // Fees on both sides: buying for 100 with a 10 fee and selling for 100 loses 10.
  const fees = realizedFor({ quantity: '0', averagePrice: null, events: [{ type: 'buy', qty: '1', funds: '100', fee: '10', at: day(0) }, { type: 'sell', qty: '1', funds: '100', fee: '0', at: day(1) }] });
  assert.deepEqual([fees.realized.toFixed(), fees.cost.toFixed()], ['-10', '110']);
  // Held before the window too: today's 2 coins at average 150 were 1 old coin at 100 plus 1 bought for 200; that buy's fee of 4 joins the cost.
  const mixed = realizedFor({ quantity: '2', averagePrice: '150', events: [{ type: 'buy', qty: '1', funds: '200', fee: '4', at: day(0) }, { type: 'sell', qty: '1', funds: '300', fee: '0', at: day(1) }, { type: 'buy', qty: '1', funds: '150', fee: '0', at: day(2) }] });
  assert.deepEqual([mixed.status, mixed.realized.toFixed(), mixed.cost.toFixed()], ['ok', '148', '152']);
});

test('flow-adjusted returns: deposits and withdrawals are not profit, months chain to the window total', () => {
  const now = at('2026-10-27T05:00:00Z');
  const result = computeReturns({
    months: 3, now, currentValueKrw: '2000000',
    holdings: [{ symbol: 'BTC', name: '비트코인', quantity: '0.002', averagePriceKrw: '100000000' }],
    history: [
      { asOf: '2026-07-31T10:00:00Z', totalValueKrw: '1000000' }, // the evening before the window
      { asOf: '2026-08-31T10:00:00Z', totalValueKrw: '1500000' },
      { asOf: '2026-09-30T10:00:00Z', totalValueKrw: '1400000' },
    ],
    krwDeposits: [
      { at: '2026-08-10T01:00:00Z', amount: '400000', state: 'ACCEPTED' },
      { at: '2026-09-02T01:00:00Z', amount: '999999', state: 'PROCESSING' }, // unfinished: not a flow
      { at: '2026-07-15T01:00:00Z', amount: '500000', state: 'ACCEPTED' },   // before the window
    ],
    krwWithdrawals: [{ at: '2026-09-15T01:00:00Z', amount: '100000', fee: '1000', state: 'DONE' }, { at: '2026-09-16T01:00:00Z', amount: '50000', fee: '1000', state: 'CANCELLED' }],
    coinDeposits: [{ at: '2026-10-05T01:00:00Z', currency: 'BTC', amount: '0.001', state: 'DEPOSIT_ACCEPTED' }],
    orders: [
      { at: '2026-08-20T01:00:00Z', market: 'KRW-BTC', side: 'bid', executed_volume: '0.002', executed_funds: '200000', paid_fee: '80' },
      { at: '2026-08-21T01:00:00Z', market: 'BTC-ETH', side: 'bid', executed_volume: '1', executed_funds: '0.03', paid_fee: '0' },
      { at: '2026-10-10T01:00:00Z', market: 'KRW-BTC', side: 'ask', executed_volume: '0.001', executed_funds: '120000', paid_fee: '48' },
      { at: '2026-10-11T01:00:00Z', market: 'KRW-BTC', side: 'ask', executed_volume: '0', executed_funds: '0', paid_fee: '0' }, // cancelled without a fill
    ],
    closeOn: (symbol, day) => symbol === 'BTC' && day === '2026-10-05' ? '100000000' : null,
  });
  const s = result.summary;
  assert.deepEqual([s.startValueKrw, s.endValueKrw, s.netFlowKrw, s.profitKrw], ['1000000', '2000000', '400000', '600000']);
  assert.deepEqual([s.depositsKrw, s.withdrawalsKrw, s.coinInKrw, s.coinOutKrw, s.feesKrw], ['400000', '100000', '100000', '0', '1128']);
  assert.deepEqual([s.buyKrw, s.sellKrw, s.trades, s.transfers], ['200000', '120000', 2, 3]);
  // 0.002 bought for 200,000 + 80 fee and 0.001 deposited at 100,000: the sold 0.001 cost 100,026.67 and netted 120,000 − 48.
  assert.deepEqual([s.realizedKrw, s.realizedComplete], ['19925', true]);
  assert.deepEqual(result.realized.map(r => [r.symbol, r.status, r.proceedsKrw, r.costKrw]), [['BTC', 'ok', '119952', '100027']]);
  assert.deepEqual(result.skipped, { btcMarketOrders: 1, unpricedFlows: 0 });
  assert.deepEqual(result.monthly.map(m => [m.month, m.startValueKrw, m.endValueKrw, m.netFlowKrw, m.profitKrw]), [
    ['2026-08', '1000000', '1500000', '400000', '100000'],
    ['2026-09', '1500000', '1400000', '-100000', '0'],
    ['2026-10', '1400000', '2000000', '100000', '500000'],
  ]);
  assert.equal(result.monthly.reduce((total, m) => total.plus(m.profitKrw), dec(0)).toFixed(), s.profitKrw);
  assert.equal(result.monthly[2].realizedKrw, '19925');
  // Modified Dietz: the rate sits between profit over (start + net deposits) and profit over start.
  assert.ok(Number(s.profitRatePct) > 600000 / 1400000 * 100 && Number(s.profitRatePct) < 60, s.profitRatePct);
  assert.equal(result.monthly[1].profitRatePct, '0.0000');
  assert.deepEqual(result.history, { from: '2026-07-31T10:00:00Z', coversStart: true });
});

test('a deposit between the last valuation and a month boundary is carried to the boundary, never counted as profit', () => {
  const now = at('2026-10-27T05:00:00Z');
  const result = computeReturns({ months: 3, now, currentValueKrw: '1870000',
    history: [
      { asOf: '2026-07-29T00:00:00Z', totalValueKrw: '1000000' }, // two days before the window
      { asOf: '2026-08-28T00:00:00Z', totalValueKrw: '1200000' },
      { asOf: '2026-09-30T10:00:00Z', totalValueKrw: '1700000' },
    ],
    krwDeposits: [{ at: '2026-07-30T00:00:00Z', amount: '200000' }, { at: '2026-08-30T00:00:00Z', amount: '500000' }],
  });
  // Without the carry the July deposit would read as +200,000 profit and the August one as −500,000 then +500,000.
  assert.deepEqual(result.monthly.map(m => [m.startValueKrw, m.endValueKrw, m.netFlowKrw, m.profitKrw]), [
    ['1200000', '1700000', '500000', '0'], ['1700000', '1700000', '0', '0'], ['1700000', '1870000', '0', '170000']]);
  assert.deepEqual([result.summary.startValueKrw, result.summary.depositsKrw, result.summary.netFlowKrw, result.summary.profitKrw, result.summary.transfers], ['1200000', '500000', '500000', '170000', 1]);
  // A valuation more than a week before a boundary is too old to stand for it.
  const stale = computeReturns({ months: 3, now, currentValueKrw: '1870000', history: [{ asOf: '2026-07-20T00:00:00Z', totalValueKrw: '1000000' }] });
  assert.equal(stale.history.coversStart, false);
});

test('returns without history at the window start begin at the first value inside it and flag the gap', () => {
  const now = at('2026-10-27T05:00:00Z');
  const result = computeReturns({ months: 3, now, currentValueKrw: '1100000', history: [{ asOf: '2026-09-20T00:00:00Z', totalValueKrw: '1000000' }],
    krwDeposits: [{ at: '2026-08-10T00:00:00Z', amount: '700000' }, { at: '2026-10-01T00:00:00Z', amount: '50000' }] });
  assert.deepEqual([result.summary.startValueKrw, result.summary.startAt, result.summary.netFlowKrw, result.summary.profitKrw], ['1000000', '2026-09-20T00:00:00.000Z', '50000', '50000']);
  assert.equal(result.history.coversStart, false);
  assert.deepEqual(result.monthly.map(m => m.profitKrw), [null, null, null], 'no month has a known start value');
  assert.equal(computeReturns({ months: 3, now, currentValueKrw: null, history: [] }).summary.profitKrw, null);
});

test('live frames: binary UTF-8 JSON decodes, tickers keep the shape calculatePortfolio reads, junk is dropped', () => {
  const message = { type: 'ticker', code: 'KRW-BTC', trade_price: 108000000, signed_change_rate: 0.0123, high_price: 109000000, low_price: 105000000,
    acc_trade_price_24h: 412000000000, timestamp: 1761541200000, market_warning: 'NONE', stream_type: 'REALTIME' };
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  assert.deepEqual(parseFrame(bytes), message);
  assert.deepEqual(parseFrame(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), message);
  assert.deepEqual(parseFrame('{"status":"UP"}'), { status: 'UP' });
  assert.equal(parseFrame('not json'), null);
  assert.deepEqual(tickerFrom(message), { market: 'KRW-BTC', trade_price: 108000000, signed_change_rate: 0.0123, timestamp: 1761541200000,
    high_price: 109000000, low_price: 105000000, acc_trade_price_24h: 412000000000, market_warning: 'NONE' });
  assert.equal(tickerFrom({ market: 'BTC-ETH', trade_price: '0.03', timestamp: 1 }).market, 'BTC-ETH', 'REST tickers use market instead of code');
  for (const bad of [{ ...message, code: 'KRW-BTC;x' }, { ...message, trade_price: 0 }, { ...message, code: undefined }, null]) assert.equal(tickerFrom(bad), null);
});

class FakeSocket {
  static sockets = [];
  constructor(url) { Object.assign(this, { url, sent: [], closed: false }); FakeSocket.sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  emit(message) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(message)) }); }
}

test('live feed: one upstream for every listener, batched updates, resubscribes when markets change and closes when idle', async () => {
  FakeSocket.sockets = [];
  const feed = new LiveFeed({ WebSocketImpl: FakeSocket }), seen = [];
  const stopA = feed.subscribe(['KRW-BTC', 'KRW-ETH', 'not a market'], changed => seen.push(['a', [...changed].sort()]));
  await sleep(0);
  const [first] = FakeSocket.sockets, subscription = JSON.parse(first.sent[0]);
  assert.equal(first.url, LIVE_URL);
  assert.ok(subscription[0].ticket);
  assert.deepEqual(subscription.slice(1), [{ type: 'ticker', codes: ['KRW-BTC', 'KRW-ETH'] }, { format: 'DEFAULT' }]);
  first.emit({ type: 'ticker', code: 'KRW-BTC', trade_price: 100, timestamp: 1 });
  first.emit({ type: 'ticker', code: 'KRW-BTC', trade_price: 101, timestamp: 2 });
  first.emit({ type: 'ticker', code: 'KRW-XRP', trade_price: 5, timestamp: 3 });
  first.onmessage({ data: '{"status":"UP"}' });
  assert.equal(feed.status, 'live');
  await sleep(1150);
  assert.deepEqual(seen, [['a', ['KRW-BTC']]], 'two trades in one second arrive as one update');
  assert.equal(feed.quotes.get('KRW-BTC').trade_price, 101);
  assert.equal(feed.quotes.has('KRW-XRP'), false, 'markets nobody asked for are ignored');
  // A new listener gets known prices at once; the wider market set replaces the upstream subscription.
  const stopB = feed.subscribe(['KRW-BTC', 'KRW-SOL'], changed => seen.push(['b', [...changed].sort()]));
  await sleep(0);
  assert.deepEqual(seen.at(-1), ['b', ['KRW-BTC']]);
  assert.equal(first.closed, true);
  assert.deepEqual(JSON.parse(FakeSocket.sockets.at(-1).sent[0])[1].codes, ['KRW-BTC', 'KRW-ETH', 'KRW-SOL']);
  stopB();
  await sleep(0);
  assert.deepEqual(JSON.parse(FakeSocket.sockets.at(-1).sent[0])[1].codes, ['KRW-BTC', 'KRW-ETH']);
  stopA(); stopA();
  assert.equal(feed.status, 'off');
  assert.ok(FakeSocket.sockets.every(socket => socket.closed));
});

test('live feed falls back to REST polling without WebSocket; demo prices walk within 3% of the snapshot', async () => {
  const polled = [], changes = [];
  const feed = new LiveFeed({ WebSocketImpl: null, poll: async markets => { polled.push(markets); return markets.map(market => ({ market, trade_price: 200, timestamp: Date.now() })); } });
  const stop = feed.subscribe(['KRW-ETH'], changed => changes.push([...changed]));
  assert.equal(feed.status, 'polling');
  await sleep(1150);
  assert.deepEqual([polled[0], changes], [['KRW-ETH'], [['KRW-ETH']]]);
  stop();
  assert.equal(feed.status, 'off');

  const demo = new LiveFeed({ demo: true, poll: async markets => markets.map(market => ({ market, trade_price: 1000, signed_change_rate: 0.01, timestamp: Date.now() })) });
  const prices = [];
  const stopDemo = demo.subscribe(['KRW-BTC'], () => prices.push(demo.quotes.get('KRW-BTC').trade_price));
  assert.equal(demo.status, 'live');
  await sleep(2700);
  stopDemo();
  assert.ok(prices.length >= 2, `ticks: ${prices}`);
  assert.ok(prices.every(price => price >= 970 && price <= 1030), String(prices));
  assert.equal(demo.status, 'off');
});

test('dashboard API: market list, candles by interval, flow-adjusted returns and filtered tickers', async t => {
  const { url } = await dashboard(t);
  const get = async path => { const response = await fetch(`${url}${path}`); return { status: response.status, body: await response.json() }; };
  assert.deepEqual((await get('/api/markets')).body.markets.map(m => m.symbol), ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'LINK']);
  const candles = (await get('/api/market?symbol=BTC&interval=15m&count=50')).body;
  assert.deepEqual([candles.interval, candles.candles.length], ['15m', 50]);
  assert.ok(candles.candles.every(c => Number(c.lowKrw) <= Math.min(c.openKrw, c.closeKrw) && Number(c.highKrw) >= Math.max(c.openKrw, c.closeKrw) && Number(c.volume) > 0));
  assert.ok(new Set(candles.candles.map(c => c.volume)).size > 10, 'volume varies between candles');
  assert.equal((await get('/api/market?symbol=BTC')).body.candles.length, 30, 'without interval the old 30-day path is unchanged');
  assert.deepEqual([(await get('/api/market?symbol=BTC&interval=2h')).status, (await get('/api/market?symbol=BTC&interval=2h')).body.error.code], [400, 'INVALID_MARKET']);
  const { body: returns } = await get('/api/returns?months=12'), s = returns.summary;
  assert.equal(returns.monthly.length, 12);
  assert.equal(dec(s.endValueKrw).minus(s.startValueKrw).minus(s.netFlowKrw).toFixed(), s.profitKrw);
  assert.equal(returns.monthly.reduce((total, m) => total.plus(m.profitKrw), dec(0)).toFixed(), s.profitKrw, 'months add up to the window');
  assert.deepEqual(returns.realized.map(r => r.status), ['ok', 'ok', 'ok']);
  assert.ok(returns.coverage.complete && returns.history.coversStart && returns.note.includes('Modified Dietz'));
  assert.deepEqual([(await get('/api/returns?months=5')).status, (await get('/api/returns?months=5')).body.error.code], [400, 'INVALID_RANGE']);
  assert.deepEqual((await get('/api/tickers?scope=all&symbols=ETH,BTC')).body.rows.map(row => row.symbol), ['BTC', 'ETH']);
  assert.equal((await fetch(`${url}/api/returns`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json', 'X-Asset-Kit': '1' }, body: '{}' })).status, 405);
});

test('live stream: same-origin SSE with status, ticks for held and watched coins, and the revalued portfolio', async t => {
  const { url } = await dashboard(t);
  const events = await readEvents(`${url}/api/stream?watch=DOGE`, ['status', 'tick', 'portfolio']);
  assert.equal(events.$status, 200);
  assert.match(events.$type, /^text\/event-stream/);
  assert.deepEqual(events.status, { live: 'live', mode: 'demo' });
  assert.deepEqual(events.tick.tickers.map(tick => tick.symbol).sort(), ['BTC', 'DOGE', 'ETH', 'SOL', 'XRP']);
  assert.ok(events.tick.tickers.every(tick => Number(tick.priceKrw) > 0 && Number.isFinite(Date.parse(tick.at))));
  assert.equal(events.portfolio.holdings.length, 5);
  assert.equal(events.portfolio.summary.totalValueKrw, events.portfolio.holdings.reduce((total, h) => total.plus(h.valueKrw), dec(0)).toFixed());
  const scoped = await readEvents(`${url}/api/stream?symbols=BTC`, ['tick', 'portfolio']);
  assert.deepEqual(scoped.tick.tickers.map(tick => tick.symbol), ['BTC']);
  assert.deepEqual(scoped.portfolio.scope, ['BTC']);
  assert.equal((await readEvents(`${url}/api/stream`, ['status'], { 'Sec-Fetch-Site': 'cross-site' })).$status, 403);
  const invalid = await fetch(`${url}/api/stream?watch=bad!`);
  assert.deepEqual([invalid.status, (await invalid.json()).error.code], [400, 'INVALID_SYMBOLS']);
});

test('live stream reports an account failure as JSON and the dashboard keeps serving', async t => {
  class Broken extends DemoProvider { async getAccounts() { throw new KitError('AUTH_FAILED', '조회 권한을 확인하세요.', 401); } }
  const { url } = await dashboard(t, new Broken());
  const failed = await fetch(`${url}/api/stream`);
  assert.equal(failed.status, 401);
  assert.equal((await failed.json()).error.code, 'AUTH_FAILED');
  assert.equal((await fetch(`${url}/api/markets`)).status, 200, 'the server survived');
});

test('live feed: each listener gets only its own markets, forgets quotes nobody follows and reports status at once', async () => {
  FakeSocket.sockets = [];
  const feed = new LiveFeed({ WebSocketImpl: FakeSocket }), seen = [], statuses = [];
  const stopA = feed.subscribe(['KRW-BTC'], changed => seen.push(['a', [...changed]]), status => statuses.push(status));
  const stopB = feed.subscribe(['KRW-DOGE'], changed => seen.push(['b', [...changed]]));
  await sleep(0);
  FakeSocket.sockets.at(-1).emit({ type: 'ticker', code: 'KRW-BTC', trade_price: 100, timestamp: 1 });
  FakeSocket.sockets.at(-1).emit({ type: 'ticker', code: 'KRW-DOGE', trade_price: 5, timestamp: 1 });
  await sleep(1150);
  assert.deepEqual(seen.sort(), [['a', ['KRW-BTC']], ['b', ['KRW-DOGE']]], 'a BTC-only stream never hears about another tab\'s coins');
  // Nobody follows DOGE any more: a later subscriber waits for a fresh trade instead of getting the old price as new.
  stopB();
  assert.equal(feed.quotes.has('KRW-DOGE'), false);
  const late = [];
  const stopC = feed.subscribe(['KRW-DOGE'], changed => late.push([...changed]));
  await sleep(0);
  assert.deepEqual(late, []);
  assert.equal(feed.status, 'live', 'changing the market set keeps a live stream live');
  // A dropped upstream is reported right away, not with the next trade.
  FakeSocket.sockets.at(-1).onclose();
  assert.deepEqual(statuses, ['connecting', 'live', 'connecting']);
  stopA(); stopC();
  assert.deepEqual([feed.status, feed.quotes.size], ['off', 0]);
});

test('live feed keeps reporting polling while REST carries prices and the stream keeps failing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  FakeSocket.sockets = [];
  const statuses = [], feed = new LiveFeed({ WebSocketImpl: FakeSocket, poll: async markets => markets.map(market => ({ market, trade_price: 10, timestamp: 1 })) });
  const stop = feed.subscribe(['KRW-BTC'], () => {}, status => statuses.push(status));
  for (const backoff of [1000, 2000, 5000, 10000]) { FakeSocket.sockets.at(-1).onclose(); t.mock.timers.tick(backoff); }
  assert.equal(FakeSocket.sockets.length, 5, 'the stream is retried after every failure');
  assert.equal(feed.status, 'polling', 'a retry attempt does not hide the REST fallback');
  FakeSocket.sockets.at(-1).emit({ type: 'ticker', code: 'KRW-BTC', trade_price: 11, timestamp: 2 });
  assert.deepEqual(statuses, ['connecting', 'polling', 'live']);
  stop();
});

test('the live portfolio keeps the account read\'s fresher price over an older live quote', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-live-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new PortfolioService({ provider: new DemoProvider(), directory });
  const read = (await service.portfolio()).holdings.find(h => h.symbol === 'BTC').currentPriceKrw;
  const btc = quotes => service.livePortfolio({ quotes }).holdings.find(h => h.symbol === 'BTC').currentPriceKrw;
  assert.equal(btc(new Map([['KRW-BTC', { market: 'KRW-BTC', trade_price: 1, timestamp: 1 }]])), read, 'an hour-old quote loses');
  assert.equal(btc(new Map([['KRW-BTC', { market: 'KRW-BTC', trade_price: 123, timestamp: Date.now() + 1000 }]])), '123');
});

test('a 12-month window reads history from the week before its first day, past the 365-day history limit', async t => {
  const now = at('2026-10-31T10:00:00Z'); // the last day of a month: the window starts almost exactly 365 days back
  t.mock.timers.enable({ apis: ['Date'], now });
  class Live extends DemoProvider { mode = 'live'; accountId = 'returns-history'; }
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-returns-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new PortfolioService({ provider: new Live(), directory });
  const recorded = new Date(returnsWindow(12, now).start - 6 * 86400000).toISOString();
  await service.history.record({ mode: 'live', asOf: recorded, summary: { totalValueKrw: '1000000', valuationComplete: true }, holdings: [] });
  const result = await service.returns({ months: 12 });
  assert.deepEqual(result.history, { from: recorded, coversStart: true });
  assert.notEqual(result.monthly[0].startValueKrw, null, 'the first month starts from the carried valuation');
});

test('live stream: a tab that hangs up during the account read leaves no subscription behind', async t => {
  let release;
  class Slow extends DemoProvider { async getAccounts() { await new Promise(resolve => { release = resolve; }); return super.getAccounts(); } }
  const { service, url } = await dashboard(t, new Slow());
  const controller = new AbortController(), pending = fetch(`${url}/api/stream`, { signal: controller.signal }).catch(() => null);
  while (!release) await sleep(5);
  controller.abort();
  await pending;
  await sleep(20);
  release();
  await sleep(50);
  assert.deepEqual([service.live.markets, service.live.status], [[], 'off']);
});

test('live stream: symbols that are not listed KRW markets are left out instead of breaking the shared feed', async t => {
  const { url } = await dashboard(t);
  const events = await readEvents(`${url}/api/stream?symbols=BTC&watch=DOGE,NOPE`, ['tick']);
  const symbols = new Set();
  for (const tick of events.tick.tickers) symbols.add(tick.symbol);
  assert.ok(symbols.has('BTC') || symbols.has('DOGE'), [...symbols].join(','));
  assert.equal(symbols.has('NOPE'), false);
});
