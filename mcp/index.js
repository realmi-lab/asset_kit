#!/usr/bin/env node
// 빗썸 자산 MCP 서버. 외부 패키지 없이 Node.js 내장 기능만으로 stdio JSON-RPC 2.0을 처리합니다. 사용법: node mcp/index.js --help
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { KitError, publicError } from '../src/errors.js';
import { check, SYMBOLS_INPUT } from '../src/schema.js';
import { dataDir } from '../src/config.js';
import { explainPortfolio } from '../src/portfolio.js';
import { ORDER_OPTIONS, TRANSFER_OPTIONS, RECORD_KINDS } from '../src/activity.js';
import { BOARD_FIELDS, PERIODS, REFRESH_SECONDS, WIDGETS } from '../src/boards.js';

export const VERSION = '0.2.0';
/** 기능 모듈. --modules로 고르며 system은 항상 켜집니다. */
export const MODULES = ['portfolio', 'market', 'account', 'dashboard', 'system'];
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = '빗썸 자산 대시보드 툴킷입니다. 금액·수량은 원화 기준 십진 문자열이며 누락값은 null입니다. mode=demo는 합성 데이터입니다. warnings, valuationComplete, coverage를 함께 전달하고 누락된 가격이나 과거 수익률을 만들어내지 마세요. 키는 도구 입력으로 받지 않습니다. 주문·출금 실행 도구는 없습니다. 대시보드는 dashboard_save_board로 화면 설정을 만들고 dashboard_open으로 띄웁니다.';
const HELP = `빗썸 자산 MCP ${VERSION} (stdio)

node mcp/index.js [옵션]
  --demo               합성 데이터(키 불필요)
  --env-file <파일>    키를 .env 파일에서 읽기
  --modules <목록>     portfolio,market,account,dashboard 중 쉼표 구분 또는 all (기본 all, system은 항상 포함)
  --read-only          화면 설정 저장·화면 띄우기 도구도 끔(완전 조회 전용)
  --verbose            도구 호출 기록을 stderr에 출력
  --help, --version`;
const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const LOCAL_READ = { ...READ, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const input = (properties = {}, required = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
// 수정할 때 생략한 필드는 기존 값을 유지하도록 기본값 없이 받습니다.
const BOARD_INPUT = Object.fromEntries(Object.entries(BOARD_FIELDS).map(([key, { default: _, ...schema }]) => [key, schema]));

/** 편집 가능한 대시보드 파일(텍스트)과 로컬 API 계약. */
export async function dashboardTemplate() {
  const files = {}, binaryAssets = [];
  for (const entry of await readdir(WEB, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const path = relative(WEB, `${entry.parentPath ?? entry.path}/${entry.name}`).split('\\').join('/');
    if (['.html', '.css', '.js', '.svg', '.json'].includes(extname(entry.name))) files[path] = await readFile(`${WEB}${path}`, 'utf8');
    else binaryAssets.push(path);
  }
  return {
    name: '내 자산 대시보드', schemaVersion: '1.1', files, binaryAssets,
    instructions: '로컬 API만 사용하며 API 키를 브라우저에 전달하지 않습니다. 금액은 서버가 계산한 십진 문자열을 표시용으로만 변환하세요. 고친 화면은 새 폴더에 저장한 뒤 `asset-kit dashboard --web-dir <폴더>`로 실행합니다. 보드 저장은 Content-Type: application/json과 X-Asset-Kit: 1 헤더가 있는 같은 출처 요청만 허용됩니다. 외부 공개 배포에는 사용자별 인증·데이터 격리가 있는 별도 서버가 필요합니다.',
    api: {
      status: 'GET /api/status', portfolio: 'GET /api/portfolio?symbols=BTC,ETH', explain: 'GET /api/explain?symbols=…',
      history: 'GET /api/history?days=7|30|90|365&symbols=… (&daily=1: 일별 손익)', market: 'GET /api/market?symbol=BTC&days=30',
      records: 'GET /api/records?kind=orders|pending|deposits|withdrawals|krw_deposits|krw_withdrawals&from=YYYY-MM-DD&to=YYYY-MM-DD',
      orders: 'GET /api/orders', transfers: 'GET /api/transfers',
      boards: 'GET /api/boards · POST /api/boards · PUT|DELETE /api/boards/:id {revision} · POST /api/boards/import {boards}',
    },
  };
}

/** 도구 정의와 실행. 전송 방식과 분리되어 있어 stdio 외의 연결에도 그대로 쓸 수 있습니다. */
export function createMcpServer(service, { modules = MODULES, readOnly = false, verbose = false, log = line => process.stderr.write(`${line}\n`) } = {}) {
  const tools = new Map();
  const tool = (module, name, description, inputSchema, annotations, run) => {
    if (module !== 'system' && !modules.includes(module)) return;
    if (readOnly && annotations.readOnlyHint === false) return;
    tools.set(name, { module, definition: { name, description, inputSchema, annotations }, run });
  };
  let dashboard = null;

  // ===== Portfolio: 잔고·손익, 비중·추이, 일별 손익, 종합 보고서 =====
  tool('portfolio', 'portfolio_get_summary', '원화 포함 총 평가금액, 보유분 평가손익, 비중 상위 자산과 데이터 누락 여부를 조회합니다. symbols로 일부 자산만 묶어 볼 수 있습니다.', input({ symbols: SYMBOLS_INPUT }), READ, async args => {
    const p = await service.portfolio(args);
    const { summary, largest } = explainPortfolio(p);
    return { mode: p.mode, asOf: p.asOf, scope: p.scope, ...p.summary, largest, explanation: summary, warnings: p.warnings, calculation: p.calculation };
  });
  tool('portfolio', 'portfolio_get_holdings', '자산별 가용·주문중 수량, 평균 매수가, 현재가, 평가금액과 손익을 조회합니다.', input({
    symbol: { type: 'string', pattern: '^[A-Za-z0-9_]+$', description: '선택: BTC, ETH, KRW 같은 자산 하나' }, symbols: SYMBOLS_INPUT,
  }), READ, async ({ symbol, symbols }) => {
    const p = await service.portfolio({ symbols });
    return { mode: p.mode, asOf: p.asOf, scope: p.scope, holdings: symbol ? p.holdings.filter(h => h.symbol === symbol.toUpperCase()) : p.holdings, warnings: p.warnings };
  });
  tool('portfolio', 'portfolio_get_allocation', '원화를 포함한 자산 비중을 조회합니다. 가격 미확인 자산의 비중은 null입니다.', input({ symbols: SYMBOLS_INPUT }), READ, async args => {
    const p = await service.portfolio(args);
    return { mode: p.mode, asOf: p.asOf, scope: p.scope, valuationComplete: p.summary.valuationComplete,
      allocation: p.holdings.map(({ symbol, name, valueKrw, allocationPct }) => ({ symbol, name, valueKrw, allocationPct })), warnings: p.warnings };
  });
  tool('portfolio', 'portfolio_get_history', '로컬에 기록된 평가금액 추이(최대 400개 지점)입니다. daily=true이면 한국 시간 날짜별 마지막 값과 전일 대비 변화(일별 손익 달력)를 반환합니다. 입출금이 포함되어 수익률이 아니며 과거 기록을 소급 생성하지 않습니다.', input({
    days: { type: 'integer', minimum: 1, maximum: 365, default: 30 }, symbols: SYMBOLS_INPUT, daily: { type: 'boolean', default: false },
  }), READ, args => service.getHistory(args));
  tool('portfolio', 'portfolio_get_report', '잔고·평가금액·비중 및 대기/최근 주문·원화/코인 입출금 첫 페이지를 종합 조회합니다. 섹션별 권한 부족과 조회 범위를 표시합니다. 전체 기간 실현손익 보고서가 아닙니다.', input(), READ, () => service.report());

  // ===== Market: 원화 시세(인증 불필요) =====
  tool('market', 'market_get_candles', '빗썸 원화 마켓의 현재가와 일봉 종가를 조회합니다. 공개 시세이며 키가 필요 없습니다.', input({
    symbol: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_]{0,29}$', description: 'BTC 같은 자산 심볼' }, days: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
  }, ['symbol']), READ, args => service.getMarket(args));

  // ===== Account: 주문·입출금 내역(조회만) =====
  tool('account', 'account_get_records', '한 종류의 주문·입출금 내역을 기간 전체(최대 366일, 날짜는 한국 시간)에 걸쳐 페이지를 이어 조회합니다. coverage.complete가 false이면 일부 페이지만 확보한 것입니다.', input({
    kind: { type: 'string', enum: Object.keys(RECORD_KINDS), description: Object.entries(RECORD_KINDS).map(([key, value]) => `${key}=${value.label}`).join(', ') },
    from: { ...DATE, description: 'YYYY-MM-DD, 생략 시 최근 7일' }, to: { ...DATE, description: 'YYYY-MM-DD' },
  }, ['kind']), READ, args => service.getRecords(args));
  tool('account', 'account_get_orders', '대기 또는 종료 주문 한 페이지를 조회합니다. 종료 주문은 최대 7일 구간, 다음 페이지는 동일 기간과 nextKey를 사용합니다. 주문 생성·취소 기능은 없습니다.', ORDER_OPTIONS, READ, args => service.getOrders(args));
  tool('account', 'account_get_transfers', '원화·가상자산 입금 또는 출금 내역을 페이지별로 조회합니다. 입출금을 실행하지 않습니다.', TRANSFER_OPTIONS, READ, args => service.getTransfers(args));

  // ===== Dashboard: 화면 설정·화면 띄우기 =====
  tool('dashboard', 'dashboard_list_boards', '로컬 대시보드 화면 설정(보드) 목록입니다. 각 보드는 이름, 자산 범위, 위젯 순서, 기간, 갱신 간격, revision을 가집니다.', input(), LOCAL_READ, async () => ({ boards: await service.boards.list() }));
  tool('dashboard', 'dashboard_save_board', `대시보드 화면 설정을 새로 만들거나(id 생략) 수정합니다(dashboard_list_boards의 id·revision 필요, 생략한 필드는 기존 값 유지). 위젯: ${WIDGETS.join('/')}, 배열 순서가 화면 순서. 기간 ${PERIODS.join('/')}일, 갱신 ${REFRESH_SECONDS.join('/')}초. 자금 이동은 없습니다.`, input({
    id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }, revision: { type: 'integer', minimum: 1 }, ...BOARD_INPUT,
  }), { ...LOCAL_WRITE, idempotentHint: false }, async ({ id, revision, ...changes }) => {
    if (!id) return service.boards.create(changes);
    if (!Number.isInteger(revision)) throw new KitError('INVALID_BOARD', '수정하려면 dashboard_list_boards에서 읽은 revision을 함께 보내세요.', 400);
    const current = (await service.boards.list()).find(board => board.id === id);
    if (!current) throw new KitError('BOARD_NOT_FOUND', '대시보드를 찾을 수 없습니다. 목록을 다시 조회하세요.', 404);
    return service.boards.update(id, { ...current, ...changes }, revision);
  });
  tool('dashboard', 'dashboard_open', '이 MCP 프로세스에서 로컬 대시보드(127.0.0.1)를 띄우고 주소를 돌려줍니다. 이미 떠 있으면 같은 주소를 돌려줍니다. 사용자에게 주소를 안내하세요. 외부에 공개되지 않습니다.', input({
    port: { type: 'integer', minimum: 1024, maximum: 65535, description: '선택: 기본 4319, 사용 중이면 빈 포트를 씁니다' },
  }), { ...LOCAL_WRITE, idempotentHint: true }, async ({ port = 4319 }) => {
    if (!dashboard) {
      const { startDashboard } = await import('../src/server.js');
      dashboard = startDashboard(service, { port }).catch(error => error.code === 'EADDRINUSE' ? startDashboard(service, { port: 0 }) : Promise.reject(error));
      // 화면 서버와 브라우저 연결이 프로세스를 붙잡지 않게 해, MCP 연결이 끝나면 함께 종료됩니다.
      dashboard.then(({ server }) => { server.unref(); server.on('connection', socket => socket.unref()); }, () => { dashboard = null; });
    }
    const { url } = await dashboard;
    return { url, mode: service.status().mode, boards: (await service.boards.list()).map(({ id, name, symbols }) => ({ id, name, symbols })),
      note: '이 컴퓨터에서만 열리는 주소입니다. 화면 위쪽 탭에서 보드를 고르고, 화면 편집으로 위젯·자산 범위·기간을 바꿀 수 있습니다.' };
  });
  tool('dashboard', 'dashboard_get_template', '편집 가능한 대시보드 HTML·CSS·JS와 로컬 API 계약을 반환합니다. 사용자가 화면 자체를 새로 만들 때 사용하고 `asset-kit dashboard --web-dir <폴더>`로 실행합니다.', input(), LOCAL_READ, dashboardTemplate);

  // ===== System: 설정 진단 =====
  tool('system', 'system_diagnose', '설정 진단: 버전, 데모/실제 모드, 활성 모듈, 인증 설정 여부와 출처(키 값 제외), 공개 시세·계좌 API 연결, 로컬 저장 위치를 확인합니다.', input(), READ, async () => {
    const probe = async task => { const started = Date.now(); try { await task(); return { ok: true, ms: Date.now() - started }; } catch (error) { return { ok: false, error: publicError(error) }; } };
    const status = service.status();
    const publicApi = await probe(() => service.provider.getTickers(['KRW-BTC']));
    const accountApi = status.configured ? await probe(() => service.portfolio()) : { ok: false, skipped: true, error: { code: 'NOT_CONFIGURED', message: 'asset-kit config init 또는 BITHUMB_ACCESS_KEY·BITHUMB_SECRET_KEY 환경 변수로 키를 설정하세요.' } };
    return { version: VERSION, mode: status.mode, modules: [...new Set([...tools.values()].map(entry => entry.module))], readOnly, tools: tools.size,
      auth: { configured: status.configured, source: status.credentialSource }, publicApi, accountApi,
      dataDir: dataDir(), lastSuccessfulFetch: service.status().lastSuccessfulFetch, historyError: service.status().historyError };
  });

  const rpcError = (code, message) => Object.assign(new Error(message), { rpc: code });
  async function callTool(name, args) {
    const entry = tools.get(name);
    if (!entry) throw rpcError(-32602, `알 수 없거나 꺼진 도구입니다: ${name}`);
    const started = Date.now();
    let result;
    try {
      const data = await entry.run(check(entry.definition.inputSchema, args ?? {}, { code: 'INVALID_ARGUMENTS', message: '도구 입력값을 확인하세요. 허용 값은 tools/list의 inputSchema를 따릅니다.' }));
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) { result = { content: [{ type: 'text', text: JSON.stringify(publicError(error)) }], isError: true }; }
    if (verbose) log(`[asset-kit-mcp] ${new Date().toISOString()} ${name} ${result.isError ? `error ${JSON.parse(result.content[0].text).code}` : 'ok'} ${Date.now() - started}ms ${JSON.stringify(args ?? {})}`);
    return result;
  }
  async function handle(method, params = {}) {
    switch (method) {
      case 'initialize': return {
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'bithumb-asset-kit', title: '빗썸 자산 대시보드 킷', version: VERSION }, instructions: INSTRUCTIONS,
      };
      case 'ping': return {};
      case 'tools/list': return { tools: [...tools.values()].map(entry => entry.definition) };
      case 'tools/call': return callTool(params.name, params.arguments);
      default: throw rpcError(-32601, `지원하지 않는 메서드입니다: ${method}`);
    }
  }
  async function close() {
    const opened = await dashboard?.catch(() => null);
    opened?.server.closeAllConnections();
    opened?.server.close();
  }
  return { tools, handle, close };
}

/** --modules 값을 검사합니다. 'all' 또는 쉼표로 구분한 모듈 이름. */
export function parseModules(value = 'all') {
  if (value === 'all') return MODULES;
  const list = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.some(item => !MODULES.includes(item))) throw new KitError('USAGE', `--modules는 all 또는 ${MODULES.join(',')} 중 쉼표 구분입니다.`, 400);
  return list;
}

/** 줄 단위 JSON-RPC 2.0 over stdio. stdout에는 프로토콜 메시지만 씁니다. */
export function startMcp(service, { input: stream = process.stdin, output = process.stdout, ...options } = {}) {
  const server = createMcpServer(service, options);
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  output.on?.('error', () => {}); // 클라이언트가 먼저 끊어도 종료 처리만 합니다.
  const reply = async message => {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    if (typeof message.method !== 'string' || !('id' in message)) return null; // 알림과 응답에는 답하지 않습니다.
    try { return { jsonrpc: '2.0', id: message.id, result: await server.handle(message.method, message.params ?? {}) }; }
    catch (error) { return { jsonrpc: '2.0', id: message.id, error: { code: error.rpc ?? -32603, message: error.rpc ? error.message : '처리하지 못했습니다.' } }; }
  };
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', async line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (Array.isArray(message)) {
      const replies = (await Promise.all(message.map(reply))).filter(Boolean);
      if (replies.length) send(replies);
    } else {
      const response = await reply(message);
      if (response) send(response);
    }
  });
  lines.on('close', () => { void server.close(); });
  return server;
}

export const MCP_OPTIONS = {
  demo: { type: 'boolean', default: false }, 'env-file': { type: 'string' }, modules: { type: 'string', default: 'all' },
  'read-only': { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false },
};

// 직접 실행할 때만 서버를 시작합니다(asset-kit mcp에서 import할 때는 실행하지 않음). 전역 설치 링크도 실제 경로로 비교합니다.
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })();
if (invoked === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { ...MCP_OPTIONS, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } });
    if (values.help) console.log(HELP);
    else if (values.version) console.log(VERSION);
    else {
      if (values['env-file']) process.loadEnvFile(values['env-file']);
      const modules = parseModules(values.modules);
      const { PortfolioService } = await import('../src/service.js');
      startMcp(new PortfolioService({ demo: values.demo }), { modules, readOnly: values['read-only'], verbose: values.verbose });
    }
  } catch (error) { console.error(JSON.stringify(publicError(error))); process.exitCode = 1; }
}
