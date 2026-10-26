#!/usr/bin/env node
// Optional integration check. The official SDK is installed outside this zero-dependency package.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sdk = process.env.MCP_SDK_ROOT;
if (!sdk) throw new Error('MCP_SDK_ROOT must point to an installed @modelcontextprotocol/sdk directory. See mcp/README.md.');
const { Client } = await import(pathToFileURL(join(sdk, 'dist/esm/client/index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'dist/esm/client/stdio.js')).href);
const directory = await mkdtemp(join(tmpdir(), 'asset-kit-sdk-'));
const root = new URL('../', import.meta.url);
const env = { PATH: process.env.PATH ?? '', ASSET_KIT_DATA_DIR: directory, BITHUMB_ACCESS_KEY: '', BITHUMB_SECRET_KEY: '' };
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('mcp/index.js', root)), '--demo'], env, stderr: 'pipe' });
const client = new Client({ name: 'asset-kit-sdk-verifier', version: '1' });
const checks = [], measurements = {};
let delayedClient;
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SDK verification timed out waiting for the synthetic provider')), 5000); })]); }
  finally { clearTimeout(timer); }
}
const call = async (name, args = {}, options) => {
  const result = await client.callTool({ name, arguments: args }, undefined, options);
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  checks.push(name);
  return result.structuredContent;
};
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools; // The SDK caches and validates each outputSchema.
  assert.equal(tools.length, 14);
  assert.ok(tools.every(tool => tool.outputSchema?.type === 'object'));
  const progress = [];
  await call('portfolio_get_summary', { force: true }, { onprogress: update => progress.push(update.progress) });
  assert.deepEqual(progress, [0, 1]);
  const full = await call('portfolio_get_holdings');
  const compact = await call('portfolio_get_holdings', { symbols: ['BTC', 'ETH'], limit: 1, fields: ['valueKrw', 'profitKrw'] });
  assert.equal(compact.holdings.length, 1); assert.equal(compact.pagination.nextOffset, 1);
  measurements.fullHoldingsBytes = Buffer.byteLength(JSON.stringify(full));
  measurements.selectedHoldingsBytes = Buffer.byteLength(JSON.stringify(compact));
  await call('portfolio_get_allocation', { symbols: ['BTC'], force: true });
  await call('portfolio_get_history', { days: 90, maxPoints: 10 });
  await call('portfolio_get_report', { sections: ['krwDeposits'] });
  await call('market_get_candles', { symbol: 'BTC', days: 5, force: true });
  await call('account_get_orders', { kind: 'pending' });
  await call('account_get_transfers', { assetType: 'krw', direction: 'deposit' });
  const recordProgress = [];
  await call('account_get_records', { kind: 'deposits', pageSize: 1, fields: ['amount'] }, { onprogress: update => recordProgress.push(update.progress) });
  assert.deepEqual(recordProgress, [0, 1, 2]);
  const invalid = await client.callTool({ name: 'portfolio_get_holdings', arguments: { limit: 0 } });
  assert.equal(invalid.isError, true); assert.equal(JSON.parse(invalid.content[0].text).path, '$.limit');
  const board = await call('dashboard_save_board', { name: 'SDK synthetic verification', symbols: ['BTC'] });
  assert.ok((await call('dashboard_list_boards')).boards.some(item => item.id === board.id));
  const opened = await call('dashboard_open', { port: 4499 });
  assert.equal((await fetch(`${opened.url}/health`)).status, 200);
  const manifest = await call('dashboard_get_template', { manifest: true });
  assert.deepEqual(manifest.files, {});
  const source = await call('dashboard_get_template');
  const single = await call('dashboard_get_template', { paths: ['index.html'] });
  assert.deepEqual(Object.keys(single.files), ['index.html']);
  measurements.templateFullBytes = Buffer.byteLength(JSON.stringify(source));
  measurements.templateManifestBytes = Buffer.byteLength(JSON.stringify(manifest));
  await call('system_diagnose');

  // A real SDK/stdio round trip against a delayed synthetic provider verifies cancellation and resume.
  const moduleUrl = path => JSON.stringify(new URL(path, root).href);
  const code = `
    import { startMcp } from ${moduleUrl('mcp/index.js')};
    import { PortfolioService } from ${moduleUrl('src/service.js')};
    import { DemoProvider } from ${moduleUrl('src/demo.js')};
    const provider = new DemoProvider();
    provider.getTransfers = async (options, { signal } = {}) => {
      if (options.direction === 'withdraw') {
        process.stderr.write('transfer-started\\n');
        return new Promise((_, reject) => signal.addEventListener('abort', () => {
          process.stderr.write('transfer-aborted\\n'); reject(signal.reason);
        }, { once: true }));
      }
      return Array.from({ length: options.page === 1 ? 100 : 3 }, (_, i) => ({
        uuid: String((options.page - 1) * 100 + i), currency: 'BTC', state: 'DONE',
        created_at: new Date(Date.now() - 1000).toISOString(), amount: '0.00000001', fee: '0'
      }));
    };
    startMcp(new PortfolioService({ provider, directory: process.env.ASSET_KIT_DATA_DIR }));
  `;
  const delayedTransport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', code], env, stderr: 'pipe' });
  let startedResolve, abortedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const aborted = new Promise(resolve => { abortedResolve = resolve; });
  delayedTransport.stderr.on('data', chunk => {
    if (String(chunk).includes('transfer-started')) startedResolve();
    if (String(chunk).includes('transfer-aborted')) abortedResolve();
  });
  delayedClient = new Client({ name: 'asset-kit-cancel-verifier', version: '1' });
  await delayedClient.connect(delayedTransport);
  await delayedClient.listTools();
  const page = async args => (await delayedClient.callTool({ name: 'account_get_records', arguments: args })).structuredContent;
  const first = await page({ kind: 'deposits', pageSize: 2, scanPages: 1 });
  const next = await page({ kind: 'deposits', cursor: first.pagination.nextCursor });
  assert.deepEqual(first.rows.map(row => row.uuid), ['0', '1']);
  assert.deepEqual(next.rows.map(row => row.uuid), ['2', '3']);
  assert.deepEqual(await page({ kind: 'deposits', cursor: first.pagination.nextCursor }), next);
  const controller = new AbortController();
  const pending = delayedClient.callTool({ name: 'account_get_records', arguments: { kind: 'withdrawals' } }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await bounded(started);
  controller.abort();
  await rejected;
  await bounded(aborted);
  await delayedClient.ping();
  const report = { sdk: JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8')).version, server: client.getServerVersion(),
    toolsValidated: [...new Set(checks)].length, checks: ['14 tool output schemas', 'stdio negotiation', 'field selection', 'force refresh', 'progress notifications', 'cursor continuation and replay', 'SDK AbortSignal cancels provider', 'post-cancellation ping', 'validation recovery path'],
    measurements, mode: 'synthetic-only', liveAccountVerified: false };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await delayedClient?.close();
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
