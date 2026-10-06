import { KitError } from './errors.js';

const DAY = 86400000;
const PRICES = [['BTC', 108400000, 0.0238, '비트코인'], ['ETH', 4180000, 0.0164, '이더리움'], ['XRP', 2610, -0.0181, '리플'], ['SOL', 238000, 0.0082, '솔라나']];

// Entirely synthetic portfolio. Never used as a fallback for live failures.
export class DemoProvider {
  mode = 'demo';
  configured = true;
  accountId = 'demo';
  credentialSource = null;
  async getAccounts() {
    return [
      { currency: 'KRW', balance: '2450000', locked: '350000', avg_buy_price: '0', avg_buy_price_modified: false, unit_currency: 'KRW' },
      { currency: 'BTC', balance: '0.12', locked: '0.005', avg_buy_price: '92000000', avg_buy_price_modified: false, unit_currency: 'KRW' },
      { currency: 'ETH', balance: '1.5', locked: '0.1', avg_buy_price: '3800000', avg_buy_price_modified: false, unit_currency: 'KRW' },
      { currency: 'XRP', balance: '1200', locked: '0', avg_buy_price: '2750', avg_buy_price_modified: false, unit_currency: 'KRW' },
      { currency: 'SOL', balance: '8', locked: '0', avg_buy_price: '225000', avg_buy_price_modified: false, unit_currency: 'KRW' },
    ];
  }
  async getMarkets() {
    return PRICES.map(([symbol, , , name]) => ({ market: `KRW-${symbol}`, korean_name: name, english_name: symbol }));
  }
  async getTickers() {
    return PRICES.map(([symbol, price, change]) => ({ market: `KRW-${symbol}`, trade_price: price, signed_change_rate: change, timestamp: Date.now() }));
  }
  async getCandles(market, count = 30, now = Date.now()) {
    const quote = PRICES.find(([symbol]) => `KRW-${symbol}` === market);
    if (!quote) throw new KitError('NO_KRW_MARKET', '예시 데이터에 없는 원화 마켓입니다.', 404);
    return Array.from({ length: count }, (_, index) => {
      const offset = count - index - 1;
      const close = quote[1] * Math.exp(-0.004 * offset) * (1 + (offset ? Math.sin(offset * 1.3 + quote[1] % 7) * 0.02 : 0));
      const day = new Date(now - offset * DAY).toISOString().slice(0, 10);
      return { market, candle_date_time_utc: `${day}T00:00:00`, candle_date_time_kst: `${day}T09:00:00`, trade_price: Number(close.toFixed(close >= 100 ? 0 : 2)) };
    });
  }
  async getOrders(options) {
    if (options.nextKey) return { data: [], has_next: false, next_key: null };
    const historical = options.kind === 'history';
    const row = { order_id: `demo-${historical ? 'done' : 'pending'}`, side: historical ? 'bid' : 'ask', order_type: 'limit',
      state: historical ? 'done' : 'wait', market: 'KRW-BTC', created_at: new Date(historical ? options.toMs - 3600000 : Date.now()-7200000).toISOString(),
      price: historical ? '92000000' : '115000000', volume: historical ? '0.01' : '0.005', remaining_volume: historical ? '0' : '0.005',
      paid_fee: historical ? '368' : '0', locked: historical ? '0' : '0.005', executed_volume: historical ? '0.01' : '0', executed_funds: historical ? '920000' : '0' };
    return { data: (!options.market || options.market === row.market) && (!options.state || options.state === row.state) && (!historical || Date.parse(row.created_at)>=options.fromMs) ? [row] : [], has_next: false, next_key: null };
  }
  async getTransfers(options) {
    if (options.page > 1) return [];
    const deposit = options.direction === 'deposit';
    const currency = options.assetType === 'krw' ? 'KRW' : options.currency || 'BTC';
    return [{ uuid: `demo-${options.direction}-${currency}`, currency,
      state: deposit ? (currency==='KRW'?'ACCEPTED':'DEPOSIT_ACCEPTED') : 'DONE',
      created_at: new Date(Date.now()-86400000).toISOString(), done_at: new Date(Date.now()-86340000).toISOString(),
      amount: currency==='KRW' ? (deposit?'1000000':'100000') : '0.01', fee: deposit ? '0' : currency==='KRW'?'1000':'0.0002' }];
  }
}

/** One synthetic daily value per day, ending exactly at the demo portfolio's current total. */
export function demoHistory(days = 30, now = Date.now(), current = 28074000) {
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    const factor = Math.exp(-0.0037 * offset) + Math.sin(offset * 1.7) * Math.min(offset, 3) * 0.0052;
    return { asOf: new Date(now - offset * DAY).toISOString(), totalValueKrw: String(Math.round(current * factor)), mode: 'demo', valuationComplete: true };
  });
}
