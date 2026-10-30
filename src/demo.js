import { KitError } from './errors.js';

const DAY = 86400000;
const PRICES = [['BTC', 108400000, 0.0238, '비트코인'], ['ETH', 4180000, 0.0164, '이더리움'], ['XRP', 2610, -0.0181, '리플'], ['SOL', 238000, 0.0082, '솔라나']];
// 보유하지 않은 합성 마켓: 마켓 목록·시장 개요·차트·경보제 예시에 쓰입니다.
const OTHERS = [['DOGE', 412, 0.0612, '도지코인'], ['ADA', 1180, -0.0247, '에이다'], ['LINK', 31800, 0.0131, '체인링크']];
const VOLUMES = { BTC: 412e9, ETH: 198e9, XRP: 156e9, SOL: 61e9, DOGE: 88e9, ADA: 24e9, LINK: 9e9 };
const STEPS = { '1m': 60000, '3m': 180000, '5m': 300000, '10m': 600000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, day: DAY, week: 7 * DAY, month: 30 * DAY };
const kst = time => new Date(time + 9 * 3600000).toISOString().slice(0, 19);
const ACCOUNTS = [
  { currency: 'KRW', balance: '2450000', locked: '350000', avg_buy_price: '0', avg_buy_price_modified: false, unit_currency: 'KRW' },
  { currency: 'BTC', balance: '0.12', locked: '0.005', avg_buy_price: '92000000', avg_buy_price_modified: false, unit_currency: 'KRW' },
  { currency: 'ETH', balance: '1.5', locked: '0.1', avg_buy_price: '3800000', avg_buy_price_modified: false, unit_currency: 'KRW' },
  { currency: 'XRP', balance: '1200', locked: '0', avg_buy_price: '2750', avg_buy_price_modified: false, unit_currency: 'KRW' },
  { currency: 'SOL', balance: '8', locked: '0', avg_buy_price: '225000', avg_buy_price_modified: false, unit_currency: 'KRW' },
];
// 코인마다 다른 합성 시세 흐름: 추세(일), 긴 주기 [진폭, 일, 위상], 짧은 주기 [진폭, 일, 위상], 날마다 다른 결정적 잡음.
const SHAPES = {
  BTC: [0.0016, [0.11, 140, 3.63], [0.02, 13, 5.5], 0.022], ETH: [0.0011, [0.14, 120, 0.59], [0.025, 11, 0.79], 0.03],
  XRP: [-0.0004, [0.16, 100, 0.49], [0.03, 9, 4.32], 0.035], SOL: [0.0019, [0.2, 150, 4.22], [0.035, 17, 5.89], 0.04],
  DOGE: [0.0008, [0.25, 90, 0.88], [0.05, 8, 4.12], 0.05], ADA: [-0.0009, [0.18, 110, 0.69], [0.03, 12, 4.12], 0.035],
  LINK: [0.0009, [0.15, 130, 3.93], [0.025, 15, 4.12], 0.03],
};
const jitter = (symbol, day) => { let h = 2166136261; for (const char of `${symbol}:${day}`) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295 * 2 - 1; };
function wave(symbol, t) {
  const [trend, [a1, p1, f1], [a2, p2, f2], noise] = SHAPES[symbol], day = Math.floor(t), frac = t - day;
  return -trend * t + a1 * Math.sin(2 * Math.PI * t / p1 + f1) + a2 * Math.sin(2 * Math.PI * t / p2 + f2) + noise * (jitter(symbol, day) * (1 - frac) + jitter(symbol, day + 1) * frac);
}
/** 지금 가격 대비 t일 전 가격의 배수. 하루 전 값은 티커의 전일 대비 등락률과 정확히 맞습니다. */
function priceFactor(symbol, t) {
  const change = [...PRICES, ...OTHERS].find(([code]) => code === symbol)[2], today = wave(symbol, 0);
  return Math.exp(wave(symbol, t) - today + (-Math.log1p(change) - (wave(symbol, 1) - today)) * Math.min(t, 1));
}

// Entirely synthetic portfolio. Never used as a fallback for live failures.
export class DemoProvider {
  mode = 'demo';
  configured = true;
  accountId = 'demo';
  credentialSource = null;
  async getAccounts() {
    return ACCOUNTS.map(account => ({ ...account }));
  }
  async getMarkets() {
    return [...PRICES, ...OTHERS].map(([symbol, , , name]) => ({ market: `KRW-${symbol}`, korean_name: name, english_name: symbol, market_warning: 'NONE' }));
  }
  async getTickers(markets) {
    const wanted = markets && new Set(markets);
    return [...PRICES, ...OTHERS].filter(([symbol]) => !wanted || wanted.has(`KRW-${symbol}`)).map(([symbol, price, change]) => ({
      market: `KRW-${symbol}`, trade_price: price, signed_change_rate: change, timestamp: Date.now(),
      high_price: Math.round(price * 1.03), low_price: Math.round(price * 0.97), acc_trade_price_24h: VOLUMES[symbol] }));
  }
  async getCandles(market, count = 30, { interval = 'day', now = Date.now() } = {}) {
    const quote = [...PRICES, ...OTHERS].find(([symbol]) => `KRW-${symbol}` === market);
    if (!quote) throw new KitError('NO_KRW_MARKET', '데모 데이터에 없는 원화 마켓입니다.', 404);
    const step = STEPS[interval] ?? DAY;
    const price = offset => quote[1] * priceFactor(quote[0], offset * step / DAY);
    const round = value => Number(value.toFixed(value >= 100 ? 0 : 2));
    return Array.from({ length: count }, (_, index) => {
      const offset = count - index - 1, close = price(offset), open = price(offset + 1);
      const start = interval === 'day' ? Date.parse(`${new Date(now - offset * DAY).toISOString().slice(0, 10)}T00:00:00Z`) : Math.floor((now - offset * step) / step) * step;
      return { market, candle_date_time_utc: new Date(start).toISOString().slice(0, 19), candle_date_time_kst: kst(start),
        opening_price: round(open), high_price: round(Math.max(open, close) * 1.01), low_price: round(Math.min(open, close) * 0.99), trade_price: round(close),
        candle_acc_trade_volume: Number((VOLUMES[quote[0]] / quote[1] * step / DAY * (0.55 + Math.abs(jitter(quote[0], offset)) * 0.9 + Math.min(2, Math.abs(close - open) / open * 40))).toFixed(4)) };
    });
  }
  async getWarnings() {
    return [{ market: 'KRW-DOGE', warning_type: 'PRICE_SUDDEN_FLUCTUATION', warning_step: 'CAUTION', end_date: kst(Date.now() + DAY).replace('T', ' ') }];
  }
  async getKeyExpiry() { return { expiresAt: null }; }
  async getOrders(options) {
    if (options.kind !== 'history') {
      if (options.nextKey) return { data: [], has_next: false, next_key: null };
      const row = { order_id: 'demo-pending', side: 'ask', order_type: 'limit', state: 'wait', market: 'KRW-BTC', created_at: new Date(Date.now() - 7200000).toISOString(),
        price: '115000000', volume: '0.005', remaining_volume: '0.005', paid_fee: '0', locked: '0.005', executed_volume: '0', executed_funds: '0' };
      return { data: (!options.market || options.market === row.market) && (!options.state || options.state === row.state) ? [row] : [], has_next: false, next_key: null };
    }
    const rows = demoRecords().orders.filter(row => { const at = Date.parse(row.created_at); return at >= options.fromMs && at <= options.toMs; })
      .filter(row => (!options.market || options.market === row.market) && (!options.state || options.state === row.state));
    // Newest first like the API; the cursor is the index of the next row.
    const offset = options.nextKey ? Number(options.nextKey) : 0, page = rows.slice(offset, offset + options.limit), next = offset + page.length;
    return { data: page, has_next: next < rows.length, next_key: next < rows.length ? String(next) : null };
  }
  async getTransfers(options) {
    const rows = demoRecords().transfers.filter(row => row.direction === options.direction && (options.assetType === 'krw') === (row.currency === 'KRW') && (!options.currency || options.currency === row.currency));
    return rows.slice((options.page - 1) * options.limit, options.page * options.limit).map(({ direction, ...row }) => row);
  }
}

/**
 * Synthetic orders and transfers for the last twelve months, relative to today and the same price paths as the candles.
 * They are consistent with the demo balances when replayed backwards (no quantity ever goes negative).
 */
export function demoRecords(now = Date.now()) {
  const kstDay = (monthsAgo, day, hour = 10) => {
    const local = new Date(now + 9 * 3600000);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - monthsAgo, day, hour - 9);
  };
  const price = (symbol, at) => { const [, base] = PRICES.find(([code]) => code === symbol); const value = base * priceFactor(symbol, Math.max(0, (now - at) / DAY)); return value >= 100 ? Math.round(value) : Number(value.toFixed(2)); };
  const orders = [], transfers = [];
  const order = (symbol, side, volume, at) => {
    if (at > now - 3600000) return;
    const unit = price(symbol, at), funds = Math.round(unit * volume), fee = Math.round(funds * 0.0004);
    orders.push({ order_id: `demo-${symbol}-${side}-${at}`, side, order_type: 'limit', state: 'done', market: `KRW-${symbol}`, created_at: new Date(at).toISOString(), done_at: new Date(at + 60000).toISOString(),
      price: String(unit), volume: String(volume), remaining_volume: '0', paid_fee: String(fee), locked: '0', executed_volume: String(volume), executed_funds: String(funds) });
  };
  const transfer = (direction, currency, amount, fee, at) => {
    if (at > now - 3600000) return;
    transfers.push({ direction, uuid: `demo-${direction}-${currency}-${at}`, currency, net_type: currency === 'KRW' ? undefined : currency, state: direction === 'deposit' ? (currency === 'KRW' ? 'ACCEPTED' : 'DEPOSIT_ACCEPTED') : 'DONE',
      created_at: new Date(at).toISOString(), done_at: new Date(at + 60000).toISOString(), amount: String(amount), fee: String(fee) });
  };
  for (let m = 0; m < 12; m++) {
    transfer('deposit', 'KRW', 300000, 0, kstDay(m, 3));            // 매달 적립식 입금
    order('BTC', 'bid', 0.004, kstDay(m, 5, 11));                    // 매달 BTC 분할 매수
    if (m % 2 === 0) order('ETH', 'bid', 0.1, kstDay(m, 8, 14));     // 격월 ETH 매수
  }
  transfer('deposit', 'KRW', 2000000, 0, kstDay(7, 11));
  transfer('withdraw', 'KRW', 1000000, 1000, kstDay(4, 20));
  transfer('withdraw', 'KRW', 300000, 1000, kstDay(1, 20));
  transfer('deposit', 'BTC', 0.01, 0, kstDay(5, 10, 15));
  transfer('withdraw', 'XRP', 100, 1, kstDay(2, 18));
  transfer('deposit', 'KRW', 1000000, 0, now - 86400000);            // 어제 입금(최근 7일 화면용)
  order('XRP', 'bid', 300, kstDay(9, 12));
  order('SOL', 'bid', 2, kstDay(6, 15));
  order('BTC', 'ask', 0.006, kstDay(3, 25));
  order('ETH', 'ask', 0.2, kstDay(6, 26));
  order('SOL', 'ask', 3, kstDay(4, 27));
  orders.sort((a, b) => b.created_at.localeCompare(a.created_at));
  transfers.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { orders, transfers };
}

/**
 * One synthetic daily value per day: the demo holdings (only `symbols` when given) valued along the same price paths
 * as the demo candles, ending exactly at `current`.
 */
export function demoHistory(days = 30, now = Date.now(), current = 28074000, symbols = []) {
  const prices = new Map(PRICES.map(([symbol, price]) => [symbol, price])), wanted = new Set(symbols);
  const accounts = ACCOUNTS.filter(a => !wanted.size || wanted.has(a.currency));
  const value = t => accounts.reduce((sum, a) => sum + (Number(a.balance) + Number(a.locked)) * (a.currency === 'KRW' ? 1 : prices.get(a.currency) * priceFactor(a.currency, t)), 0);
  const today = value(0);
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    return { asOf: new Date(now - offset * DAY).toISOString(), totalValueKrw: String(today ? Math.round(current * value(offset) / today) : 0), mode: 'demo', valuationComplete: true };
  });
}
