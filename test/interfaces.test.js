import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createInterface } from 'node:readline';
import { PortfolioService } from '../src/service.js';
import { startDashboard } from '../src/server.js';

// Every test writes boards and history into a throwaway folder, never the user's real data folder.
const data = mkdtempSync(join(tmpdir(), 'asset-kit-interfaces-'));
process.env.ASSET_KIT_DATA_DIR = data;
const env = { ...process.env, ASSET_KIT_DATA_DIR: data, BITHUMB_ACCESS_KEY: '', BITHUMB_SECRET_KEY: '' };
const cli = fileURLToPath(new URL('../cli/asset-kit.js', import.meta.url));
const mcp = fileURLToPath(new URL('../mcp/index.js', import.meta.url));
const WRITE_TOOLS = ['dashboard_save_board', 'dashboard_open'];

// 외부 패키지 없이 MCP stdio 서버와 JSON-RPC로 대화하는 최소 클라이언트
function mcpClient(args) {
  const child = spawn(process.execPath, [mcp, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let next = 1;
  createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); waiting.get(message.id)?.(message); waiting.delete(message.id); });
  const rpc = (method, params) => new Promise(resolve => { const id = next++; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  const close = () => new Promise(resolve => { const started = Date.now(); child.once('exit', () => resolve(Date.now() - started)); child.stdin.end(); });
  return { child, rpc, call, close };
}

test('stdio MCP: protocol, 17 tools, read-only except local dashboard tools, boards and dashboard end to end', async () => {
  const client = mcpClient(['--demo']);
  try {
    const init = await client.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18'); assert.equal(init.result.serverInfo.name, 'bithumb-asset-kit');
    assert.deepEqual(init.result.capabilities.resources, { listChanged: false });
    assert.equal((await client.rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
    client.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    assert.deepEqual((await client.rpc('ping')).result, {});
    assert.equal((await client.rpc('prompts/list')).error.code, -32601);
    const [view] = (await client.rpc('resources/list')).result.resources;
    assert.deepEqual([view.uri, view.mimeType], ['ui://bithumb-asset-kit/dashboard.html', 'text/html;profile=mcp-app']);
    const html = (await client.rpc('resources/read', { uri: view.uri })).result.contents[0];
    assert.equal(html.mimeType, view.mimeType);
    assert.match(html.text, /ui\/initialize/);
    assert.doesNotMatch(html.text, /__VERSION__|(?:src|href)="(?:https?:)?\/\//);
    assert.equal((await client.rpc('resources/read', { uri: 'ui://other' })).error.code, -32002);
    assert.equal((await client.rpc('tools/call', { name: 'nope' })).error.code, -32602);
    const { tools } = (await client.rpc('tools/list')).result;
    assert.equal(tools.length, 17);
    assert.ok(tools.every(tool => tool.title && tool.annotations.title === tool.title), 'every tool has a short title');
    assert.equal(tools.find(tool => tool.name === 'dashboard_snapshot')._meta.ui.resourceUri, view.uri);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, !WRITE_TOOLS.includes(tool.name), tool.name);
      assert.equal(tool.inputSchema.type, 'object');
    }
    assert.ok(tools.every(tool => !/order_place|withdraw|cancel/.test(tool.name)));
    const data = async (name, args) => (await client.call(name, args)).structuredContent;
    const summary = await data('portfolio_get_summary');
    assert.equal(summary.totalValueKrw, '28074000'); assert.equal(summary.mode, 'demo'); assert.equal(summary.largest[0].symbol, 'BTC');
    assert.equal((await data('portfolio_get_summary', { symbols: ['btc', 'ETH'] })).totalValueKrw, '20238000');
    assert.equal((await data('portfolio_get_holdings', { symbol: 'btc' })).holdings[0].quantity, '0.125');
    assert.equal((await data('portfolio_get_history', { days: 7 })).points.length, 7);
    assert.equal((await data('portfolio_get_history', { days: 7, daily: true })).daily.length, 7);
    assert.equal((await data('market_get_candles', { symbol: 'BTC', days: 3 })).candles.length, 3);
    assert.equal((await data('account_get_records', { kind: 'krw_deposits' })).rows.length, 1);
    assert.ok((await data('dashboard_get_template')).files['index.html'].includes('Asset Kit'));
    assert.equal((await data('portfolio_get_report')).coverage.allTime, false);
    const board = await data('dashboard_save_board', { name: 'AI 장기 보유', symbols: ['eth'], widgets: ['summary', 'holdings'] });
    assert.deepEqual(board.symbols, ['ETH']);
    const renamed = await data('dashboard_save_board', { id: board.id, revision: 1, name: '이름만 변경' });
    assert.deepEqual([renamed.revision, renamed.symbols, renamed.widgets], [2, ['ETH'], ['summary', 'holdings']]);
    assert.ok((await data('dashboard_list_boards')).boards.some(b => b.id === board.id));
    const opened = await data('dashboard_open', { port: 4399 });
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await data('dashboard_open')).url, opened.url);
    // 저장과 열기를 한 번에: 같은 서버 주소에 새 보드가 선택된 링크를 돌려줍니다.
    const shown = await data('dashboard_save_board', { name: 'BTC만', symbols: ['BTC'], open: true });
    assert.equal(shown.url, `${opened.url}/?board=${shown.id}`);
    assert.equal((await data('dashboard_open', { boardId: board.id })).url, `${opened.url}/?board=${board.id}`);
    const missing = await client.call('dashboard_open', { boardId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(JSON.parse(missing.content[0].text).code, 'BOARD_NOT_FOUND');
    const snapshot = await data('dashboard_snapshot', { boardId: shown.id });
    assert.deepEqual([snapshot.board.name, snapshot.scope, snapshot.holdings.map(h => h.symbol)], ['BTC만', ['BTC'], ['BTC']]);
    assert.equal((await fetch(`${opened.url}/api/boards`)).status, 200);
    assert.equal((await client.call('account_get_orders', { kind: 'history', fromMs: 1, toMs: 10 * 86400000 })).isError, true);
    assert.equal((await client.call('market_get_candles', { symbol: '../../etc/passwd' })).isError, true);
    assert.equal((await client.call('portfolio_get_summary', { unexpected: true })).isError, true);
  } finally {
    // 대시보드를 띄운 뒤에도 MCP 연결이 끝나면 바로 종료돼야 합니다.
    assert.ok(await client.close() < 1000);
  }
});

test('MCP options: --modules and --read-only limit tools like the official server; --verbose logs to stderr; system_diagnose reports state', async () => {
  const client = mcpClient(['--demo', '--modules', 'market', '--read-only', '--verbose']);
  let stderr = '';
  client.child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const init = (await client.rpc('initialize', { protocolVersion: '2025-06-18' })).result;
    assert.equal(init.capabilities.resources, undefined);
    assert.doesNotMatch(init.instructions, /dashboard_/, 'instructions never point to disabled tools');
    const names = (await client.rpc('tools/list')).result.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ['market_get_candles', 'market_get_tickers', 'market_get_warnings', 'system_diagnose']);
    assert.deepEqual((await client.rpc('resources/list')).result.resources, []);
    assert.equal((await client.rpc('tools/call', { name: 'portfolio_get_summary', arguments: {} })).error.code, -32602);
    const diagnose = (await client.call('system_diagnose')).structuredContent;
    assert.deepEqual([diagnose.mode, diagnose.readOnly, diagnose.publicApi.ok, diagnose.accountApi.ok], ['demo', true, true, true]);
    assert.deepEqual(diagnose.modules.sort(), ['market', 'system']);
  } finally { await client.close(); }
  assert.match(stderr, /system_diagnose ok \d+ms/);
  const help = spawnSync(process.execPath, [mcp, '--help'], { encoding: 'utf8', env });
  assert.equal(help.status, 0); assert.match(help.stdout, /--modules/);
  const bad = spawnSync(process.execPath, [mcp, '--modules', 'trade'], { encoding: 'utf8', env });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).code, 'USAGE');
});

test('CLI: JSON for demo data, explicit failure without live keys, boards and explain', () => {
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
  const demo = run('portfolio', '--demo');
  assert.equal(demo.status, 0); assert.equal(JSON.parse(demo.stdout).summary.totalValueKrw, '28074000');
  const live = run('portfolio');
  assert.equal(live.status, 1); assert.equal(live.stdout, ''); assert.equal(JSON.parse(live.stderr).code, 'NOT_CONFIGURED');
  assert.equal(Object.keys(JSON.parse(run('report', '--demo').stdout).sections).length, 6);
  assert.match(JSON.parse(run('explain', '--demo', '--symbols', 'BTC').stdout).summary, /13,550,000원/);
  const created = JSON.parse(run('boards', 'create', '--demo', '--name', 'CLI 보드', '--symbols', 'btc', '--widgets', 'summary,trend').stdout);
  assert.deepEqual(created.symbols, ['BTC']);
  assert.ok(JSON.parse(run('boards', 'list', '--demo').stdout).some(b => b.id === created.id));
  assert.equal(JSON.parse(run('boards', 'create', '--demo', '--name', 'x', '--widgets', 'execute').stderr).code, 'INVALID_BOARD');
  assert.equal(JSON.parse(run('config', 'status').stdout).configured, false);
});

test('CLI dashboard names the busy port instead of a generic failure', async () => {
  const { server, url } = await startDashboard(new PortfolioService({ demo: true }), { port: 0, collect: false });
  const port = new URL(url).port;
  try {
    const result = spawnSync(process.execPath, [cli, 'dashboard', '--demo', '--port', port], { encoding: 'utf8', env, timeout: 10000 });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), { code: 'PORT_IN_USE', message: `${port}번 포트를 이미 다른 프로그램이 쓰고 있습니다. --port 옵션으로 다른 포트를 선택하세요.` });
  } finally { server.close(); }
});

test('served dashboard: consistent JSON, guarded board writes, foreign origins and rebinding hosts fail', async () => {
  const service = new PortfolioService({ demo: true });
  const { server, url } = await startDashboard(service, { port: 0, collect: false });
  const json = (path, method, body, headers = {}) => fetch(`${url}${path}`, { method, headers: { Origin: url, 'Content-Type': 'application/json', 'X-Asset-Kit': '1', ...headers }, body: JSON.stringify(body) });
  try {
    const html = await fetch(url);
    assert.equal(html.status, 200); assert.match(await html.text(), /Asset Kit/);
    assert.ok(html.headers.get('content-security-policy').includes("connect-src 'self'")); assert.equal(html.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${url}/assets/bithumb-logo.png`)).headers.get('content-type'), 'image/png');
    assert.equal((await (await fetch(`${url}/api/portfolio`)).json()).summary.totalValueKrw, '28074000');
    assert.equal((await (await fetch(`${url}/api/portfolio?symbols=BTC`)).json()).summary.totalValueKrw, '13550000');
    assert.equal((await fetch(`${url}/api/portfolio`, { headers: { Origin: 'https://example.com' } })).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      const req = request(`${url}/api/portfolio`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(rebound, 403);
    assert.equal((await fetch(`${url}/api/portfolio`, { method: 'POST' })).status, 403);
    assert.equal((await json('/api/portfolio', 'POST', {})).status, 405);
    assert.equal((await fetch(`${url}/api/history?days=999`)).status, 400);
    assert.equal((await fetch(`${url}/api/orders?kind=history&fromMs=0&toMs=999999999999`)).status, 400);
    assert.equal((await (await fetch(`${url}/api/transfers?direction=withdraw&assetType=krw`)).json()).data[0].currency, 'KRW');
    assert.equal((await fetch(`${url}/api/boards`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'text/plain' }, body: '{"name":"csrf"}' })).status, 403);
    const created = await json('/api/boards', 'POST', { name: 'BTC only', symbols: ['BTC'], widgets: ['summary', 'holdings'] });
    assert.equal(created.status, 201);
    const board = await created.json();
    assert.equal((await json(`/api/boards/${board.id}`, 'PUT', { ...board, name: 'BTC updated' })).status, 200);
    assert.equal((await json(`/api/boards/${board.id}`, 'PUT', board)).status, 409);
    assert.equal((await json('/api/boards/import', 'POST', { boards: [{ name: 'valid' }, { name: 'bad', widgets: ['execute'] }] })).status, 400);
    assert.ok(!(await service.boards.list()).some(b => b.name === 'valid'));
    assert.equal((await json(`/api/boards/${board.id}`, 'DELETE', { revision: 2 })).status, 200);
    // Market data for the market page: public prices, read-only, unknown options fall back to defaults.
    const movers = await (await fetch(`${url}/api/tickers?scope=all&sort=change&direction=desc&limit=3`)).json();
    assert.deepEqual(movers.rows.map(row => row.symbol), ['DOGE', 'BTC', 'ETH']);
    assert.deepEqual((await (await fetch(`${url}/api/tickers?scope=holdings`)).json()).rows.map(row => row.symbol), ['BTC', 'ETH', 'XRP', 'SOL']);
    const fallback = await (await fetch(`${url}/api/tickers?scope=evil&sort=evil&direction=up&limit=999`)).json();
    assert.deepEqual([fallback.scope, fallback.sort, fallback.direction, fallback.rows.length], ['all', 'value24h', 'desc', 7]);
    assert.deepEqual((await (await fetch(`${url}/api/warnings?scope=all`)).json()).rows.map(row => [row.symbol, row.held]), [['DOGE', false]]);
    assert.equal((await (await fetch(`${url}/api/warnings?scope=holdings`)).json()).total, 0);
    assert.equal((await json('/api/tickers', 'POST', {})).status, 405);
    const market = await json('/api/boards', 'POST', { name: '시장', widgets: ['market', 'warnings', 'heatmap'] });
    assert.equal(market.status, 201);
    assert.equal((await fetch(`${url}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${url}/../src/config.js`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('web and sample scripts parse; every file is plain JavaScript without a build step', () => {
  for (const file of ['../web/app.js', '../web/dashboard-utils.js', '../web/theme.js', '../examples/fixture.js', '../examples/build.js']) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
