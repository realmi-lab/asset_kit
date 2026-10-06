import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dec } from './decimal.js';
import { KitError } from './errors.js';
import { dataDir } from './config.js';

const DAY = 86400000;
const BUCKET = 5 * 60000; // one stored point per five minutes
const COMPACT = 30 * 60000; // finished days keep one point per half hour in memory
const decimal = /^\d+(\.\d+)?$/;

export const kstDay = iso => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const lastPerBucket = (records, width) => [...new Map(records.map(r => [Math.floor(Date.parse(r.asOf) / width), r])).values()];

export class HistoryStore {
  #days = new Map(); // file → { size, mtimeMs, records }
  constructor({ directory = dataDir(), accessKey, accountId, mode = 'live' } = {}) {
    const id = mode === 'demo' ? 'demo' : accountId ?? createHash('sha256').update(accessKey ?? process.env.BITHUMB_ACCESS_KEY ?? '').digest('hex').slice(0, 24);
    this.directory = join(directory, mode, id);
    this.mode = mode;
    this.lastBucket = null;
  }
  /** Appends at most one point per five minutes. Per-asset values let filtered boards draw their own trend. */
  async record(portfolio) {
    if (portfolio.mode !== this.mode) throw new KitError('MODE_MISMATCH', '데이터 모드가 일치하지 않습니다.', 400);
    const bucket = Math.floor(Date.parse(portfolio.asOf) / BUCKET);
    if (bucket === this.lastBucket) return false;
    const record = {
      asOf: portfolio.asOf, totalValueKrw: portfolio.summary.totalValueKrw, valuationComplete: portfolio.summary.valuationComplete, mode: this.mode,
      values: Object.fromEntries((portfolio.holdings ?? []).map(h => [h.symbol, h.valueKrw])),
    };
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(join(this.directory, `${portfolio.asOf.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    } catch { throw new KitError('HISTORY_WRITE_FAILED', '자산 조회는 완료됐지만 로컬 추이를 저장하지 못했습니다.'); }
    this.lastBucket = bucket;
    return true;
  }
  async read(days = 30, now = Date.now()) {
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new KitError('INVALID_RANGE', '조회 기간은 1~365일입니다.', 400);
    const dates = Array.from({ length: days + 1 }, (_, i) => new Date(now - (days - i) * DAY).toISOString().slice(0, 10));
    const today = new Date(now).toISOString().slice(0, 10);
    const files = await Promise.all(dates.map(date => this.#readDay(date, date < today)));
    const from = now - days * DAY;
    const records = files.flat().filter(r => { const time = Date.parse(r.asOf); return time >= from && time <= now; });
    return lastPerBucket(records, BUCKET);
  }
  // Day files are append-only, so a cached parse stays valid while size and mtime are unchanged.
  async #readDay(date, finished) {
    const file = join(this.directory, `${date}.jsonl`);
    let info;
    try { info = await stat(file); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new KitError('HISTORY_READ_FAILED', '로컬 자산 추이를 읽지 못했습니다.');
    }
    const cached = this.#days.get(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.records;
    let text;
    try { text = await readFile(file, 'utf8'); } catch { throw new KitError('HISTORY_READ_FAILED', '로컬 자산 추이를 읽지 못했습니다.'); }
    const parsed = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.mode !== this.mode || !decimal.test(record.totalValueKrw) || Number.isNaN(Date.parse(record.asOf))) continue;
      parsed.push({ asOf: record.asOf, totalValueKrw: record.totalValueKrw, valuationComplete: record.valuationComplete === true, values: record.values ?? null });
    }
    parsed.sort((a, b) => a.asOf.localeCompare(b.asOf));
    const records = finished ? lastPerBucket(parsed, COMPACT) : lastPerBucket(parsed, BUCKET);
    this.#days.set(file, { size: info.size, mtimeMs: info.mtimeMs, records });
    return records;
  }
}

/** Total for a symbol filter. Points recorded before per-asset values existed cannot be split and stay unknown. */
export function pointFor(record, symbols = []) {
  if (!symbols.length) return { asOf: record.asOf, totalValueKrw: record.totalValueKrw, valuationComplete: record.valuationComplete };
  if (!record.values) return { asOf: record.asOf, totalValueKrw: null, valuationComplete: false };
  let total = dec(0), complete = true;
  for (const symbol of symbols) {
    const value = record.values[symbol];
    if (value === undefined) continue; // not held at that time
    if (value === null) complete = false; else total = total.plus(value);
  }
  return { asOf: record.asOf, totalValueKrw: complete ? total.toFixed() : null, valuationComplete: complete };
}

/** Keeps the last point of each equal-width time bucket so long ranges stay small while ending on the latest value. */
export function downsample(points, max = 400) {
  if (points.length <= max) return points;
  const start = Date.parse(points[0].asOf), width = Math.max(1, (Date.parse(points.at(-1).asOf) - start) / max);
  return [...new Map(points.map(p => [Math.min(max - 1, Math.floor((Date.parse(p.asOf) - start) / width)), p])).values()];
}

/** Last complete value of each Korean calendar day and its change from the previous recorded day (deposits and withdrawals included). */
export function dailyCloses(points) {
  const byDay = new Map();
  for (const p of points) if (p.valuationComplete && p.totalValueKrw !== null) byDay.set(kstDay(p.asOf), p);
  let previous = null;
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, p]) => {
    const close = dec(p.totalValueKrw);
    const row = {
      day, asOf: p.asOf, closeKrw: close.toFixed(),
      changeKrw: previous === null ? null : close.minus(previous).toFixed(),
      changePct: previous === null || previous.isZero() ? null : close.minus(previous).times(100).div(previous, 4).toFixed(4),
    };
    previous = close;
    return row;
  });
}
