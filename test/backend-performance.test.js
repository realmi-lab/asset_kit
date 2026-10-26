import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortfolioService } from '../src/service.js';
import { BithumbProvider } from '../src/bithumb.js';
import { DemoProvider } from '../src/demo.js';
import { HistoryStore, dailyCloses, downsample, pointFor } from '../src/history.js';
import { startDashboard } from '../src/server.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const directoryFor = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-kit-backend-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test('manual portfolio refresh bypasses TTL and all concurrent consumers join the new snapshot', async () => {
  const provider = new DemoProvider();
  const accounts = provider.getAccounts.bind(provider), gate = deferred();
  let calls = 0;
  provider.getAccounts = async () => {
    calls++;
    if (calls > 1) await gate.promise;
    const rows = await accounts();
    rows[0].balance = calls === 1 ? '1' : '100';
    return rows;
  };
  const service = new PortfolioService({ provider });
  const old = await service.portfolio();
  assert.equal(await service.portfolio(), old);
  const first = service.portfolio({ force: true });
  const second = service.portfolio({ force: true });
  const regular = service.portfolio();
  gate.resolve();
  const [a, b, c] = await Promise.all([first, second, regular]);
  assert.equal(calls, 2);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.notEqual(a.summary.cashKrw, old.summary.cashKrw);
});

test('market requests share one upstream chain, cache per period, and force refresh does not fan out', async () => {
  const provider = new DemoProvider();
  const candles = provider.getCandles.bind(provider);
  let calls = 0;
  provider.getCandles = async (...args) => { calls++; return candles(...args); };
  const service = new PortfolioService({ provider });
  const results = await Promise.all(Array.from({ length: 12 }, () => service.getMarket({ symbol: 'BTC', days: 7 })));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result === results[0]));
  assert.equal(await service.getMarket({ symbol: 'btc', days: 7 }), results[0]);
  await service.getMarket({ symbol: 'BTC', days: 30 });
  assert.equal(calls, 2);
  await Promise.all([service.getMarket({ symbol: 'BTC', days: 7, force: true }), service.getMarket({ symbol: 'BTC', days: 7, force: true })]);
  assert.equal(calls, 3);
});

test('a failed market load is not cached and can be retried', async () => {
  const provider = new DemoProvider(), candles = provider.getCandles.bind(provider);
  let calls = 0;
  provider.getCandles = async (...args) => { if (++calls === 1) throw new Error('fixture unavailable'); return candles(...args); };
  const service = new PortfolioService({ provider });
  await assert.rejects(service.getMarket(), /fixture unavailable/);
  assert.equal((await service.getMarket()).symbol, 'BTC');
  assert.equal(calls, 2);
});

test('record ranges reuse recent results and preserve original asOf; forced refresh and failures remain retryable', async () => {
  const provider = new DemoProvider(), orders = provider.getOrders.bind(provider);
  let calls = 0, fail = false;
  provider.getOrders = async (...args) => { calls++; if (fail) throw new Error('fixture unavailable'); return orders(...args); };
  const service = new PortfolioService({ provider });
  const options = { kind: 'orders', from: '2026-09-01', to: '2026-09-03' };
  const a = await service.getRecords(options);
  assert.equal(await service.getRecords(options), a);
  assert.equal(calls, 1);
  await Promise.all([service.getRecords({ ...options, force: true }), service.getRecords({ ...options, force: true })]);
  assert.equal(calls, 2);
  const rolling = await service.getRecords({ kind: 'orders' });
  assert.equal(await service.getRecords({ kind: 'orders' }), rolling);
  assert.equal(calls, 3);
  fail = true;
  await assert.rejects(service.getRecords({ kind: 'pending' }), /fixture unavailable/);
  fail = false;
  assert.equal((await service.getRecords({ kind: 'pending' })).coverage.complete, true);
  await assert.rejects(service.getRecords({ kind: '__proto__' }), { code: 'INVALID_KIND' });
});

test('retained record ranges are bounded independently of the market cache', async () => {
  const provider = new DemoProvider(), orders = provider.getOrders.bind(provider);
  let calls = 0;
  provider.getOrders = async (...args) => { calls++; return orders(...args); };
  const service = new PortfolioService({ provider });
  for (let day = 1; day <= 9; day++) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    await service.getRecords({ from: date, to: date });
  }
  await service.getRecords({ from: '2026-09-09', to: '2026-09-09' });
  assert.equal(calls, 9);
  await service.getRecords({ from: '2026-09-01', to: '2026-09-01' });
  assert.equal(calls, 10);
});

test('market and record TTLs expire without changing the stored retrieval time', async t => {
  let now = Date.now(), markets = 0, records = 0;
  t.mock.method(Date, 'now', () => now);
  const provider = new DemoProvider(), candles = provider.getCandles.bind(provider), orders = provider.getOrders.bind(provider);
  provider.getCandles = async (...args) => { markets++; return candles(...args); };
  provider.getOrders = async (...args) => { records++; return orders(...args); };
  const service = new PortfolioService({ provider });
  const originalMarket = await service.getMarket(), originalRecords = await service.getRecords({ kind: 'pending' });
  now += 29999;
  assert.equal(await service.getRecords({ kind: 'pending' }), originalRecords);
  assert.equal(await service.getMarket(), originalMarket);
  now += 1;
  assert.notEqual(await service.getRecords({ kind: 'pending' }), originalRecords);
  assert.equal(await service.getMarket(), originalMarket);
  now += 30000;
  assert.notEqual(await service.getMarket(), originalMarket);
  assert.equal(markets, 2);
  assert.equal(records, 2);
});

test('public market discovery shares concurrent requests and releases a failed response body', async () => {
  const gate = deferred();
  let calls = 0, canceled = 0;
  const provider = new BithumbProvider({ accessKey: 'fixture-access', secretKey: 'fixture-secret', retries: 0, minIntervalMs: 0,
    fetchImpl: async (_, options) => {
      assert.equal(options.headers.Authorization, undefined);
      calls++;
      await gate.promise;
      if (calls === 1) return { ok: false, status: 503, body: { cancel: async () => { canceled++; } } };
      return Response.json([]);
    },
  });
  const reads = Array.from({ length: 10 }, () => provider.getMarkets());
  gate.resolve();
  const results = await Promise.allSettled(reads);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'API_ERROR'));
  assert.equal(calls, 1);
  assert.equal(canceled, 1);
  await Promise.all([provider.getMarkets(), provider.getMarkets()]);
  assert.equal(calls, 2);
});

test('concurrent history writes append once per bucket and a failed write does not poison the queue', async t => {
  const directory = await directoryFor(t), store = new HistoryStore({ directory, accountId: 'fixture', mode: 'live' });
  const asOf = new Date(Date.now() - 1000).toISOString();
  const portfolio = { mode: 'live', asOf, summary: { totalValueKrw: '12', valuationComplete: true }, holdings: [{ symbol: 'BTC', valueKrw: '12' }] };
  const saved = await Promise.all(Array.from({ length: 20 }, () => store.record(portfolio)));
  assert.equal(saved.filter(Boolean).length, 1);
  assert.equal((await readFile(join(store.directory, `${asOf.slice(0, 10)}.jsonl`), 'utf8')).trim().split('\n').length, 1);
  await assert.rejects(store.record({ ...portfolio, asOf: 'invalid' }), { code: 'INVALID_HISTORY' });
  const later = { ...portfolio, asOf: new Date(Date.parse(asOf) + 300000).toISOString() };
  assert.equal(await store.record(later), true);
});

test('corrupt history entries do not break the chart or manufacture a selected asset value', async t => {
  const directory = await directoryFor(t), store = new HistoryStore({ directory, accountId: 'fixture', mode: 'live' });
  const now = Date.parse('2026-10-20T04:00:00.000Z'), asOf = '2026-10-20T03:00:00.000Z';
  await mkdir(store.directory, { recursive: true });
  const record = { mode: 'live', asOf, totalValueKrw: '10', valuationComplete: true, values: { BTC: 'broken', KRW: '10' } };
  await writeFile(join(store.directory, '2026-10-20.jsonl'), ['null', 'false', '{broken', JSON.stringify({ ...record, asOf: 1 }), JSON.stringify(record)].join('\n'));
  const points = await store.read(1, now);
  assert.equal(points.length, 1);
  assert.equal(pointFor(points[0], ['BTC']).valuationComplete, false);
  assert.equal(pointFor(points[0], ['BTC']).totalValueKrw, null);
  assert.equal(pointFor(points[0], ['KRW']).totalValueKrw, '10');
  assert.equal(pointFor({ ...points[0], values: 'broken' }, ['BTC']).valuationComplete, false);
});

test('daily changes expose missing calendar days instead of implying a one-day return', () => {
  const daily = dailyCloses([
    { asOf: '2026-10-01T04:00:00.000Z', totalValueKrw: '100', valuationComplete: true },
    { asOf: '2026-10-04T04:00:00.000Z', totalValueKrw: '130', valuationComplete: true },
  ]);
  assert.equal(daily[0].previousDay, null);
  assert.equal(daily[0].gapDays, null);
  assert.equal(daily[1].previousDay, '2026-10-01');
  assert.equal(daily[1].gapDays, 3);
  assert.equal(daily[1].changeKrw, '30');
});

test('chart downsampling preserves the original +100 range change and both endpoints within 400 points', () => {
  const points = Array.from({ length: 2000 }, (_, index) => ({
    asOf: new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
    totalValueKrw: index === 0 ? '100' : '200', valuationComplete: true,
  }));
  const sampled = downsample(points);
  assert.ok(sampled.length <= 400);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));
  assert.equal(Number(sampled.at(-1).totalValueKrw) - Number(sampled[0].totalValueKrw), 100);
  assert.deepEqual(downsample(points, 2), [points[0], points.at(-1)]);
});

test('finished-day compression preserves the first eligible record when the cutoff falls inside a bucket', async t => {
  const directory = await directoryFor(t), store = new HistoryStore({ directory, accountId: 'fixture', mode: 'live' });
  await mkdir(store.directory, { recursive: true });
  const record = (minute, total) => ({ mode: 'live', asOf: `2026-10-18T00:${minute}:00.000Z`, totalValueKrw: total, valuationComplete: true });
  await writeFile(join(store.directory, '2026-10-18.jsonl'), [record('00', '50'), record('05', '60'), record('10', '80'), record('15', '100'), record('20', '150'), record('25', '200')].map(value => JSON.stringify(value)).join('\n'));
  const points = await store.read(1, Date.parse('2026-10-19T00:13:00.000Z'));
  assert.equal(points[0].asOf, '2026-10-18T00:15:00.000Z');
  assert.equal(points.at(-1).asOf, '2026-10-18T00:25:00.000Z');
  assert.equal(Number(points.at(-1).totalValueKrw) - Number(points[0].totalValueKrw), 100);
  // Advancing the range must not reuse the earlier cutoff's already compressed cache.
  const next = await store.read(1, Date.parse('2026-10-19T00:16:00.000Z'));
  assert.equal(next[0].asOf, '2026-10-18T00:20:00.000Z');
  const entire = await store.read(2, Date.parse('2026-10-19T00:16:00.000Z'));
  assert.equal(entire[0].asOf, '2026-10-18T00:00:00.000Z');
});

test('transfer pagination includes older-created later-completed rows and reports a capped scan as partial', async () => {
  const provider = new DemoProvider();
  const old = { currency: 'KRW', state: 'DONE', created_at: '2026-09-30T12:00:00.000Z', done_at: '2026-09-30T12:01:00.000Z', amount: '1', fee: '0' };
  let calls = 0;
  provider.getTransfers = async ({ page }) => {
    calls++;
    return page === 1 ? Array.from({ length: 100 }, (_, index) => ({ ...old, uuid: `old-${index}` }))
      : [{ ...old, uuid: 'late-completion', created_at: '2026-09-20T12:00:00.000Z', done_at: '2026-10-03T12:00:00.000Z', amount: '100' }];
  };
  const options = { kind: 'krw_withdrawals', from: '2026-10-01', to: '2026-10-04' };
  const result = await new PortfolioService({ provider }).getRecords(options);
  assert.equal(calls, 2);
  assert.deepEqual(result.rows.map(row => row.uuid), ['late-completion']);
  assert.equal(result.rows[0].at, '2026-10-03T12:00:00.000Z');
  assert.equal(result.totals.KRW.amount, '100');
  assert.equal(result.coverage.complete, true);
  const partial = await new PortfolioService({ provider, maxPages: 1 }).getRecords(options);
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.coverage.pages, 1);
  assert.equal(partial.rows.length, 0);
});

test('HTTP manual refresh reaches the provider and malformed board request roots return 400', async t => {
  const directory = await directoryFor(t), provider = new DemoProvider(), accounts = provider.getAccounts.bind(provider);
  let calls = 0;
  provider.getAccounts = async () => { calls++; return accounts(); };
  const service = new PortfolioService({ provider, directory });
  const { server, url } = await startDashboard(service, { port: 0, collect: false });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await fetch(`${url}/api/portfolio`);
  await fetch(`${url}/api/portfolio`);
  assert.equal(calls, 1);
  await fetch(`${url}/api/portfolio?force=1`);
  assert.equal(calls, 2);
  for (const body of ['null', '[]', '42']) {
    const response = await fetch(`${url}/api/boards/import`, { method: 'POST', headers: { Origin: url, 'X-Asset-Kit': '1', 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  }
});
