import { KitError } from './errors.js';
import { check, DECIMAL, MARKET } from './schema.js';

const time = { type: 'integer', minimum: 0 };
/** 주문 한 페이지 조회 조건. MCP 도구 입력 스키마로도 공개합니다. */
export const ORDER_OPTIONS = { type: 'object', additionalProperties: false, properties: {
  kind: { type: 'string', enum: ['pending', 'history'], default: 'pending', description: 'pending=대기 주문, history=종료 주문(최대 7일 구간)' },
  market: { ...MARKET, description: '선택: KRW-BTC' },
  state: { type: 'string', enum: ['wait', 'watch', 'done', 'cancel'] },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
  nextKey: { type: 'string', minLength: 1, maxLength: 4096, description: '이전 응답의 next_key' },
  fromMs: { ...time, description: '종료 주문 시작(Unix ms)' }, toMs: { ...time, description: '종료 주문 끝(Unix ms)' },
} };
/** 입출금 한 페이지 조회 조건. */
export const TRANSFER_OPTIONS = { type: 'object', additionalProperties: false, properties: {
  direction: { type: 'string', enum: ['deposit', 'withdraw'], default: 'deposit' },
  assetType: { type: 'string', enum: ['crypto', 'krw'], default: 'krw' },
  currency: { type: 'string', pattern: '^[A-Z0-9_]+$', description: '선택: 코인 심볼' },
  page: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
} };
export const ORDER_PAGE = { type: 'object', required: ['data', 'has_next', 'next_key'], properties: {
  data: { type: 'array', items: { type: 'object', required: ['order_id', 'side', 'order_type', 'state', 'market', 'volume', 'remaining_volume', 'paid_fee', 'locked', 'executed_volume', 'executed_funds'], properties: {
    order_id: { type: 'string' }, side: { type: 'string', enum: ['bid', 'ask'] }, order_type: { type: 'string' }, state: { type: 'string' }, market: { type: 'string' },
    created_at: { type: 'string' }, price: { ...DECIMAL, nullable: true }, volume: DECIMAL, remaining_volume: DECIMAL,
    paid_fee: DECIMAL, locked: DECIMAL, executed_volume: DECIMAL, executed_funds: DECIMAL,
  } } },
  has_next: { type: 'boolean' }, next_key: { type: 'string', nullable: true },
} };
export const TRANSFER_PAGE = { type: 'array', items: { type: 'object', required: ['uuid', 'currency', 'state', 'created_at', 'amount', 'fee'], properties: {
  uuid: { type: 'string' }, currency: { type: 'string' }, state: { type: 'string' }, created_at: { type: 'string' }, done_at: { type: 'string', nullable: true },
  amount: DECIMAL, fee: DECIMAL, net_type: { type: 'string', nullable: true },
} } };

const DAY = 86400000;
/** Range-collected record kinds for the dashboard widget, CLI `records` and MCP `account_get_records`. */
export const RECORD_KINDS = {
  orders: { label: '종료 주문' },
  pending: { label: '대기 주문' },
  deposits: { label: '코인 입금', direction: 'deposit', assetType: 'crypto' },
  withdrawals: { label: '코인 출금', direction: 'withdraw', assetType: 'crypto' },
  krw_deposits: { label: '원화 입금', direction: 'deposit', assetType: 'krw' },
  krw_withdrawals: { label: '원화 출금', direction: 'withdraw', assetType: 'krw' },
};

/** Inclusive period. A plain date is a Korean calendar day; the default is the last seven days; at most 366 days. */
export function recordRange(from, to, now = Date.now()) {
  const parseDate = (value, end) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const check = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== value) return NaN;
      return Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+09:00`);
    }
    return /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  };
  const end = to ? parseDate(String(to), true) : now;
  const start = from ? parseDate(String(from), false) : end - 7 * DAY + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start >= 366 * DAY) {
    throw new KitError('INVALID_RANGE', '기간은 YYYY-MM-DD 형식, 시작일 ≤ 종료일, 최대 366일입니다.', 400);
  }
  return { start, end, from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

const parse = (schema, input) => check(schema, input, { code: 'INVALID_QUERY', message: '조회 조건이 올바르지 않습니다.' });
export function normalizeOrders(input = {}, now = Date.now()) {
  const options = parse(ORDER_OPTIONS, input);
  if (options.kind === 'pending') {
    if (options.fromMs !== undefined || options.toMs !== undefined || (options.state && !['wait','watch'].includes(options.state))) {
      throw new KitError('INVALID_QUERY', '대기 주문은 wait/watch 상태를 사용하며 기간 필터를 지원하지 않습니다.', 400);
    }
  } else {
    if (options.state && !['done','cancel'].includes(options.state)) throw new KitError('INVALID_QUERY', '종료 주문은 done/cancel 상태를 사용합니다.', 400);
    options.toMs ??= now;
    options.fromMs ??= options.toMs - 7 * 86400000;
    if (options.toMs < options.fromMs || options.toMs - options.fromMs > 7 * 86400000) {
      throw new KitError('INVALID_RANGE', '종료 주문은 한 번에 최대 7일 범위로 조회합니다.', 400);
    }
  }
  return options;
}
export function normalizeTransfers(input = {}) {
  const options = parse(TRANSFER_OPTIONS, input);
  if (options.assetType === 'krw' && options.currency && options.currency !== 'KRW') throw new KitError('INVALID_QUERY','원화 내역에는 KRW만 지정할 수 있습니다.',400);
  if (options.assetType === 'crypto' && options.currency === 'KRW') throw new KitError('INVALID_QUERY','원화 내역은 assetType=krw로 조회하세요.',400);
  return options;
}
export function ordersQuery(o) {
  const query = new URLSearchParams({ limit: String(o.limit), order_by: 'desc' });
  if (o.market) query.set('market',o.market);
  if (o.state) query.set('state',o.state);
  if (o.nextKey) query.set('next_key',o.nextKey);
  if (o.kind === 'history') { query.set('start_time',String(o.fromMs)); query.set('end_time',String(o.toMs)); }
  return `/v2/orders/${o.kind === 'pending' ? 'pending' : 'history'}?${query}`;
}
export function transfersQuery(o) {
  const query = new URLSearchParams({ page: String(o.page), limit: String(o.limit), order_by: 'desc' });
  if (o.assetType === 'crypto' && o.currency) query.set('currency',o.currency);
  return `/v1/${o.direction === 'deposit' ? 'deposits' : 'withdraws'}${o.assetType === 'krw' ? '/krw' : ''}?${query}`;
}
