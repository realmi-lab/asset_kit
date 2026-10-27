import { dec } from './decimal.js';
import { calculatePortfolio, explainPortfolio, projectPortfolio } from './portfolio.js';
import { BithumbProvider, CANDLE_PATHS } from './bithumb.js';
import { DemoProvider, demoHistory } from './demo.js';
import { HistoryStore, dailyCloses, downsample, kstDay, pointFor } from './history.js';
import { BoardStore } from './boards.js';
import { KitError, publicError } from './errors.js';
import { ORDER_PAGE_SIZE, RECORD_KINDS, normalizeOrders, normalizeTransfers, recordRange } from './activity.js';
import { LiveFeed } from './live.js';
import { computeReturns, kstDate, returnsWindow } from './returns.js';
import { dataDir } from './config.js';

const DAY = 86400000, WEEK = 7 * DAY;
const SYMBOL = /^[A-Z0-9][A-Z0-9_]{0,29}$/;
const iso = value => { const time = Date.parse(value); return Number.isNaN(time) ? null : new Date(time).toISOString(); };
const decimalOrNull = value => value === undefined || value === null ? null : dec(value).toFixed();
const WARNING_TYPES = { PRICE_SUDDEN_FLUCTUATION: '가격 급등락', PRICE_DIFFERENCE_HIGH: '글로벌 시세 차이', SPECIFIC_ACCOUNT_HIGH_TRANSACTION: '소수 계정 거래 집중',
  TRADING_VOLUME_SUDDEN_FLUCTUATION: '거래량 급등', DEPOSIT_AMOUNT_SUDDEN_FLUCTUATION: '입금량 급등', MARKET_CAUTION: '거래 유의 종목' };
const WARNING_STEPS = { CAUTION: '주의', WARNING: '경고', DANGER: '위험' };

/** Accepts `BTC,ETH` or ['BTC','ETH']; an empty list means the whole account. */
export function parseSymbols(input = []) {
  const list = Array.isArray(input) ? input : String(input).split(',');
  const symbols = [...new Set(list.map(value => String(value).trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 100 || symbols.some(value => !SYMBOL.test(value))) throw new KitError('INVALID_SYMBOLS', '자산 심볼은 BTC,ETH처럼 쉼표로 구분합니다.', 400);
  return symbols;
}

export class PortfolioService {
  #pending; #cached; #source; #live; #records = new Map(); #recordCache = new Map(); #markets = new Map(); #marketPending = new Map(); #shared = new Map();
  constructor({ demo = false, provider, history, boards, directory, maxPages = 50, ...options } = {}) {
    this.provider = provider ?? (demo ? new DemoProvider() : new BithumbProvider(options));
    const storage = { directory: directory ?? dataDir(options.env), accountId: this.provider.accountId, mode: this.provider.mode };
    this.history = history ?? new HistoryStore(storage);
    this.boards = boards ?? new BoardStore(storage);
    this.maxPages = maxPages;
    this.historyError = null;
  }
  status() {
    return { mode: this.provider.mode, provider: 'bithumb', configured: this.provider.configured, credentialSource: this.provider.credentialSource ?? null,
      readOnly: true, cacheSeconds: 30, marketCacheSeconds: 60, recordsCacheSeconds: 30,
      historyIntervalSeconds: 300, lastSuccessfulFetch: this.#cached?.asOf ?? null, historyError: this.historyError };
  }
  /** Whole account, or the subset named by `symbols` with its own totals and allocation. */
  async portfolio({ symbols = [], force = false } = {}) {
    const scope = parseSymbols(symbols);
    return projectPortfolio(await this.#portfolio(force), scope);
  }
  async #portfolio(force = false) {
    if (this.#pending) return this.#pending;
    if (!force && this.#cached && Date.now() - Date.parse(this.#cached.asOf) < 30000) return this.#cached;
    this.#pending = this.#load();
    try { return await this.#pending; } finally { this.#pending = null; }
  }
  async #load() {
    const [accounts, markets] = await Promise.all([this.provider.getAccounts(), this.provider.getMarkets()]);
    const listed = new Set(markets.map(m => m.market)), needed = new Set();
    for (const account of accounts) {
      if (account.currency === 'KRW' || !dec(account.balance).plus(account.locked).gt(0)) continue;
      if (listed.has(`KRW-${account.currency}`)) needed.add(`KRW-${account.currency}`);
      else if (listed.has(`BTC-${account.currency}`)) { needed.add(`BTC-${account.currency}`); needed.add('KRW-BTC'); }
    }
    const tickers = needed.size ? await this.provider.getTickers([...needed]) : [];
    const portfolio = calculatePortfolio({ accounts, markets, tickers, mode: this.provider.mode });
    this.#cached = portfolio;
    // Live prices revalue these balances without another account request.
    this.#source = { accounts, markets, tickers, needed: [...needed] };
    // Every live read (dashboard, CLI, MCP) adds at most one local history point per five minutes.
    if (this.provider.mode !== 'demo') {
      try { await this.history.record(portfolio); this.historyError = null; } catch (error) { this.historyError = publicError(error); }
    }
    return portfolio;
  }
  /** Public live ticker feed (Bithumb WebSocket, REST fallback; synthetic ticks in demo mode). Created on first use. */
  get live() {
    this.#live ??= new LiveFeed({ demo: this.provider.mode === 'demo', poll: markets => this.provider.getTickers(markets) });
    return this.#live;
  }
  /** Markets whose prices value the current balances (KRW-BTC is added for coins quoted only in BTC). */
  async liveMarkets({ symbols = [] } = {}) {
    await this.#portfolio();
    const scope = new Set(parseSymbols(symbols));
    return this.#source.needed.filter(market => !scope.size || scope.has(market.split('-')[1]) || (market === 'KRW-BTC' && this.#source.needed.some(m => m.startsWith('BTC-'))));
  }
  /**
   * The last account snapshot revalued with live quotes (exact decimals, same contract as portfolio()).
   * Balances come from the last account read; nothing is recorded to history.
   */
  livePortfolio({ symbols = [], quotes = this.live.quotes } = {}) {
    if (!this.#source) return null;
    const merged = new Map(this.#source.tickers.map(ticker => [ticker.market, ticker]));
    // A live stream keeps its quotes current. Otherwise (reconnecting, polling) a quote older than the last account read's
    // ticker must not undo the fresher price.
    const streaming = quotes === this.live.quotes && this.live.status === 'live';
    for (const market of this.#source.needed) {
      const quote = quotes.get(market), rest = merged.get(market);
      if (quote && (streaming || !(Number(rest?.timestamp) > Number(quote.timestamp)))) merged.set(market, { ...rest, ...quote });
    }
    const portfolio = calculatePortfolio({ accounts: this.#source.accounts, markets: this.#source.markets, tickers: [...merged.values()], mode: this.provider.mode, asOf: new Date().toISOString() });
    return projectPortfolio(portfolio, parseSymbols(symbols));
  }
  /** Every KRW market's symbol, Korean name and caution flag, for search boxes. Public data. */
  async marketList() {
    return (await this.provider.getMarkets()).filter(m => m.market.startsWith('KRW-'))
      .map(m => ({ symbol: m.market.slice(4), name: m.korean_name, marketWarning: m.market_warning && m.market_warning !== 'NONE' ? m.market_warning : null }));
  }
  /**
   * Flow-adjusted returns, realized P&L and a monthly report over the last 3, 6 or 12 calendar months.
   * Reads up to a year of orders and transfers, so the result is kept for a minute.
   */
  async returns({ months = 12, force = false } = {}) {
    if (![3, 6, 12].includes(months)) throw new KitError('INVALID_RANGE', '수익률 기간은 3, 6, 12개월 중 하나입니다.', 400);
    return this.#share(`returns:${months}`, 60000, async () => {
      const now = Date.now(), window = returnsWindow(months, now), from = kstDate(window.start), to = kstDate(now);
      const portfolio = await this.portfolio({ force });
      // A year of closed orders is 53 seven-day windows; allow enough pages for them.
      const read = kind => this.getRecords({ kind, from, to, force, pages: 200 });
      // Transfers in the week before the window carry an earlier valuation up to the window start (records allow at most 366 days per read).
      const before = kind => this.getRecords({ kind, from: kstDate(window.start - 7 * DAY), to: kstDate(window.start - DAY), force });
      const transferKinds = ['krw_deposits', 'krw_withdrawals', 'deposits', 'withdrawals'];
      const [orders, ...inside] = await Promise.all(['orders', ...transferKinds].map(read)), earlier = await Promise.all(transferKinds.map(before));
      const [krwDeposits, krwWithdrawals, coinDeposits, coinWithdrawals] = inside.map((value, i) => ({ rows: [...earlier[i].rows, ...value.rows], coverage: { complete: value.coverage.complete && earlier[i].coverage.complete } }));
      // History from a week before the window start, so a 12-month window can read past the 365-day limit of getHistory.
      const points = await this.#points(Math.ceil((now - window.start) / DAY) + 8);
      // Coin transfers are valued at that day's KRW close.
      const closes = new Map(), symbols = [...new Set([...coinDeposits.rows, ...coinWithdrawals.rows].map(row => row.currency).filter(symbol => symbol && symbol !== 'KRW'))];
      await Promise.all(symbols.map(async symbol => {
        const byDay = new Map();
        try {
          const recent = await this.getMarket({ symbol, interval: 'day', count: 200 });
          for (const candle of recent.candles) byDay.set(candle.date, candle.closeKrw);
          if (recent.candles.length && recent.candles[0].date > kstDate(window.start - 7 * DAY)) {
            const older = await this.getMarket({ symbol, interval: 'day', count: 200, to: recent.candles[0].date });
            for (const candle of older.candles) byDay.set(candle.date, candle.closeKrw);
          }
        } catch { /* left unpriced and reported */ }
        closes.set(symbol, byDay);
      }));
      const result = computeReturns({
        months, now, holdings: portfolio.holdings, currentValueKrw: portfolio.summary.valuationComplete ? portfolio.summary.totalValueKrw : null,
        orders: orders.rows, krwDeposits: krwDeposits.rows, krwWithdrawals: krwWithdrawals.rows, coinDeposits: coinDeposits.rows, coinWithdrawals: coinWithdrawals.rows,
        history: points, closeOn: (symbol, day) => closes.get(symbol)?.get(day) ?? null,
      });
      const records = Object.fromEntries([['orders', orders], ['krwDeposits', krwDeposits], ['krwWithdrawals', krwWithdrawals], ['coinDeposits', coinDeposits], ['coinWithdrawals', coinWithdrawals]]
        .map(([name, value]) => [name, { rows: value.rows.length, complete: value.coverage.complete }]));
      return { mode: this.provider.mode, asOf: new Date(now).toISOString(), ...result, coverage: { records, complete: Object.values(records).every(r => r.complete) },
        note: '실제 수익 = 기간 말 평가금액 − 기간 초 평가금액 − 순입금(코인 입출금은 그날 종가로 환산). 수익률은 입출금 시점을 반영한 근사(Modified Dietz)입니다. 실현손익은 평균 매수가 방식으로 다시 계산한 추정치이며, 세금·확정 손익 계산에 쓰지 마세요.' };
    }, force);
  }
  async explain({ symbols = [] } = {}) {
    return explainPortfolio(await this.portfolio({ symbols }));
  }
  /** Every recorded point in the period, before any downsampling. Exact endpoints and counts must come from here. */
  async historyPoints({ days = 30, symbols = [], daily = false } = {}) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new KitError('INVALID_RANGE', '조회 기간은 1~365일입니다.', 400);
    const scope = parseSymbols(symbols);
    return { scope, points: await this.#points(daily ? days + 1 : days, scope) }; // one extra day gives the first day's change
  }
  async #points(span, scope = []) {
    if (this.provider.mode === 'demo') {
      const part = projectPortfolio(await this.#portfolio(), scope).summary.totalValueKrw;
      return demoHistory(span, Date.now(), Number(part), scope).map(p => ({ asOf: p.asOf, totalValueKrw: p.totalValueKrw, valuationComplete: true }));
    }
    return (await this.history.read(span)).map(record => pointFor(record, scope));
  }
  async getHistory({ days = 30, symbols = [], daily = false } = {}) {
    const { scope, points } = await this.historyPoints({ days, symbols, daily });
    const base = { mode: this.provider.mode, days, scope };
    if (daily) {
      const first = kstDay(new Date(Date.now() - (days - 1) * DAY).toISOString());
      return { ...base, daily: dailyCloses(points).filter(row => row.day >= first),
        note: '한국 시간 날짜별 마지막 평가금액과 직전 기록일 대비 변화입니다. 기록이 없는 날은 건너뛰며 gapDays는 두 기록일 사이의 일수입니다. 입출금이 포함되어 투자 수익률과 다릅니다.' };
    }
    const sampled = downsample(points);
    return { ...base, points: sampled, sampled: sampled.length < points.length,
      note: '평가금액 기록입니다. 입출금 영향을 포함하며 투자 수익률이 아닙니다. 가격 미확인 시점은 차트에서 제외됩니다.' };
  }
  /** KRW market price and candles of one interval (minutes to months) for one asset. Public market data; works without keys. */
  async getMarket({ symbol = 'BTC', days = 30, interval = 'day', count, to, force = false } = {}) {
    const code = String(symbol).trim().toUpperCase(), size = count ?? days;
    const before = to === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T00:00:00` : String(to).replace(' ', 'T');
    if (!SYMBOL.test(code) || code === 'KRW' || !Number.isInteger(size) || size < 1 || size > 200 || !Object.hasOwn(CANDLE_PATHS, interval)
      || (before !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(before))) {
      throw new KitError('INVALID_MARKET', '자산 심볼, 1~200개 캔들, 지원하는 간격, to(한국 시간 YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm:ss)를 확인하세요.', 400);
    }
    const market = `KRW-${code}`, key = `${market}:${interval}:${size}:${before ?? ''}`, cached = this.#markets.get(key);
    if (this.#marketPending.has(key)) return this.#marketPending.get(key);
    if (!force && cached && Date.now() - cached.at < 60000) return cached.data;
    const pending = this.#loadMarket(code, market, size, interval, before).then(data => {
      this.#markets.delete(key);
      this.#markets.set(key, { at: Date.now(), data });
      if (this.#markets.size > 100) this.#markets.delete(this.#markets.keys().next().value);
      return data;
    }).finally(() => this.#marketPending.delete(key));
    this.#marketPending.set(key, pending);
    return pending;
  }
  async #loadMarket(code, market, count, interval, to) {
    const listing = (await this.provider.getMarkets()).find(m => m.market === market);
    if (!listing) throw new KitError('NO_KRW_MARKET', '빗썸 원화 마켓에 없는 자산입니다.', 404);
    const [tickers, candles] = await Promise.all([this.provider.getTickers([market]), this.provider.getCandles(market, count, { interval, to })]);
    const ticker = tickers.find(t => t.market === market);
    const data = {
      mode: this.provider.mode, symbol: code, name: listing.korean_name, market, interval, asOf: new Date().toISOString(),
      priceKrw: ticker ? dec(ticker.trade_price).toFixed() : null,
      changePct: ticker?.signed_change_rate === undefined ? null : dec(ticker.signed_change_rate).times(100).toFixed(4),
      // date는 한국 시간 날짜, at은 캔들 시작 시각(한국 시간)입니다.
      candles: candles.map(c => ({ date: (c.candle_date_time_kst ?? c.candle_date_time_utc).slice(0, 10), at: c.candle_date_time_kst ? `${c.candle_date_time_kst}+09:00` : `${c.candle_date_time_utc}Z`,
        openKrw: decimalOrNull(c.opening_price), highKrw: decimalOrNull(c.high_price), lowKrw: decimalOrNull(c.low_price), closeKrw: dec(c.trade_price).toFixed(), volume: decimalOrNull(c.candle_acc_trade_volume) })),
      note: `빗썸 원화 마켓 ${interval === 'day' ? '일봉' : `${interval} 캔들`}입니다. 시세이며 내 자산의 과거 평가금액이 아닙니다.`,
    };
    return data;
  }
  // Shares one in-flight public read and keeps its result for `ms`.
  #share(key, ms, load, force = false) {
    const entry = this.#shared.get(key);
    if (entry?.pending) return entry.pending;
    if (!force && entry && Date.now() - entry.at < ms) return entry.data;
    const pending = load().then(data => { this.#shared.set(key, { at: Date.now(), data }); return data; }, error => { this.#shared.delete(key); throw error; });
    this.#shared.set(key, { ...entry, pending });
    return pending;
  }
  // Held symbols when an account is connected; null without keys so public tools still work.
  // With `optional` (scope=all) an account failure only drops the "held" marks instead of failing public market data.
  async #heldSymbols(force, optional = false) {
    if (!this.provider.configured) return null;
    try {
      return new Map((await this.#portfolio(force)).holdings.filter(h => h.symbol !== 'KRW').map(h => [h.symbol, h]));
    } catch (error) {
      if (optional) return null;
      throw error;
    }
  }
  /** Prices, 24h change and traded value for held assets or every KRW market. Public data; works without keys for scope=all. */
  async marketOverview({ scope = 'holdings', symbols = [], sort = 'value24h', direction = 'desc', limit = 20, force = false } = {}) {
    const wanted = parseSymbols(symbols), held = await this.#heldSymbols(force, scope === 'all');
    if (scope === 'holdings' && !held) throw new KitError('NOT_CONFIGURED', '보유 자산 시세는 계좌 연결 후 볼 수 있습니다. scope=all은 키 없이 됩니다.', 503);
    const markets = (await this.provider.getMarkets()).filter(m => m.market.startsWith('KRW-'));
    const listed = markets.filter(m => {
      const symbol = m.market.slice(4);
      return (scope === 'all' || held.has(symbol)) && (!wanted.length || wanted.includes(symbol));
    });
    const tickers = scope === 'all' && !wanted.length
      ? await this.#share('tickers:all', 10000, () => this.provider.getTickers(markets.map(m => m.market)), force)
      : listed.length ? await this.provider.getTickers(listed.map(m => m.market)) : [];
    const quotes = new Map(tickers.map(t => [t.market, t]));
    const rows = listed.filter(m => quotes.has(m.market)).map(m => {
      const t = quotes.get(m.market), symbol = m.market.slice(4);
      return { symbol, name: m.korean_name, priceKrw: dec(t.trade_price).toFixed(), changePct: t.signed_change_rate === undefined ? null : dec(t.signed_change_rate).times(100).toFixed(4),
        value24hKrw: decimalOrNull(t.acc_trade_price_24h), highKrw: decimalOrNull(t.high_price), lowKrw: decimalOrNull(t.low_price),
        held: held ? held.has(symbol) : null, marketWarning: m.market_warning && m.market_warning !== 'NONE' ? m.market_warning : null };
    });
    const field = { change: 'changePct', value24h: 'value24hKrw', price: 'priceKrw' }[sort], factor = direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ko') * factor
      : a[field] === null || b[field] === null ? (a[field] === null) - (b[field] === null) : dec(a[field]).cmp(b[field]) * factor || a.symbol.localeCompare(b.symbol));
    return { mode: this.provider.mode, asOf: new Date().toISOString(), scope, sort, direction, total: rows.length, rows: rows.slice(0, limit),
      note: '빗썸 원화 마켓 시세입니다. changePct는 전일 종가 대비, value24hKrw는 최근 24시간 거래대금이며 내 자산 평가가 아닙니다.' };
  }
  /** 경보제(가격 급등락 등)와 거래 유의 종목. scope=holdings는 보유 자산만, all은 빗썸 전체. */
  async getWarnings({ scope = 'holdings', force = false } = {}) {
    const held = await this.#heldSymbols(force, scope === 'all');
    if (scope === 'holdings' && !held) throw new KitError('NOT_CONFIGURED', '보유 자산 경보는 계좌 연결 후 볼 수 있습니다. scope=all은 키 없이 됩니다.', 503);
    const [alerts, markets] = await Promise.all([this.#share('warnings', 60000, () => this.provider.getWarnings(), force), this.provider.getMarkets()]);
    const names = new Map(markets.map(m => [m.market, m.korean_name]));
    const kst = value => { const time = Date.parse(`${String(value).replace(' ', 'T')}+09:00`); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
    const rows = [
      ...alerts.map(a => ({ market: a.market, type: a.warning_type, step: a.warning_step, endsAt: a.end_date ? kst(a.end_date) : null })),
      ...markets.filter(m => m.market_warning && m.market_warning !== 'NONE').map(m => ({ market: m.market, type: 'MARKET_CAUTION', step: 'CAUTION', endsAt: null })),
    ].map(row => {
      const symbol = row.market.split('-')[1];
      return { ...row, symbol, name: names.get(row.market) ?? symbol, typeLabel: WARNING_TYPES[row.type] ?? row.type, stepLabel: WARNING_STEPS[row.step] ?? row.step, held: held ? held.has(symbol) : null };
    }).filter(row => scope === 'all' || row.held);
    return { mode: this.provider.mode, asOf: new Date().toISOString(), scope, total: rows.length, rows,
      note: rows.length ? '빗썸이 투자 주의가 필요하다고 표시한 거래 페어입니다. 매매 권유나 판단이 아닙니다.' : scope === 'holdings' ? '보유 자산 중 경보나 거래 유의 지정이 없습니다.' : '현재 빗썸 경보·거래 유의 지정이 없습니다.' };
  }
  /** This API key's expiry (keys last one year on Bithumb). */
  async keyInfo() {
    const { expiresAt } = await this.provider.getKeyExpiry();
    return { expiresAt, daysLeft: expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / DAY) : null };
  }
  async getOrders(input = {}, context) {
    const options = normalizeOrders(input);
    const result = await this.provider.getOrders(options, context);
    return { mode: this.provider.mode, asOf: new Date().toISOString(), query: options, ...result,
      coverage: { scope: options.kind==='history'?'지정한 최대 7일 기간의 주문 한 페이지':'대기 주문 한 페이지', completePageSet: !result.has_next, allTime: false },
    };
  }
  async getTransfers(input = {}, context) {
    const options = normalizeTransfers(input);
    const data = await this.provider.getTransfers(options, context);
    return { mode: this.provider.mode, asOf: new Date().toISOString(), query: options, data,
      pagination: { page: options.page, limit: options.limit, mayHaveMore: data.length === options.limit, nextPage: data.length === options.limit ? options.page+1 : null },
      coverage: { scope: '조회 조건에 해당하는 입출금 한 페이지', allTime: false },
    };
  }
  /** Every page of one record kind within a period (up to maxPages). Identical concurrent requests share one run. */
  async getRecords({ kind = 'orders', from, to, force = false, pages } = {}) {
    const spec = Object.hasOwn(RECORD_KINDS, kind) ? RECORD_KINDS[kind] : null;
    if (!spec) throw new KitError('INVALID_KIND', `내역 종류는 ${Object.keys(RECORD_KINDS).join(', ')} 중 하나입니다.`, 400);
    const period = kind === 'pending' ? null : recordRange(from, to);
    // Omitted bounds mean a rolling interval. Reuse its original period and asOf for the short cache lifetime.
    const key = JSON.stringify([kind, from ? period?.start : null, to ? period?.end : null, pages ?? null]);
    if (this.#records.has(key)) return this.#records.get(key);
    const cached = this.#recordCache.get(key);
    if (!force && cached && Date.now() - cached.at < 30000) return cached.data;
    this.#records.set(key, this.#collectRecords(kind, spec, period, pages ?? this.maxPages).then(data => {
      this.#recordCache.delete(key);
      this.#recordCache.set(key, { at: Date.now(), data });
      // A result may contain thousands of rows: bound retained ranges independently of small price caches.
      if (this.#recordCache.size > 8) this.#recordCache.delete(this.#recordCache.keys().next().value);
      return data;
    }).finally(() => this.#records.delete(key)));
    return this.#records.get(key);
  }
  async #collectRecords(kind, spec, period, maxPages) {
    const rows = new Map();
    let pages = 0, complete = true;
    const page = async load => {
      // Larger closed-order pages mean fewer calls, not more retained rows: keep the old 100-rows-per-page ceiling.
      if (pages >= maxPages || rows.size >= maxPages * 100) { complete = false; return null; }
      pages++;
      return load();
    };
    const orderPages = async base => {
      const seen = new Set();
      for (let nextKey; ;) {
        const result = await page(() => this.provider.getOrders(normalizeOrders({ ...base, limit: ORDER_PAGE_SIZE[base.kind], ...(nextKey ? { nextKey } : {}) })));
        if (!result) return;
        for (const row of result.data) rows.set(row.order_id, row);
        if (!result.has_next) return;
        if (!result.next_key || seen.has(result.next_key)) throw new KitError('INVALID_CURSOR', '주문 페이지를 안전하게 이어갈 수 없습니다.', 502);
        seen.add(result.next_key);
        nextKey = result.next_key;
      }
    };
    if (kind === 'pending') await orderPages({ kind: 'pending' });
    else if (kind === 'orders') {
      // The orders API accepts at most seven days per query.
      for (let start = period.start; start <= period.end && complete; start += WEEK) {
        await orderPages({ kind: 'history', fromMs: start, toMs: Math.min(period.end, start + WEEK - 1) });
      }
    } else {
      for (let number = 1; ; number++) {
        const result = await page(() => this.provider.getTransfers(normalizeTransfers({ direction: spec.direction, assetType: spec.assetType, page: number, limit: 100 })));
        if (!result) break;
        for (const row of result) rows.set(row.uuid, row);
        // Results are not guaranteed to be ordered by completion time. An older created_at can still
        // complete within this period, so only a short page proves exhaustion; maxPages marks truncation.
        if (result.length < 100) break;
      }
    }
    const isOrder = kind === 'orders' || kind === 'pending';
    const list = [...rows.values()]
      .map(row => ({ ...row, at: iso(row.done_at ?? row.created_at) }))
      .filter(row => isOrder || (row.at && Date.parse(row.at) >= period.start && Date.parse(row.at) <= period.end))
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    const totals = {};
    for (const row of list) {
      const currency = row.market ? row.market.split('-')[0] : row.currency;
      const item = totals[currency] ??= { count: 0, amount: '0', fee: '0' };
      item.count++;
      item.amount = dec(item.amount).plus(isOrder ? row.executed_funds : row.amount).toFixed();
      item.fee = dec(item.fee).plus(isOrder ? row.paid_fee : row.fee).toFixed();
    }
    return {
      mode: this.provider.mode, kind, label: spec.label, asOf: new Date().toISOString(),
      period: period && { from: period.from, to: period.to }, rows: list, totals,
      coverage: {
        complete, pages, maxPages,
        note: kind === 'pending' ? '현재 대기 주문 전체입니다.' : kind === 'orders' ? '주문 생성 시각 기준 기간입니다. 체결 기준 투자 성과가 아닙니다.' : '완료 시각(없으면 생성 시각) 기준 기간입니다.',
      },
      notice: '통화별 합계는 내역의 단순 합계입니다. 실현손익이나 확정 현금흐름이 아닙니다.',
    };
  }
  async report({ symbols = [], force = false, sections: selected } = {}, context) {
    const portfolio = await this.portfolio({ symbols, force });
    context?.signal?.throwIfAborted();
    // Each section has its own permission boundary. Report unavailable data explicitly.
    const queries = {
      pendingOrders: () => this.getOrders({kind:'pending',limit:30}, context),
      recentOrders: () => this.getOrders({kind:'history',limit:30}, context),
      krwDeposits: () => this.getTransfers({direction:'deposit',assetType:'krw',limit:30}, context),
      cryptoDeposits: () => this.getTransfers({direction:'deposit',assetType:'crypto',limit:30}, context),
      krwWithdrawals: () => this.getTransfers({direction:'withdraw',assetType:'krw',limit:30}, context),
      cryptoWithdrawals: () => this.getTransfers({direction:'withdraw',assetType:'crypto',limit:30}, context),
    };
    const names = selected ?? Object.keys(queries);
    if (!Array.isArray(names) || names.some(name => !Object.hasOwn(queries, name))) throw new KitError('INVALID_QUERY', '보고서 섹션 이름을 확인하세요.', 400);
    const settled = await Promise.allSettled(names.map(name => queries[name]()));
    const sections = Object.fromEntries(names.map((name, i) => [name, settled[i].status === 'fulfilled'
      ? { available: true, result: settled[i].value } : { available: false, error: publicError(settled[i].reason) }]));
    context?.signal?.throwIfAborted();
    return { mode:this.provider.mode, portfolio, sections, scope: portfolio.scope,
      coverage: { allTime:false, realizedProfitAvailable:false, notes:[
        'symbols는 포트폴리오에만 적용됩니다. 주문·입출금 섹션은 계좌 전체의 첫 30건입니다. 자산별 내역은 account_get_records의 symbols로 조회하세요.',
        '종료 주문은 최근 7일 범위입니다. 더 오래된 내역은 기간을 지정해 조회하세요.',
        '평가손익은 현재 보유분 기준입니다. 전체 기간 실현손익·세금·스테이킹/대여 상품은 제공하지 않습니다.',
      ] },
    };
  }
}
