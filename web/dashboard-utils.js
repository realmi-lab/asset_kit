const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
const nameOrder = new Intl.Collator('ko', { sensitivity: 'base', numeric: true });
const symbolOrder = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const SORT_FIELDS = { value: 'valueKrw', profit: 'profitRatePct', pnl: 'profitKrw', change: 'priceChangePct' };

// Compare the API's decimal strings without rounding small amounts or large balances to Number.
function decimalParts(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
  if (!match || !(match[2] || match[3])) return null;
  const digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, '');
  if (!digits) return { sign: 0, digits: '', magnitude: 0 };
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  return { sign: match[1] === '-' ? -1 : 1, digits, magnitude: digits.length - (match[3]?.length ?? 0) + exponent };
}

function compareDecimals(left, right) {
  if (left.sign !== right.sign) return left.sign - right.sign;
  if (!left.sign) return 0;
  if (left.magnitude !== right.magnitude) return Math.sign(left.magnitude - right.magnitude) * left.sign;
  const length = Math.max(left.digits.length, right.digits.length);
  const a = left.digits.padEnd(length, '0'), b = right.digits.padEnd(length, '0');
  return (a < b ? -1 : a > b ? 1 : 0) * left.sign;
}

/** Search, filter and sort a new holdings array; missing numeric values always sort last. */
export function filterHoldings(rows, { search = '', excludeCash = false, performance = 'all', sort = 'value', direction = 'desc' } = {}) {
  const term = String(search).trim().toLocaleLowerCase('ko');
  const filtered = rows.filter(row => {
    const cash = row.symbol === 'KRW';
    if (excludeCash && cash) return false;
    if (term && !`${row.symbol ?? ''} ${row.name ?? ''}`.toLocaleLowerCase('ko').includes(term)) return false;
    if (performance === 'all') return true;
    if (cash) return false;
    if (performance === 'unknown') return row.profitKrw === null || row.profitKrw === undefined;
    const profit = decimalParts(row.profitKrw);
    return performance === 'gain' ? profit?.sign === 1 : performance === 'loss' ? profit?.sign === -1 : true;
  });
  const factor = direction === 'asc' ? 1 : -1;
  const field = SORT_FIELDS[sort] ?? SORT_FIELDS.value;
  // Parse each amount once, instead of repeatedly for every comparison during sort.
  return filtered.map(row => ({ row, value: sort === 'name' ? null : decimalParts(row[field]) })).sort((a, b) => {
    const tie = () => symbolOrder.compare(String(a.row.symbol ?? ''), String(b.row.symbol ?? ''));
    if (sort === 'name') return nameOrder.compare(String(a.row.name ?? a.row.symbol ?? ''), String(b.row.name ?? b.row.symbol ?? '')) * factor || tie();
    if (a.value === null || b.value === null) return a.value === null && b.value === null ? tie() : a.value === null ? 1 : -1;
    return compareDecimals(a.value, b.value) * factor || tie();
  }).map(item => item.row);
}

/** Apply board scope and local search to already fetched activity; preserve upstream order. */
export function filterActivity(rows, { symbols = [], search = '', status = 'all', side = 'all' } = {}) {
  const scope = new Set(symbols.map(symbol => String(symbol).toUpperCase()));
  const term = String(search).trim().toLocaleLowerCase('ko');
  return rows.filter(row => {
    const symbol = row.market ? String(row.market).split('-')[1] : row.currency;
    if (scope.size && !scope.has(String(symbol ?? '').toUpperCase())) return false;
    if (status !== 'all' && row.state !== status) return false;
    if (side !== 'all' && row.side !== side) return false;
    return !term || `${symbol ?? ''} ${row.market ?? ''} ${row.state ?? ''}`.toLocaleLowerCase('ko').includes(term);
  });
}

function csvCell(value) {
  let text = String(value ?? '');
  const trimmed = text.trimStart();
  const negativeNumber = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed.trimEnd());
  // Quotes alone do not stop spreadsheet formulas; protect formulas even after whitespace.
  if (/^[\s\uFEFF]*[\t\r\n]/.test(text) || /^[=+@]/.test(trimmed) || (trimmed.startsWith('-') && !negativeNumber)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Excel-friendly UTF-8 BOM, RFC 4180 quoting and CRLF record separators. */
export function csvText(rows) {
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}

/** Inclusive date presets in Korea's calendar, independent of the browser's timezone. */
export function recordDates(preset, now = Date.now()) {
  const current = new Date(Number(now) + KST);
  if (!Number.isFinite(current.getTime())) throw new RangeError('현재 날짜가 올바르지 않습니다.');
  const to = current.toISOString().slice(0, 10);
  if (preset === 'month') return { from: `${to.slice(0, 7)}-01`, to };
  const days = Number(preset);
  if (days !== 7 && days !== 30) throw new RangeError('기간은 7일, 30일, 이번 달 중에서 선택하세요.');
  return { from: new Date(current.getTime() - (days - 1) * DAY).toISOString().slice(0, 10), to };
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

/** Match the API's real-date validation and maximum of 366 inclusive calendar days. */
export function dateRangeError(from, to) {
  const start = calendarDate(from), end = calendarDate(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '시작일과 종료일을 YYYY-MM-DD 형식의 올바른 날짜로 입력하세요.';
  if (start > end) return '시작일은 종료일보다 늦을 수 없습니다.';
  if (end - start >= 366 * DAY) return '한 번에 조회할 수 있는 기간은 최대 366일입니다.';
  return '';
}

// ===== 차트·계산기·알림용 순수 계산 (화면 표시용 Number 계산, 참고용) =====

/** Simple moving average; null until `period` values are available. */
export function movingAverage(values, period) {
  let total = 0;
  return values.map((value, i) => {
    total += value;
    if (i >= period) total -= values[i - period];
    return i >= period - 1 ? total / period : null;
  });
}

/** Position after buying `buyQuantity` more at `buyPrice` (average-cost method, fees excluded). */
export function averageAfterBuy({ quantity, average, buyQuantity, buyPrice }) {
  const q = Number(quantity) || 0, a = Number(average) || 0, b = Math.max(0, Number(buyQuantity) || 0), p = Number(buyPrice) || 0;
  const total = q + b, cost = q * a + b * p;
  return { quantity: total, cost, average: total > 0 ? cost / total : null };
}

/** Quantity to buy at `price` so the average becomes `target`; null when the target cannot be reached by buying. */
export function quantityForTarget({ quantity, average, price, target }) {
  const q = Number(quantity), a = Number(average), p = Number(price), t = Number(target);
  if (!(q > 0) || !(a > 0) || !(p > 0) || !(t > 0)) return null;
  // Buying at p moves the average toward p, so the target must lie strictly between p and the current average.
  if (!((t < a && t > p) || (t > a && t < p))) return null;
  return q * (a - t) / (t - p);
}

/**
 * Trades that bring each asset to its target share of (current total + extra cash).
 * rows: [{ symbol, value, price, target }] with target in percent; KRW rows have price 1.
 */
export function rebalance(rows, extraCash = 0) {
  const total = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0) + (Number(extraCash) || 0);
  const targetSum = rows.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  return {
    total, targetSum,
    rows: rows.map(row => {
      const targetValue = total * (Number(row.target) || 0) / 100, diff = targetValue - (Number(row.value) || 0), price = Number(row.price) || 0;
      return { ...row, targetValue, diff, quantity: price > 0 ? diff / price : null };
    }),
  };
}

/** Portfolio value and P&L if each coin's price moves by its percentage (or by `all` when not set). */
export function scenario(holdings, changes = {}, all = 0) {
  let total = 0, base = 0, cost = 0, costKnown = true;
  const rows = holdings.map(h => {
    const value = Number(h.valueKrw) || 0, cash = h.symbol === 'KRW';
    const pct = cash ? 0 : Number(changes[h.symbol] ?? all) || 0, next = value * (1 + pct / 100);
    total += next; base += value;
    if (!cash) { if (h.costKrw === null || h.costKrw === undefined) costKnown = false; else cost += Number(h.costKrw); }
    return { symbol: h.symbol, name: h.name, pct, value, next, price: Number(h.currentPriceKrw) * (1 + pct / 100), change: next - value };
  });
  const crypto = rows.filter(r => r.symbol !== 'KRW').reduce((sum, r) => sum + r.next, 0);
  return { total, base, change: total - base, changePct: base ? (total - base) / base * 100 : 0, profit: costKnown ? crypto - cost : null, profitPct: costKnown && cost ? (crypto - cost) / cost * 100 : null, rows };
}

/** Whether an alert rule's condition holds for the current metrics { price, changePct, profitPct, total }; null when the metric is unknown. */
export function alertMet(rule, metrics) {
  const value = Number(rule.value);
  if (!Number.isFinite(value)) return false;
  const pick = { above: metrics.price, below: metrics.price, rise: metrics.changePct, fall: metrics.changePct, profit: metrics.profitPct, loss: metrics.profitPct, total_above: metrics.total, total_below: metrics.total }[rule.type];
  if (pick === null || pick === undefined || !Number.isFinite(Number(pick))) return null;
  const current = Number(pick);
  return { above: current >= value, below: current <= value, rise: current >= value, fall: current <= -Math.abs(value), profit: current >= value, loss: current <= -Math.abs(value), total_above: current >= value, total_below: current <= value }[rule.type] ?? false;
}
