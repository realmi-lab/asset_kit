import { dec } from './decimal.js';
import { calculatePortfolio, explainPortfolio, projectPortfolio } from './portfolio.js';
import { BithumbProvider } from './bithumb.js';
import { DemoProvider, demoHistory } from './demo.js';
import { HistoryStore, dailyCloses, downsample, kstDay, pointFor } from './history.js';
import { BoardStore } from './boards.js';
import { KitError, publicError } from './errors.js';
import { RECORD_KINDS, normalizeOrders, normalizeTransfers, recordRange } from './activity.js';
import { dataDir } from './config.js';

const DAY = 86400000, WEEK = 7 * DAY;
const SYMBOL = /^[A-Z0-9][A-Z0-9_]{0,29}$/;
const iso = value => { const time = Date.parse(value); return Number.isNaN(time) ? null : new Date(time).toISOString(); };

/** Accepts `BTC,ETH` or ['BTC','ETH']; an empty list means the whole account. */
export function parseSymbols(input = []) {
  const list = Array.isArray(input) ? input : String(input).split(',');
  const symbols = [...new Set(list.map(value => String(value).trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 100 || symbols.some(value => !SYMBOL.test(value))) throw new KitError('INVALID_SYMBOLS', '자산 심볼은 BTC,ETH처럼 쉼표로 구분합니다.', 400);
  return symbols;
}

export class PortfolioService {
  #pending; #cached; #records = new Map(); #recordCache = new Map(); #markets = new Map(); #marketPending = new Map();
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
    // Every live read (dashboard, CLI, MCP) adds at most one local history point per five minutes.
    if (this.provider.mode !== 'demo') {
      try { await this.history.record(portfolio); this.historyError = null; } catch (error) { this.historyError = publicError(error); }
    }
    return portfolio;
  }
  async explain({ symbols = [] } = {}) {
    return explainPortfolio(await this.portfolio({ symbols }));
  }
  async getHistory({ days = 30, symbols = [], daily = false } = {}) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new KitError('INVALID_RANGE', '조회 기간은 1~365일입니다.', 400);
    const scope = parseSymbols(symbols), span = daily ? days + 1 : days; // one extra day gives the first day's change
    let points;
    if (this.provider.mode === 'demo') {
      const full = await this.#portfolio(), total = dec(full.summary.totalValueKrw), part = projectPortfolio(full, scope).summary.totalValueKrw;
      points = demoHistory(span, Date.now(), total.toNumber()).map(p => ({ asOf: p.asOf, totalValueKrw: total.isZero() ? '0' : dec(p.totalValueKrw).times(part).div(total, 0).toFixed(0), valuationComplete: true }));
    } else {
      points = (await this.history.read(span)).map(record => pointFor(record, scope));
    }
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
  /** KRW market price and daily closes for one asset. Public market data; works without keys. */
  async getMarket({ symbol = 'BTC', days = 30, force = false } = {}) {
    const code = String(symbol).trim().toUpperCase();
    if (!SYMBOL.test(code) || code === 'KRW' || !Number.isInteger(days) || days < 1 || days > 200) {
      throw new KitError('INVALID_MARKET', '자산 심볼과 1~200일 범위를 확인하세요.', 400);
    }
    const market = `KRW-${code}`, key = `${market}:${days}`, cached = this.#markets.get(key);
    if (this.#marketPending.has(key)) return this.#marketPending.get(key);
    if (!force && cached && Date.now() - cached.at < 60000) return cached.data;
    const pending = this.#loadMarket(code, market, days).then(data => {
      this.#markets.delete(key);
      this.#markets.set(key, { at: Date.now(), data });
      if (this.#markets.size > 100) this.#markets.delete(this.#markets.keys().next().value);
      return data;
    }).finally(() => this.#marketPending.delete(key));
    this.#marketPending.set(key, pending);
    return pending;
  }
  async #loadMarket(code, market, days) {
    const listing = (await this.provider.getMarkets()).find(m => m.market === market);
    if (!listing) throw new KitError('NO_KRW_MARKET', '빗썸 원화 마켓에 없는 자산입니다.', 404);
    const [tickers, candles] = await Promise.all([this.provider.getTickers([market]), this.provider.getCandles(market, days)]);
    const ticker = tickers.find(t => t.market === market);
    const data = {
      mode: this.provider.mode, symbol: code, name: listing.korean_name, market, asOf: new Date().toISOString(),
      priceKrw: ticker ? dec(ticker.trade_price).toFixed() : null,
      changePct: ticker?.signed_change_rate === undefined ? null : dec(ticker.signed_change_rate).times(100).toFixed(4),
      candles: candles.map(c => ({ date: (c.candle_date_time_kst ?? c.candle_date_time_utc).slice(0, 10), closeKrw: dec(c.trade_price).toFixed() })),
      note: '빗썸 원화 마켓 일봉 종가입니다. 시세이며 내 자산의 과거 평가금액이 아닙니다.',
    };
    return data;
  }
  async getOrders(input = {}) {
    const options = normalizeOrders(input);
    const result = await this.provider.getOrders(options);
    return { mode: this.provider.mode, asOf: new Date().toISOString(), query: options, ...result,
      coverage: { scope: options.kind==='history'?'지정한 최대 7일 기간의 주문 한 페이지':'대기 주문 한 페이지', completePageSet: !result.has_next, allTime: false },
    };
  }
  async getTransfers(input = {}) {
    const options = normalizeTransfers(input);
    const data = await this.provider.getTransfers(options);
    return { mode: this.provider.mode, asOf: new Date().toISOString(), query: options, data,
      pagination: { page: options.page, limit: options.limit, mayHaveMore: data.length === options.limit, nextPage: data.length === options.limit ? options.page+1 : null },
      coverage: { scope: '조회 조건에 해당하는 입출금 한 페이지', allTime: false },
    };
  }
  /** Every page of one record kind within a period (up to maxPages). Identical concurrent requests share one run. */
  async getRecords({ kind = 'orders', from, to, force = false } = {}) {
    const spec = Object.hasOwn(RECORD_KINDS, kind) ? RECORD_KINDS[kind] : null;
    if (!spec) throw new KitError('INVALID_KIND', `내역 종류는 ${Object.keys(RECORD_KINDS).join(', ')} 중 하나입니다.`, 400);
    const period = kind === 'pending' ? null : recordRange(from, to);
    // Omitted bounds mean a rolling interval. Reuse its original period and asOf for the short cache lifetime.
    const key = JSON.stringify([kind, from ? period?.start : null, to ? period?.end : null]);
    if (this.#records.has(key)) return this.#records.get(key);
    const cached = this.#recordCache.get(key);
    if (!force && cached && Date.now() - cached.at < 30000) return cached.data;
    this.#records.set(key, this.#collectRecords(kind, spec, period).then(data => {
      this.#recordCache.delete(key);
      this.#recordCache.set(key, { at: Date.now(), data });
      // A result may contain thousands of rows: bound retained ranges independently of small price caches.
      if (this.#recordCache.size > 8) this.#recordCache.delete(this.#recordCache.keys().next().value);
      return data;
    }).finally(() => this.#records.delete(key)));
    return this.#records.get(key);
  }
  async #collectRecords(kind, spec, period) {
    const rows = new Map();
    let pages = 0, complete = true;
    const page = async load => {
      if (pages >= this.maxPages) { complete = false; return null; }
      pages++;
      return load();
    };
    const orderPages = async base => {
      const seen = new Set();
      for (let nextKey; ;) {
        const result = await page(() => this.provider.getOrders(normalizeOrders({ ...base, limit: 100, ...(nextKey ? { nextKey } : {}) })));
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
        complete, pages, maxPages: this.maxPages,
        note: kind === 'pending' ? '현재 대기 주문 전체입니다.' : kind === 'orders' ? '주문 생성 시각 기준 기간입니다. 체결 기준 투자 성과가 아닙니다.' : '완료 시각(없으면 생성 시각) 기준 기간입니다.',
      },
      notice: '통화별 합계는 내역의 단순 합계입니다. 실현손익이나 확정 현금흐름이 아닙니다.',
    };
  }
  async report() {
    const portfolio = await this.portfolio();
    // Each section has its own permission boundary. Report unavailable data explicitly.
    const queries = {
      pendingOrders: () => this.getOrders({kind:'pending',limit:30}),
      recentOrders: () => this.getOrders({kind:'history',limit:30}),
      krwDeposits: () => this.getTransfers({direction:'deposit',assetType:'krw',limit:30}),
      cryptoDeposits: () => this.getTransfers({direction:'deposit',assetType:'crypto',limit:30}),
      krwWithdrawals: () => this.getTransfers({direction:'withdraw',assetType:'krw',limit:30}),
      cryptoWithdrawals: () => this.getTransfers({direction:'withdraw',assetType:'crypto',limit:30}),
    };
    const names = Object.keys(queries);
    const settled = await Promise.allSettled(names.map(name => queries[name]()));
    const sections = Object.fromEntries(names.map((name, i) => [name, settled[i].status === 'fulfilled'
      ? { available: true, result: settled[i].value } : { available: false, error: publicError(settled[i].reason) }]));
    return { mode:this.provider.mode, portfolio, sections,
      coverage: { allTime:false, realizedProfitAvailable:false, notes:[
        '주문·입출금은 섹션별 첫 30건입니다. 기간 전체는 records 명령 또는 account_get_records 도구로 조회하세요.',
        '종료 주문은 최근 7일 범위입니다. 더 오래된 내역은 기간을 지정해 조회하세요.',
        '평가손익은 현재 보유분 기준입니다. 전체 기간 실현손익·세금·스테이킹/대여 상품은 제공하지 않습니다.',
      ] },
    };
  }
}
