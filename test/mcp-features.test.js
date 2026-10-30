import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { PortfolioService } from '../src/service.js';
import { DemoProvider } from '../src/demo.js';
import { BithumbProvider } from '../src/bithumb.js';
import { createMcpServer, dashboardTemplate, startMcp } from '../mcp/index.js';
import { RecordReader } from '../mcp/records.js';
import { dashboardSnapshot } from '../mcp/query.js';
import { KitError } from '../src/errors.js';

const NOW = Date.parse('2026-10-26T06:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const order = (id, at = new Date(NOW).toISOString()) => ({ order_id: String(id), market: 'KRW-BTC', side: 'bid', state: 'done', created_at: at,
  order_type: 'limit', price: '100', volume: '1', remaining_volume: '0', locked: '0', executed_volume: '1', executed_funds: '100.00000001', paid_fee: '0.00000001' });
const transfer = (id, currency = 'BTC') => ({ uuid: String(id), currency, state: 'DONE', created_at: '2026-09-01T00:00:00Z', done_at: new Date(NOW).toISOString(), amount: '0.00000001', fee: '0' });
const serviceFor = provider => ({ provider: { mode: 'demo', ...provider } });
async function serverFor(t, provider = new DemoProvider()) {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-mcp-features-'));
  const service = new PortfolioService({ provider, directory });
  const server = createMcpServer(service);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  return { service, server, call: (name, args = {}, context) => server.handle('tools/call', { name, arguments: args }, context) };
}

test('MCP exposes force refresh, exact filters/sorts and selected fields without losing warnings', async t => {
  const provider = new DemoProvider();
  let accountReads = 0;
  const accounts = provider.getAccounts.bind(provider);
  provider.getAccounts = () => { accountReads++; return accounts(); };
  const { call, server } = await serverFor(t, provider);
  await call('portfolio_get_summary');
  await call('portfolio_get_allocation');
  assert.equal(accountReads, 1);
  await call('portfolio_get_summary', { force: true });
  assert.equal(accountReads, 2);
  const full = (await call('portfolio_get_holdings')).structuredContent;
  const result = (await call('portfolio_get_holdings', { excludeCash: true, performance: 'gain', sort: 'pnl', direction: 'asc', limit: 2, fields: ['valueKrw'] })).structuredContent;
  assert.deepEqual(result.holdings.map(h => h.symbol), ['SOL', 'ETH']);
  assert.deepEqual(result.pagination, { total: 3, returned: 2, offset: 0, nextOffset: 2 });
  assert.deepEqual(Object.keys(result.holdings[0]).sort(), ['staleQuote', 'symbol', 'valuationStatus', 'valueKrw']);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(JSON.stringify(result).length < JSON.stringify(full).length / 2);
  const loss = (await call('portfolio_get_holdings', { performance: 'loss', search: '리플' })).structuredContent;
  assert.equal(loss.holdings[0].symbol, 'XRP');
  const tools = (await server.handle('tools/list')).tools;
  assert.equal(tools.length, 17);
  assert.ok(tools.every(tool => tool.outputSchema.type === 'object'));
  for (const args of [{ fields: ['secret'] }, { limit: 0 }, JSON.parse('{"constructor":true}')]) {
    const bad = await call('portfolio_get_holdings', args);
    assert.equal(bad.isError, true);
    assert.equal(JSON.parse(bad.content[0].text).retryable, false);
  }
});

test('dashboard snapshot draws a board in one compact call with exact decimals and columnar series', async t => {
  const { call, service } = await serverFor(t);
  const result = (await call('dashboard_snapshot', { top: 2 })).structuredContent;
  assert.deepEqual(result.holdings.map(h => h.symbol), ['BTC', 'ETH']);
  assert.deepEqual(Object.keys(result.holdings[0]).sort(), ['allocationPct', 'marketWarning', 'name', 'priceChangePct', 'profitKrw', 'profitRatePct', 'quantity', 'symbol', 'valueKrw']);
  // The others slice is a decimal sum, so top holdings and others cover the whole scope exactly.
  assert.equal(result.others.count, 3);
  assert.equal(result.others.valueKrw, '7836000');
  assert.equal(result.holdings.reduce((sum, h) => sum + BigInt(h.valueKrw), BigInt(result.others.valueKrw)).toString(), result.summary.totalValueKrw);
  assert.equal(result.summary.totalValueKrw, '28074000');
  assert.equal(result.trend.at.length, result.trend.valueKrw.length);
  assert.equal(result.trend.days, 30);
  assert.equal(result.trend.firstKrw, result.trend.valueKrw[0]);
  assert.equal(result.trend.lastKrw, result.trend.valueKrw.at(-1));
  assert.equal(result.daily, undefined);
  const year = (await call('dashboard_snapshot', { days: 365, points: 20, daily: true })).structuredContent;
  const history = (await call('portfolio_get_history', { days: 365 })).structuredContent;
  assert.equal(year.trend.at.length, 20);
  assert.equal(year.trend.sampled, true);
  assert.equal(year.trend.firstKrw, history.points[0].totalValueKrw);
  assert.equal(year.trend.changeKrw, (BigInt(year.trend.lastKrw) - BigInt(year.trend.firstKrw)).toString());
  assert.equal(year.daily.day.length, year.daily.changeKrw.length);
  const compact = (await call('dashboard_snapshot', { days: 365 })).structuredContent;
  assert.ok(JSON.stringify(compact).length < JSON.stringify(history).length / 4);
  // A board supplies the default scope and period; explicit arguments still win.
  const board = await service.boards.create({ name: '이더리움', symbols: ['ETH'], days: 7 });
  const scoped = (await call('dashboard_snapshot', { boardId: board.id })).structuredContent;
  assert.deepEqual([scoped.board.name, scoped.scope, scoped.trend.days, scoped.holdings[0].allocationPct, scoped.others.count], ['이더리움', ['ETH'], 7, '100.0000', 0]);
  assert.equal((await call('dashboard_snapshot', { boardId: board.id, days: 90 })).structuredContent.trend.days, 90);
  const missing = await call('dashboard_snapshot', { boardId: '00000000-0000-4000-8000-000000000000' });
  assert.equal(missing.isError, true);
  assert.deepEqual([JSON.parse(missing.content[0].text).code, JSON.parse(missing.content[0].text).retryable], ['BOARD_NOT_FOUND', false]);
});

test('dashboard snapshot keeps unpriced history out of the series and reports it', async () => {
  const history = { mode: 'live', days: 30, scope: [], sampled: false, points: [
    { asOf: '2026-10-01T00:00:00.000Z', totalValueKrw: '100', valuationComplete: true },
    { asOf: '2026-10-02T00:00:00.000Z', totalValueKrw: null, valuationComplete: false },
    { asOf: '2026-10-03T00:00:00.000Z', totalValueKrw: '90.5', valuationComplete: true },
  ] };
  const portfolio = { mode: 'live', asOf: '2026-10-03T00:00:00.000Z', scope: [], warnings: [], summary: { totalValueKrw: '0', valuationComplete: true },
    holdings: [{ symbol: 'KRW', name: '원화', valueKrw: null, allocationPct: null }] };
  const result = await dashboardSnapshot({ portfolio: async () => portfolio, historyPoints: async () => history }, {});
  assert.deepEqual(result.trend.valueKrw, ['100', '90.5']);
  assert.deepEqual([result.trend.omitted, result.trend.changeKrw], [1, '-9.5']);
  assert.deepEqual(result.others, { count: 0, valueKrw: '0', allocationPct: '0', unpriced: 0 });
  const empty = await dashboardSnapshot({ portfolio: async () => portfolio, historyPoints: async () => ({ ...history, points: [] }) }, {});
  assert.deepEqual([empty.trend.at, empty.trend.firstKrw, empty.trend.changeKrw], [[], null, null]);
});

test('MCP field projection keeps decimals, nulls, and full-scope allocation semantics', async t => {
  const { call } = await serverFor(t);
  const result = (await call('portfolio_get_holdings', { symbols: ['BTC', 'ETH'], symbol: 'BTC', fields: ['quantity', 'allocationPct'] })).structuredContent;
  assert.equal(result.holdings[0].quantity, '0.125');
  assert.equal(result.holdings[0].allocationPct, '66.9533');
  assert.deepEqual(result.scope, ['BTC', 'ETH']);
  const cash = (await call('portfolio_get_holdings', { symbol: 'KRW', fields: ['profitKrw'] })).structuredContent;
  assert.equal(cash.holdings[0].profitKrw, null);
  const history = (await call('portfolio_get_history', { days: 90, maxPoints: 10 })).structuredContent;
  assert.ok(history.points.length <= 10);
  assert.equal(history.sampled, true);
  const all = (await call('portfolio_get_history', { days: 90 })).structuredContent;
  assert.equal(history.points[0].totalValueKrw, all.points[0].totalValueKrw);
  assert.equal(history.points.at(-1).totalValueKrw, all.points.at(-1).totalValueKrw);
  assert.equal((await call('portfolio_get_history', { daily: true, maxPoints: 10 })).isError, true);
});

test('report section selection avoids unrequested private calls; template manifest avoids source payloads', async t => {
  const provider = new DemoProvider();
  let orders = 0, transfers = 0;
  provider.getOrders = async () => { orders++; return { data: [], has_next: false, next_key: null }; };
  provider.getTransfers = async () => { transfers++; return []; };
  const { call } = await serverFor(t, provider);
  const report = (await call('portfolio_get_report', { sections: [] })).structuredContent;
  assert.deepEqual(report.sections, {}); assert.equal(orders + transfers, 0);
  await call('portfolio_get_report', { sections: ['krwDeposits'] });
  assert.equal(orders, 0); assert.equal(transfers, 1);
  const manifest = await dashboardTemplate({ manifest: true });
  const full = await dashboardTemplate();
  assert.deepEqual(manifest.files, {});
  assert.ok(manifest.manifest.some(file => file.path === 'app.js' && file.bytes > 0));
  assert.ok(JSON.stringify(manifest).length < JSON.stringify(full).length / 10);
  assert.deepEqual(Object.keys((await dashboardTemplate({ paths: ['index.html'] })).files), ['index.html']);
  await assert.rejects(dashboardTemplate({ paths: ['../src/config.js'] }), { code: 'INVALID_ARGUMENTS' });
});

test('bounded MCP record pages drain buffered rows, retain exact page totals and replay without more API calls', async () => {
  let reads = 0;
  const reader = new RecordReader(serviceFor({ getOrders: async options => {
    reads++;
    return options.nextKey ? { data: Array.from({ length: 25 }, (_, i) => order(i + 100)), has_next: false, next_key: null }
      : { data: Array.from({ length: 100 }, (_, i) => order(i)), has_next: true, next_key: 'page-two' };
  } }), { clock: () => NOW });
  const first = await reader.read({ kind: 'pending', pageSize: 17, scanPages: 1 });
  assert.equal(first.rows.length, 17); assert.equal(first.coverage.complete, false);
  assert.equal(first.totals.KRW.amount, '1700.00000017');
  const seen = first.rows.map(row => row.order_id);
  let cursor = first.pagination.nextCursor, last;
  while (cursor) {
    last = await reader.read({ kind: 'pending', cursor });
    const count = reads;
    assert.deepEqual(await reader.read({ kind: 'pending', cursor }), last);
    assert.equal(reads, count);
    seen.push(...last.rows.map(row => row.order_id));
    cursor = last.pagination.nextCursor;
  }
  assert.equal(reads, 2); assert.equal(seen.length, 125); assert.equal(new Set(seen).size, 125);
  assert.equal(last.coverage.complete, true); assert.equal(last.coverage.totalsScope, 'returned_rows');
});

test('sparse transfer filters return a continuation even when rows is empty; older-created late completions remain visible', async () => {
  const pages = [];
  const reader = new RecordReader(serviceFor({ getTransfers: async options => {
    pages.push(options.page);
    return options.page === 1 ? Array.from({ length: 100 }, (_, i) => transfer(i, 'ETH')) : [transfer('late-btc')];
  } }), { clock: () => NOW });
  const first = await reader.read({ kind: 'deposits', from: '2026-10-01', to: '2026-10-26', symbols: ['btc'], scanPages: 1 });
  assert.deepEqual(first.rows, []); assert.ok(first.pagination.nextCursor); assert.equal(first.coverage.complete, false);
  const next = await reader.read({ kind: 'deposits', cursor: first.pagination.nextCursor });
  assert.deepEqual(next.rows.map(row => row.uuid), ['late-btc']);
  assert.equal(next.coverage.complete, true); assert.deepEqual(pages, [1, 2]);
});

test('order periods resume across non-overlapping seven-day windows and reject repeating upstream cursors', async () => {
  const windows = [];
  const reader = new RecordReader(serviceFor({ getOrders: async options => {
    windows.push(options);
    return { data: [], has_next: false, next_key: null };
  } }), { clock: () => NOW });
  const first = await reader.read({ kind: 'orders', from: '2026-10-01', to: '2026-10-14', scanPages: 1 });
  assert.equal(first.coverage.complete, false);
  const second = await reader.read({ kind: 'orders', cursor: first.pagination.nextCursor });
  assert.equal(second.coverage.complete, true); assert.equal(windows.length, 2);
  assert.equal(windows[1].toMs + 1, windows[0].fromMs);
  assert.ok(windows.every(window => window.toMs - window.fromMs < 7 * 86400000));
  const broken = new RecordReader(serviceFor({ getOrders: async () => ({ data: [], has_next: true, next_key: 'loop' }) }), { clock: () => NOW });
  await assert.rejects(broken.read({ kind: 'pending' }), { code: 'INVALID_CURSOR' });
});

test('cancelled and failed continuations do not advance their checkpoint', async () => {
  const waiting = deferred();
  let fail = true, delay = true, seenSignal;
  const keys = [];
  const reader = new RecordReader(serviceFor({ getOrders: async (options, { signal } = {}) => {
    keys.push(options.nextKey); seenSignal = signal;
    if (!options.nextKey) return { data: [order('first')], has_next: true, next_key: 'next' };
    if (delay) return waiting.promise;
    if (fail) throw new KitError('RATE_LIMITED', 'retry', 429);
    return { data: [order('second')], has_next: false, next_key: null };
  } }), { clock: () => NOW });
  const first = await reader.read({ kind: 'pending', pageSize: 1 });
  const args = { kind: 'pending', cursor: first.pagination.nextCursor };
  const controller = new AbortController();
  const pending = reader.read(args, { signal: controller.signal });
  await assert.rejects(reader.read(args), { code: 'CURSOR_BUSY' });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(seenSignal.aborted, true);
  waiting.resolve({ data: [order('cancelled')], has_next: false, next_key: null });
  delay = false;
  await assert.rejects(reader.read(args), { code: 'RATE_LIMITED' });
  fail = false;
  const result = await reader.read(args);
  assert.deepEqual(result.rows.map(row => row.order_id), ['second']);
  assert.deepEqual(keys, [undefined, 'next', 'next', 'next']);
});

test('cursor filters, expiry and process boundaries fail explicitly; force bypasses first-page cache', async () => {
  let clock = NOW, reads = 0;
  const service = serviceFor({ getOrders: async () => { reads++; return { data: [order('one'), order('two')], has_next: false, next_key: null }; } });
  const reader = new RecordReader(service, { clock: () => clock });
  const args = { kind: 'pending', pageSize: 1, symbols: ['BTC'] };
  const first = await reader.read(args);
  assert.deepEqual(await reader.read(args), first); assert.equal(reads, 1);
  await reader.read({ ...args, force: true }); assert.equal(reads, 2);
  const cursor = first.pagination.nextCursor;
  for (const extra of [{ symbols: ['ETH'] }, { pageSize: 2 }, { force: true }]) await assert.rejects(reader.read({ kind: 'pending', cursor, ...extra }), { code: 'CURSOR_QUERY_MISMATCH' });
  await assert.rejects(new RecordReader(service).read({ kind: 'pending', cursor }), { code: 'CURSOR_EXPIRED' });
  clock += 10 * 60000;
  await assert.rejects(reader.read({ kind: 'pending', cursor }), { code: 'CURSOR_EXPIRED' });
});

test('identical initial record reads share work; cancelling one subscriber leaves the other intact', async () => {
  const reached = deferred(), response = deferred();
  let calls = 0, upstreamSignal;
  const reader = new RecordReader(serviceFor({ getOrders: async (_, { signal }) => {
    calls++; upstreamSignal = signal; reached.resolve(); return response.promise;
  } }), { clock: () => NOW });
  const controller = new AbortController();
  const first = reader.read({ kind: 'pending' }, { signal: controller.signal });
  const second = reader.read({ kind: 'pending' });
  await reached.promise;
  controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(upstreamSignal.aborted, false);
  response.resolve({ data: [order('shared')], has_next: false, next_key: null });
  assert.equal((await second).rows[0].order_id, 'shared'); assert.equal(calls, 1);
});

test('input errors identify the invalid path and preserve SDK-readable error results', async t => {
  const { call } = await serverFor(t);
  for (const [args, path] of [[{ limit: -1 }, '$.limit'], [{ fields: ['invalid'] }, '$.fields[0]'], [null, '$']]) {
    const result = await call('portfolio_get_holdings', args);
    assert.equal(result.isError, true);
    const error = JSON.parse(result.content[0].text);
    assert.equal(error.path, path); assert.equal(error.retryable, false);
  }
});

test('provider cancellation aborts the HTTP request and never retries it', async () => {
  const reached = deferred();
  let attempts = 0;
  const provider = new BithumbProvider({ accessKey: 'mock', secretKey: 'mock', minIntervalMs: 0, fetchImpl: async (_, { signal }) => {
    attempts++; reached.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = provider.getOrders({ kind: 'pending', limit: 1 }, { signal: controller.signal });
  await reached.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(attempts, 1);
});

test('stdio progress uses request tokens and cancellation stops a read without responding or poisoning ping', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-mcp-stdio-'));
  const provider = new DemoProvider(), reached = deferred();
  let requestSignal;
  provider.getTransfers = async (_, { signal } = {}) => {
    requestSignal = signal; reached.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const input = new PassThrough(), output = new PassThrough(), messages = [], waiters = new Map();
  const lines = createInterface({ input: output });
  lines.on('line', line => { const message = JSON.parse(line); messages.push(message); waiters.get(message.id)?.(message); waiters.delete(message.id); });
  const server = startMcp(new PortfolioService({ provider, directory }), { input, output });
  t.after(async () => { input.end(); lines.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  const send = value => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
  const rpc = (id, method, params) => new Promise(resolve => { waiters.set(id, resolve); send({ id, method, params }); });
  await rpc(1, 'initialize', { protocolVersion: '2025-11-25' });
  send({ id: 2, method: 'tools/call', params: { name: 'account_get_records', arguments: { kind: 'deposits' }, _meta: { progressToken: 0 } } });
  await reached.promise;
  send({ method: 'notifications/cancelled', params: { requestId: 2 } });
  assert.deepEqual((await rpc(3, 'ping')).result, {});
  await tick();
  assert.equal(requestSignal.aborted, true);
  assert.equal(messages.some(message => message.id === 2), false);
  assert.deepEqual(messages.filter(message => message.method === 'notifications/progress').map(message => message.params), [{ progressToken: 0, progress: 0, message: '요청 시작' }]);
  const completed = await rpc(4, 'tools/call', { name: 'portfolio_get_summary', arguments: {}, _meta: { progressToken: 'summary' } });
  assert.equal(completed.result.structuredContent.totalValueKrw, '28074000');
  assert.deepEqual(messages.filter(message => message.params?.progressToken === 'summary').map(message => message.params.progress), [0, 1]);
});
