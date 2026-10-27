import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortfolioService } from '../src/service.js';
import { DemoProvider } from '../src/demo.js';
import { BithumbProvider } from '../src/bithumb.js';
import { calculatePortfolio } from '../src/portfolio.js';
import { normalizeOrders } from '../src/activity.js';
import { createMcpServer } from '../mcp/index.js';
import { startFailure } from '../src/server.js';
import { publicError } from '../src/errors.js';

const DAY = 86400000;
async function serverFor(t, { provider = new DemoProvider(), history, readOnly } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-market-tools-'));
  const service = new PortfolioService({ provider, directory, ...(history ? { history } : {}) });
  const server = createMcpServer(service, { readOnly });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const call = (name, args = {}) => server.handle('tools/call', { name, arguments: args });
  return { service, server, call, data: async (name, args) => (await call(name, args)).structuredContent };
}
// Demo account data, reported as a live account so live-only paths (history store, key expiry) run.
class LiveDemo extends DemoProvider { mode = 'live'; accountId = 'fixture'; }
const fixedFetch = routes => async url => {
  const path = new URL(url).pathname, body = routes[path];
  return body === undefined ? new Response('', { status: 404 }) : Response.json(typeof body === 'function' ? body(url) : body);
};

test('market_get_candles serves minute to month intervals: closes by default, OHLC on request', async t => {
  const { call, data } = await serverFor(t);
  const hourly = await data('market_get_candles', { symbol: 'btc', interval: '1h', count: 5 });
  assert.deepEqual([hourly.interval, hourly.candles.length], ['1h', 5]);
  assert.deepEqual(Object.keys(hourly.candles[0]).sort(), ['at', 'closeKrw']);
  assert.deepEqual(Object.keys((await data('market_get_candles', { symbol: 'BTC', count: 2 })).candles[0]).sort(), ['closeKrw', 'date'], 'daily stays as compact as before');
  assert.match(hourly.candles[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.ok(Date.parse(hourly.candles[0].at) < Date.parse(hourly.candles.at(-1).at), 'oldest first');
  const full = await data('market_get_candles', { symbol: 'BTC', interval: 'week', count: 3, ohlc: true });
  assert.deepEqual(Object.keys(full.candles[0]).sort(), ['at', 'closeKrw', 'date', 'highKrw', 'lowKrw', 'openKrw', 'volume']);
  assert.equal((await data('market_get_candles', { symbol: 'BTC', days: 3 })).candles.length, 3, 'days still works as the count');
  for (const args of [{ symbol: 'BTC', interval: '2h' }, { symbol: 'BTC', count: 201 }, { symbol: 'BTC', to: '2026/10/01' }]) assert.equal((await call('market_get_candles', args)).isError, true);
});

test('Bithumb candle, warning, market and key requests use documented paths; only private ones are signed', async () => {
  const calls = [];
  const provider = new BithumbProvider({ accessKey: 'own-key', secretKey: 'fixture-secret', minIntervalMs: 0, fetchImpl: async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    return fixedFetch({
      '/v1/candles/minutes/240': [{ market: 'KRW-BTC', candle_date_time_utc: '2026-09-30T11:00:00', candle_date_time_kst: '2026-09-30T20:00:00', trade_price: 100 }],
      '/v1/market/virtual_asset_warning': [{ market: 'KRW-DOGE', warning_type: 'PRICE_SUDDEN_FLUCTUATION', warning_step: 'CAUTION', end_date: '2026-10-27 18:00:00' }],
      '/v1/market/all': [{ market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin', market_warning: 'NONE' }],
      '/v1/api_keys': [{ access_key: 'someone-else', expire_at: '2027-01-01T09:00:00+09:00' }, { access_key: 'own-key', expire_at: '2027-06-11T09:00:00+09:00' }],
    })(url);
  } });
  await provider.getCandles('KRW-BTC', 5, { interval: '4h', to: '2026-10-01T00:00:00' });
  await provider.getWarnings();
  await provider.getMarkets();
  const key = await provider.getKeyExpiry();
  assert.deepEqual(calls.map(call => [call.url.replace('https://api.bithumb.com', ''), Boolean(call.auth)]), [
    ['/v1/candles/minutes/240?market=KRW-BTC&count=5&to=2026-10-01T00%3A00%3A00', false],
    ['/v1/market/virtual_asset_warning', false],
    ['/v1/market/all?isDetails=true', false],
    ['/v1/api_keys', true],
  ]);
  assert.deepEqual(key, { expiresAt: '2027-06-11T00:00:00.000Z' }, 'only this key, and never a key value');
});

test('named Bithumb errors become specific messages without echoing upstream text', async () => {
  const failing = (status, body) => new BithumbProvider({ accessKey: 'a', secretKey: 'b', minIntervalMs: 0, retries: 0, fetchImpl: async () => Response.json(body, { status }) });
  await assert.rejects(failing(401, { error: { name: 'NotAllowIP', message: 'client 1.2.3.4 denied' } }).getAccounts(),
    error => error.code === 'AUTH_FAILED' && error.upstream === 'NotAllowIP' && /허용 IP/.test(error.message) && !error.message.includes('1.2.3.4'));
  await assert.rejects(failing(401, { error: { name: 'expired_jwt', message: 'x' } }).getAccounts(), error => /시계/.test(error.message));
  await assert.rejects(failing(401, { error: { name: 'invalid_query_payload', message: 'x' } }).getAccounts(), error => /query_hash/.test(error.message));
  await assert.rejects(failing(400, { error: { name: 'invalid_parameter', message: 'x' } }).getAccounts(), { code: 'API_ERROR', upstream: 'invalid_parameter' });
  await assert.rejects(failing(401, { error: { name: 'something_new', message: 'x' } }).getAccounts(), error => error.code === 'AUTH_FAILED' && error.upstream === undefined);
});

test('holdings carry Bithumb caution flags and the portfolio warns about them', () => {
  const accounts = ['BTC', 'XRP'].map(currency => ({ currency, balance: '1', locked: '0', avg_buy_price: '1', avg_buy_price_modified: false, unit_currency: 'KRW' }));
  const p = calculatePortfolio({ accounts, tickers: ['BTC', 'XRP'].map(s => ({ market: `KRW-${s}`, trade_price: 10, timestamp: Date.now() })),
    markets: [{ market: 'KRW-BTC', korean_name: '비트코인', market_warning: 'NONE' }, { market: 'KRW-XRP', korean_name: '리플', market_warning: 'CAUTION' }] });
  assert.deepEqual(p.holdings.map(h => [h.symbol, h.marketWarning]), [['BTC', null], ['XRP', 'CAUTION']]);
  assert.ok(p.warnings.some(text => text.includes('거래 유의') && text.includes('XRP')));
});

test('market_get_tickers ranks markets with or without keys and marks held assets', async t => {
  const { data } = await serverFor(t);
  const movers = await data('market_get_tickers', { scope: 'all', sort: 'change', limit: 3 });
  assert.deepEqual(movers.rows.map(row => [row.symbol, row.changePct, row.held]), [['DOGE', '6.1200', false], ['BTC', '2.3800', true], ['ETH', '1.6400', true]]);
  assert.equal(movers.total, 7);
  const mine = await data('market_get_tickers');
  assert.deepEqual(mine.rows.map(row => row.symbol), ['BTC', 'ETH', 'XRP', 'SOL'], 'held assets by 24h traded value');
  // Without keys: the whole market works, holdings explain what is missing.
  const routes = { '/v1/market/all': [{ market: 'KRW-BTC', korean_name: '비트코인', english_name: 'Bitcoin', market_warning: 'NONE' }],
    '/v1/ticker': [{ market: 'KRW-BTC', trade_price: 100, signed_change_rate: 0.01, timestamp: 1, acc_trade_price_24h: 5 }] };
  const keyless = await serverFor(t, { provider: new BithumbProvider({ accessKey: '', secretKey: '', minIntervalMs: 0, fetchImpl: fixedFetch(routes) }) });
  assert.deepEqual((await keyless.data('market_get_tickers', { scope: 'all' })).rows[0], { symbol: 'BTC', name: '비트코인', priceKrw: '100', changePct: '1.0000', value24hKrw: '5', highKrw: null, lowKrw: null, held: null, marketWarning: null });
  assert.equal(JSON.parse((await keyless.call('market_get_tickers')).content[0].text).code, 'NOT_CONFIGURED');
});

test('market_get_warnings joins exchange alerts with holdings and labels them in Korean', async t => {
  const { data } = await serverFor(t);
  const mine = await data('market_get_warnings');
  assert.deepEqual([mine.total, mine.rows], [0, []]);
  assert.match(mine.note, /보유 자산 중/);
  const all = await data('market_get_warnings', { scope: 'all' });
  assert.deepEqual(all.rows.map(({ symbol, typeLabel, stepLabel, held }) => ({ symbol, typeLabel, stepLabel, held })), [{ symbol: 'DOGE', typeLabel: '가격 급등락', stepLabel: '주의', held: false }]);
  assert.match(all.rows[0].endsAt, /Z$/);
});

test('system_diagnose reports API key expiry and warns two weeks ahead', async t => {
  const provider = new LiveDemo();
  provider.getKeyExpiry = async () => ({ expiresAt: new Date(Date.now() + 5 * DAY + 60000).toISOString() });
  const { data } = await serverFor(t, { provider });
  const diagnose = await data('system_diagnose');
  assert.equal(diagnose.auth.daysLeft, 5);
  assert.match(diagnose.warnings[0], /5일 뒤 만료/);
  provider.getKeyExpiry = async () => { throw new Error('no key list permission'); };
  const degraded = await data('system_diagnose');
  assert.deepEqual([degraded.auth.expiresAt, degraded.auth.error.code, degraded.warnings], [null, 'INTERNAL_ERROR', []]);
});

test('closed-order history reads 1,000 rows per upstream page; pending orders stay at 100', async t => {
  assert.equal(normalizeOrders({ kind: 'history', limit: 1000 }).limit, 1000);
  assert.throws(() => normalizeOrders({ kind: 'pending', limit: 101 }), { code: 'INVALID_QUERY' });
  const provider = new DemoProvider(), limits = [];
  provider.getOrders = async options => { limits.push([options.kind, options.limit]); return { data: [], has_next: false, next_key: null }; };
  const { call } = await serverFor(t, { provider });
  await call('account_get_records', { kind: 'orders', scanPages: 1 });
  await call('account_get_records', { kind: 'pending' });
  assert.deepEqual(limits, [['history', 1000], ['pending', 100]]);
});

// ===== Adversarial review regressions =====
test('snapshot endpoints and omitted count come from every record, not the 400-point chart sample', async t => {
  const start = Date.parse('2026-09-26T00:00:00Z'), records = Array.from({ length: 1440 }, (_, i) => ({
    asOf: new Date(start + i * 1800000).toISOString(), totalValueKrw: String(1000000 + i * 7), valuationComplete: true, values: i < 301 ? null : { BTC: String(1000000 + i * 7) } }));
  const history = { read: async () => records, record: async () => false };
  const { data } = await serverFor(t, { provider: new LiveDemo(), history });
  const snapshot = await data('dashboard_snapshot', { symbols: ['BTC'] });
  assert.deepEqual([snapshot.trend.firstKrw, snapshot.trend.lastKrw, snapshot.trend.changeKrw, snapshot.trend.omitted, snapshot.trend.sampled],
    [records[301].totalValueKrw, records.at(-1).totalValueKrw, String((1439 - 301) * 7), 301, true]);
  assert.equal(snapshot.trend.at.length, 60);
});

test('snapshot others slice is null, not zero, when every remaining holding is unpriced', async () => {
  const { dashboardSnapshot } = await import('../mcp/query.js');
  const portfolio = { mode: 'live', asOf: '2026-10-26T00:00:00.000Z', scope: [], warnings: [], summary: { totalValueKrw: '10', valuationComplete: false },
    holdings: [{ symbol: 'BTC', name: '비트코인', valueKrw: '10', allocationPct: '100.0000' }, { symbol: 'NEW', name: 'NEW', valueKrw: null, allocationPct: null }] };
  const result = await dashboardSnapshot({ portfolio: async () => portfolio, historyPoints: async () => ({ points: [] }) }, { top: 1 });
  assert.deepEqual(result.others, { count: 1, valueKrw: null, allocationPct: null, unpriced: 1 });
});

// Makes every listen fail with this OS error code until the returned restore runs.
function failListen(code) {
  const listen = Server.prototype.listen;
  Server.prototype.listen = function () { process.nextTick(() => this.emit('error', Object.assign(new Error(`listen ${code} /private/path`), { code }))); return this; };
  return () => { Server.prototype.listen = listen; };
}

test('save_board with open:true saves nothing when the dashboard cannot start, so a retry cannot duplicate it', async t => {
  const { call, service } = await serverFor(t);
  const restore = failListen('EACCES');
  let result;
  try { result = await call('dashboard_save_board', { name: '실패 후 재시도', open: true }); }
  finally { restore(); }
  const error = JSON.parse(result.content[0].text);
  assert.equal(result.isError, true);
  assert.equal(error.code, 'DASHBOARD_START_FAILED');
  assert.match(error.message, /로컬 포트를 열 권한이 없습니다\(EACCES\).*보드는 저장하지 않았습니다\.$/);
  assert.doesNotMatch(result.content[0].text, /private\/path|처리하지 못했습니다/);
  assert.equal(error.retryable, false);
  assert.match(error.recovery, /asset-kit dashboard/);
  assert.equal((await service.boards.list()).some(board => board.name === '실패 후 재시도'), false);
});

test('dashboard_open names the start failure and starts normally once the cause is gone', async t => {
  const { call, data } = await serverFor(t);
  const restore = failListen('EPERM');
  let failed;
  try { failed = await call('dashboard_open'); }
  finally { restore(); }
  assert.equal(failed.isError, true);
  assert.deepEqual((({ code, message }) => [code, /\(EPERM\)/.test(message)])(JSON.parse(failed.content[0].text)), ['DASHBOARD_START_FAILED', true]);
  const opened = await data('dashboard_open');
  assert.equal((await (await fetch(`${opened.url}/health`)).json()).status, 'ok');
});

test('startFailure explains listen errors by OS code only and leaves bugs generic', () => {
  const failure = code => startFailure(Object.assign(new Error(`listen ${code} 127.0.0.1:4319 /Users/me`), { code }), 4319);
  assert.deepEqual([failure('EADDRINUSE').code, failure('EADDRINUSE').message], ['PORT_IN_USE', '4319번 포트를 이미 다른 프로그램이 쓰고 있습니다.']);
  assert.match(failure('EADDRNOTAVAIL').message, /127\.0\.0\.1 주소를 쓸 수 없습니다\(EADDRNOTAVAIL\)/);
  assert.equal(failure('ENOSYS').message, '운영체제가 로컬 서버 시작을 거부했습니다(ENOSYS).');
  for (const code of ['EACCES', 'EPERM', 'EADDRNOTAVAIL', 'ENOSYS']) assert.equal(failure(code).code, 'DASHBOARD_START_FAILED');
  const bug = new TypeError('boom');
  assert.equal(startFailure(bug, 4319), bug);
  assert.equal(publicError(startFailure(bug, 4319)).code, 'INTERNAL_ERROR');
});

test('read-only snapshots tell the view that the local dashboard cannot be opened', async t => {
  assert.equal((await (await serverFor(t, { readOnly: true })).data('dashboard_snapshot')).canOpenLocal, false);
  assert.equal((await (await serverFor(t)).data('dashboard_snapshot')).canOpenLocal, true);
});

test('tool metadata stays within the token budget', async t => {
  const { server } = await serverFor(t);
  const { tools } = await server.handle('tools/list');
  // About 7k tokens for 17 tools (main had 14 tools in 19.9KB). Tool metadata is sent with every request, so raise this deliberately.
  assert.ok(Buffer.byteLength(JSON.stringify(tools)) < 28000, `${Buffer.byteLength(JSON.stringify(tools))} bytes`);
});
