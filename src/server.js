import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicError, KitError } from './errors.js';

const DEFAULT_WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const READ_PATHS = new Set(['/api/status', '/api/portfolio', '/api/history', '/api/market', '/api/explain', '/api/records', '/api/boards', '/api/orders', '/api/transfers']);
const BOARD_PATH = /^\/api\/boards\/([0-9a-f-]{36})$/;
const MAX_BODY = 64 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new KitError('BODY_TOO_LARGE', '요청 크기는 64KB 이하여야 합니다.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  }
  catch { throw new KitError('INVALID_JSON', 'JSON 요청 형식이 올바르지 않습니다.', 400); }
}

/**
 * Turns a failed listen into a specific error. Only the OS error code is shown, never paths or internals;
 * an error without one is a bug and stays a generic INTERNAL_ERROR.
 */
export function startFailure(error, port) {
  const code = typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? error.code : null;
  if (!code) return error;
  if (code === 'EADDRINUSE') return new KitError('PORT_IN_USE', `${port}번 포트를 이미 다른 프로그램이 쓰고 있습니다.`, 503);
  const reason = {
    EACCES: `이 환경에서 로컬 포트를 열 권한이 없습니다(${code}). 샌드박스나 보안 프로그램이 로컬 서버를 막았을 수 있습니다.`,
    EPERM: `이 환경에서 로컬 포트를 열 권한이 없습니다(${code}). 샌드박스나 보안 프로그램이 로컬 서버를 막았을 수 있습니다.`,
    EADDRNOTAVAIL: `이 컴퓨터에서 127.0.0.1 주소를 쓸 수 없습니다(${code}). 네트워크 설정을 확인하세요.`,
  }[code] ?? `운영체제가 로컬 서버 시작을 거부했습니다(${code}).`;
  return new KitError('DASHBOARD_START_FAILED', reason, 503);
}

/**
 * Loopback dashboard. Account data is GET-only. The only writes are local board settings, and they need a
 * same-origin JSON request with X-Asset-Kit: a header cross-site pages cannot send without a preflight this server never grants.
 */
export async function startDashboard(service, { port = 4319, collect = true, webDir = DEFAULT_WEB } = {}) {
  const root = resolve(webDir);
  let timer;
  const read = async url => {
    const query = url.searchParams, symbols = query.get('symbols') ?? '', force = query.get('force') === '1';
    const number = (name, fallback) => query.has(name) ? Number(query.get(name)) : fallback;
    switch (url.pathname) {
      case '/api/status': return service.status();
      case '/api/portfolio': return service.portfolio({ symbols, force });
      case '/api/history': return service.getHistory({ days: number('days', 30), symbols, daily: query.get('daily') === '1' });
      case '/api/market': return service.getMarket({ symbol: query.get('symbol') ?? '', days: number('days', 30), force });
      case '/api/explain': return service.explain({ symbols });
      case '/api/records': return service.getRecords({ kind: query.get('kind') ?? 'orders', from: query.get('from') || undefined, to: query.get('to') || undefined, force });
      case '/api/boards': return { boards: await service.boards.list() };
      default: {
        const options = Object.fromEntries(query);
        for (const key of ['limit', 'page', 'fromMs', 'toMs']) if (key in options) options[key] = Number(options[key]);
        return url.pathname === '/api/orders' ? service.getOrders(options) : service.getTransfers(options);
      }
    }
  };
  const write = async (req, url) => {
    const board = BOARD_PATH.exec(url.pathname);
    const allowed = url.pathname === '/api/boards' || url.pathname === '/api/boards/import' ? req.method === 'POST' : board ? ['PUT', 'DELETE'].includes(req.method) : false;
    if (!allowed) {
      if (READ_PATHS.has(url.pathname) || board || url.pathname === '/api/boards/import') throw new KitError('READ_ONLY', '허용되지 않는 요청 방식입니다. 계좌 데이터는 조회만 지원합니다.', 405);
      throw new KitError('NOT_FOUND', '지원하지 않는 API입니다.', 404);
    }
    if (req.headers['x-asset-kit'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) {
      throw new KitError('FORBIDDEN', '대시보드 화면에서 보낸 요청만 저장할 수 있습니다.', 403);
    }
    const body = await readJson(req);
    if (url.pathname === '/api/boards') return [201, await service.boards.create(body)];
    if (url.pathname === '/api/boards/import') return [201, { boards: await service.boards.importMany(body.boards) }];
    if (!Number.isInteger(body.revision)) throw new KitError('INVALID_BOARD', '대시보드의 revision이 필요합니다.', 400);
    return [200, req.method === 'PUT' ? await service.boards.update(board[1], body, body.revision) : await service.boards.remove(board[1], body.revision)];
  };
  const server = createServer(async (req, res) => {
    const actualPort = server.address().port;
    const hosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
    const origins = new Set([...hosts].map(host => `http://${host}`));
    const json = (code, value) => { if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const reading = req.method === 'GET' || req.method === 'HEAD';
    // Writes must also carry a matching Origin; browsers always send one on POST/PUT/DELETE.
    if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) || (!reading && !origins.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
      return json(403, { error: { code: 'LOCAL_ONLY', message: '로컬 대시보드에서만 사용할 수 있습니다.' } });
    }
    try {
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (url.pathname === '/health') return json(200, { status: 'ok', name: 'bithumb-asset-kit', mode: service.status().mode });
      if (url.pathname.startsWith('/api/')) {
        if (reading && READ_PATHS.has(url.pathname)) return json(200, await read(url));
        if (reading) throw new KitError('NOT_FOUND', '지원하지 않는 API입니다.', 404);
        const [code, body] = await write(req, url);
        return json(code, body);
      }
      if (!reading) throw new KitError('READ_ONLY', '조회만 지원합니다.', 405);
      let relative;
      try { relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); } catch { relative = ''; }
      const file = resolve(join(root, relative)), type = TYPES[extname(file).toLowerCase()];
      if (!type || !file.startsWith(root + sep) || relative.split('/').some(part => part.startsWith('.'))) throw new KitError('NOT_FOUND', '페이지를 찾을 수 없습니다.', 404);
      let body;
      try { body = await readFile(file); } catch { throw new KitError('NOT_FOUND', '페이지를 찾을 수 없습니다.', 404); }
      res.writeHead(200, { 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) { json(error instanceof KitError ? error.status : 500, { error: publicError(error) }); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  // Keeps local history growing while the dashboard runs; the service stores at most one point per five minutes.
  const sample = () => { const status = service.status(); if (status.configured && status.mode !== 'demo') service.portfolio().catch(() => {}); };
  if (collect) { sample(); timer = setInterval(sample, 60000); timer.unref(); }
  server.on('close', () => clearInterval(timer));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
