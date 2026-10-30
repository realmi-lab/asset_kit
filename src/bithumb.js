import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { KitError } from './errors.js';
import { resolveCredentials } from './config.js';
import { check, DECIMAL, MARKET, SYMBOL } from './schema.js';
import { ORDER_PAGE, TRANSFER_PAGE, ordersQuery, transfersQuery } from './activity.js';
import { abortable } from './async.js';

const PRICE = { anyOf: [{ type: 'number', minimum: 0 }, DECIMAL] };
const TIMESTAMP = { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^\\d+$' }] };
export const ACCOUNTS = { type: 'array', items: { type: 'object', required: ['currency', 'balance', 'locked', 'avg_buy_price', 'avg_buy_price_modified', 'unit_currency'], properties: {
  currency: SYMBOL, balance: DECIMAL, locked: DECIMAL, avg_buy_price: DECIMAL, avg_buy_price_modified: { type: 'boolean' }, unit_currency: SYMBOL,
} } };
export const TICKERS = { type: 'array', items: { type: 'object', required: ['market', 'trade_price', 'timestamp'], properties: {
  market: MARKET, trade_price: PRICE, signed_change_rate: { type: 'number' }, timestamp: TIMESTAMP,
  high_price: PRICE, low_price: PRICE, acc_trade_price_24h: PRICE,
} } };
const MARKETS = { type: 'array', items: { type: 'object', required: ['market', 'korean_name', 'english_name'], properties: {
  market: { type: 'string' }, korean_name: { type: 'string' }, english_name: { type: 'string' }, market_warning: { type: 'string', nullable: true },
} } };
const CANDLES = { type: 'array', items: { type: 'object', required: ['market', 'candle_date_time_utc', 'trade_price'], properties: {
  market: MARKET, candle_date_time_utc: { type: 'string' }, candle_date_time_kst: { type: 'string' }, trade_price: PRICE,
  opening_price: PRICE, high_price: PRICE, low_price: PRICE, candle_acc_trade_volume: PRICE,
} } };
const WARNINGS = { type: 'array', items: { type: 'object', required: ['market', 'warning_type', 'warning_step'], properties: {
  market: MARKET, warning_type: { type: 'string' }, warning_step: { type: 'string' }, end_date: { type: 'string', nullable: true },
} } };
const API_KEYS = { type: 'array', items: { type: 'object', required: ['access_key', 'expire_at'], properties: { access_key: { type: 'string' }, expire_at: { type: 'string' } } } };
/** 캔들 간격 → 빗썸 경로. 분 캔들은 1·3·5·10·15·30·60·240분만 있습니다. */
export const CANDLE_PATHS = { '1m': '/v1/candles/minutes/1', '3m': '/v1/candles/minutes/3', '5m': '/v1/candles/minutes/5', '10m': '/v1/candles/minutes/10',
  '15m': '/v1/candles/minutes/15', '30m': '/v1/candles/minutes/30', '1h': '/v1/candles/minutes/60', '4h': '/v1/candles/minutes/240',
  day: '/v1/candles/days', week: '/v1/candles/weeks', month: '/v1/candles/months' };
/** 빗썸 응답 형식이 바뀌면 추정하지 않고 계산을 멈춥니다. */
export const validResponse = (schema, body) => check(schema, body, { code: 'INVALID_RESPONSE', message: '빗썸 응답 형식이 예상과 달라 계산을 중단했습니다.', status: 502 });

const PUBLIC = new Set(['/v1/market/all', '/v1/ticker', '/v1/market/virtual_asset_warning', ...Object.values(CANDLE_PATHS)]);
const PATHS = new Set([...PUBLIC, '/v1/accounts', '/v1/api_keys', '/v2/orders/pending', '/v2/orders/history', '/v1/deposits', '/v1/deposits/krw', '/v1/withdraws', '/v1/withdraws/krw']);
const retryable = status => status === 429 || status >= 500;
// 빗썸 오류 본문 { error: { name, message } }의 알려진 name만 씁니다. message는 요청 값을 되돌려줄 수 있어 버립니다.
const UPSTREAM = {
  invalid_query_payload: ['AUTH_FAILED', '빗썸이 요청 서명(query_hash)을 거부했습니다. 키 문제가 아니라 이 도구의 요청 형식 문제일 수 있으니 asset-kit doctor(MCP는 system_diagnose) 결과와 함께 GitHub 이슈로 알려 주세요.'],
  jwt_verification: ['AUTH_FAILED', 'Access Key 또는 Secret Key가 올바르지 않습니다. 환경 변수로 키를 지정했다면 그 값을, 아니면 asset-kit config init으로 키를 다시 설정하세요.'],
  expired_jwt: ['AUTH_FAILED', '인증 토큰이 만료된 것으로 처리되었습니다. 이 컴퓨터의 시계가 맞지 않을 수 있으니 시간 자동 설정을 켠 뒤 다시 시도하세요.'],
  NotAllowIP: ['AUTH_FAILED', '이 컴퓨터의 IP가 API 키의 허용 IP에 없습니다. 빗썸 API 관리에서 허용 IP를 추가하세요.'],
  out_of_scope: ['AUTH_FAILED', '이 API 키에 해당 조회 권한이 없습니다. 빗썸 API 관리에서 자산·주문·입출금 조회 권한을 켜세요.'],
  blocked_member_id: ['AUTH_FAILED', '빗썸 운영 정책에 따라 API 이용이 제한된 계정입니다. 빗썸 고객센터에 문의하세요.'],
  invalid_parameter: ['API_ERROR', '빗썸이 조회 조건을 거부했습니다(invalid_parameter). 기간·자산·페이지 값을 확인하세요.'],
};
async function upstreamName(response) {
  try { const name = (await response.json())?.error?.name; return Object.hasOwn(UPSTREAM, name) ? name : null; }
  catch { try { await response.body?.cancel(); } catch { /* 원래 HTTP 오류를 그대로 씁니다. */ } return null; }
}

// Sign a new JWT for every request; requests with a query string also carry query_hash.
export function accountJwt(accessKey, secretKey, now = Date.now(), query = '') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { access_key: accessKey, nonce: randomUUID(), timestamp: now };
  if (query) { payload.query_hash = createHash('sha512').update(query).digest('hex'); payload.query_hash_alg = 'SHA512'; }
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${message}.${createHmac('sha256', secretKey).update(message).digest('base64url')}`;
}

export class BithumbProvider {
  #accessKey; #secretKey; #fetch; #marketCache; #marketPending; #gate = Promise.resolve();
  constructor({ accessKey, secretKey, fetchImpl = fetch, env = process.env, retries = 2, retryDelayMs = 250, minIntervalMs = 40 } = {}) {
    const credentials = resolveCredentials({ accessKey, secretKey, env });
    this.#accessKey = credentials.accessKey;
    this.#secretKey = credentials.secretKey;
    this.#fetch = fetchImpl;
    this.mode = 'live';
    this.credentialSource = credentials.source;
    // Separates local history and boards per account without storing the key itself.
    this.accountId = createHash('sha256').update(this.#accessKey).digest('hex').slice(0, 24);
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.minIntervalMs = minIntervalMs;
  }
  get configured() { return Boolean(this.#accessKey && this.#secretKey); }

  // Request starts are spaced by minIntervalMs so batches stay under Bithumb's per-second limits.
  async #turn() {
    const previous = this.#gate;
    this.#gate = previous.then(() => pause(this.minIntervalMs));
    await previous;
  }

  async #request(path, schema, { signal } = {}) {
    signal?.throwIfAborted();
    const [pathname, query = ''] = path.split('?');
    if (!PATHS.has(pathname)) throw new KitError('UNSUPPORTED_ENDPOINT', '지원하지 않는 조회 경로입니다.', 400);
    const authenticated = !PUBLIC.has(pathname);
    if (authenticated && !this.configured) {
      throw new KitError('NOT_CONFIGURED', '빗썸 API 키가 설정되지 않았습니다. asset-kit config init으로 키를 저장하거나 환경 변수 BITHUMB_ACCESS_KEY·BITHUMB_SECRET_KEY(또는 --env-file .env)로 지정하세요.', 503);
    }
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.retries;
      await abortable(this.#turn(), signal);
      signal?.throwIfAborted();
      // Each attempt gets a fresh nonce and timestamp.
      const headers = { Accept: 'application/json' };
      if (authenticated) headers.Authorization = `Bearer ${accountJwt(this.#accessKey, this.#secretKey, Date.now(), query)}`;
      let response;
      try {
        response = await this.#fetch(`https://api.bithumb.com${path}`, {
          method: 'GET', headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
        });
      } catch {
        signal?.throwIfAborted();
        if (!last) { await pause(this.retryDelayMs * 2 ** attempt, undefined, { signal }); continue; }
        throw new KitError('API_UNREACHABLE', '빗썸 API에 연결하지 못했습니다. 네트워크 상태를 확인하세요.');
      }
      if (!response.ok) {
        if (retryable(response.status)) {
          // Release failed response streams even on the final attempt so repeated refreshes do not retain sockets.
          try { await response.body?.cancel(); } catch { /* The original HTTP error remains authoritative. */ }
          if (!last) { await pause(this.retryDelayMs * 2 ** attempt, undefined, { signal }); continue; }
        } else {
          // A named cause (bad signature, clock skew, IP, scope) is more useful than a generic auth hint.
          const name = await upstreamName(response);
          if (name) throw Object.assign(new KitError(UPSTREAM[name][0], UPSTREAM[name][1], UPSTREAM[name][0] === 'AUTH_FAILED' ? 401 : 400), { upstream: name });
        }
        if (response.status === 401 || response.status === 403) {
          throw new KitError('AUTH_FAILED', '빗썸이 인증을 거부했습니다. API 키의 조회 권한, 만료일, 허용 IP를 확인하세요.', 401);
        }
        if (response.status === 429) throw new KitError('RATE_LIMITED', '빗썸 요청 한도를 넘어 조회가 일시적으로 제한되었습니다. 잠시 후 다시 시도하세요.', 429);
        throw new KitError('API_ERROR', `빗썸 API에서 조회하지 못했습니다(HTTP ${response.status}).`, response.status >= 500 ? 502 : 400);
      }
      let body;
      try { body = await response.json(); } catch { signal?.throwIfAborted(); throw new KitError('INVALID_RESPONSE', '빗썸 API 응답 형식이 올바르지 않습니다.'); }
      signal?.throwIfAborted();
      return validResponse(schema, body);
    }
  }
  async getAccounts() { return this.#request('/v1/accounts', ACCOUNTS); }
  async getOrders(options, context) { return this.#request(ordersQuery(options), ORDER_PAGE, context); }
  async getTransfers(options, context) { return this.#request(transfersQuery(options), TRANSFER_PAGE, context); }
  async getMarkets() {
    if (this.#marketCache && Date.now() - this.#marketCache.at < 3600000) return this.#marketCache.data;
    // isDetails=true adds market_warning (거래 유의) at no extra request cost.
    if (!this.#marketPending) this.#marketPending = this.#request('/v1/market/all?isDetails=true', MARKETS).then(data => {
      this.#marketCache = { at: Date.now(), data };
      return data;
    }).finally(() => { this.#marketPending = null; });
    return this.#marketPending;
  }
  async getTickers(markets) {
    const unique = [...new Set(markets)];
    if (unique.some(value => !/^(KRW|BTC)-[A-Z0-9_]+$/.test(value))) {
      throw new KitError('INVALID_MARKET', '원화 또는 BTC 마켓만 조회할 수 있습니다.', 400);
    }
    const result = [];
    // Bithumb announces a 200-market limit from 2026-10-13; use smaller batches now.
    for (let i = 0; i < unique.length; i += 100) {
      const query = new URLSearchParams({ markets: unique.slice(i, i + 100).join(',') });
      result.push(...await this.#request(`/v1/ticker?${query}`, TICKERS));
    }
    return result;
  }
  /** Candles of one interval, oldest first. `to` is an exclusive KST time (yyyy-MM-ddTHH:mm:ss). Public market data; no key is sent. */
  async getCandles(market, count = 30, { interval = 'day', to } = {}) {
    if (!/^KRW-[A-Z0-9_]+$/.test(market) || !Number.isInteger(count) || count < 1 || count > 200 || !Object.hasOwn(CANDLE_PATHS, interval)
      || (to !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(to))) {
      throw new KitError('INVALID_MARKET', '원화 마켓, 캔들 수(1~200개), 지원하는 간격, to(YYYY-MM-DDTHH:mm:ss)를 확인하세요.', 400);
    }
    const query = new URLSearchParams({ market, count: String(count), ...(to ? { to } : {}) });
    const candles = await this.#request(`${CANDLE_PATHS[interval]}?${query}`, CANDLES);
    return candles.sort((a, b) => a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
  }
  /** 경보제(투자 주의가 필요한 거래 페어). Public. */
  async getWarnings() { return this.#request('/v1/market/virtual_asset_warning', WARNINGS); }
  /** Only this key's expiry; other keys on the account are never returned. */
  async getKeyExpiry() {
    const own = (await this.#request('/v1/api_keys', API_KEYS)).find(key => key.access_key === this.#accessKey);
    return { expiresAt: own && Number.isFinite(Date.parse(own.expire_at)) ? new Date(own.expire_at).toISOString() : null };
  }
}
