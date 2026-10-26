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
} } };
const MARKETS = { type: 'array', items: { type: 'object', required: ['market', 'korean_name', 'english_name'], properties: {
  market: { type: 'string' }, korean_name: { type: 'string' }, english_name: { type: 'string' },
} } };
const CANDLES = { type: 'array', items: { type: 'object', required: ['market', 'candle_date_time_utc', 'trade_price'], properties: {
  market: MARKET, candle_date_time_utc: { type: 'string' }, candle_date_time_kst: { type: 'string' }, trade_price: PRICE,
} } };
/** 빗썸 응답 형식이 바뀌면 추정하지 않고 계산을 멈춥니다. */
export const validResponse = (schema, body) => check(schema, body, { code: 'INVALID_RESPONSE', message: '빗썸 데이터 형식이 변경되어 계산을 중단했습니다.', status: 502 });

const PATHS = new Set(['/v1/accounts', '/v1/market/all', '/v1/ticker', '/v1/candles/days', '/v2/orders/pending', '/v2/orders/history', '/v1/deposits', '/v1/deposits/krw', '/v1/withdraws', '/v1/withdraws/krw']);
const PUBLIC = new Set(['/v1/market/all', '/v1/ticker', '/v1/candles/days']);
const retryable = status => status === 429 || status >= 500;

// Accounts has no query parameters. Sign a new JWT for every request.
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
      throw new KitError('NOT_CONFIGURED', '빗썸 조회용 API 키를 로컬에 설정해주세요. (asset-kit config init 또는 .env)', 503);
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
        throw new KitError('API_UNREACHABLE', '빗썸 API에 연결하지 못했습니다. 네트워크 상태를 확인해주세요.');
      }
      if (!response.ok) {
        // Release failed response streams even on the final attempt so repeated refreshes do not retain sockets.
        try { await response.body?.cancel(); } catch { /* The original HTTP error remains authoritative. */ }
        if (retryable(response.status) && !last) { await pause(this.retryDelayMs * 2 ** attempt, undefined, { signal }); continue; }
        if (response.status === 401 || response.status === 403) {
          throw new KitError('AUTH_FAILED', 'API 키의 해당 조회 권한, 만료일, 허용 IP를 확인해주세요.', 401);
        }
        if (response.status === 429) throw new KitError('RATE_LIMITED', '조회가 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.', 429);
        throw new KitError('API_ERROR', `빗썸 API에서 조회하지 못했습니다. (HTTP ${response.status})`, response.status >= 500 ? 502 : 400);
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
    if (!this.#marketPending) this.#marketPending = this.#request('/v1/market/all', MARKETS).then(data => {
      this.#marketCache = { at: Date.now(), data };
      return data;
    }).finally(() => { this.#marketPending = null; });
    return this.#marketPending;
  }
  async getTickers(markets) {
    const unique = [...new Set(markets)];
    if (unique.some(value => !/^(KRW|BTC)-[A-Z0-9_]+$/.test(value))) {
      throw new KitError('INVALID_MARKET', '원화 또는 BTC 거래 페어만 조회할 수 있습니다.', 400);
    }
    const result = [];
    // Bithumb announces a 200-market limit from 2026-10-13; use smaller batches now.
    for (let i = 0; i < unique.length; i += 100) {
      const query = new URLSearchParams({ markets: unique.slice(i, i + 100).join(',') });
      result.push(...await this.#request(`/v1/ticker?${query}`, TICKERS));
    }
    return result;
  }
  /** Daily candles, oldest first. Public market data; no key is sent. */
  async getCandles(market, count = 30) {
    if (!/^KRW-[A-Z0-9_]+$/.test(market) || !Number.isInteger(count) || count < 1 || count > 200) {
      throw new KitError('INVALID_MARKET', '원화 마켓과 1~200개의 일봉 수를 지정하세요.', 400);
    }
    const query = new URLSearchParams({ market, count: String(count) });
    const candles = await this.#request(`/v1/candles/days?${query}`, CANDLES);
    return candles.sort((a, b) => a.candle_date_time_utc.localeCompare(b.candle_date_time_utc));
  }
}
