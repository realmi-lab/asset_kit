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
const validAmount = value => typeof value === 'string' && decimal.test(value);

export const kstDay = iso => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const lastPerBucket = (records, width) => {
  const sampled = [...new Map(records.map(r => [Math.floor(Date.parse(r.asOf) / width), r])).values()];
  // The first observed value is the range baseline, even when its bucket has a later point.
  if (records.length && sampled[0] !== records[0]) sampled.unshift(records[0]);
  return sampled;
};

export class HistoryStore {
  #days = new Map(); // file → { size, mtimeMs, records }
  #reading = new Map();
  #writing = Promise.resolve();
  constructor({ directory = dataDir(), accessKey, accountId, mode = 'live' } = {}) {
    const id = mode === 'demo' ? 'demo' : accountId ?? createHash('sha256').update(accessKey ?? process.env.BITHUMB_ACCESS_KEY ?? '').digest('hex').slice(0, 24);
    this.directory = join(directory, mode, id);
    this.mode = mode;
    this.lastBucket = null;
  }
  /** Appends at most one point per five minutes. Per-asset values let filtered boards draw their own trend. */
  record(portfolio) {
    const run = this.#writing.then(() => this.#record(portfolio));
    this.#writing = run.catch(() => {});
    return run;
  }
  async #record(portfolio) {
    if (portfolio.mode !== this.mode) throw new KitError('MODE_MISMATCH', '데이터 모드가 일치하지 않습니다.', 400);
    if (typeof portfolio.asOf !== 'string' || !Number.isFinite(Date.parse(portfolio.asOf)) || !validAmount(portfolio.summary?.totalValueKrw)) {
      throw new KitError('INVALID_HISTORY', '저장할 자산 추이의 시각 또는 평가금액이 올바르지 않습니다.', 400);
    }
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
    await this.#writing;
    const dates = Array.from({ length: days + 1 }, (_, i) => new Date(now - (days - i) * DAY).toISOString().slice(0, 10));
    const today = new Date(now).toISOString().slice(0, 10);
    const from = now - days * DAY;
    // Apply the cutoff before compressing its day; otherwise an in-bucket first value is unrecoverable.
    const files = await Promise.all(dates.map((date, index) => this.#readDay(date, date < today, index === 0 ? from : 0)));
    const records = files.flat().filter(r => { const time = Date.parse(r.asOf); return time >= from && time <= now; });
    return lastPerBucket(records, BUCKET);
  }
  // Day files are append-only, so a cached parse stays valid while size and mtime are unchanged.
  async #readDay(date, finished, from) {
    const key = `${date}:${finished}:${from}`;
    if (!this.#reading.has(key)) this.#reading.set(key, this.#loadDay(date, finished, from).finally(() => this.#reading.delete(key)));
    return this.#reading.get(key);
  }
  async #loadDay(date, finished, from) {
    const file = join(this.directory, `${date}.jsonl`);
    let info;
    try { info = await stat(file); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new KitError('HISTORY_READ_FAILED', '로컬 자산 추이를 읽지 못했습니다.');
    }
    const cached = this.#days.get(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.finished === finished && cached.from === from) return cached.records;
    let text;
    try { text = await readFile(file, 'utf8'); } catch { throw new KitError('HISTORY_READ_FAILED', '로컬 자산 추이를 읽지 못했습니다.'); }
    const parsed = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!record || record.mode !== this.mode || !validAmount(record.totalValueKrw) || typeof record.asOf !== 'string' || Number.isNaN(Date.parse(record.asOf))) continue;
      if (Date.parse(record.asOf) < from) continue;
      const values = record.values && typeof record.values === 'object' && !Array.isArray(record.values)
        ? Object.fromEntries(Object.entries(record.values).map(([symbol, value]) => [symbol, validAmount(value) ? value : null])) : null;
      parsed.push({ asOf: new Date(record.asOf).toISOString(), totalValueKrw: record.totalValueKrw, valuationComplete: record.valuationComplete === true, values });
    }
    parsed.sort((a, b) => a.asOf.localeCompare(b.asOf));
    const records = finished ? lastPerBucket(parsed, COMPACT) : lastPerBucket(parsed, BUCKET);
    this.#days.set(file, { size: info.size, mtimeMs: info.mtimeMs, finished, from, records });
    if (this.#days.size > 400) this.#days.delete(this.#days.keys().next().value);
    return records;
  }
}

/** Total for a symbol filter. Points recorded before per-asset values existed cannot be split and stay unknown. */
export function pointFor(record, symbols = []) {
  if (!symbols.length) return { asOf: record.asOf, totalValueKrw: record.totalValueKrw, valuationComplete: record.valuationComplete };
  if (!record.values || typeof record.values !== 'object' || Array.isArray(record.values)) return { asOf: record.asOf, totalValueKrw: null, valuationComplete: false };
  let total = dec(0), complete = true;
  for (const symbol of symbols) {
    const value = record.values[symbol];
    if (value === undefined) continue; // not held at that time
    if (!validAmount(value)) complete = false; else total = total.plus(value);
  }
  return { asOf: record.asOf, totalValueKrw: complete ? total.toFixed() : null, valuationComplete: complete };
}

/** Keeps both range endpoints and the last interior point of each time bucket, up to max points. */
export function downsample(points, max = 400) {
  if (!Number.isInteger(max) || max < 2) throw new RangeError('At least two history points must be retained.');
  if (points.length <= max) return points;
  const first = points[0], last = points.at(-1), buckets = max - 2;
  if (!buckets) return [first, last];
  const start = Date.parse(first.asOf), width = Math.max(1, (Date.parse(last.asOf) - start) / buckets);
  const interior = [...new Map(points.slice(1, -1).map(p => [Math.min(buckets - 1, Math.floor((Date.parse(p.asOf) - start) / width)), p])).values()];
  return [first, ...interior, last];
}

/** Last complete value of each Korean calendar day and its change from the previous recorded day (deposits and withdrawals included). */
export function dailyCloses(points) {
  const byDay = new Map();
  for (const p of points) if (p.valuationComplete && p.totalValueKrw !== null) byDay.set(kstDay(p.asOf), p);
  let previous = null, previousDay = null;
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, p]) => {
    const close = dec(p.totalValueKrw);
    const row = {
      day, asOf: p.asOf, closeKrw: close.toFixed(),
      previousDay, gapDays: previousDay === null ? null : Math.round((Date.parse(day) - Date.parse(previousDay)) / DAY),
      changeKrw: previous === null ? null : close.minus(previous).toFixed(),
      changePct: previous === null || previous.isZero() ? null : close.minus(previous).times(100).div(previous, 4).toFixed(4),
    };
    previous = close;
    previousDay = day;
    return row;
  });
}
