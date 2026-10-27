// Open output objects preserve existing fields while giving clients reliable response contracts.
const string = { type: 'string' }, integer = { type: 'integer', minimum: 0 }, boolean = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const array = items => ({ type: 'array', items });
const object = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const mode = { type: 'string', enum: ['live', 'demo'] }, strings = array(string);
const base = { mode, asOf: string };
const pagination = object({ total: integer, returned: integer, offset: integer, nextOffset: nullable(integer) });
export const OUTPUTS = {
  portfolio_get_summary: object({ ...base, totalValueKrw: string, valuationComplete: boolean, warnings: strings }),
  portfolio_get_holdings: object({ ...base, scope: strings, holdings: array(object({ symbol: string })), warnings: strings, pagination }),
  portfolio_get_allocation: object({ ...base, allocation: array(object({ symbol: string })), valuationComplete: boolean, warnings: strings }),
  portfolio_get_history: object({ mode, days: integer, scope: strings, note: string }),
  portfolio_get_report: object({ mode, portfolio: object(), sections: object(), coverage: object() }),
  market_get_candles: object({ ...base, symbol: string, interval: string, candles: array(object({ closeKrw: string })) }),
  market_get_tickers: object({ ...base, scope: string, total: integer, rows: array(object({ symbol: string, priceKrw: string })) }),
  market_get_warnings: object({ ...base, scope: string, total: integer, rows: array(object({ market: string, symbol: string, type: string, step: string })) }),
  account_get_records: object({ ...base, kind: string, rows: array(object()), totals: object(),
    pagination: object({ nextCursor: nullable(string), pageSize: integer, returned: integer, expiresAt: nullable(string) }),
    coverage: object({ complete: boolean, pages: integer, scannedPages: integer, snapshot: boolean, totalsScope: { type: 'string', const: 'returned_rows' } }) }),
  account_get_orders: object({ ...base, data: array(object()), has_next: boolean, next_key: nullable(string), coverage: object() }),
  account_get_transfers: object({ ...base, data: array(object()), pagination: object(), coverage: object() }),
  dashboard_list_boards: object({ boards: array(object({ id: string, revision: integer, name: string })) }),
  dashboard_snapshot: object({ ...base, scope: strings, summary: object({ totalValueKrw: string, valuationComplete: boolean }), holdings: array(object({ symbol: string })),
    others: object({ count: integer, valueKrw: nullable(string), allocationPct: nullable(string) }), trend: object({ days: integer, at: strings, valueKrw: strings, sampled: boolean }), warnings: strings }),
  dashboard_save_board: object({ id: string, revision: integer, name: string, symbols: strings, widgets: strings }),
  dashboard_open: object({ url: string, mode, boards: array(object()) }),
  dashboard_get_template: object({ name: string, schemaVersion: string, files: object(), binaryAssets: strings, manifest: array(object({ path: string, bytes: integer })) }),
  system_diagnose: object({ version: string, mode, tools: integer, auth: object(), publicApi: object(), accountApi: object() }),
};

export function recovery(error, status) {
  const codes = {
    NOT_CONFIGURED: [false, '로컬 CLI의 config init으로 조회용 키를 설정하세요. 키를 도구 입력에 넣지 마세요.'],
    AUTH_FAILED: [false, 'API 키의 조회 권한·만료·허용 IP를 확인한 뒤 다시 시도하세요.'],
    RATE_LIMITED: [true, '잠시 기다렸다가 같은 입력으로 다시 시도하세요.'],
    API_UNREACHABLE: [true, '네트워크를 확인한 뒤 같은 입력으로 다시 시도하세요.'],
    CURSOR_BUSY: [true, '현재 호출이 끝난 뒤 같은 cursor로 다시 시도하세요.'],
    CURSOR_EXPIRED: [false, 'cursor를 빼고 같은 날짜·필터로 다시 시작하세요.'],
    CURSOR_QUERY_MISMATCH: [false, '기존 cursor 조건을 유지하거나 cursor를 빼고 새 조건으로 시작하세요.'],
    QUERY_LIMIT: [false, '날짜 구간이나 자산 범위를 나누어 새 조회를 시작하세요.'],
    BOARD_NOT_FOUND: [false, 'dashboard_list_boards로 보드 id를 확인하거나 boardId 없이 다시 호출하세요.'],
    CONFLICT: [false, 'dashboard_list_boards로 최신 revision을 읽은 뒤 변경을 다시 적용하세요.'],
    DASHBOARD_START_FAILED: [false, '이 컴퓨터의 터미널에서 asset-kit dashboard로 직접 띄우세요. 대화 안 화면(dashboard_snapshot)은 그대로 쓸 수 있습니다.'],
    PORT_IN_USE: [true, 'port를 빼거나 다른 port로 다시 시도하세요.'],
  };
  const [retryable, action] = codes[error.code] ?? (error.code === 'API_ERROR' && status >= 500 ? [true, '거래소 일시 오류입니다. 잠시 뒤 같은 입력으로 다시 시도하세요.'] : [false, 'tools/list의 입력 규격과 오류 메시지를 확인하세요. 반복 실패하면 system_diagnose로 상태를 확인하세요.']);
  return { ...error, retryable, recovery: action };
}
