import { randomUUID } from 'node:crypto';
import { KitError } from '../src/errors.js';
import { ORDER_PAGE_SIZE, RECORD_KINDS, recordRange, normalizeOrders, normalizeTransfers } from '../src/activity.js';
import { parseSymbols } from '../src/service.js';
import { abortable } from '../src/async.js';
import { recordTotals } from './query.js';

const WEEK = 7 * 86400000, TTL = 10 * 60000;
const error = (code, message) => new KitError(code, message, 400);
const at = row => {
  const time = Date.parse(row.done_at ?? row.created_at);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** Opaque, process-local continuation tokens: no account data or provider cursors in the token.
 * Each successful cursor is replayable. Failed/cancelled reads never advance its checkpoint.
 * Session expiry is fixed, so a changing account cannot be presented as an atomic snapshot.
 */
export class RecordReader {
  #tokens = new Map(); #cache = new Map(); #starts = new Map();
  constructor(service, { clock = Date.now } = {}) { this.service = service; this.clock = clock; }
  clear() {
    for (const job of this.#starts.values()) job.controller.abort();
    this.#starts.clear(); this.#tokens.clear(); this.#cache.clear();
  }
  async read(args, { signal, onProgress = () => {} } = {}) {
    signal?.throwIfAborted();
    if (args.cursor) return this.#read(args, { signal, onProgress });
    const key = JSON.stringify([args.kind, args.from, args.to, parseSymbols(args.symbols).sort(), [...new Set(args.states ?? [])].sort(), args.side, args.pageSize ?? 50, args.scanPages ?? 5, Boolean(args.force)]);
    let job = this.#starts.get(key);
    if (!job || job.controller.signal.aborted) {
      job = { controller: new AbortController(), listeners: new Set(), users: 0, settled: false };
      const current = job;
      this.#starts.set(key, job);
      job.promise = Promise.resolve().then(() => this.#read(args, { signal: current.controller.signal, onProgress: value => {
        for (const listener of current.listeners) listener(value);
      } })).finally(() => {
        current.settled = true;
        if (this.#starts.get(key) === current) this.#starts.delete(key);
      });
    }
    const listener = value => { if (!signal?.aborted) onProgress(value); };
    job.users++; job.listeners.add(listener);
    try { return structuredClone(await abortable(job.promise, signal)); }
    finally {
      job.listeners.delete(listener); job.users--;
      // One cancelled client must not stop the provider while another client still needs the result.
      if (!job.users && !job.settled) job.controller.abort();
    }
  }
  async #read(args, { signal, onProgress = () => {} } = {}) {
    signal?.throwIfAborted();
    const now = this.clock();
    for (const [key, entry] of this.#tokens) if (entry.expiresAt <= now && !entry.busy) this.#tokens.delete(key);
    for (const [key, entry] of this.#cache) if (now - entry.at >= 30000 || (entry.result.pagination.nextCursor && !this.#tokens.has(entry.result.pagination.nextCursor))) this.#cache.delete(key);
    let entry, key;
    if (args.cursor) {
      entry = this.#tokens.get(args.cursor);
      if (!entry || entry.expiresAt <= now) throw error('CURSOR_EXPIRED', 'cursor가 만료되었거나 이 MCP 연결에서 만든 값이 아닙니다. cursor를 빼고 다시 조회하세요.');
      if (args.force) throw error('CURSOR_QUERY_MISMATCH', '이어받기에는 force를 사용할 수 없습니다. 새 조회는 cursor를 빼고 force=true로 시작하세요.');
      // Absent properties inherit the original query. Present filters must match it exactly.
      for (const name of ['kind', 'from', 'to', 'side', 'pageSize', 'scanPages']) {
        if (args[name] !== undefined && args[name] !== entry.state.query[name]) throw error('CURSOR_QUERY_MISMATCH', '이어받는 동안 조회 조건을 바꿀 수 없습니다. cursor를 빼고 새 조회를 시작하세요.');
      }
      for (const name of ['symbols', 'states']) {
        const values = name === 'symbols' ? parseSymbols(args[name]) : args[name];
        if (args[name] !== undefined && JSON.stringify([...values].sort()) !== JSON.stringify(entry.state.query[name])) throw error('CURSOR_QUERY_MISMATCH', '이어받는 동안 자산·상태 필터를 바꿀 수 없습니다.');
      }
      if (entry.result) return structuredClone(entry.result);
      if (entry.busy) throw error('CURSOR_BUSY', '같은 cursor를 이미 조회 중입니다.');
    } else {
      const kind = args.kind;
      if (!Object.hasOwn(RECORD_KINDS, kind)) throw error('INVALID_KIND', '조회할 내역 종류를 지정하세요.');
      if (kind === 'pending' && (args.from || args.to)) throw error('INVALID_QUERY', '대기 주문에는 기간을 지정할 수 없습니다.');
      if (!['orders', 'pending'].includes(kind) && args.side) throw error('INVALID_QUERY', '매수·매도 필터는 주문 내역에서만 사용할 수 있습니다.');
      const query = { kind, from: args.from, to: args.to, side: args.side,
        symbols: parseSymbols(args.symbols).sort(), states: [...new Set(args.states ?? [])].sort(), pageSize: args.pageSize ?? 50, scanPages: args.scanPages ?? 5 };
      key = JSON.stringify(query);
      const cached = this.#cache.get(key);
      if (!args.force && cached) return structuredClone(cached.result);
      const period = kind === 'pending' ? null : recordRange(query.from, query.to, now);
      entry = { expiresAt: now + TTL, state: { query, period, end: period?.end, nextKey: null, transferPage: 1,
        buffer: [], seen: [], seenKeys: [], done: false, pages: 0, unknownTimes: 0, startedAt: new Date(now).toISOString() } };
    }
    const state = structuredClone(entry.state), rows = [], order = ['orders', 'pending'].includes(state.query.kind);
    const seen = new Set(state.seen), { query, period } = state;
    entry.busy = true;
    let pages = 0;
    try {
      while (rows.length < query.pageSize) {
        signal?.throwIfAborted();
        rows.push(...state.buffer.splice(0, query.pageSize - rows.length));
        if (rows.length >= query.pageSize || state.done || pages >= query.scanPages) break;
        if (state.pages >= 1000 || seen.size >= 10000) throw error('QUERY_LIMIT', '한 조회의 최대 1,000페이지 또는 10,000건에 도달했습니다. 날짜 구간을 나누어 다시 조회하세요.');
        let raw;
        if (order) {
          const start = period ? Math.max(period.start, state.end - WEEK + 1) : undefined;
          const options = normalizeOrders({ kind: query.kind === 'pending' ? 'pending' : 'history', limit: ORDER_PAGE_SIZE[query.kind === 'pending' ? 'pending' : 'history'],
            ...(period ? { fromMs: start, toMs: state.end } : {}), ...(state.nextKey ? { nextKey: state.nextKey } : {}) });
          const result = await abortable(this.service.provider.getOrders(options, { signal }), signal);
          raw = result.data;
          if (result.has_next) {
            if (!result.next_key || state.seenKeys.includes(result.next_key)) throw error('INVALID_CURSOR', '거래소가 반복되거나 비어 있는 페이지 키를 반환했습니다. 새 조회를 시작하세요.');
            state.seenKeys.push(result.next_key); state.nextKey = result.next_key;
          } else {
            state.nextKey = null; state.seenKeys = [];
            if (!period || start <= period.start) state.done = true;
            else state.end = start - 1;
          }
        } else {
          const spec = RECORD_KINDS[query.kind];
          raw = await abortable(this.service.provider.getTransfers(normalizeTransfers({ direction: spec.direction, assetType: spec.assetType, page: state.transferPage, limit: 100 }), { signal }), signal);
          state.transferPage++;
          state.done = raw.length < 100;
        }
        signal?.throwIfAborted();
        pages++; state.pages++;
        for (const item of raw) {
          const id = order ? item.order_id : item.uuid, row = { ...item, at: at(item) };
          const symbol = order ? row.market.split('-')[1] : row.currency;
          if (query.symbols.length && !query.symbols.includes(symbol)) continue;
          if (query.states.length && !query.states.includes(row.state)) continue;
          if (query.side && row.side !== query.side) continue;
          if (period) {
            if (!row.at) { state.unknownTimes++; continue; }
            if (Date.parse(row.at) < period.start || Date.parse(row.at) > period.end) continue;
          }
          if (seen.has(id)) continue;
          if (seen.size >= 10000) throw error('QUERY_LIMIT', '조회 결과가 10,000건을 넘습니다. 날짜 구간을 나누어 다시 조회하세요.');
          seen.add(id); state.buffer.push(row);
        }
        onProgress({ pages, message: `거래소 ${pages}페이지 조회 · 이번 응답 ${Math.min(query.pageSize, rows.length + state.buffer.length)}건 준비` });
      }
      signal?.throwIfAborted();
      state.seen = [...seen];
      const more = !state.done || state.buffer.length > 0;
      if (more && this.clock() >= entry.expiresAt) throw error('CURSOR_EXPIRED', '조회 중 이어받기 유효 시간이 끝났습니다. 날짜 구간을 줄여 새로 시작하세요.');
      const nextCursor = more ? randomUUID() : null;
      const result = { mode: this.service.provider.mode, kind: query.kind, label: RECORD_KINDS[query.kind].label,
        asOf: new Date(this.clock()).toISOString(), startedAt: state.startedAt,
        period: period && { from: period.from, to: period.to }, filters: { symbols: query.symbols, states: query.states, side: query.side ?? null },
        rows, totals: recordTotals(rows, order),
        pagination: { nextCursor, pageSize: query.pageSize, returned: rows.length, expiresAt: nextCursor ? new Date(entry.expiresAt).toISOString() : null },
        coverage: { complete: !more && state.unknownTimes === 0, pages, scannedPages: state.pages, scanPages: query.scanPages, unknownTimestampRows: state.unknownTimes, snapshot: false, totalsScope: 'returned_rows', scope: 'cursor_chain',
          note: 'complete는 이어받기 전체의 종료 상태이며 rows·합계는 이번 응답만 포함합니다. rows가 비어 있어도 nextCursor가 있으면 계속 조회하세요. 거래소 내역이 조회 중 바뀔 수 있어 결과는 원자적 스냅샷이 아닙니다.' },
        notice: order ? '주문 생성 시각 기준입니다. totals는 실현손익이 아닙니다.' : '완료 시각(없으면 생성 시각) 기준입니다. 완료 시각순 정렬은 보장하지 않습니다.' };
      if (nextCursor) {
        // Never evict an active read. A later attempt with an evicted token gets an explicit restart error.
        if (this.#tokens.size >= 32) {
          const oldest = [...this.#tokens].find(([token, value]) => !value.busy && token !== args.cursor);
          if (!oldest) throw error('CURSOR_BUSY', '보관 중인 cursor 32개가 모두 진행 중인 조회에 쓰이고 있습니다. 진행 중인 조회가 끝난 뒤 다시 시도하세요.');
          this.#tokens.delete(oldest[0]);
        }
        this.#tokens.set(nextCursor, { state, expiresAt: entry.expiresAt });
      }
      if (args.cursor) entry.result = result;
      else {
        this.#cache.set(key, { at: this.clock(), result });
        if (this.#cache.size > 8) this.#cache.delete(this.#cache.keys().next().value);
      }
      return structuredClone(result);
    } finally { entry.busy = false; }
  }
}
