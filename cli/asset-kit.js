#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { publicError, KitError } from '../src/errors.js';
import { VERSION } from '../mcp/index.js';

const HELP = `내 자산 킷 ${VERSION} · 빗썸 자산 대시보드 (조회 전용)

화면·연결
  asset-kit dashboard [--port 4319] [--web-dir 폴더]   로컬 대시보드 실행
  asset-kit mcp [--modules all] [--read-only] [--verbose]   MCP stdio 서버 (mcp/README.md)
  asset-kit config init | status                       키를 이 컴퓨터에 저장 / 설정 확인
  asset-kit doctor                                     공개 시세·계좌 조회·저장 위치 진단

자산
  asset-kit portfolio [--symbols BTC,ETH]              잔고·평가·손익·비중
  asset-kit explain [--symbols BTC,ETH]                숫자 기반 요약
  asset-kit history [--days 30] [--symbols …] [--daily]  기록된 추이 / 일별 손익
  asset-kit market --symbol BTC [--interval day|week|month|1m|5m|1h|4h…] [--count 30] [--to 2026-10-01]   현재가와 캔들
  asset-kit tickers [--scope holdings|all] [--sort value24h|change|price|name] [--limit 20]   여러 자산 시세·24시간 거래대금
  asset-kit warnings [--scope holdings|all]            빗썸 경보제·거래 유의 종목
  asset-kit report                                     잔고 + 주문·입출금 첫 페이지 종합

내역
  asset-kit records --kind orders|pending|deposits|withdrawals|krw_deposits|krw_withdrawals [--from 2026-09-01] [--to 2026-09-30]
  asset-kit orders [--kind pending|history] [--market KRW-BTC] [--state wait|watch|done|cancel] [--limit 30] [--next-key 커서] [--from ms] [--to ms]
  asset-kit transfers [--direction deposit|withdraw] [--asset-type krw|crypto] [--currency BTC] [--page 1] [--limit 30]

대시보드 화면 설정(보드)
  asset-kit boards list
  asset-kit boards create --name "장기 보유" [--symbols BTC,ETH] [--widgets summary,trend,holdings] [--days 30] [--refresh 60]
  asset-kit boards export --file boards.json | import --file boards.json

기타
  asset-kit skill install --path 프로젝트 [--target claude|agents] [--force]
  asset-kit status

공통 옵션: --demo(합성 데이터), --env-file .env. 데이터 명령은 JSON을 출력하고 오류는 stderr JSON + 종료 코드 1입니다.
키 우선순위: 환경 변수 → asset-kit config init 저장 파일. 키를 채팅이나 명령 인수로 전달하지 마세요.`;

const output = value => console.log(JSON.stringify(value, null, 2));
const list = value => value ? value.split(',').map(item => item.trim()).filter(Boolean) : undefined;

// Reads a secret from the terminal without echoing it.
function secret(label) {
  if (!process.stdin.isTTY) throw new KitError('TTY_REQUIRED', '키 설정은 터미널에서 직접 실행하세요. 자동화 환경에서는 환경 변수를 사용하세요.', 400);
  process.stdout.write(label);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolveInput, reject) => {
    let value = '';
    const done = error => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolveInput(value); };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return done(new KitError('CANCELLED', '취소했습니다.', 400));
        if (char === '\r' || char === '\n') return done();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 1024) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const { values: o, positionals } = parseArgs({ allowPositionals: true, options: {
    demo: { type: 'boolean', default: false }, 'env-file': { type: 'string' }, port: { type: 'string', default: '4319' }, 'web-dir': { type: 'string' },
    days: { type: 'string' }, symbols: { type: 'string' }, symbol: { type: 'string' }, daily: { type: 'boolean', default: false },
    kind: { type: 'string' }, market: { type: 'string' }, state: { type: 'string' }, limit: { type: 'string' }, 'next-key': { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, direction: { type: 'string' }, 'asset-type': { type: 'string' }, currency: { type: 'string' }, page: { type: 'string' },
    name: { type: 'string' }, widgets: { type: 'string' }, refresh: { type: 'string' }, file: { type: 'string' },
    path: { type: 'string' }, target: { type: 'string', default: 'claude' }, force: { type: 'boolean', default: false },
    modules: { type: 'string', default: 'all' }, 'read-only': { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false },
    interval: { type: 'string' }, count: { type: 'string' }, scope: { type: 'string' }, sort: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  const [command = 'help', sub] = positionals;
  if (o.version) return console.log(VERSION);
  if (o.help || command === 'help') return console.log(HELP);
  if (o['env-file']) process.loadEnvFile(o['env-file']);

  if (command === 'config') {
    const { saveCredentials, resolveCredentials, credentialsFile, dataDir } = await import('../src/config.js');
    if (sub === 'status') {
      const credentials = resolveCredentials();
      return output({ configured: Boolean(credentials.accessKey && credentials.secretKey), source: credentials.source, dataDir: dataDir(), credentialsFile: credentialsFile() });
    }
    if (sub !== 'init') throw new KitError('USAGE', 'asset-kit config init 또는 asset-kit config status를 사용하세요.', 400);
    const access = await secret('Access Key (입력 내용은 표시되지 않습니다): ');
    const secretKey = await secret('Secret Key (입력 내용은 표시되지 않습니다): ');
    const file = await saveCredentials(access, secretKey);
    return console.log(`키를 이 컴퓨터에만 저장했습니다: ${file} (권한 0600)\n연결 확인: asset-kit doctor`);
  }
  if (command === 'skill') {
    if (sub !== 'install' || !o.path) throw new KitError('USAGE', 'asset-kit skill install --path <프로젝트 폴더> [--target claude|agents]', 400);
    if (!['claude', 'agents'].includes(o.target)) throw new KitError('USAGE', '--target은 claude 또는 agents입니다.', 400);
    const target = join(resolve(o.path), o.target === 'claude' ? '.claude' : '.agents', 'skills', 'bithumb-asset-dashboard');
    const exists = await stat(join(target, 'SKILL.md')).then(() => true, () => false);
    if (exists && !o.force) throw new KitError('EXISTS', `이미 설치되어 있습니다: ${target} (덮어쓰려면 --force)`, 409);
    await mkdir(target, { recursive: true });
    await cp(fileURLToPath(new URL('../skills/bithumb-asset-dashboard/', import.meta.url)), target, { recursive: true });
    return console.log(`스킬을 설치했습니다: ${target}`);
  }

  const { PortfolioService } = await import('../src/service.js');
  const service = new PortfolioService({ demo: o.demo });
  const number = (value, fallback) => value === undefined ? fallback : Number(value);
  const choice = (value, allowed, fallback) => {
    if (value === undefined) return fallback;
    if (!allowed.includes(value)) throw new KitError('USAGE', `${allowed.join('|')} 중 하나를 지정하세요.`, 400);
    return value;
  };
  switch (command) {
    case 'dashboard': {
      const port = Number(o.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new KitError('INVALID_PORT', '포트는 1024~65535 사이 정수입니다.', 400);
      const { startDashboard, startFailure } = await import('../src/server.js');
      const { server, url } = await startDashboard(service, { port, ...(o['web-dir'] ? { webDir: resolve(o['web-dir']) } : {}) }).catch(error => Promise.reject(startFailure(error, port)));
      console.log(`내 자산 대시보드: ${url}\n모드: ${o.demo ? '데모 · 합성 데이터' : '빗썸 계좌 조회'}${o['web-dir'] ? `\n화면 폴더: ${resolve(o['web-dir'])}` : ''}\n종료: Ctrl+C`);
      // An open dashboard tab keeps a live stream that never ends by itself, so close connections instead of waiting for them.
      const stop = () => { server.close(() => process.exit(0)); server.closeAllConnections(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      return;
    }
    case 'mcp': {
      const { startMcp, parseModules } = await import('../mcp/index.js');
      startMcp(service, { modules: parseModules(o.modules), readOnly: o['read-only'], verbose: o.verbose });
      return;
    }
    case 'portfolio': return output(await service.portfolio({ symbols: list(o.symbols) }));
    case 'explain': return output(await service.explain({ symbols: list(o.symbols) }));
    case 'report': return output(await service.report());
    case 'history': return output(await service.getHistory({ days: number(o.days, 30), symbols: list(o.symbols), daily: o.daily }));
    case 'market': return output(await service.getMarket({ symbol: o.symbol ?? 'BTC', days: number(o.days, 30), interval: o.interval ?? 'day', count: number(o.count), to: o.to }));
    case 'tickers': return output(await service.marketOverview({ scope: choice(o.scope, ['holdings', 'all'], 'holdings'), sort: choice(o.sort, ['value24h', 'change', 'price', 'name'], 'value24h'), limit: number(o.limit, 20), symbols: list(o.symbols) }));
    case 'warnings': return output(await service.getWarnings({ scope: choice(o.scope, ['holdings', 'all'], 'holdings') }));
    case 'records': return output(await service.getRecords({ kind: o.kind ?? 'orders', from: o.from, to: o.to }));
    case 'status': return output(service.status());
    case 'orders': case 'transfers': {
      const mappings = command === 'orders'
        ? { kind: 'kind', market: 'market', state: 'state', limit: 'limit', 'next-key': 'nextKey', from: 'fromMs', to: 'toMs' }
        : { direction: 'direction', 'asset-type': 'assetType', currency: 'currency', page: 'page', limit: 'limit' };
      const options = {};
      for (const [flag, key] of Object.entries(mappings)) if (o[flag] !== undefined) options[key] = ['limit', 'page', 'fromMs', 'toMs'].includes(key) ? Number(o[flag]) : o[flag];
      return output(command === 'orders' ? await service.getOrders(options) : await service.getTransfers(options));
    }
    case 'boards': {
      if (sub === 'list') return output(await service.boards.list());
      if (sub === 'create') {
        return output(await service.boards.create({ name: o.name, symbols: list(o.symbols), widgets: list(o.widgets), days: number(o.days, undefined), refreshSeconds: number(o.refresh, undefined) }));
      }
      if (!o.file) throw new KitError('USAGE', '--file 경로가 필요합니다.', 400);
      if (sub === 'export') {
        const boards = (await service.boards.list()).map(({ name, symbols, widgets, days, refreshSeconds }) => ({ name, symbols, widgets, days, refreshSeconds }));
        await writeFile(o.file, `${JSON.stringify(boards, null, 2)}\n`, { flag: 'wx', mode: 0o600 }).catch(error => {
          throw error.code === 'EEXIST' ? new KitError('EXISTS', '같은 이름의 파일이 있습니다. 다른 경로를 지정하세요.', 409) : error;
        });
        return console.log(`대시보드 설정 ${boards.length}개를 내보냈습니다: ${o.file}`);
      }
      if (sub === 'import') {
        let data;
        try { data = JSON.parse(await readFile(o.file, 'utf8')); } catch { throw new KitError('INVALID_BOARD', '설정 파일(JSON)을 읽지 못했습니다.', 400); }
        return output(await service.boards.importMany(Array.isArray(data) ? data : data.boards));
      }
      throw new KitError('USAGE', 'boards list|create|export|import', 400);
    }
    case 'doctor': {
      const status = service.status(), checks = { mode: status.mode, credentials: { configured: status.configured, source: status.credentialSource } };
      const check = async task => { try { await task(); return { ok: true }; } catch (error) { return { ok: false, error: publicError(error) }; } };
      checks.publicApi = await check(() => service.provider.getTickers(['KRW-BTC']));
      checks.accountApi = status.configured ? await check(() => service.portfolio()) : { ok: false, error: { code: 'NOT_CONFIGURED', message: 'asset-kit config init 또는 .env로 키를 설정하세요.' } };
      checks.history = service.status().historyError ? { ok: false, error: service.status().historyError } : { ok: true };
      output(checks);
      if (!checks.publicApi.ok || !checks.accountApi.ok || !checks.history.ok) process.exitCode = 1;
      return;
    }
    default: throw new KitError('USAGE', '지원하지 않는 명령입니다. asset-kit --help를 확인하세요.', 400);
  }
}

main().catch(error => {
  if (error.code === 'PORT_IN_USE') console.error(JSON.stringify({ code: error.code, message: `${error.message} --port 옵션으로 다른 포트를 선택하세요.` }));
  else if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') console.error(JSON.stringify({ code: 'USAGE', message: `${error.message} — asset-kit --help` }));
  else console.error(JSON.stringify(publicError(error)));
  process.exitCode = 1;
});
