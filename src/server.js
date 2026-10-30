import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicError, KitError } from './errors.js';
import { parseSymbols } from './service.js';
import { CANDLE_PATHS } from './bithumb.js';

const DEFAULT_WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const READ_PATHS = new Set(['/api/status', '/api/portfolio', '/api/history', '/api/market', '/api/markets', '/api/tickers', '/api/warnings', '/api/returns', '/api/explain', '/api/records', '/api/boards', '/api/orders', '/api/transfers']);
const pick = (value, allowed) => allowed.includes(value) ? value : allowed[0];
const BOARD_PATH = /^\/api\/boards\/([0-9a-f-]{36})$/;
const MAX_BODY = 64 * 1024;
// Live stream extras beyond the held coins: the chart coin, up to 30 watched coins and the coins of price alerts.
const MAX_WATCH = 60;

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
      case '/api/market': {
        // interval이 있으면 차트용 캔들(분~월), 없으면 기존처럼 days일 일봉입니다.
        const interval = query.get('interval');
        if (interval === null) return service.getMarket({ symbol: query.get('symbol') ?? '', days: number('days', 30), force });
        if (!Object.hasOwn(CANDLE_PATHS, interval)) throw new KitError('INVALID_MARKET', `간격은 ${Object.keys(CANDLE_PATHS).join(', ')} 중 하나입니다.`, 400);
        return service.getMarket({ symbol: query.get('symbol') ?? '', interval, count: number('count', 120), force });
      }
      case '/api/markets': return { markets: await service.marketList() };
      case '/api/returns': return service.returns({ months: number('months', 12), force });
      // 시장 개요·경보는 공개 시세입니다. 허용하지 않는 값은 기본값으로 바꿉니다.
      case '/api/tickers': return service.marketOverview({ scope: pick(query.get('scope'), ['all', 'holdings']), symbols: query.get('symbols') ?? '', sort: pick(query.get('sort'), ['value24h', 'change', 'price', 'name']),
        direction: pick(query.get('direction'), ['desc', 'asc']), limit: Math.min(Math.max(Math.trunc(number('limit', 10)) || 10, 1), 50), force });
      case '/api/warnings': return service.getWarnings({ scope: pick(query.get('scope'), ['all', 'holdings']), force });
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
  /**
   * Server-Sent Events: live prices for the held markets (and `watch` symbols) plus the portfolio revalued with them.
   * Events: status {live, mode}, tick {tickers}, portfolio {...same contract as /api/portfolio}. Same origin only.
   */
  const openStream = async (req, res, url) => {
    // Listen for the hang-up before the account read: a tab that closes or switches boards meanwhile must not leave a subscription behind.
    let closed = false;
    const cleanup = [], stop = () => { closed = true; for (const fn of cleanup.splice(0)) fn(); };
    req.on('close', stop);
    res.on('close', stop);
    const symbols = parseSymbols(url.searchParams.get('symbols') ?? ''), watch = parseSymbols(url.searchParams.get('watch') ?? '').filter(symbol => symbol !== 'KRW').slice(0, MAX_WATCH);
    const held = await service.liveMarkets({ symbols });
    // Only listed KRW markets: a delisted symbol kept in a browser must not break the subscription shared by every tab.
    const listed = watch.length ? await service.marketList().then(list => new Set(list.map(m => m.symbol)), () => null) : null;
    if (closed) return;
    const markets = [...new Set([...held, ...watch.filter(symbol => !listed || listed.has(symbol)).map(symbol => `KRW-${symbol}`)])];
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = text => { if (!res.writableEnded && !res.destroyed) res.write(text); };
    const send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let lastStatus = null, refreshing = false;
    const status = live => { if (live !== lastStatus) { lastStatus = live; send('status', { live, mode: service.provider.mode }); } };
    const quote = market => service.live.quotes.get(market);
    const unsubscribe = service.live.subscribe(markets, changed => {
      const tickers = [...changed].filter(market => market.startsWith('KRW-')).map(market => quote(market)).filter(Boolean).map(t => ({
        symbol: t.market.slice(4), priceKrw: String(t.trade_price), changePct: t.signed_change_rate === undefined ? null : String(Math.round(Number(t.signed_change_rate) * 1e6) / 1e4),
        highKrw: t.high_price === undefined ? null : String(t.high_price), lowKrw: t.low_price === undefined ? null : String(t.low_price),
        value24hKrw: t.acc_trade_price_24h === undefined ? null : String(t.acc_trade_price_24h), at: new Date(t.timestamp).toISOString() }));
      if (tickers.length) send('tick', { tickers });
      if ([...changed].some(market => held.includes(market))) { const portfolio = service.livePortfolio({ symbols }); if (portfolio) send('portfolio', portfolio); }
    }, status);
    status(service.live.status);
    // Balances change only through trades and transfers: re-read the account every 30 seconds while the stream is open.
    const timers = [setInterval(() => write(': keep-alive\n\n'), 20000), setInterval(async () => {
      if (refreshing) return;
      refreshing = true;
      try { await service.portfolio({ symbols }); } catch { /* the next round retries */ } finally { refreshing = false; }
    }, 30000)];
    for (const timer of timers) timer.unref?.();
    cleanup.push(unsubscribe, () => { for (const timer of timers) clearInterval(timer); });
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
        if (reading && url.pathname === '/api/stream') return await openStream(req, res, url);
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
