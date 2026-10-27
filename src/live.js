// 빗썸 공개 웹소켓(현재가)을 구독자들에게 나눠 줍니다. API 키를 쓰지 않는 공개 시세만 다룹니다.
// 웹소켓이 계속 실패하면 REST 현재가를 몇 초마다 읽고, 데모 모드에서는 합성 시세를 흘려보냅니다.
import { randomUUID } from 'node:crypto';

export const LIVE_URL = 'wss://ws-api.bithumb.com/websocket/v1';
const MARKET = /^(KRW|BTC)-[A-Z0-9_]+$/;
const FLUSH_MS = 1000, PING_MS = 50000, POLL_MS = 3000, BACKOFF = [1000, 2000, 5000, 10000, 30000];

/** One ticker message (REST or WebSocket DEFAULT format) in the shape calculatePortfolio expects. */
export function tickerFrom(message) {
  const market = message?.code ?? message?.market;
  if (!MARKET.test(market ?? '') || !(Number(message.trade_price) > 0)) return null;
  const pick = key => message[key] === undefined || message[key] === null ? undefined : message[key];
  return Object.fromEntries(Object.entries({
    market, trade_price: message.trade_price, signed_change_rate: pick('signed_change_rate'), timestamp: Number(message.timestamp ?? message.trade_timestamp ?? Date.now()),
    high_price: pick('high_price'), low_price: pick('low_price'), acc_trade_price_24h: pick('acc_trade_price_24h'), market_warning: pick('market_warning'),
  }).filter(([, value]) => value !== undefined));
}

/** Decodes one WebSocket frame: Bithumb sends UTF-8 JSON as binary frames, and {"status":"UP"} for PING. */
export function parseFrame(data) {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  try { return JSON.parse(text); } catch { return null; }
}

export class LiveFeed {
  #counts = new Map(); #listeners = new Set(); #socket = null; #timers = {}; #failures = 0; #dirty = new Set(); #key = '';
  quotes = new Map();
  status = 'off';
  /**
   * @param {object} options
   * @param {() => Promise<object[]>} [options.poll] REST fallback: tickers for the given markets.
   * @param {boolean} [options.demo] synthetic ticks around the demo prices instead of a connection.
   */
  constructor({ url = LIVE_URL, WebSocketImpl = globalThis.WebSocket, poll, demo = false } = {}) {
    Object.assign(this, { url, WebSocketImpl, poll, demo });
  }
  get markets() { return [...this.#counts.keys()].sort(); }
  /**
   * Adds markets for one listener. `onChange` receives the listener's own markets that changed, at most once a second;
   * `onStatus` receives every status change (off, connecting, live, polling).
   */
  subscribe(markets, onChange, onStatus) {
    const wanted = [...new Set(markets.filter(market => MARKET.test(market)))], entry = { markets: new Set(wanted), onChange, onStatus };
    for (const market of wanted) this.#counts.set(market, (this.#counts.get(market) ?? 0) + 1);
    this.#listeners.add(entry);
    this.#reconcile();
    // A new listener gets what is already known without waiting for the next trade.
    const known = new Set(wanted.filter(market => this.quotes.has(market)));
    if (known.size) queueMicrotask(() => this.#listeners.has(entry) && onChange(known));
    return () => {
      if (!this.#listeners.delete(entry)) return;
      for (const market of wanted) {
        const count = (this.#counts.get(market) ?? 1) - 1;
        if (count > 0) this.#counts.set(market, count);
        // Nobody follows the market any more: drop its quote so a later subscriber never gets an old price as a new tick.
        else { this.#counts.delete(market); this.quotes.delete(market); this.#dirty.delete(market); }
      }
      this.#reconcile();
    };
  }
  close() { this.#listeners.clear(); this.#counts.clear(); this.quotes.clear(); this.#dirty.clear(); this.#reconcile(); }
  #setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    for (const { onStatus } of this.#listeners) { try { onStatus?.(status); } catch { /* a failing listener must not stop the feed */ } }
  }
  // Opens, re-subscribes or closes the upstream whenever the market set changes.
  #reconcile() {
    const key = this.markets.join(',');
    if (key === this.#key) return;
    const resubscribing = this.status === 'live';
    this.#key = key;
    this.#stop();
    if (!key) { this.#failures = 0; this.#setStatus('off'); return; }
    if (this.demo) { this.#simulate(); return; }
    if (this.#failures >= 3) this.#startPolling();
    this.#connect(resubscribing);
  }
  #stop() {
    for (const name of Object.keys(this.#timers)) { clearTimeout(this.#timers[name]); clearInterval(this.#timers[name]); delete this.#timers[name]; }
    const socket = this.#socket;
    this.#socket = null;
    if (socket) { socket.onclose = socket.onerror = socket.onmessage = socket.onopen = null; try { socket.close(); } catch { /* already closed */ } }
  }
  #timer(name, fn, ms, repeat = false) {
    clearTimeout(this.#timers[name]); clearInterval(this.#timers[name]);
    const id = repeat ? setInterval(fn, ms) : setTimeout(fn, ms);
    id.unref?.();
    this.#timers[name] = id;
  }
  #accept(ticker) {
    if (!ticker || !this.#counts.has(ticker.market)) return;
    this.quotes.set(ticker.market, ticker);
    this.#dirty.add(ticker.market);
    if (!this.#timers.flush) this.#timer('flush', () => this.#flush(), FLUSH_MS);
  }
  #flush() {
    delete this.#timers.flush;
    const changed = new Set(this.#dirty);
    this.#dirty.clear();
    if (!changed.size) return;
    for (const { markets, onChange } of this.#listeners) {
      const mine = new Set([...changed].filter(market => markets.has(market)));
      if (mine.size) { try { onChange(mine); } catch { /* a failing listener must not stop the feed */ } }
    }
  }
  /** @param {boolean} [keepStatus] a live stream that only changes its markets stays 'live' while it reconnects. */
  #connect(keepStatus = false) {
    if (typeof this.WebSocketImpl !== 'function') { this.#startPolling(); return; }
    // While REST polling carries the prices, the status stays 'polling' until the stream delivers again.
    if (!keepStatus && !this.#timers.poll) this.#setStatus('connecting');
    const key = this.#key, socket = new this.WebSocketImpl(this.url);
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      socket.send(JSON.stringify([{ ticket: randomUUID() }, { type: 'ticker', codes: key.split(',') }, { format: 'DEFAULT' }]));
      // The server closes a connection after about 120 seconds without traffic; a text PING keeps it open.
      this.#timer('ping', () => { try { socket.send('PING'); } catch { /* reconnect handles it */ } }, PING_MS, true);
    };
    socket.onmessage = ({ data }) => {
      const message = parseFrame(data);
      if (message?.type !== 'ticker') return;
      if (this.status !== 'live' || this.#failures) { this.#failures = 0; this.#stopPolling(); this.#setStatus('live'); }
      this.#accept(tickerFrom(message));
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      clearInterval(this.#timers.ping); delete this.#timers.ping;
      this.#failures++;
      // After a few failures keep prices moving through REST while retrying the stream in the background.
      if (this.#failures >= 3) this.#startPolling();
      else this.#setStatus('connecting');
      this.#timer('retry', () => this.#key === key && this.#connect(), BACKOFF[Math.min(this.#failures - 1, BACKOFF.length - 1)]);
    };
  }
  #startPolling() {
    if (!this.poll) { this.#setStatus('connecting'); return; }
    this.#setStatus('polling');
    if (this.#timers.poll) return;
    const run = async () => {
      try { for (const ticker of await this.poll(this.markets)) this.#accept(tickerFrom(ticker)); } catch { /* next round retries */ }
    };
    void run();
    this.#timer('poll', run, POLL_MS, true);
  }
  #stopPolling() { clearInterval(this.#timers.poll); delete this.#timers.poll; }
  // Demo: a small bounded random walk around the synthetic prices, labelled as demo by the caller.
  #simulate() {
    this.#setStatus('live');
    const base = new Map();
    const tick = async () => {
      if (!base.size && this.poll) for (const ticker of await this.poll(this.markets).catch(() => [])) base.set(ticker.market, ticker);
      for (const market of this.markets) {
        const origin = base.get(market);
        if (!origin) continue;
        const previous = Number(this.quotes.get(market)?.trade_price ?? origin.trade_price), price0 = Number(origin.trade_price);
        const next = Math.min(price0 * 1.03, Math.max(price0 * 0.97, previous * (1 + (Math.random() - 0.5) * 0.004)));
        const price = next >= 100 ? Math.round(next) : Number(next.toFixed(2));
        const rate = origin.signed_change_rate === undefined ? undefined : (1 + Number(origin.signed_change_rate)) * price / price0 - 1;
        this.#accept(tickerFrom({ ...origin, trade_price: price, ...(rate === undefined ? {} : { signed_change_rate: Number(rate.toFixed(6)) }), timestamp: Date.now() }));
      }
    };
    void tick();
    this.#timer('demo', tick, 1500, true);
  }
}
