import { dec } from '../src/decimal.js';
import { KitError } from '../src/errors.js';
import { downsample } from '../src/history.js';

export const HOLDING_FIELDS = ['symbol', 'name', 'quantity', 'available', 'locked', 'currentPriceKrw', 'valueKrw', 'averagePriceKrw', 'costKrw', 'profitKrw', 'profitRatePct', 'priceChangePct', 'priceSource', 'averagePriceModified', 'quoteAt', 'staleQuote', 'valuationStatus', 'allocationPct'];
export const RECORD_FIELDS = ['order_id', 'uuid', 'at', 'created_at', 'done_at', 'market', 'currency', 'side', 'state', 'order_type', 'price', 'volume', 'remaining_volume', 'executed_volume', 'executed_funds', 'locked', 'paid_fee', 'amount', 'fee', 'net_type'];
export const fieldInput = fields => ({ type: 'array', minItems: 1, maxItems: fields.length, uniqueItems: true, items: { type: 'string', enum: fields }, description: '반환할 행 필드만 선택합니다. 식별자와 데이터 경고는 항상 유지됩니다.' });
export const FORCE = { type: 'boolean', default: false, description: 'true이면 캐시를 건너뜁니다. 이미 진행 중인 동일 조회는 공유할 수 있습니다.' };

export function selectFields(rows, fields, required = []) {
  if (!fields) return rows;
  const keys = new Set([...required, ...fields]);
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => keys.has(key))));
}

export function holdingsResult(p, { symbol, search = '', excludeCash = false, performance = 'all', sort = 'value', direction = 'desc', offset = 0, limit, fields } = {}) {
  const term = search.trim().toLocaleLowerCase('ko'), factor = direction === 'asc' ? 1 : -1;
  const sortField = { value: 'valueKrw', profit: 'profitRatePct', pnl: 'profitKrw', change: 'priceChangePct', quantity: 'quantity' }[sort];
  const rows = p.holdings.filter(h => {
    if (symbol && h.symbol !== symbol.toUpperCase()) return false;
    if (excludeCash && h.symbol === 'KRW') return false;
    if (term && !`${h.symbol} ${h.name}`.toLocaleLowerCase('ko').includes(term)) return false;
    if (performance === 'all') return true;
    if (h.symbol === 'KRW') return false;
    if (performance === 'unknown') return h.profitKrw === null;
    return h.profitKrw !== null && (performance === 'gain' ? dec(h.profitKrw).gt(0) : dec(h.profitKrw).cmp(0) < 0);
  }).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ko') * factor || a.symbol.localeCompare(b.symbol);
    if (a[sortField] === null || b[sortField] === null) return a[sortField] === b[sortField] ? a.symbol.localeCompare(b.symbol) : a[sortField] === null ? 1 : -1;
    return dec(a[sortField]).cmp(b[sortField]) * factor || a.symbol.localeCompare(b.symbol);
  });
  const selected = rows.slice(offset, limit === undefined ? undefined : offset + limit);
  return { mode: p.mode, asOf: p.asOf, scope: p.scope,
    holdings: selectFields(selected, fields, ['symbol', 'valuationStatus', 'staleQuote']), warnings: p.warnings,
    pagination: { total: rows.length, returned: selected.length, offset, nextOffset: offset + selected.length < rows.length ? offset + selected.length : null },
    note: '비중은 symbols 범위 전체를 분모로 사용합니다. 검색·손익 필터·페이지 제한으로 다시 계산하지 않습니다. nextOffset은 같은 asOf 안에서 사용하세요.' };
}

const SNAPSHOT_SUMMARY = ['totalValueKrw', 'cashKrw', 'cryptoValueKrw', 'profitKrw', 'profitRatePct', 'assetCount', 'valuationComplete', 'profitComplete'];
const SNAPSHOT_HOLDING = ['symbol', 'name', 'quantity', 'valueKrw', 'allocationPct', 'profitKrw', 'profitRatePct', 'priceChangePct'];
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
const total = (rows, key) => rows.reduce((sum, row) => row[key] === null ? sum : sum.plus(row[key]), dec(0)).toFixed();

/** One chart-ready call for drawing a dashboard: summary, top holdings with an "others" slice, and a columnar trend. */
export async function dashboardSnapshot(service, { boardId, symbols, days, points = 60, top = 5, daily = false, force = false } = {}) {
  let board = null;
  if (boardId) {
    board = (await service.boards.list()).find(item => item.id === boardId);
    if (!board) throw new KitError('BOARD_NOT_FOUND', '대시보드를 찾을 수 없습니다. dashboard_list_boards로 id를 확인하세요.', 404);
  }
  const scope = symbols ?? board?.symbols ?? [], period = days ?? board?.days ?? 30;
  const p = await service.portfolio({ symbols: scope, force });
  const [history, calendar] = await Promise.all([service.getHistory({ days: period, symbols: scope }), daily ? service.getHistory({ days: period, symbols: scope, daily: true }) : null]);
  // Unpriced points cannot be drawn. Downsampling keeps the first and last recorded values, so the change is exact.
  const drawable = history.points.filter(point => point.valuationComplete && point.totalValueKrw !== null);
  const shown = downsample(drawable, points);
  const first = drawable[0]?.totalValueKrw ?? null, last = drawable.at(-1)?.totalValueKrw ?? null;
  const rest = p.holdings.slice(top), changed = calendar?.daily.filter(row => row.changeKrw !== null) ?? [];
  return {
    mode: p.mode, asOf: p.asOf, scope: p.scope ?? [], board: board && { id: board.id, name: board.name, revision: board.revision, widgets: board.widgets },
    summary: pick(p.summary, SNAPSHOT_SUMMARY),
    holdings: p.holdings.slice(0, top).map(h => pick(h, SNAPSHOT_HOLDING)),
    others: { count: rest.length, valueKrw: total(rest, 'valueKrw'), allocationPct: total(rest, 'allocationPct'), unpriced: rest.filter(h => h.valueKrw === null).length },
    trend: { days: period, at: shown.map(point => point.asOf), valueKrw: shown.map(point => point.totalValueKrw), firstKrw: first, lastKrw: last,
      changeKrw: drawable.length > 1 ? dec(last).minus(first).toFixed() : null, omitted: history.points.length - drawable.length, sampled: history.sampled || shown.length < drawable.length },
    ...(calendar ? { daily: { day: changed.map(row => row.day), changeKrw: changed.map(row => row.changeKrw), changePct: changed.map(row => row.changePct), gapDays: changed.map(row => row.gapDays) } } : {}),
    warnings: p.warnings,
    note: '금액은 십진 문자열이고 trend·daily는 같은 위치끼리 짝인 열 배열입니다. 추이와 일별 변화는 입출금이 포함된 평가금액 기록이라 수익률이 아니며, 평가손익은 현재 보유분 평균 매수가 기준입니다. holdings 비중은 scope 전체가 분모입니다.',
  };
}

export function recordTotals(rows, order) {
  const totals = {};
  for (const row of rows) {
    const currency = order ? row.market.split('-')[0] : row.currency;
    const item = totals[currency] ??= { count: 0, amount: '0', fee: '0' };
    item.count++;
    item.amount = dec(item.amount).plus(order ? row.executed_funds : row.amount).toFixed();
    item.fee = dec(item.fee).plus(order ? row.paid_fee : row.fee).toFixed();
  }
  return totals;
}
