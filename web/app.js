// Asset Kit 대시보드 화면. asset-kit dashboard의 로컬 /api만 사용하며 API 키는 브라우저로 오지 않습니다.
// 샘플 HTML(examples/sample-dashboard.html)에서는 window.AssetKitFixture가 같은 형식의 응답을 대신 돌려줍니다.
import { filterHoldings, filterActivity, csvText, recordDates, dateRangeError, movingAverage, averageAfterBuy, quantityForTarget, rebalance, scenario, alertMet } from './dashboard-utils.js';

const $ = selector => document.querySelector(selector);
const fixture = globalThis.AssetKitFixture;
const WIDGETS = { summary: '자산 요약', trend: '자산 추이', insights: '인사이트', allocation: '자산 비중', heatmap: '자산 히트맵', performance: '손익 분석', holdings: '보유 내역', market: '시장 개요', warnings: '시장 경보', activity: '거래·입출금' };
// 왼쪽 메뉴의 고정 화면입니다. 대시보드(home)만 보드 설정을 따르고, 나머지는 원화 포함 전체 자산을 봅니다.
const PAGES = {
  home: {},
  assets: { title: '자산', description: '원화 포함 전체 자산의 구성과 보유 내역', widgets: ['summary', 'heatmap', 'allocation', 'holdings'] },
  analysis: { title: '손익 분석', description: '평균 매수가 기준 손익과 기간별 평가금액 변화 · 수수료·실현손익 제외', widgets: ['insights', 'performance', 'trend'] },
  market: { title: '시장', description: '관심 코인 실시간 시세 · 빗썸 원화 마켓 순위와 경보 · 투자 권유 아님', widgets: ['watchlist', 'market', 'warnings'] },
  activity: { title: '거래내역', description: '주문·입출금 기록 조회 · 조회 전용', widgets: ['activity'] },
  returns: { title: '수익률', description: '입출금을 뺀 실제 수익, 실현손익, 월별 리포트 · 추정치이며 세금 계산용이 아닙니다', widgets: ['returns', 'monthly', 'realized'] },
  chart: { title: '차트', description: '빗썸 원화 마켓 캔들 · 이동평균 · 거래량 · 내 평균 매수가 · 실시간 마지막 캔들', widgets: ['coinchart'] },
  tools: { title: '계산기', description: '물타기·리밸런싱·시나리오 계산 · 참고용이며 주문하지 않습니다 · 수수료 제외', widgets: ['averaging', 'rebalance', 'scenario'] },
};
// 넓은 위젯과 좁은 위젯이 이어지면 한 줄에 나란히 둡니다.
const WIDE = new Set(['trend', 'heatmap', 'market', 'performance']), NARROW = new Set(['allocation', 'warnings']);
const INTERVALS = [['15m', '15분'], ['1h', '1시간'], ['4h', '4시간'], ['day', '일'], ['week', '주']];
const OVERLAYS = [['ma5', 'MA5'], ['ma20', 'MA20'], ['ma60', 'MA60'], ['avg', '내 평단가'], ['volume', '거래량']];
const PERIODS = [[7, '7일'], [30, '30일'], [90, '90일'], [365, '1년']];
const PERIOD_LABEL = { 7: '지난 7일', 30: '지난 30일', 90: '지난 90일', 365: '지난 1년' };
const REFRESH = { 0: '수동 갱신', 30: '30초마다 갱신', 60: '1분마다 갱신', 300: '5분마다 갱신' };
const KINDS = { orders: '종료 주문', pending: '대기 주문', krw_deposits: '원화 입금', krw_withdrawals: '원화 출금', deposits: '코인 입금', withdrawals: '코인 출금' };
const STATES = { wait: '미체결', watch: '예약 대기', done: '체결 완료', cancel: '취소', DONE: '완료', ACCEPTED: '완료', DEPOSIT_ACCEPTED: '입금 완료', PROCESSING: '처리 중', DEPOSIT_PROCESSING: '입금 처리 중', CANCELLED: '취소', REJECTED: '거절' };
const SPARK_TTL = 10 * 60000;
const ICONS = {
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  inbox: '<path d="M3.5 13.5h5l1.5 3h4l1.5-3h5"/><path d="M6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5Z"/>',
  alert: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17v.2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  rise: '<path d="M3.5 16.5 9 11l4 4 7.5-7.5"/><path d="M15 7.5h5.5V13"/>',
  fall: '<path d="M3.5 7.5 9 13l4-4 7.5 7.5"/><path d="M15 16.5h5.5V11"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5a2.5 2.5 0 0 0 3 3.4M16 6.5h3a2.5 2.5 0 0 1-3 3.4"/><path d="M12 13.5v3M9 20h6M10.2 16.5h3.6l.6 3.5H9.6z"/>',
  low: '<path d="M12 4v12.5"/><path d="m6.5 11 5.5 5.5 5.5-5.5"/><path d="M5 20.5h14"/>',
  pie: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.9A8.5 8.5 0 0 1 20.1 9H15z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  candle: '<path d="M7 4v3M7 17v3M17 6v3M17 15v3"/><rect x="5" y="7" width="4" height="10" rx="1"/><rect x="15" y="9" width="4" height="6" rx="1"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2.5"/><path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z"/><circle cx="16" cy="14.5" r="1.2"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

const saved = {
  get: key => { try { return localStorage.getItem(`asset-kit:${key}`); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(`asset-kit:${key}`, value); } catch { /* 저장할 수 없으면 이 창에서만 유지 */ } },
};
const state = {
  status: null, boards: [], boardId: null, portfolio: null, history: null, daily: null, market: null, activity: null, activityShown: 100,
  hidden: saved.get('hidden') === '1', view: saved.get('view') === 'calendar' ? 'calendar' : 'chart', month: null,
  timer: null, syncTimer: null, reloading: false, draft: null, allSymbols: [], saving: Promise.resolve(),
  filters: {}, paused: false, failed: false, loading: false, lastLoaded: null,
  series: new Map(), sparks: new Map(), sparkPending: new Set(),
  page: 'home', perfMetric: 'amount', heatMetric: 'change', marketTab: 'value', alertScope: 'all', tickers: null, alerts: null,
  live: { source: null, key: '', status: 'off', failures: 0, retry: null, stale: false }, ticks: new Map(), marketList: null, watchRows: null, returns: null,
  returnsMonths: [3, 6, 12].includes(Number(saved.get('returns-months'))) ? Number(saved.get('returns-months')) : 12,
  chart: { symbol: saved.get('chart-symbol'), interval: INTERVALS.some(([value]) => value === saved.get('chart-interval')) ? saved.get('chart-interval') : 'day',
    overlays: new Set((saved.get('chart-overlays') ?? 'ma5,ma20,avg,volume').split(',').filter(key => OVERLAYS.some(([value]) => value === key))), data: null },
  scenario: {},
};
// 관심 코인·알림·목표 비중은 이 브라우저에만 저장합니다.
const store = {
  list: (key, fallback = []) => { try { const value = JSON.parse(saved.get(key)); return Array.isArray(value) ? value : fallback; } catch { return fallback; } },
  map: key => { try { const value = JSON.parse(saved.get(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } },
  put: (key, value) => saved.set(key, JSON.stringify(value)),
};
const SYMBOL_TEXT = /^[A-Z0-9][A-Z0-9_]{0,29}$/; // 서버의 심볼 규칙과 같습니다.
const watchlist = () => store.list('watchlist', ['BTC', 'ETH', 'XRP']).filter(symbol => SYMBOL_TEXT.test(symbol)).slice(0, 30);
const board = () => state.boards.find(b => b.id === state.boardId);
const scope = () => state.page === 'home' ? board()?.symbols.join(',') ?? '' : '';
const widgetsNow = () => state.page === 'home' ? board()?.widgets ?? [] : PAGES[state.page].widgets;
// 보유 내역 필터는 보드마다, 고정 메뉴는 메뉴마다 따로 기억합니다.
const filterKey = () => state.page === 'home' ? `filters:${state.boardId}` : `filters:page:${state.page}`;
const now = () => state.status?.sampleAsOf ? Date.parse(state.status.sampleAsOf) : Date.now();

// 새 화면/조건으로 바꾸면 이전 요청을 취소하고 늦게 도착한 응답도 무시합니다.
const requests = new Map();
function cancelRequest(key) { requests.get(key)?.abort(); requests.delete(key); }
function beginRequest(key) {
  cancelRequest(key);
  const controller = new AbortController();
  requests.set(key, controller);
  return { signal: controller.signal, current: () => requests.get(key) === controller && !controller.signal.aborted };
}
// 실시간 값이 바뀔 때 목록을 통째로 갈아 끼우지 않고 달라진 글자와 속성만 고칩니다. 누르던 버튼과 키보드 포커스가 그대로 남습니다.
// data-symbol이 같은 요소끼리 맞추고, 스크립트가 크기에 맞춰 넣는 style은 건드리지 않습니다.
function morph(target, markup) {
  const template = document.createElement?.('template');
  if (!template) { target.innerHTML = markup; return; }
  template.innerHTML = markup;
  patchChildren(target, template.content);
}
function patchChildren(target, source) {
  let current = target.firstChild;
  for (const node of [...source.childNodes]) {
    if (!current) { target.append(node); continue; }
    const next = current.nextSibling;
    if (current.nodeType !== node.nodeType || current.nodeName !== node.nodeName || (node.nodeType === 1 && current.getAttribute('data-symbol') !== node.getAttribute('data-symbol'))) current.replaceWith(node);
    else if (node.nodeType !== 1) { if (current.nodeValue !== node.nodeValue) current.nodeValue = node.nodeValue; }
    else {
      for (const { name } of [...current.attributes]) if (name !== 'style' && !node.hasAttribute(name)) current.removeAttribute(name);
      for (const { name, value } of [...node.attributes]) if (current.getAttribute(name) !== value) current.setAttribute(name, value);
      patchChildren(current, node);
    }
    current = next;
  }
  while (current) { const next = current.nextSibling; current.remove(); current = next; }
}
// 바뀐 현재가 칸을 잠깐 물들입니다(상승 빨강, 하락 파랑). 같은 방향으로 연달아 바뀌어도 처음부터 다시 깜빡입니다.
function flash(cell, up) {
  if (!cell) return;
  cell.classList.remove('flash-up', 'flash-down');
  void cell.offsetWidth;
  cell.classList.add(up ? 'flash-up' : 'flash-down');
}

// ===== 표시 형식 =====
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const missing = value => value === null || value === undefined || value === '';
const formatters = new Map();
const number = (value, digits = 0) => {
  if (missing(value) || !Number.isFinite(Number(value))) return '—';
  if (!formatters.has(digits)) formatters.set(digits, new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }));
  return formatters.get(digits).format(Number(value));
};
const money = (value, signed = false) => state.hidden ? '••••' : missing(value) ? '—' : `${signed && Number(value) > 0 ? '+' : ''}${number(value)}원`;
const percent = value => state.hidden ? '••' : missing(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${number(value, 2)}%`;
const amount = (value, unit) => state.hidden ? '••••' : missing(value) ? '—' : `${number(value, 8)} ${esc(unit)}`;
const price = value => missing(value) ? '—' : `${number(value, Number(value) < 100 ? 4 : 0)}원`;
const sign = value => Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
// 시세 등락률은 열 안에서 자릿수가 맞도록 항상 소수 둘째 자리까지 씁니다(▲ 1.70%).
const fixed2 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const arrowRate = value => missing(value) || !Number.isFinite(Number(value)) ? '—' : `${Number(value) > 0 ? '▲ ' : Number(value) < 0 ? '▼ ' : ''}${fixed2.format(Math.abs(Number(value)))}%`;
const tone = value => state.hidden ? '' : sign(value);
const share = (part, whole) => Number(whole) > 0 && !missing(part) ? `${number(Number(part) / Number(whole) * 100, 1)}%` : '—';
const compact = (value, digits = 1) => { const n = Math.abs(value), s = value > 0 ? '+' : value < 0 ? '-' : ''; return n >= 1e8 ? `${s}${(n / 1e8).toFixed(digits).replace('.0', '')}억` : n >= 1e4 ? `${s}${(n / 1e4).toFixed(digits).replace('.0', '')}만` : `${s}${number(n)}`; };
const kstDay = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
const shortDay = value => { const day = new Date(Date.parse(value) + 9 * 3600000); return `${day.getUTCMonth() + 1}.${day.getUTCDate()}`; };
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const date = value => missing(value) || !Number.isFinite(Date.parse(value)) ? '—' : dateFormat.format(new Date(value));
const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => !missing(value))).toString();
const monogram = symbol => symbol === 'KRW' ? '₩' : symbol.slice(0, 4);
const bigWon = value => missing(value) ? '—' : Number(value) >= 1e12 ? `${number(Number(value) / 1e12, 1)}조` : Number(value) >= 1e8 ? `${number(Number(value) / 1e8, 0)}억` : `${number(value)}원`;
// 축 눈금: 눈금 간격에 맞춰 억·만 단위와 소수 자릿수를 정합니다.
function axisLabel(value, step) {
  const unit = Math.abs(value) >= 1e8 ? 1e8 : Math.abs(value) >= 1e4 ? 1e4 : 1, suffix = { 1e8: '억', 1e4: '만', 1: '' }[unit];
  const digits = !step || Number.isInteger(Math.round(step / unit * 1e6) / 1e6) ? 0 : Number.isInteger(Math.round(step * 10 / unit * 1e6) / 1e6) ? 1 : 2;
  return `${number(value / unit, unit === 1 ? Math.max(digits, value < 100 ? 2 : 0) : digits)}${suffix}`;
}
// 부호를 화살표와 색으로 보여주는 변화량 표시. 스크린리더에는 증가·감소로 읽힙니다.
function deltaPill(change, base, unit = '원') {
  if (state.hidden) return '<span class="pill">••••</span>';
  if (!Number.isFinite(change)) return '';
  const pct = Number(base) ? change / Number(base) * 100 : null, arrow = change > 0 ? '▲' : change < 0 ? '▼' : '';
  return `<span class="pill ${sign(change)}"><span class="sr-only">${change > 0 ? '증가' : change < 0 ? '감소' : '변화 없음'}</span>${arrow ? `<span aria-hidden="true">${arrow}</span>` : ''}${number(Math.abs(change))}${unit}${pct === null ? '' : ` (${number(Math.abs(pct), 2)}%)`}</span>`;
}
// 비중 색은 자산을 따라갑니다. 지금 화면의 자산 범위에서 상위 가상자산 5개가 정해진 순서의 색을 받고, 원화와 나머지는 회색입니다.
// 보유 내역 검색·필터는 이 색을 바꾸지 않습니다.
function seriesMap(holdings) {
  const map = new Map([['KRW', 'c-cash']]);
  holdings.filter(h => h.symbol !== 'KRW' && h.valueKrw !== null && Number(h.allocationPct) > 0).forEach((h, i) => map.set(h.symbol, i < 5 ? `c${i + 1}` : 'c-other'));
  return map;
}
const seriesClass = symbol => state.series.get(symbol) ?? (symbol === 'KRW' ? 'c-cash' : 'c-other');
// CSP가 인라인 style 속성을 막으므로 막대 길이는 CSSOM으로 넣습니다.
function applyShares(root) { for (const element of root?.querySelectorAll?.('[data-share]') ?? []) element.style.setProperty('--share', element.dataset.share); }

// ===== 서버 연결 =====
async function api(path, { method = 'GET', body, signal } = {}) {
  if (fixture) return fixture.request(method, path, body);
  const timeout = AbortSignal.timeout(path.startsWith('/api/records') || path.startsWith('/api/returns') ? 180000 : 30000);
  const options = { method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  if (body !== undefined) { options.headers = { 'Content-Type': 'application/json', 'X-Asset-Kit': '1' }; options.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(path, options); } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(error.name === 'TimeoutError' ? '응답이 늦어 중단했습니다. 잠시 후 다시 시도해주세요.' : '로컬 대시보드 서버에 연결하지 못했습니다. 터미널에서 실행 중인지 확인하세요.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || '요청을 처리하지 못했습니다. 다시 시도해주세요.'), { code: data.error?.code, status: response.status });
  return data;
}
function notice(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notice.timer); notice.timer = setTimeout(() => { toast.hidden = true; }, 3000); }
function showError(message) { $('#error').textContent = message; $('#error').hidden = !message; }

async function init() {
  syncPrivacy();
  try {
    state.status = await api('/api/status');
    const demo = state.status.mode === 'demo';
    $('#demo-note').hidden = !demo;
    if (state.status.sample) $('#demo-text').textContent = '샘플 페이지입니다. 모든 숫자는 합성 데이터이며 화면 설정 변경은 이 창에서만 유지됩니다.';
    $('#mode-label').textContent = demo ? 'DEMO' : state.status.configured ? '조회 전용' : '계좌 연결 전';
    $('#mode-label').classList.toggle('is-demo', demo);
    $('#mode-label').classList.toggle('is-live', !demo && state.status.configured);
    $('#setup').hidden = state.status.configured;
    $('#dashboard').hidden = $('#board-add').hidden = $('#nav').hidden = $('#alerts-button').hidden = !state.status.configured;
    renderBell();
    if (!state.status.configured) return;
    state.boards = (await api('/api/boards')).boards;
    // ?board=<id>만 있는 MCP 링크는 그 보드가 보이는 대시보드 메뉴로 엽니다. 주소에 아무것도 없을 때만 마지막 메뉴를 씁니다.
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const page = params.get('page') ?? (params.has('board') ? 'home' : saved.get('page'));
    state.page = Object.hasOwn(PAGES, page ?? '') ? page : 'home';
    // MCP의 dashboard_open·dashboard_save_board(open)가 준 ?board=<id>를 마지막으로 본 보드보다 먼저 씁니다.
    const requested = new URLSearchParams(globalThis.location?.search ?? '').get('board');
    selectBoard([requested, saved.get('board')].find(id => state.boards.some(b => b.id === id)) ?? state.boards[0].id);
    state.syncTimer = setTimeout(syncBoards, BOARD_SYNC_MS);
  } catch (error) { showError(error.message); }
}

// ===== 보드(화면 설정) =====
function selectBoard(id) {
  for (const key of ['portfolio', 'history', 'activity', 'explain', 'market', 'tickers', 'alerts', 'candles', 'returns', 'watch']) cancelRequest(key);
  chartModels.delete('chart');
  state.boardId = id;
  saved.set('board', id);
  if (!state.status?.sample) globalThis.history?.replaceState(null, '', `?board=${encodeURIComponent(id)}${state.page === 'home' ? '' : `&page=${state.page}`}`);
  Object.assign(state, { portfolio: null, history: null, daily: null, activity: null, activityShown: 100, month: null, calendarDay: null, lastLoaded: null, failed: false, tickers: null, alerts: null, watchRows: null });
  state.chart.data = null;
  try { state.filters = JSON.parse(saved.get(filterKey())) || {}; } catch { state.filters = {}; }
  showError(''); $('#warnings').hidden = true;
  renderTabs(); mount(); schedule(); void load();
  // 보드 범위가 바뀌면 실시간 구독도 바꿉니다.
  if (state.live.key && state.live.key !== liveKey()) connectLive();
}
// 왼쪽 메뉴: 같은 보드를 유지한 채 고정 화면으로 바꿉니다.
function selectPage(page) {
  if (!Object.hasOwn(PAGES, page) || !board()) return;
  state.page = page;
  saved.set('page', page);
  selectBoard(state.boardId);
  globalThis.scrollTo?.({ top: 0 });
}
// MCP나 다른 창에서 바꾼 화면 설정을 보이는 동안 몇 초마다 확인합니다. 편집 중이거나 저장 중에는 건드리지 않습니다.
const BOARD_SYNC_MS = 5000;
const boardKey = boards => boards.map(b => `${b.id}:${b.revision}`).join(',');
const layoutKey = b => JSON.stringify([b?.symbols, b?.widgets, b?.days, b?.refreshSeconds]);
async function syncBoards() {
  clearTimeout(state.syncTimer);
  // init()이 첫 보드를 고르기 전에는 비교할 화면이 없습니다.
  if (state.status?.sample || !state.status?.configured || !state.boardId) return;
  const saving = state.saving, quiet = () => !document.hidden && !document.querySelector('dialog[open]') && !state.reloading && saving === state.saving;
  if (quiet()) {
    // 자체 채널을 써서, 저장 실패 뒤 원래 설정을 되돌리는 reloadBoards()를 취소하지 않습니다.
    const request = beginRequest('boards-sync');
    try {
      await saving;
      const { boards } = await api('/api/boards', { signal: request.signal });
      if (request.current() && quiet() && Array.isArray(boards) && boards.length && boardKey(boards) !== boardKey(state.boards)) {
        const current = boards.find(b => b.id === state.boardId), previous = board();
        state.boards = boards;
        if (!current) selectBoard(boards[0].id);
        else if (layoutKey(current) !== layoutKey(previous) && state.page === 'home') selectBoard(current.id);
        // 이름만 바뀌었거나 다른 메뉴를 보는 중이면 진행 중인 조회와 입력한 기간을 그대로 둡니다.
        else {
          renderTabs();
          if (state.page === 'home') $('#board-name').textContent = current.name;
          else if (layoutKey(current) !== layoutKey(previous)) {
            // 다른 메뉴를 보는 중이면 화면은 그대로 두고 갱신 주기·기간 표시만 새 설정에 맞춥니다.
            schedule(); connectionStatus(); syncTrendControls();
            if (current.days !== previous?.days && widgetsNow().includes('trend')) { $('#chart')?.classList.add('is-stale'); void loadHistory(); }
          }
        }
        notice('다른 곳에서 바꾼 화면 설정을 반영했어요.');
      }
    } catch { /* 다음 확인에서 다시 시도합니다. */ }
  }
  state.syncTimer = setTimeout(syncBoards, BOARD_SYNC_MS);
}
function renderTabs() {
  const home = state.page === 'home';
  $('#board-tabs').innerHTML = state.boards.map(b => `<button type="button" class="tab${b.id === state.boardId ? ' is-active' : ''}" data-action="board" data-id="${esc(b.id)}"${b.id === state.boardId ? ' aria-current="page"' : ''}>${esc(b.name)}</button>`).join('');
  $('#board-tabs').hidden = !home;
  $('#board-add').hidden = !home || !state.status?.configured;
  for (const item of document.querySelectorAll('[data-page]')) {
    item.classList.toggle('is-active', item.dataset.page === state.page);
    if (item.dataset.page === state.page) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
}
const TREND_CONTROLS = () => `<div class="hero__controls">
    <div class="segmented" role="group" aria-label="보기 방식"><button type="button" data-action="view" data-view="chart">추이</button><button type="button" data-action="view" data-view="calendar">일별 변화</button></div>
    <div class="segmented" role="group" aria-label="조회 기간" id="days">${PERIODS.map(([days, label]) => `<button type="button" data-action="days" data-days="${days}">${label}</button>`).join('')}</div>
  </div>`;
const TEMPLATES = {
  // 요약 바로 뒤에 추이가 오면 한 카드로 합쳐 총액·기간 변화·차트를 함께 보여줍니다.
  summary: (trend = false) => `<section class="card hero" id="summary" aria-label="자산 요약" aria-busy="true">
    <div class="hero__head"><p class="hero__label"><span id="total-label">총 평가금액</span><small id="updated">불러오는 중</small></p>${trend ? TREND_CONTROLS() : ''}</div>
    <div class="hero__figure" id="total"><span class="skeleton hero-skeleton"></span></div>
    ${trend ? `<div class="hero__delta" id="hero-delta"></div>
    <div class="hero__chart" id="trend">
      <div id="chart" class="chart"><span class="skeleton chart-skeleton"></span></div>
      <div id="calendar" class="calendar" aria-live="polite" hidden></div>
      <p class="chart-caption"><span id="history-summary">—</span><span>평가금액 기록 · 입출금 포함 · 수익률 아님</span></p>
    </div>` : ''}
    <dl class="kpis">
      <div class="kpi"><dt>오늘 시세 변동</dt><dd><strong id="day-change">—</strong><small id="day-change-rate">—</small></dd></div>
      <div class="kpi"><dt>보유분 평가손익</dt><dd><strong id="profit">—</strong><small id="profit-rate">—</small></dd></div>
      <div class="kpi"><dt>가상자산</dt><dd><strong id="crypto-total">—</strong><small id="count">—</small></dd></div>
      <div class="kpi"><dt>원화</dt><dd><strong id="cash">—</strong><small id="cash-share">주문 중 금액 포함</small></dd></div>
    </dl></section>`,
  trend: () => `<section class="card trend-card" id="trend" aria-labelledby="trend-title">
    <div class="card__head"><div><h2 id="trend-title">자산 추이</h2><p class="card__sub">평가금액 기록 · 입출금 포함 · 수익률 아님</p></div>${TREND_CONTROLS()}</div>
    <div id="trend-stats" class="trend-stats" hidden></div>
    <div id="chart" class="chart"><span class="skeleton chart-skeleton"></span></div>
    <div id="calendar" class="calendar" aria-live="polite" hidden></div>
    <p class="chart-caption"><span id="history-summary">—</span></p></section>`,
  insights: () => `<section class="card" aria-labelledby="insights-title"><div class="card__head"><div><h2 id="insights-title">오늘의 인사이트</h2><p class="card__sub">보유 자산 데이터로 계산한 사실 요약 · 투자 조언이 아닙니다</p></div></div><div class="insights" id="insights">${'<span class="skeleton insight-skeleton"></span>'.repeat(3)}</div></section>`,
  performance: () => `<section class="card" aria-labelledby="performance-title">
    <div class="card__head"><div><h2 id="performance-title">손익 분석</h2><p class="card__sub">자산별 평가손익 · 평균 매수가 기준 · 수수료·실현손익 제외</p></div>
      <div class="segmented" role="group" aria-label="손익 단위"><button type="button" data-action="perf-metric" data-metric="amount">금액</button><button type="button" data-action="perf-metric" data-metric="rate">수익률</button></div></div>
    <dl class="perf-summary" id="perf-summary"></dl>
    <div class="perf" id="perf-chart"><span class="skeleton stack-skeleton"></span></div></section>`,
  heatmap: () => `<section class="card" aria-labelledby="heatmap-title">
    <div class="card__head"><div><h2 id="heatmap-title">자산 히트맵</h2><p class="card__sub">면적은 평가금액, 색은 <span id="heatmap-metric">전일 대비 등락률</span></p></div>
      <div class="segmented" role="group" aria-label="히트맵 색 기준"><button type="button" data-action="heat-metric" data-metric="change">전일 대비</button><button type="button" data-action="heat-metric" data-metric="profit">수익률</button></div></div>
    <div class="heatmap" id="heatmap"><span class="skeleton heatmap-skeleton"></span></div>
    <div class="heat-legend" id="heatmap-legend" aria-hidden="true"></div></section>`,
  market: () => `<section class="card" id="market-card" aria-labelledby="market-title">
    <div class="card__head"><div><h2 id="market-title">시장 개요</h2><p class="card__sub" id="market-sub">빗썸 원화 마켓 · 전일 대비 · 24시간 거래대금</p></div>
      <div class="segmented" role="group" aria-label="시장 순위"><button type="button" data-action="market-tab" data-tab="value">거래대금</button><button type="button" data-action="market-tab" data-tab="gainers">상승</button><button type="button" data-action="market-tab" data-tab="losers">하락</button><button type="button" data-action="market-tab" data-tab="held">보유</button></div></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="시장 시세 표"><table class="table market-table"><thead><tr><th scope="col">자산</th><th scope="col">현재가</th><th scope="col">전일 대비</th><th scope="col" class="col-volume">거래대금(24시간)</th></tr></thead><tbody id="market-body"><tr><td colspan="4" class="empty">불러오는 중</td></tr></tbody></table></div>
    <p class="card__foot" id="market-foot">빗썸 공개 시세입니다. 내 자산 평가가 아니며 매매 권유가 아닙니다.</p></section>`,
  warnings: () => `<section class="card" id="alerts-card" aria-labelledby="alerts-title">
    <div class="card__head"><div><h2 id="alerts-title">시장 경보</h2><p class="card__sub">빗썸 경보제 · 거래 유의 지정</p></div>
      <div class="segmented" role="group" aria-label="경보 범위"><button type="button" data-action="alert-scope" data-scope="all">전체</button><button type="button" data-action="alert-scope" data-scope="holdings">보유</button></div></div>
    <ul class="alerts" id="alerts-list"><li class="empty">불러오는 중</li></ul>
    <p class="card__foot" id="alerts-note">빗썸이 투자 주의가 필요하다고 표시한 거래 페어입니다. 매매 권유나 판단이 아닙니다.</p></section>`,
  watchlist: () => `<section class="card" id="watch-card" aria-labelledby="watch-title">
    <div class="card__head"><div><h2 id="watch-title">관심 코인 <span class="count" id="watch-count">0</span></h2><p class="card__sub">실시간 시세 · 빗썸 원화 마켓 · 이 브라우저에 저장</p></div>
      <form class="inline-form" id="watch-form"><label class="search">${icon('search')}<input class="input" id="watch-input" list="market-options" placeholder="코인 이름 또는 심볼" aria-label="관심 코인 추가" autocomplete="off"></label><button type="submit" class="button">${icon('plus')}추가</button></form></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="관심 코인 시세 표"><table class="table watch-table"><thead><tr><th scope="col">자산</th><th scope="col">현재가</th><th scope="col">전일 대비</th><th scope="col" class="col-volume">거래대금(24시간)</th><th scope="col" class="col-spark">30일</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead><tbody id="watch-body"><tr><td colspan="6" class="empty">불러오는 중</td></tr></tbody></table></div></section>`,
  coinchart: () => `<section class="card coin-card" id="coin-card" aria-labelledby="coin-title">
    <div class="coin-top"><form class="inline-form coin-search" id="coin-form"><label class="search">${icon('search')}<input class="input" id="coin-input" list="market-options" placeholder="코인 이름·심볼 (예: BTC)" aria-label="차트로 볼 코인" autocomplete="off"></label><button type="submit" class="button">보기</button></form>
      <div class="chips" id="coin-chips" role="group" aria-label="보유·관심 코인"></div></div>
    <div class="coin-head"><div class="coin-name"><span class="avatar avatar--lg" id="coin-avatar" aria-hidden="true"></span><div><h2 id="coin-title">—</h2><p class="muted small" id="coin-sub">—</p></div></div>
      <div class="coin-price"><strong id="coin-price">—</strong><span id="coin-change"></span></div></div>
    <div class="coin-controls"><div class="segmented" role="group" aria-label="캔들 간격">${INTERVALS.map(([value, label]) => `<button type="button" data-action="interval" data-interval="${value}">${label}</button>`).join('')}</div>
      <div class="chips" role="group" aria-label="보조 지표">${OVERLAYS.map(([value, label]) => `<button type="button" class="chip chip--${value}" data-action="overlay" data-overlay="${value}">${label}</button>`).join('')}</div></div>
    <div class="candles" id="candles"><span class="skeleton chart-skeleton"></span></div>
    <dl class="coin-stats" id="coin-stats"></dl></section>`,
  returns: () => `<section class="card" id="returns-card" aria-labelledby="returns-title">
    <div class="card__head"><div><h2 id="returns-title">실제 수익률</h2><p class="card__sub">입출금을 뺀 손익 · 코인 입출금은 그날 종가로 환산 · 추정치</p></div>
      <div class="segmented" role="group" aria-label="수익률 기간">${[3, 6, 12].map(m => `<button type="button" data-action="returns-months" data-months="${m}">${m}개월</button>`).join('')}</div></div>
    <div id="returns-body"><span class="skeleton chart-skeleton"></span></div></section>`,
  monthly: () => `<section class="card" aria-labelledby="monthly-title">
    <div class="card__head"><div><h2 id="monthly-title">월별 손익</h2><p class="card__sub">월말 평가금액 변화에서 그달 순입금을 뺀 값 · 빨강 수익, 파랑 손실</p></div></div>
    <div class="monthly-chart" id="monthly-chart"><span class="skeleton chart-skeleton"></span></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="월별 손익 표"><table class="table monthly-table"><thead><tr><th scope="col">월</th><th scope="col">순입금</th><th scope="col">실현손익</th><th scope="col">수수료</th><th scope="col">월말 평가금액</th><th scope="col">월 손익</th></tr></thead><tbody id="monthly-body"></tbody></table></div></section>`,
  realized: () => `<section class="card" aria-labelledby="realized-title"><div class="card__head"><div><h2 id="realized-title">실현손익</h2><p class="card__sub">기간 안의 매도 · 평균 매수가 방식 추정 · 수수료 차감</p></div></div><div class="perf" id="realized-body"><span class="skeleton stack-skeleton"></span></div></section>`,
  averaging: () => `<section class="card" id="avg-card" aria-labelledby="avg-title">
    <div class="card__head"><div><h2 id="avg-title">물타기·불타기 계산기</h2><p class="card__sub">추가로 사면 평균 매수가가 어떻게 바뀌는지 · 수수료 제외 · 참고용</p></div></div>
    <div class="tool"><div class="tool__form">
      <label class="field"><span>자산</span><select class="input" id="avg-symbol"></select></label>
      <div class="field-row"><label class="field"><span>보유 수량</span><input class="input" id="avg-qty" type="number" step="any" inputmode="decimal"></label><label class="field"><span>평균 매수가(원)</span><input class="input" id="avg-avg" type="number" step="any" inputmode="decimal"></label></div>
      <div class="field-row"><label class="field"><span>추가 매수 가격(원)</span><input class="input" id="avg-price" type="number" step="any" inputmode="decimal"></label><label class="field"><span>추가 매수 금액(원)</span><input class="input" id="avg-amount" type="number" step="any" inputmode="decimal" placeholder="예: 1000000"></label></div>
      <div class="chips" role="group" aria-label="금액 빠르게 더하기">${[100000, 500000, 1000000, 5000000].map(v => `<button type="button" class="chip" data-action="avg-add" data-amount="${v}">+${v >= 10000 ? `${v / 10000}만` : v}</button>`).join('')}<button type="button" class="chip" data-action="avg-add" data-amount="0">지우기</button></div>
      <label class="field"><span>목표 평균 매수가(선택) <small>그 평단을 만들려면 얼마나 사야 하는지</small></span><input class="input" id="avg-target" type="number" step="any" inputmode="decimal"></label>
    </div><div class="tool__result" id="avg-result" aria-live="polite"></div></div></section>`,
  rebalance: () => `<section class="card" id="reb-card" aria-labelledby="reb-title">
    <div class="card__head"><div><h2 id="reb-title">목표 비중 리밸런싱</h2><p class="card__sub">목표 비중으로 맞추려면 얼마나 사고팔아야 하는지 · 주문하지 않습니다</p></div>
      <div class="chips" role="group" aria-label="목표 비중 빠르게 채우기"><button type="button" class="chip" data-action="reb-preset" data-preset="current">현재 비중</button><button type="button" class="chip" data-action="reb-preset" data-preset="equal">균등</button><button type="button" class="chip" data-action="reb-preset" data-preset="cash10">원화 10% 유지</button></div></div>
    <div class="toolbar"><label class="field field--inline"><span>추가 투입 금액(원)</span><input class="input" id="reb-cash" type="number" step="any" inputmode="decimal" placeholder="0"></label></div>
    <div class="reb-bars" id="reb-bars" aria-hidden="true"></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="리밸런싱 표"><table class="table reb-table"><thead><tr><th scope="col">자산</th><th scope="col">현재</th><th scope="col">목표 비중</th><th scope="col">목표 금액</th><th scope="col">사고팔 금액</th><th scope="col">수량</th></tr></thead><tbody id="reb-body"></tbody></table></div>
    <p class="card__foot" id="reb-foot"></p></section>`,
  scenario: () => `<section class="card" id="scn-card" aria-labelledby="scn-title">
    <div class="card__head"><div><h2 id="scn-title">시나리오 시뮬레이터</h2><p class="card__sub">가격이 바뀌면 내 자산이 어떻게 변하는지 · 원화는 그대로</p></div>
      <div class="chips" role="group" aria-label="시나리오 예시"><button type="button" class="chip" data-action="scn-preset" data-preset="btc10">BTC +10%</button><button type="button" class="chip" data-action="scn-preset" data-preset="down20">전체 −20%</button><button type="button" class="chip" data-action="scn-preset" data-preset="up30">전체 +30%</button><button type="button" class="chip" data-action="scn-preset" data-preset="reset">초기화</button></div></div>
    <div class="tool"><div class="tool__form" id="scn-sliders"></div><div class="tool__result" id="scn-result" aria-live="polite"></div></div></section>`,
  allocation: () => `<section class="card" aria-labelledby="allocation-title"><div class="card__head"><div><h2 id="allocation-title">자산 비중</h2><p class="card__sub" id="allocation-sub">원화 포함 · 평가금액 기준</p></div></div><div id="allocation" class="allocation"><span class="skeleton stack-skeleton"></span></div></section>`,
  holdings: () => `<section class="card holdings-card" id="holdings" aria-labelledby="holdings-title">
    <div class="card__head"><div><h2 id="holdings-title">보유 자산 <span class="count" id="holding-count">0</span></h2><p class="card__sub" id="holding-filter-summary" role="status"></p></div><button type="button" class="button button--quiet" id="export" data-action="export" disabled>${icon('download')}CSV</button></div>
    <div class="toolbar"><label class="search">${icon('search')}<input class="input" id="search" type="search" placeholder="자산명 또는 심볼 검색" aria-label="보유자산 검색"></label>
      <label class="switch"><input type="checkbox" id="cash-filter"><span>원화 제외</span></label>
      <select class="input" id="performance" aria-label="손익 필터"><option value="all">손익 전체</option><option value="gain">수익 자산</option><option value="loss">손실 자산</option><option value="unknown">손익 미확인</option></select>
      <select class="input" id="sort" aria-label="정렬 기준"><option value="value">평가금액순</option><option value="profit">수익률순</option><option value="pnl">평가손익순</option><option value="change">전일 대비순</option><option value="name">이름순</option></select>
      <button type="button" class="button" id="sort-direction" data-action="sort-direction" aria-label="정렬 방향">높은 순 ↓</button>
      <button type="button" class="button button--ghost" data-action="filter-reset">초기화</button></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="보유자산 표"><table class="table holdings-table"><thead><tr><th scope="col">자산</th><th scope="col" class="col-price">현재가 · 전일 대비</th><th scope="col" class="col-spark">30일 시세</th><th scope="col" class="col-qty">보유 수량</th><th scope="col">평가금액 · 비중</th><th scope="col">평가손익</th></tr></thead><tbody id="holdings-body"><tr><td colspan="6" class="empty">불러오는 중</td></tr></tbody></table></div>
    <p class="card__foot">평가손익은 API 평균 매수가 기준이며 수수료와 실현손익은 포함하지 않습니다. 가격·원가 미확인 항목은 합계에서 제외됩니다. 30일 시세는 원화 마켓 일봉 종가입니다.</p></section>`,
  activity: () => `<section class="card" id="activity" aria-labelledby="activity-title">
    <div class="card__head"><div><h2 id="activity-title">거래·입출금 내역</h2><p class="card__sub">조회 전용 · 최대 366일 · 한국 시간</p></div><button type="button" class="button button--quiet" id="activity-export" data-action="activity-export" disabled>${icon('download')}CSV</button></div>
    <div class="toolbar">
      <select class="input" id="activity-kind" aria-label="내역 종류">${Object.entries(KINDS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <div class="date-range"><input class="input" type="date" id="activity-from" aria-label="시작일"><span class="muted">~</span><input class="input" type="date" id="activity-to" aria-label="종료일"></div>
      <div class="chips" id="activity-presets" role="group" aria-label="빠른 기간"><button type="button" class="chip" data-action="activity-period" data-period="7">최근 7일</button><button type="button" class="chip" data-action="activity-period" data-period="30">최근 30일</button><button type="button" class="chip" data-action="activity-period" data-period="month">이번 달</button></div>
      <button type="button" class="button button--primary" id="activity-load" data-action="activity">내역 조회</button>
      <button type="button" class="button button--ghost" id="activity-cancel" data-action="activity-cancel" hidden>조회 중단</button>
    </div>
    <div class="toolbar" id="activity-filters" hidden><label class="search">${icon('search')}<input type="search" class="input" id="activity-search" aria-label="거래 내역 검색" placeholder="자산·마켓·상태 검색"></label><select class="input" id="activity-status" aria-label="거래 상태"><option value="all">상태 전체</option></select><select class="input" id="activity-side" aria-label="매수·매도"><option value="all">매수·매도 전체</option><option value="bid">매수</option><option value="ask">매도</option></select></div>
    <p class="coverage" id="activity-coverage">종류와 기간(최대 366일, 한국 시간)을 고른 뒤 조회하세요.</p>
    <div class="empty-state" id="activity-empty">${icon('inbox')}<strong>아직 불러온 내역이 없어요</strong><span id="activity-hint">종류와 기간을 고른 뒤 내역 조회를 누르세요.</span></div>
    <div class="table-wrap" id="activity-table" tabindex="0" role="region" aria-label="거래·입출금 내역 표" hidden><table class="table"><thead><tr><th scope="col">종류 / 자산</th><th scope="col">시각</th><th scope="col">수량 / 금액</th><th scope="col">수수료</th><th scope="col">상태</th></tr></thead><tbody id="activity-body"><tr><td colspan="5" class="empty">조회 전입니다.</td></tr></tbody></table></div>
    <div class="pagination"><button type="button" class="button" id="activity-more" data-action="activity-more" hidden>더 보기</button></div></section>`,
};
// 위젯을 보드 순서대로 배치합니다. 요약 뒤의 추이는 요약 카드에 합치고, 추이와 비중이 이어지면 한 줄에 나란히 둡니다.
function mount() {
  const b = board(), page = PAGES[state.page], widgets = widgetsNow(), parts = [];
  $('#board-name').textContent = page.title ?? b.name;
  $('#board-scope').textContent = page.title ? page.description : `${b.symbols.length ? b.symbols.join(' · ') : '원화 포함 전체 자산'} · ${REFRESH[b.refreshSeconds]}`;
  $('#board-edit').hidden = state.page !== 'home';
  for (let i = 0; i < widgets.length; i++) {
    const [current, next] = [widgets[i], widgets[i + 1]];
    if (current === 'summary' && next === 'trend') { parts.push(TEMPLATES.summary(true)); i++; }
    else if ((WIDE.has(current) && NARROW.has(next)) || (NARROW.has(current) && WIDE.has(next))) {
      parts.push(`<div class="pair${NARROW.has(current) ? ' pair--reversed' : ''}">${TEMPLATES[current]()}${TEMPLATES[next]()}</div>`);
      i++;
    } else parts.push(TEMPLATES[current]());
  }
  $('#widgets').innerHTML = parts.join('');
  restoreFilters();
  if ($('#activity-from')) {
    const range = recordDates(7, now());
    $('#activity-to').value = range.to;
    $('#activity-from').value = range.from;
  }
  syncTrendControls(); syncSegments();
  charts.disconnect();
  for (const id of ['#chart', '#heatmap', '#candles', '#monthly-chart', '#returns-body']) if ($(id)) charts.observe($(id));
}
function schedule() {
  clearInterval(state.timer);
  const seconds = board()?.refreshSeconds;
  if (seconds) state.timer = setInterval(() => { if (!document.hidden && !state.paused && !$('#refresh').disabled && !document.querySelector('dialog[open]')) void load(); }, seconds * 1000);
}
function connectionStatus() {
  const box = $('#connection-status');
  if (!box) return;
  box.classList.toggle('is-error', state.failed);
  box.classList.toggle('is-loading', state.loading);
  $('#auto-refresh').hidden = !board()?.refreshSeconds;
  $('#auto-refresh').textContent = state.paused ? '자동 갱신 재개' : '자동 갱신 중지';
  $('#auto-refresh').setAttribute('aria-pressed', String(state.paused));
  box.textContent = state.loading ? '자산을 갱신하고 있습니다…' : state.failed ? '갱신 실패 · 마지막 조회 결과 유지' : state.lastLoaded
    ? `${state.status.sample ? '샘플 기준' : '마지막 조회'} ${date(state.lastLoaded)} · ${state.status.sample ? '오프라인 샘플' : document.hidden || document.querySelector('dialog[open]') || state.paused ? '자동 갱신 일시 정지' : REFRESH[board()?.refreshSeconds]}` : '연결 확인 중';
}

// ===== 조회 =====
async function load(force = false) {
  const b = board();
  if (!b) return;
  const widgets = widgetsNow();
  // 시장 시세·경보는 계좌와 무관한 공개 데이터라 자산 조회와 함께 가져옵니다.
  if (widgets.includes('market')) void loadTickers(force);
  if (widgets.includes('warnings')) void loadAlerts(force);
  const request = beginRequest('portfolio');
  state.loading = true; connectionStatus();
  $('#refresh').disabled = true;
  $('#refresh').classList.add('is-busy');
  $('#refresh-label').textContent = '갱신 중…';
  // 다시 불러오는 동안 지난 화면을 흐리게 유지해 레이아웃이 흔들리지 않게 합니다.
  $('#widgets').classList.toggle('is-refreshing', Boolean(state.portfolio));
  $('#summary')?.setAttribute('aria-busy', 'true');
  try {
    const portfolio = await api(`/api/portfolio?${query({ symbols: scope(), force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.portfolio = portfolio;
    state.lastLoaded = portfolio.asOf; state.failed = false;
    showError('');
    renderPortfolio(); renderTools(); evaluateAlerts();
    if (widgets.includes('trend')) { if (state.view === 'calendar') state.history = null; else state.daily = null; void loadHistory(); }
    if (widgets.some(widget => ['watchlist', 'coinchart'].includes(widget))) void loadMarketList();
    if (widgets.includes('watchlist')) void loadWatch(force);
    if (widgets.includes('coinchart') && (force || !state.chart.data)) void loadCandles(force);
    if (widgets.includes('returns') && (force || state.returns?.months !== state.returnsMonths)) void loadReturns(force);
    else if (widgets.includes('returns')) { renderReturns(); renderMonthly(); renderRealized(); }
    connectLive();
    if (force && state.activity && $('#activity-load')) void loadActivity(true);
    if (!fixture && state.status.mode !== 'demo') {
      const status = await api('/api/status', { signal: request.signal });
      if (request.current() && status.historyError) showError(`추이 기록: ${status.historyError.message}`);
    }
  } catch (error) {
    if (!request.current()) return;
    state.failed = true;
    showError(`${error.message}${state.portfolio ? ' 마지막으로 성공한 조회 결과를 표시합니다.' : ''}`);
    if (!state.portfolio) renderFailure();
  } finally {
    if (request.current()) {
      state.loading = false; connectionStatus();
      $('#refresh').disabled = false; $('#refresh').classList.remove('is-busy'); $('#refresh-label').textContent = '새로고침';
      $('#widgets').classList.remove('is-refreshing');
      $('#summary')?.setAttribute('aria-busy', 'false');
    }
  }
}
function renderFailure() {
  if ($('#updated')) $('#updated').textContent = '조회 실패 · 새로고침으로 다시 시도하세요.';
  if ($('#total')) $('#total').textContent = '—';
  if ($('#holdings-body')) $('#holdings-body').innerHTML = '<tr><td colspan="6" class="empty">계좌 데이터를 가져오지 못했습니다.</td></tr>';
  if ($('#allocation')) $('#allocation').innerHTML = '<p class="empty">자산 데이터가 없습니다.</p>';
  if ($('#chart')) $('#chart').innerHTML = '<p class="empty">연결 후 추이를 확인할 수 있습니다.</p>';
  for (const id of ['#insights', '#perf-chart', '#heatmap']) if ($(id)) $(id).innerHTML = '<p class="empty">계좌 데이터를 가져오지 못했습니다.</p>';
}
async function loadHistory() {
  const b = board();
  if (!b || !widgetsNow().includes('trend')) return;
  const request = beginRequest('history'), calendar = state.view === 'calendar';
  const params = calendar ? { days: 365, daily: 1, symbols: scope() } : { days: b.days, symbols: scope() };
  try {
    const result = await api(`/api/history?${query(params)}`, { signal: request.signal });
    if (!request.current()) return;
    if (calendar) state.daily = result; else state.history = result;
    renderTrend();
  } catch (error) {
    if (!request.current()) return;
    const box = $(calendar ? '#calendar' : '#chart');
    if (box) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; box.classList.remove('is-stale'); }
    if ($('#history-summary')) $('#history-summary').textContent = '조회 실패';
  }
}

// ===== 요약·비중·보유 내역 =====
function renderPortfolio() {
  const p = state.portfolio;
  if (!p) return;
  $('#warnings').textContent = p.warnings.join(' ');
  $('#warnings').hidden = !p.warnings.length;
  state.series = seriesMap(p.holdings);
  renderSummary(); renderInsights(); renderAllocation(); renderHeatmap(); renderPerformance(); renderHoldings();
  // 시세 표가 먼저 도착했으면 보유 자산 색을 다시 입힙니다.
  renderTickers();
}
function setFigure(value) {
  if ($('#total')) $('#total').innerHTML = `${state.hidden ? '••••••••' : number(value)}<span class="unit">원</span>`;
}
function renderSummary() {
  const p = state.portfolio;
  if (!p || !$('#summary')) return;
  const s = p.summary;
  $('#total-label').textContent = s.valuationComplete ? '총 평가금액' : '확인된 평가금액';
  $('#updated').textContent = `${date(p.asOf)} 기준${p.mode === 'demo' ? ' · 합성 예시' : ''}`;
  setFigure(s.totalValueKrw);
  $('#day-change').textContent = money(s.dayChangeKrw, true);
  $('#day-change').className = tone(s.dayChangeKrw);
  $('#day-change-rate').textContent = missing(s.dayChangeKrw) ? '전일 대비 미확인' : `${percent(s.dayChangePct)} · 전일 종가 대비${s.dayChangeComplete === false ? ' · 일부 자산' : ''}`;
  $('#day-change-rate').className = tone(s.dayChangeKrw);
  $('#profit').textContent = money(s.profitKrw, true);
  $('#profit').className = tone(s.profitKrw);
  $('#profit-rate').textContent = `${percent(s.profitRatePct)}${s.profitComplete ? '' : ' · 일부 자산 기준'}`;
  $('#profit-rate').className = tone(s.profitKrw);
  $('#crypto-total').textContent = money(s.cryptoValueKrw);
  $('#count').textContent = state.hidden ? '••종' : `${s.assetCount}종 · ${share(s.cryptoValueKrw, s.totalValueKrw)}`;
  $('#cash').textContent = money(s.cashKrw);
  $('#cash-share').textContent = state.hidden ? '주문 중 금액 포함' : `${share(s.cashKrw, s.totalValueKrw)} · 주문 중 금액 포함`;
  heroReadout(chartModels.get('chart')?.index ?? null);
}
// 히어로 아래 줄: 평소에는 선택한 기간의 변화, 차트를 탐색하는 동안에는 그 시점의 값과 변화입니다.
function heroReadout(index) {
  const delta = $('#hero-delta');
  if (!delta) return;
  const model = chartModels.get('chart'), points = model?.points ?? [], point = index === null ? null : points[index];
  if (state.view === 'calendar') { delta.innerHTML = ''; setFigure(state.portfolio?.summary.totalValueKrw); return; }
  if (state.hidden) { delta.innerHTML = state.history ? `${deltaPill(0, 0)}<span>${PERIOD_LABEL[board()?.days] ?? '기록 구간'}</span>` : ''; setFigure(null); return; }
  if (point) {
    setFigure(point.value);
    delta.innerHTML = `${deltaPill(point.value - points[0].value, points[0].value)}<span>${esc(shortDay(points[0].at))} 대비 · ${esc(date(point.at))} 기록</span>`;
    return;
  }
  if (state.portfolio) setFigure(state.portfolio.summary.totalValueKrw);
  // 실시간 가격으로 총액이 바뀌면 기간 변화도 지금 총액을 기준으로 맞춥니다(총액을 모르면 마지막 기록).
  const total = state.portfolio?.summary.totalValueKrw, latest = missing(total) ? points.at(-1)?.value : Number(total);
  delta.innerHTML = points.length > 1
    ? `${deltaPill(latest - points[0].value, points[0].value)}<span>${PERIOD_LABEL[board()?.days] ?? '기록 구간'} · 입출금 포함</span>`
    : state.history ? '<span>기록이 쌓이면 기간 변화가 표시됩니다.</span>' : '';
}
function renderAllocation() {
  const box = $('#allocation');
  if (!box || !state.portfolio) return;
  const priced = state.portfolio.holdings.filter(h => h.valueKrw !== null && Number(h.allocationPct) > 0);
  if (state.hidden || !priced.length) {
    if ($('#allocation-sub')) $('#allocation-sub').textContent = '원화 포함 · 평가금액 기준';
    box.innerHTML = `<p class="empty">${state.hidden ? '금액과 자산 비중을 숨겼습니다.' : '평가 가능한 자산이 없습니다.'}</p>`;
    return;
  }
  const crypto = priced.filter(h => h.symbol !== 'KRW'), cash = priced.find(h => h.symbol === 'KRW'), rest = crypto.slice(5);
  const slices = crypto.slice(0, 5).map(h => ({ key: h.symbol, symbol: h.symbol, name: h.name, pct: Number(h.allocationPct), value: h.valueKrw, cls: seriesClass(h.symbol) }));
  if (cash) slices.push({ key: 'KRW', symbol: 'KRW', name: '원화', pct: Number(cash.allocationPct), value: cash.valueKrw, cls: 'c-cash' });
  if (rest.length) slices.push({ key: 'other', symbol: '', name: `기타 ${rest.length}종`, pct: rest.reduce((sum, h) => sum + Number(h.allocationPct), 0), value: rest.reduce((sum, h) => sum + Number(h.valueKrw), 0), cls: 'c-other', title: rest.map(h => h.symbol).join(', ') });
  const cryptoPct = crypto.reduce((sum, h) => sum + Number(h.allocationPct), 0);
  if ($('#allocation-sub')) $('#allocation-sub').textContent = `가상자산 ${number(cryptoPct, 1)}% · 원화 ${number(cash ? cash.allocationPct : 0, 1)}% · ${priced.length}개 자산`;
  const item = s => `<span class="swatch" aria-hidden="true"></span><span class="legend__name">${esc(s.name)}${s.symbol && s.symbol !== 'KRW' && s.symbol !== s.name ? `<small>${esc(s.symbol)}</small>` : ''}</span><span class="legend__nums"><b class="legend__pct">${number(s.pct, 1)}%</b><span class="legend__value">${money(s.value)}</span></span>`;
  morph(box, `<div class="stack" role="img" aria-label="${esc(`자산 비중:${slices.map(s => `${s.name} ${number(s.pct, 1)}%`).join(', ')}`)}">${slices.map(s => `<span class="stack__seg ${s.cls}" data-key="${esc(s.key)}" data-share="${s.pct}"></span>`).join('')}</div>
    <ul class="legend">${slices.map(s => `<li>${s.symbol
      ? `<button type="button" class="legend__item ${s.cls}" data-action="detail" data-symbol="${esc(s.symbol)}" data-key="${esc(s.key)}">${item(s)}</button>`
      : `<div class="legend__item ${s.cls}" data-key="other" title="${esc(s.title)}">${item(s)}</div>`}</li>`).join('')}</ul>`);
  applyShares(box);
}
function renderHoldings() {
  const body = $('#holdings-body');
  if (!body || !state.portfolio) return;
  const p = state.portfolio, rows = visibleHoldings();
  $('#holding-count').textContent = `${rows.length} / ${p.holdings.length}`;
  $('#holding-filter-summary').textContent = `${p.holdings.length}개 중 ${rows.length}개 표시 · CSV에도 현재 검색·필터·정렬을 적용합니다.`;
  $('#export').disabled = state.hidden || !rows.length;
  const asc = state.filters.direction === 'asc', name = state.filters.sort === 'name';
  $('#sort-direction').textContent = name ? (asc ? '가나다순 ↑' : '역순 ↓') : (asc ? '낮은 순 ↑' : '높은 순 ↓');
  $('#sort-direction').setAttribute('aria-label', `정렬 방향: ${$('#sort-direction').textContent}. 누르면 반대로 정렬`);
  morph(body, rows.length ? rows.map(holdingRow).join('') : '<tr><td colspan="6" class="empty">표시할 자산이 없습니다.</td></tr>');
  applyShares(body);
  void loadSparks(rows.filter(h => h.symbol !== 'KRW' && !h.priceSource?.startsWith('BTC-')).map(h => h.symbol));
}
function holdingRow(h) {
  const cash = h.symbol === 'KRW', cls = seriesClass(h.symbol);
  const change = h.staleQuote ? '시세 지연 · ' : '';
  const changeText = cash ? '원화 잔고' : h.priceSource?.startsWith('BTC-') ? 'BTC 마켓 환산' : missing(h.priceChangePct) ? '전일 대비 미확인' : `${Number(h.priceChangePct) > 0 ? '+' : ''}${number(h.priceChangePct, 2)}%`;
  const allocation = state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`;
  return `<tr data-symbol="${esc(h.symbol)}">
    <td class="col-asset"><button type="button" class="asset" data-action="detail" data-symbol="${esc(h.symbol)}" aria-label="${esc(h.name)} 상세 보기"><span class="avatar ${cls}" aria-hidden="true">${esc(monogram(h.symbol))}</span><span class="asset__text"><span class="asset__name">${esc(h.name)}${h.marketWarning ? `<span class="flag" title="빗썸 거래 유의 지정">${icon('alert')}유의</span>` : ''}</span><span class="asset__sym">${esc(h.symbol)}</span><span class="asset__mobile">${state.hidden ? '••••' : esc(number(h.quantity, 8))} ${esc(h.symbol)}</span></span></button></td>
    <td class="col-price">${cash ? '—' : h.currentPriceKrw === null ? '가격 미확인' : price(h.currentPriceKrw)}<small class="${cash ? '' : sign(h.priceChangePct)}">${change}${changeText}</small></td>
    <td class="col-spark" data-spark="${esc(h.symbol)}">${sparkCell(h.symbol)}</td>
    <td class="col-qty">${state.hidden ? '••••' : esc(number(h.quantity, 8))}<small>${esc(h.symbol)}</small></td>
    <td class="col-value"><span class="cell-strong">${money(h.valueKrw)}</span>${h.valueKrw === null ? '<small>합계에서 제외</small>' : `<span class="share ${cls}"><span class="share__track"><span class="share__fill" data-share="${state.hidden ? 0 : Number(h.allocationPct ?? 0)}"></span></span>${allocation}</span>`}</td>
    <td class="col-pnl ${tone(h.profitKrw)}">${cash ? '—' : money(h.profitKrw, true)}<small class="${tone(h.profitKrw)}">${cash ? '현금' : percent(h.profitRatePct)}</small></td>
  </tr>`;
}

// ===== 보유 자산 30일 시세 선 =====
function sparkCell(symbol) {
  if (symbol === 'KRW') return '';
  const spark = state.sparks.get(symbol);
  if (!spark) return '<span class="spark-placeholder skeleton" aria-hidden="true"></span>';
  const closes = spark.closes;
  if (closes.length < 2) return '<span class="muted small">—</span>';
  const width = 96, height = 32, pad = 3, low = Math.min(...closes), high = Math.max(...closes), span = high - low || 1;
  const points = closes.map((value, i) => [pad + i / (closes.length - 1) * (width - pad * 2), height - pad - (value - low) / span * (height - pad * 2)]);
  const change = (closes.at(-1) - closes[0]) / closes[0] * 100;
  return `<svg class="spark ${sign(change)}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><path d="${smoothPath(points)}"/></svg><span class="sr-only">30일 시세 ${number(change, 2)}%</span>`;
}
async function loadSparks(symbols) {
  const queue = symbols.filter(symbol => /^[A-Z0-9_]+$/i.test(symbol) && !state.sparkPending.has(symbol) && !(Date.now() - (state.sparks.get(symbol)?.at ?? 0) < SPARK_TTL));
  for (const symbol of queue) state.sparkPending.add(symbol);
  // 거래소 요청이 몰리지 않게 두 개씩만 가져옵니다. 결과는 자산별로 10분간 재사용합니다.
  const worker = async () => {
    for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
      try {
        const market = await api(`/api/market?${query({ symbol, days: 30 })}`);
        state.sparks.set(symbol, { at: Date.now(), closes: market.candles.map(c => Number(c.closeKrw)).filter(Number.isFinite) });
      } catch { state.sparks.set(symbol, { at: Date.now(), closes: [] }); }
      finally { state.sparkPending.delete(symbol); }
      const cell = document.querySelector(`[data-spark="${symbol}"]`);
      if (cell) cell.innerHTML = sparkCell(symbol);
    }
  };
  await Promise.all([worker(), worker()]);
}
// ===== 인사이트 · 손익 분석 · 히트맵 =====
// 세그먼트 버튼의 선택 표시를 상태와 맞춥니다.
function syncSegments() {
  const pairs = [['perf-metric', 'metric', state.perfMetric], ['heat-metric', 'metric', state.heatMetric], ['market-tab', 'tab', state.marketTab], ['alert-scope', 'scope', state.alertScope], ['returns-months', 'months', String(state.returnsMonths)]];
  for (const [action, key, value] of pairs) for (const button of document.querySelectorAll(`[data-action="${action}"]`)) {
    button.classList.toggle('selected', button.dataset[key] === value);
    button.setAttribute('aria-pressed', String(button.dataset[key] === value));
  }
}
// 오늘의 인사이트: 계산된 사실만 짧게 보여줍니다. 매매를 권하지 않습니다.
function renderInsights() {
  const box = $('#insights');
  if (!box || !state.portfolio) return;
  const holdings = state.portfolio.holdings, crypto = holdings.filter(h => h.symbol !== 'KRW' && h.valueKrw !== null);
  const moved = crypto.filter(h => !missing(h.priceChangePct)).sort((a, b) => Number(b.priceChangePct) - Number(a.priceChangePct));
  const ranked = crypto.filter(h => !missing(h.profitRatePct)).sort((a, b) => Number(b.profitRatePct) - Number(a.profitRatePct));
  const priced = holdings.filter(h => Number(h.allocationPct) > 0), cash = holdings.find(h => h.symbol === 'KRW'), flagged = holdings.filter(h => h.marketWarning);
  const impact = h => { const value = Number(h.valueKrw), rate = Number(h.priceChangePct) / 100; return value - value / (1 + rate); };
  const top = moved[0], bottom = moved.at(-1), best = ranked[0], worst = ranked.at(-1);
  const cards = [
    top && Number(top.priceChangePct) > 0
      ? { icon: 'rise', label: '오늘 가장 많이 오른 자산', name: top.name, metric: percent(top.priceChangePct), tone: tone(top.priceChangePct), sub: `평가금액 영향 ${money(impact(top), true)}` }
      : { icon: 'rise', label: '오늘 오른 자산', name: '없음', metric: '', sub: '전일 종가 대비' },
    bottom && Number(bottom.priceChangePct) < 0
      ? { icon: 'fall', label: '오늘 가장 많이 내린 자산', name: bottom.name, metric: percent(bottom.priceChangePct), tone: tone(bottom.priceChangePct), sub: `평가금액 영향 ${money(impact(bottom), true)}` }
      : { icon: 'fall', label: '오늘 내린 자산', name: '없음', metric: '', sub: '전일 종가 대비' },
    best && { icon: 'trophy', label: '수익률이 가장 높은 자산', name: best.name, metric: percent(best.profitRatePct), tone: tone(best.profitRatePct), sub: `평가손익 ${money(best.profitKrw, true)}` },
    worst && worst !== best && { icon: 'low', label: '수익률이 가장 낮은 자산', name: worst.name, metric: percent(worst.profitRatePct), tone: tone(worst.profitRatePct), sub: `평가손익 ${money(worst.profitKrw, true)}` },
    priced[0] && { icon: 'pie', label: '비중이 가장 큰 자산', name: priced[0].name, metric: state.hidden ? '••' : `${number(priced[0].allocationPct, 1)}%`, sub: `상위 3개 합계 ${state.hidden ? '••' : `${number(priced.slice(0, 3).reduce((sum, h) => sum + Number(h.allocationPct), 0), 1)}%`}` },
    { icon: 'wallet', label: '원화 비중', name: state.hidden ? '••' : share(state.portfolio.summary.cashKrw, state.portfolio.summary.totalValueKrw), metric: '', sub: `주문 가능 ${money(cash?.available ?? 0)} · 주문 중 ${money(cash?.locked ?? 0)}` },
    flagged.length && { icon: 'alert', label: '거래 유의 지정 보유', name: `${flagged.length}개`, metric: flagged.map(h => h.symbol).join(', '), tone: 'warn', sub: '빗썸 거래 유의 종목 기준' },
  ].filter(Boolean);
  box.innerHTML = cards.map(card => `<article class="insight${card.tone === 'warn' ? ' insight--warn' : ''}"><span class="insight__icon">${icon(card.icon)}</span><div class="insight__body"><p class="insight__label">${esc(card.label)}</p><p class="insight__value"><span>${esc(card.name)}</span>${card.metric ? ` <b class="${card.tone ?? ''}">${esc(card.metric)}</b>` : ''}</p><p class="insight__sub">${esc(card.sub)}</p></div></article>`).join('');
}
// 손익 분석: 0을 기준으로 수익은 오른쪽(빨강), 손실은 왼쪽(파랑)으로 뻗는 막대입니다.
function renderPerformance() {
  const box = $('#perf-chart');
  if (!box || !state.portfolio) return;
  const s = state.portfolio.summary, key = state.perfMetric === 'rate' ? 'profitRatePct' : 'profitKrw';
  const rows = state.portfolio.holdings.filter(h => h.symbol !== 'KRW' && !missing(h[key])).sort((a, b) => Number(b[key]) - Number(a[key]));
  const gains = rows.filter(h => Number(h.profitKrw) > 0).length, losses = rows.filter(h => Number(h.profitKrw) < 0).length;
  const cost = Number(s.comparableCostKrw ?? 0), profit = s.profitKrw === null ? null : Number(s.profitKrw);
  $('#perf-summary').innerHTML = `<div><dt>원가 합계</dt><dd>${money(cost)}</dd></div><div><dt>평가금액</dt><dd>${profit === null ? '—' : money(cost + profit)}</dd></div><div><dt>평가손익</dt><dd class="${tone(profit)}">${money(profit, true)} <small>${percent(s.profitRatePct)}</small></dd></div><div><dt>수익 · 손실 자산</dt><dd>${gains}개 · ${losses}개</dd></div>`;
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; return; }
  if (!rows.length) { box.innerHTML = '<p class="empty">평균 매수가를 확인할 수 있는 자산이 없습니다.</p>'; return; }
  const values = rows.map(h => Number(h[key])), maxUp = Math.max(0, ...values), maxDown = Math.max(0, ...values.map(v => -v)), span = maxUp + maxDown || 1, zero = maxDown / span * 100;
  morph(box, `<ul class="perf__list">${rows.map((h, i) => {
    const value = values[i], size = Math.abs(value) / span * 100, start = value >= 0 ? zero : zero - size;
    return `<li class="perf__row" data-symbol="${esc(h.symbol)}"><button type="button" class="perf__name" data-action="detail" data-symbol="${esc(h.symbol)}"><span class="avatar ${seriesClass(h.symbol)}" aria-hidden="true">${esc(monogram(h.symbol))}</span><span>${esc(h.name)}<small>${esc(h.symbol)}</small></span></button>
      <span class="perf__track" aria-hidden="true"><span class="perf__zero" data-pos="${zero}"></span><span class="perf__bar ${sign(value)}" data-start="${start}" data-size="${size}"></span></span>
      <span class="perf__value ${sign(value)}">${key === 'profitKrw' ? money(value, true) : percent(value)}<small>${key === 'profitKrw' ? percent(h.profitRatePct) : money(h.profitKrw, true)}</small></span></li>`;
  }).join('')}</ul>`);
  for (const element of box.querySelectorAll?.('[data-start]') ?? []) { element.style.setProperty('--start', element.dataset.start); element.style.setProperty('--size', element.dataset.size); }
  for (const element of box.querySelectorAll?.('[data-pos]') ?? []) element.style.setProperty('--pos', element.dataset.pos);
}
// 정사각형에 가까운 칸으로 나누는 트리맵(squarified). items의 area 합은 w×h입니다.
function squarify(items, x, y, w, h) {
  const out = [], worst = (row, side) => { const sum = row.reduce((t, it) => t + it.area, 0), max = Math.max(...row.map(it => it.area)), min = Math.min(...row.map(it => it.area)); return Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min)); };
  let rest = items.filter(it => it.area > 0), rect = { x, y, w, h };
  while (rest.length) {
    const side = Math.min(rect.w, rect.h);
    let row = [rest[0]];
    for (let i = 1; i < rest.length && worst([...row, rest[i]], side) <= worst(row, side); i++) row = [...row, rest[i]];
    const thickness = row.reduce((t, it) => t + it.area, 0) / side;
    let offset = 0;
    for (const it of row) {
      const length = it.area / thickness;
      out.push(rect.w >= rect.h ? { ...it, x: rect.x, y: rect.y + offset, w: thickness, h: length } : { ...it, x: rect.x + offset, y: rect.y, w: length, h: thickness });
      offset += length;
    }
    rect = rect.w >= rect.h ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h } : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };
    rest = rest.slice(row.length);
  }
  return out;
}
const HEAT = { change: { key: 'priceChangePct', cap: 5, label: '전일 대비 등락률' }, profit: { key: 'profitRatePct', cap: 25, label: '평균 매수가 대비 수익률' } };
function renderHeatmap() {
  const box = $('#heatmap');
  if (!box || !state.portfolio) return;
  const metric = HEAT[state.heatMetric];
  if ($('#heatmap-metric')) $('#heatmap-metric').textContent = metric.label;
  const priced = state.portfolio.holdings.filter(h => h.valueKrw !== null && Number(h.valueKrw) > 0);
  if (state.hidden || !priced.length) { box.innerHTML = `<p class="empty">${state.hidden ? '금액과 자산 비중을 숨겼습니다.' : '평가 가능한 자산이 없습니다.'}</p>`; $('#heatmap-legend').innerHTML = ''; return; }
  const width = Math.max(280, box.clientWidth), height = width >= 720 ? 340 : width >= 480 ? 300 : 260, total = priced.reduce((sum, h) => sum + Number(h.valueKrw), 0);
  const tiles = squarify(priced.map(holding => ({ holding, area: Number(holding.valueKrw) / total * width * height })), 0, 0, width, height);
  box.dataset.width = String(box.clientWidth);
  morph(box, tiles.map(({ holding: h, x, y, w, h: tall }) => {
    const value = h.symbol === 'KRW' ? null : h[metric.key], level = missing(value) || Number(value) === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.abs(Number(value)) / metric.cap * 4)));
    const cls = h.symbol === 'KRW' ? 'heat-cash' : level ? `heat-${Number(value) > 0 ? 'up' : 'down'}-${level}` : 'heat-flat';
    const text = h.symbol === 'KRW' ? '원화' : missing(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${number(value, 2)}%`;
    const label = `${h.name} ${h.symbol}, 평가금액 ${money(h.valueKrw)}, 비중 ${number(h.allocationPct, 1)}%, ${metric.label} ${text}`;
    const roomy = w >= 64 && tall >= 46, large = w >= 140 && tall >= 92;
    return `<button type="button" class="heat-tile ${cls}" data-action="detail" data-symbol="${esc(h.symbol)}" data-box="${(x / width * 100).toFixed(3)},${(y / height * 100).toFixed(3)},${(w / width * 100).toFixed(3)},${(tall / height * 100).toFixed(3)}" aria-label="${esc(label)}" title="${esc(label)}">${roomy ? `<strong>${esc(h.symbol === 'KRW' ? '원화' : h.symbol)}</strong><span>${h.symbol === 'KRW' ? `${number(h.allocationPct, 1)}%` : esc(text)}</span>${large ? `<small>${esc(h.name)} · ${money(h.valueKrw)}</small>` : ''}` : ''}</button>`;
  }).join(''));
  box.style?.setProperty('--heat-height', `${height}px`);
  for (const tile of box.querySelectorAll?.('[data-box]') ?? []) {
    const [left, top, w, tall] = tile.dataset.box.split(',');
    Object.assign(tile.style, { left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${tall}%` });
  }
  const steps = [4, 3, 2, 1].map(l => `<span class="heat-down-${l}"></span>`).join('') + '<span class="heat-flat"></span>' + [1, 2, 3, 4].map(l => `<span class="heat-up-${l}"></span>`).join('');
  $('#heatmap-legend').innerHTML = `<span>▼ ${metric.cap}% 이상</span><span class="heat-scale">${steps}</span><span>▲ ${metric.cap}% 이상</span>`;
}

// ===== 시장 개요 · 경보 (빗썸 공개 시세) =====
const MARKET_TABS = { value: { scope: 'all', sort: 'value24h' }, gainers: { scope: 'all', sort: 'change' }, losers: { scope: 'all', sort: 'change', direction: 'asc' }, held: { scope: 'holdings', sort: 'value24h' } };
async function loadTickers(force = false) {
  if (!$('#market-body')) return;
  const request = beginRequest('tickers');
  $('#market-card').setAttribute('aria-busy', 'true');
  try {
    const result = await api(`/api/tickers?${query({ ...MARKET_TABS[state.marketTab], limit: 10, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.tickers = result;
    renderTickers();
  } catch (error) { if (request.current() && $('#market-body')) $('#market-body').innerHTML = `<tr><td colspan="4" class="empty">${esc(error.message)}</td></tr>`; }
  finally { if (request.current()) $('#market-card')?.setAttribute('aria-busy', 'false'); }
}
function renderTickers() {
  const body = $('#market-body'), t = state.tickers;
  if (!body || !t) return;
  $('#market-sub').textContent = `빗썸 원화 마켓 ${t.total}개 중 ${t.rows.length}개 · ${date(t.asOf)} 기준`;
  const live = row => { const tick = state.ticks.get(row.symbol); return tick ? { ...row, priceKrw: tick.priceKrw, changePct: tick.changePct ?? row.changePct, highKrw: tick.highKrw ?? row.highKrw, lowKrw: tick.lowKrw ?? row.lowKrw, value24hKrw: tick.value24hKrw ?? row.value24hKrw } : row; };
  body.innerHTML = t.rows.length ? t.rows.map(live).map((row, i) => `<tr>
    <td><span class="asset"><span class="rank">${i + 1}</span><span class="avatar ${row.held ? seriesClass(row.symbol) : 'c-none'}" aria-hidden="true">${esc(monogram(row.symbol))}</span><span class="asset__text"><span class="asset__name">${esc(row.name)}${row.held ? '<span class="tag">보유</span>' : ''}${row.marketWarning ? `<span class="flag" title="빗썸 거래 유의 지정">${icon('alert')}유의</span>` : ''}</span><span class="asset__sym">${esc(row.symbol)}</span></span></span></td>
    <td>${price(row.priceKrw)}<small>고가 ${price(row.highKrw)} · 저가 ${price(row.lowKrw)}</small></td>
    <td class="${sign(row.changePct)}"><span class="cell-strong">${arrowRate(row.changePct)}</span></td>
    <td class="col-volume">${bigWon(row.value24hKrw)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">표시할 마켓이 없습니다.</td></tr>';
}
async function loadAlerts(force = false) {
  if (!$('#alerts-list')) return;
  const request = beginRequest('alerts');
  $('#alerts-card').setAttribute('aria-busy', 'true');
  try {
    const result = await api(`/api/warnings?${query({ scope: state.alertScope, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.alerts = result;
    renderAlerts();
  } catch (error) { if (request.current() && $('#alerts-list')) $('#alerts-list').innerHTML = `<li class="empty">${esc(error.message)}</li>`; }
  finally { if (request.current()) $('#alerts-card')?.setAttribute('aria-busy', 'false'); }
}
function renderAlerts() {
  const list = $('#alerts-list'), a = state.alerts;
  if (!list || !a) return;
  $('#alerts-note').textContent = a.note;
  list.innerHTML = a.rows.length ? a.rows.map(row => `<li class="alert-row"><span class="alert-row__icon">${icon('alert')}</span><span class="alert-row__main"><strong>${esc(row.name)} <small>${esc(row.symbol)}</small>${row.held ? '<span class="tag">보유</span>' : ''}</strong><span>${esc(row.typeLabel)}${row.endsAt ? ` · ${esc(date(row.endsAt))}까지` : ''}</span></span><span class="step step--${esc(String(row.step).toLowerCase())}">${esc(row.stepLabel)}</span></li>`).join('')
    : `<li class="alerts__empty">${icon('check')}<span>${esc(a.note)}</span></li>`;
}
// ===== 실시간 시세: 서버가 빗썸 공개 웹소켓을 받아 SSE(/api/stream)로 넘겨줍니다 =====
const LIVE_LABEL = { live: '실시간', connecting: '실시간 연결 중', polling: '실시간 · 3초 조회', reconnecting: '다시 연결 중' };
const LIVE_RETRY = [3000, 10000, 30000, 60000];
// 차트 코인, 관심 코인, 알림을 건 코인 순서입니다(서버도 60개까지 받습니다). 알림은 지금 화면에 없는 코인도 실시간 가격으로 확인합니다.
const liveWatch = () => [...new Set([...(state.page === 'chart' && state.chart.symbol ? [state.chart.symbol] : []), ...watchlist(),
  ...alertRules().filter(rule => rule.enabled && rule.symbol !== 'TOTAL').map(rule => rule.symbol)])].slice(0, 60);
const liveKey = () => `${scope()}|${liveWatch().join(',')}`;
// 켜 둔 알림이 있으면 탭이 가려져도 연결을 유지합니다. 그래야 다른 탭을 보는 동안에도 알림이 뜹니다.
const alertsOn = () => alertRules().some(rule => rule.enabled);
function connectLive() {
  if (!board() || !state.status?.configured || (document.hidden && !alertsOn())) return;
  const key = liveKey();
  if (state.live.source && state.live.key === key) return;
  disconnectLive();
  state.live.key = key;
  const [symbols, watch] = key.split('|');
  const handlers = { status: data => { state.live.failures = 0; state.live.status = data.live; renderLiveStatus(); }, tick: data => onTicks(data.tickers ?? []), portfolio: data => onLivePortfolio(data, key) };
  if (fixture?.stream) { state.live.source = fixture.stream({ symbols, watch }, handlers); return; }
  if (typeof EventSource !== 'function') return;
  const source = new EventSource(`/api/stream?${query({ symbols, watch })}`);
  for (const [event, handler] of Object.entries(handlers)) source.addEventListener(event, message => { try { handler(JSON.parse(message.data)); } catch { /* 형식이 다른 메시지는 건너뜁니다. */ } });
  source.onerror = () => {
    if (state.live.source !== source) return;
    state.live.status = 'reconnecting'; renderLiveStatus();
    // 서버가 오류로 답하면(키 문제, 잠깐의 빗썸 장애 등) EventSource는 스스로 다시 연결하지 않으므로 잠시 뒤 새로 엽니다.
    if (source.readyState !== 2) return;
    source.close();
    clearTimeout(state.live.retry);
    state.live.retry = setTimeout(() => { if (state.live.source === source) { state.live.source = null; connectLive(); } }, LIVE_RETRY[Math.min(state.live.failures++, LIVE_RETRY.length - 1)]);
  };
  state.live.source = source;
}
function disconnectLive() {
  clearTimeout(state.live.retry);
  state.live.source?.close();
  Object.assign(state.live, { source: null, key: '', status: 'off', retry: null });
  renderLiveStatus();
}
function renderLiveStatus() {
  const chip = $('#live-status');
  if (!chip) return;
  chip.hidden = !LIVE_LABEL[state.live.status];
  chip.textContent = LIVE_LABEL[state.live.status] ?? '';
  chip.className = `live is-${state.live.status}`;
}
// 실시간 가격으로 다시 계산한 포트폴리오(서버의 십진수 계산 결과)를 그대로 그립니다.
function onLivePortfolio(p, key) {
  if (key !== state.live.key || !state.portfolio || state.loading || p.mode !== state.portfolio.mode || (p.scope ?? []).join(',') !== scope()) return;
  const before = new Map(state.portfolio.holdings.map(h => [h.symbol, Number(h.currentPriceKrw)]));
  state.portfolio = p;
  if (document.hidden) { state.live.stale = true; evaluateAlerts(); return; }
  renderPortfolio(); renderTools(); evaluateAlerts();
  for (const h of p.holdings) {
    const previous = before.get(h.symbol), current = Number(h.currentPriceKrw);
    if (!previous || !current || previous === current || !SYMBOL_TEXT.test(h.symbol)) continue;
    flash(document.querySelector(`#holdings-body tr[data-symbol="${h.symbol}"] .col-price`), current > previous);
  }
  if ($('#total') && !chartModels.get('chart')?.index) $('#total').classList.toggle('pulse', !$('#total').classList.contains('pulse'));
}
function onTicks(tickers) {
  const changed = new Map();
  for (const tick of tickers) { if (!SYMBOL_TEXT.test(tick.symbol)) continue; changed.set(tick.symbol, state.ticks.get(tick.symbol)); state.ticks.set(tick.symbol, tick); }
  const candle = liveCandle();
  // 가려진 탭에서는 값만 받아 두고 알림만 확인합니다. 다시 보이면 한 번에 그립니다.
  if (document.hidden) { state.live.stale = true; evaluateAlerts(); return; }
  renderWatch(changed); renderTickers(); if (candle) redrawCandles(); renderCoinHead(); evaluateAlerts();
}
function renderLive() {
  state.live.stale = false;
  renderPortfolio(); renderTools(); renderWatch(); renderTickers(); redrawCandles(); renderCoinHead();
}

// ===== 가격 알림: 실시간 값으로 이 브라우저에서 확인합니다 =====
const PRICE_TYPES = { above: ['현재가가 이 값 이상', '원'], below: ['현재가가 이 값 이하', '원'], rise: ['전일 대비 상승률 이상', '%'], fall: ['전일 대비 하락률 이상', '%'] };
const PROFIT_TYPES = { profit: ['내 수익률이 이 값 이상', '%'], loss: ['내 손실률이 이 값 이상', '%'] };
const TOTAL_TYPES = { total_above: ['총 평가금액이 이 값 이상', '원'], total_below: ['총 평가금액이 이 값 이하', '원'] };
const ALL_TYPES = { ...PRICE_TYPES, ...PROFIT_TYPES, ...TOTAL_TYPES };
const alertRules = () => store.list('alerts').filter(rule => rule && ALL_TYPES[rule.type] && (rule.symbol === 'TOTAL' || SYMBOL_TEXT.test(rule.symbol)));
function metricsFor(symbol) {
  // 총 평가금액은 전체 자산을 다 평가한 결과로만 봅니다. 일부 자산만 보는 보드의 합계로는 알리지 않습니다.
  if (symbol === 'TOTAL') { const p = state.portfolio; return { total: p && !(p.scope ?? []).length && p.summary.valuationComplete !== false ? Number(p.summary.totalValueKrw) : null }; }
  const h = state.portfolio?.holdings.find(item => item.symbol === symbol), t = state.ticks.get(symbol), w = state.watchRows?.find(row => row.symbol === symbol);
  const num = value => missing(value) ? null : Number(value);
  return { price: num(t?.priceKrw ?? h?.currentPriceKrw ?? w?.priceKrw), changePct: num(t?.changePct ?? h?.priceChangePct ?? w?.changePct), profitPct: num(h?.profitRatePct) };
}
function describeRule(rule) {
  const [label, unit] = ALL_TYPES[rule.type], value = unit === '원' ? `${number(rule.value)}원` : `${number(rule.value, 2)}%`;
  const name = nameOf(rule.symbol);
  return `${rule.symbol === 'TOTAL' ? '총 평가금액' : name === rule.symbol ? name : `${name} ${rule.symbol}`} · ${label.replace('이 값', value)}`;
}
function evaluateAlerts() {
  const rules = alertRules(), fired = [];
  let changed = false;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    // 값을 모르면(이 화면에 없는 자산, 다시 불러오는 중) 알리지도, 다시 켜지도 않습니다.
    const met = alertMet(rule, metricsFor(rule.symbol));
    if (met === null) continue;
    if (met && rule.armed !== false) { Object.assign(rule, { armed: false, firedAt: new Date().toISOString() }); fired.push(rule); changed = true; }
    else if (!met && rule.armed === false) { rule.armed = true; changed = true; }
  }
  if (!changed) return;
  store.put('alerts', rules);
  for (const rule of fired) notifyAlert(rule);
  if ($('#alerts-dialog').open) renderAlertLists();
}
function notifyAlert(rule) {
  const text = describeRule(rule);
  store.put('alert-log', [{ text, at: rule.firedAt }, ...store.list('alert-log')].slice(0, 30));
  saved.set('alerts-unseen', String(Number(saved.get('alerts-unseen') || 0) + 1));
  renderBell();
  notice(`알림 · ${text}`);
  try { if (globalThis.Notification?.permission === 'granted') new globalThis.Notification('Asset Kit 가격 알림', { body: text, tag: rule.id }); } catch { /* 이 환경에서는 브라우저 알림을 띄울 수 없습니다. */ }
}
function renderBell() {
  const count = Number(saved.get('alerts-unseen') || 0);
  $('#alerts-badge').hidden = !count;
  $('#alerts-badge').textContent = count > 9 ? '9+' : String(count);
}
const alertTargets = () => [...new Set([...(state.portfolio?.holdings.filter(h => h.symbol !== 'KRW').map(h => h.symbol) ?? []), ...watchlist()])];
function openAlerts(symbol) {
  void loadMarketList().then(() => $('#alerts-dialog').open && renderAlertLists());
  const target = $('#alert-target'), targets = alertTargets();
  target.innerHTML = `${targets.map(item => `<option value="${esc(item)}">${esc(nameOf(item))} ${esc(item)}</option>`).join('')}<option value="TOTAL">총 평가금액</option>`;
  if (symbol && (targets.includes(symbol) || symbol === 'TOTAL')) target.value = symbol;
  $('#alert-error').hidden = true;
  syncAlertForm(true); renderPermission(); renderAlertLists();
  if (!$('#alerts-dialog').open) $('#alerts-dialog').showModal();
  saved.set('alerts-unseen', '0'); renderBell();
}
function syncAlertForm(prefill) {
  const symbol = $('#alert-target').value, held = state.portfolio?.holdings.some(h => h.symbol === symbol && !missing(h.profitRatePct));
  const types = symbol === 'TOTAL' ? TOTAL_TYPES : { ...PRICE_TYPES, ...(held ? PROFIT_TYPES : {}) }, select = $('#alert-type'), keep = select.value;
  select.innerHTML = Object.entries(types).map(([value, [label]]) => `<option value="${value}">${label.replace('이 값 ', '').replace('이 값', '')}</option>`).join('');
  if (types[keep]) select.value = keep;
  $('#alert-unit').textContent = types[select.value][1] === '원' ? '원' : '%';
  if (!prefill) return;
  const m = metricsFor(symbol), round = value => value >= 1000 ? Math.round(value / 10 ** (String(Math.round(value)).length - 3)) * 10 ** (String(Math.round(value)).length - 3) : Number(value.toFixed(2));
  const suggestion = { above: m.price && round(m.price * 1.05), below: m.price && round(m.price * 0.95), rise: 5, fall: 5, profit: 10, loss: 10, total_above: m.total && round(m.total * 1.05), total_below: m.total && round(m.total * 0.95) }[select.value];
  $('#alert-value').value = suggestion ?? '';
}
function renderPermission() {
  const box = $('#alert-permission'), support = typeof globalThis.Notification === 'function', permission = support ? globalThis.Notification.permission : 'unsupported';
  box.innerHTML = { granted: `${icon('check')}<span>브라우저 알림이 켜져 있습니다. 이 탭을 열어 두면 다른 탭을 보고 있어도 알림이 뜹니다.</span>`, denied: `${icon('alert')}<span>브라우저 설정에서 이 페이지의 알림이 막혀 있습니다. 화면 안 알림만 보여줍니다.</span>`,
    default: `${icon('bell')}<span>다른 탭을 보고 있을 때도 알림을 받으려면 허용하세요.</span><button type="button" class="button button--quiet" data-action="alert-permission">브라우저 알림 허용</button>`,
    unsupported: `${icon('alert')}<span>이 브라우저는 시스템 알림을 지원하지 않아 화면 안 알림만 보여줍니다.</span>` }[permission];
}
function renderAlertLists() {
  const rules = alertRules();
  $('#alert-rules').innerHTML = rules.length ? rules.map(rule => {
    const m = metricsFor(rule.symbol), unit = ALL_TYPES[rule.type][1];
    const current = rule.symbol === 'TOTAL' ? money(m.total) : rule.type in PROFIT_TYPES ? percent(m.profitPct) : rule.type === 'rise' || rule.type === 'fall' ? percent(m.changePct) : m.price === null ? '—' : price(m.price);
    const status = !rule.enabled ? '꺼짐' : rule.armed === false ? `발생 ${date(rule.firedAt)} · 조건이 풀리면 다시 켜집니다` : `대기 중 · 지금 ${current}`;
    return `<li class="rule${rule.enabled ? '' : ' is-off'}${rule.armed === false ? ' is-fired' : ''}"><div class="rule__text"><strong>${esc(describeRule(rule))}</strong><small>${esc(status)}${unit === '%' ? '' : ''}</small></div><div class="rule__actions"><button type="button" class="button button--quiet" data-action="alert-toggle" data-id="${esc(rule.id)}">${rule.enabled ? '끄기' : '켜기'}</button><button type="button" class="icon-button icon-button--quiet" data-action="alert-delete" data-id="${esc(rule.id)}" aria-label="알림 삭제">${icon('trash')}</button></div></li>`;
  }).join('') : '<li class="empty">설정한 알림이 없습니다. 위에서 대상과 조건을 고르세요.</li>';
  const log = store.list('alert-log');
  $('#alert-log').innerHTML = log.length ? log.slice(0, 10).map(item => `<li class="rule rule--log"><div class="rule__text"><strong>${esc(item.text)}</strong><small>${esc(date(item.at))}</small></div></li>`).join('') : '<li class="empty">아직 발생한 알림이 없습니다.</li>';
}
function addAlert() {
  const symbol = $('#alert-target').value, type = $('#alert-type').value, value = Number($('#alert-value').value);
  if (!ALL_TYPES[type] || !Number.isFinite(value) || value <= 0) { $('#alert-error').textContent = '0보다 큰 값을 입력하세요.'; $('#alert-error').hidden = false; return; }
  const rules = alertRules();
  if (rules.length >= 50) { $('#alert-error').textContent = '알림은 50개까지 저장합니다.'; $('#alert-error').hidden = false; return; }
  rules.push({ id: globalThis.crypto?.randomUUID?.() ?? `a${Date.now()}`, symbol, type, value, enabled: true, armed: true, createdAt: new Date().toISOString() });
  store.put('alerts', rules);
  $('#alert-error').hidden = true;
  notice('알림을 추가했어요. 이 화면이 열려 있는 동안 확인합니다.');
  evaluateAlerts(); renderAlertLists(); connectLive();
}

// ===== 마켓 목록·관심 코인 =====
async function loadMarketList() {
  if (state.marketList) return state.marketList;
  try { state.marketList = (await api('/api/markets')).markets; } catch { return []; }
  $('#market-options').innerHTML = state.marketList.map(m => `<option value="${esc(m.symbol)}">${esc(m.name)}</option>`).join('');
  return state.marketList;
}
const nameOf = symbol => state.portfolio?.holdings.find(h => h.symbol === symbol)?.name ?? state.marketList?.find(m => m.symbol === symbol)?.name ?? state.watchRows?.find(r => r.symbol === symbol)?.name ?? symbol;
function resolveSymbol(text) {
  const value = String(text).trim(), upper = value.toUpperCase(), list = state.marketList ?? [];
  if (!value) return null;
  return (list.find(m => m.symbol === upper) ?? list.find(m => m.name === value) ?? list.find(m => m.name.includes(value)))?.symbol ?? null;
}
async function loadWatch(force = false) {
  if (!$('#watch-body')) return;
  const list = watchlist();
  $('#watch-count').textContent = String(list.length);
  if (!list.length) { state.watchRows = []; renderWatch(); return; }
  const request = beginRequest('watch');
  try {
    const result = await api(`/api/tickers?${query({ scope: 'all', symbols: list.join(','), limit: 50, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    const order = new Map(list.map((symbol, i) => [symbol, i]));
    state.watchRows = result.rows.filter(row => order.has(row.symbol)).sort((a, b) => order.get(a.symbol) - order.get(b.symbol));
    renderWatch();
    void loadSparks(state.watchRows.map(row => row.symbol));
  } catch (error) { if (request.current() && $('#watch-body')) $('#watch-body').innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`; }
}
function renderWatch(changed = new Map()) {
  const body = $('#watch-body'), rows = state.watchRows;
  if (!body || !rows) return;
  $('#watch-count').textContent = String(rows.length);
  if (!rows.length) {
    morph(body, `<tr><td colspan="6" class="empty">관심 코인을 추가하면 실시간 시세를 보여 드립니다.<br><span class="chips chips--center">${['BTC', 'ETH', 'XRP', 'SOL', 'DOGE'].map(symbol => `<button type="button" class="chip" data-action="watch-suggest" data-symbol="${symbol}">+ ${symbol}</button>`).join('')}</span></td></tr>`);
    return;
  }
  const held = new Set(state.portfolio?.holdings.map(h => h.symbol) ?? []);
  morph(body, rows.map(row => {
    const t = state.ticks.get(row.symbol), priceKrw = t?.priceKrw ?? row.priceKrw, change = t?.changePct ?? row.changePct;
    return `<tr data-symbol="${esc(row.symbol)}"><td><span class="asset"><span class="avatar ${held.has(row.symbol) ? seriesClass(row.symbol) : 'c-none'}" aria-hidden="true">${esc(monogram(row.symbol))}</span><span class="asset__text"><span class="asset__name">${esc(row.name)}${held.has(row.symbol) ? '<span class="tag">보유</span>' : ''}${row.marketWarning ? `<span class="flag" title="빗썸 거래 유의 지정">${icon('alert')}유의</span>` : ''}</span><span class="asset__sym">${esc(row.symbol)}</span></span></span></td>
      <td class="col-price"><span class="cell-strong">${price(priceKrw)}</span><small>고가 ${price(t?.highKrw ?? row.highKrw)} · 저가 ${price(t?.lowKrw ?? row.lowKrw)}</small></td>
      <td class="${sign(change)}"><span class="cell-strong">${arrowRate(change)}</span></td>
      <td class="col-volume">${bigWon(t?.value24hKrw ?? row.value24hKrw)}</td>
      <td class="col-spark" data-spark="${esc(row.symbol)}">${sparkCell(row.symbol)}</td>
      <td class="col-actions"><div class="row-actions"><button type="button" class="button button--quiet" data-action="coin-open" data-symbol="${esc(row.symbol)}" aria-label="${esc(row.name)} 차트">${icon('candle')}<span>차트</span></button><button type="button" class="button button--quiet" data-action="alert-new" data-symbol="${esc(row.symbol)}" aria-label="${esc(row.name)} 알림 추가">${icon('bell')}<span>알림</span></button><button type="button" class="icon-button icon-button--quiet" data-action="watch-remove" data-symbol="${esc(row.symbol)}" aria-label="${esc(row.name)} 관심 해제">${icon('x')}</button></div></td></tr>`;
  }).join(''));
  for (const [symbol, previous] of changed) {
    const t = state.ticks.get(symbol);
    if (previous && t && Number(t.priceKrw) !== Number(previous.priceKrw)) flash(body.querySelector(`tr[data-symbol="${symbol}"] .col-price`), Number(t.priceKrw) > Number(previous.priceKrw));
  }
}
async function addWatch(text) {
  await loadMarketList();
  const symbol = resolveSymbol(text), list = watchlist();
  if (!symbol) { notice('빗썸 원화 마켓에서 찾지 못했습니다. 심볼(BTC)이나 이름을 입력하세요.'); return; }
  if (list.includes(symbol)) { notice('이미 관심 코인에 있습니다.'); return; }
  if (list.length >= 30) { notice('관심 코인은 30개까지 저장합니다.'); return; }
  store.put('watchlist', [...list, symbol]);
  if ($('#watch-input')) $('#watch-input').value = '';
  notice(`관심 코인에 추가했어요: ${nameOf(symbol)}`);
  await loadWatch(); connectLive();
}
function removeWatch(symbol) {
  store.put('watchlist', watchlist().filter(item => item !== symbol));
  state.watchRows = state.watchRows?.filter(row => row.symbol !== symbol) ?? null;
  renderWatch(); connectLive();
}

// ===== 코인 차트: 캔들 · 이동평균 · 거래량 · 내 평균 매수가 =====
const coinChoices = () => [...new Set([...(state.portfolio?.holdings.filter(h => h.symbol !== 'KRW' && !h.priceSource?.startsWith('BTC-')).map(h => h.symbol) ?? []), ...watchlist()])];
function selectCoin(symbol) {
  if (!SYMBOL_TEXT.test(symbol ?? '')) return;
  state.chart.symbol = symbol;
  saved.set('chart-symbol', symbol);
  state.chart.data = null;
  renderCoinHead(); void loadCandles(); connectLive();
}
/** @param {boolean} [quiet] a background refresh keeps the current chart on screen, even when it fails. */
async function loadCandles(force = false, quiet = false) {
  const box = $('#candles');
  if (!box) return;
  if (!state.chart.symbol || !SYMBOL_TEXT.test(state.chart.symbol)) state.chart.symbol = coinChoices()[0] ?? 'BTC';
  if (!quiet) { renderCoinHead(); box.classList.add('is-stale'); }
  const request = beginRequest('candles');
  try {
    const result = await api(`/api/market?${query({ symbol: state.chart.symbol, interval: state.chart.interval, count: 120, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.chart.data = result;
    liveCandle();
    renderCandles(); renderCoinHead();
  } catch (error) {
    if (!request.current() || quiet) return;
    state.chart.data = null;
    box.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    box.classList.remove('is-stale');
  }
}
function renderCoinHead() {
  if (!$('#coin-card')) return;
  const symbol = state.chart.symbol ?? '', data = state.chart.data?.symbol === symbol ? state.chart.data : null, t = state.ticks.get(symbol);
  const holding = state.portfolio?.holdings.find(h => h.symbol === symbol), name = data?.name ?? nameOf(symbol);
  $('#coin-title').textContent = name;
  $('#coin-sub').textContent = `${symbol} · KRW-${symbol}${t ? ' · 실시간' : ''}`;
  $('#coin-avatar').textContent = monogram(symbol);
  $('#coin-avatar').className = `avatar avatar--lg ${holding ? seriesClass(symbol) : 'c-none'}`;
  const current = t?.priceKrw ?? data?.priceKrw ?? data?.candles.at(-1)?.closeKrw, change = t?.changePct ?? data?.changePct;
  $('#coin-price').textContent = price(current);
  $('#coin-change').innerHTML = missing(change) ? '' : `<span class="pill ${sign(change)}">${arrowRate(change)} <span class="sr-only">전일 대비</span></span>`;
  morph($('#coin-chips'), coinChoices().map(item => `<button type="button" class="chip" data-action="coin" data-symbol="${esc(item)}" aria-pressed="${item === symbol}">${esc(item)}</button>`).join(''));
  for (const button of document.querySelectorAll('[data-action="interval"]')) { const on = button.dataset.interval === state.chart.interval; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); }
  for (const button of document.querySelectorAll('[data-action="overlay"]')) button.setAttribute('aria-pressed', String(state.chart.overlays.has(button.dataset.overlay)));
  renderCoinStats();
}
function renderCoinStats() {
  const box = $('#coin-stats'), data = state.chart.data;
  if (!box) return;
  if (!data || data.symbol !== state.chart.symbol || data.candles.length < 2) { box.innerHTML = ''; return; }
  const candles = data.candles, first = Number(candles[0].openKrw ?? candles[0].closeKrw), t = state.ticks.get(data.symbol), last = Number(t?.priceKrw ?? candles.at(-1).closeKrw);
  const high = Math.max(...candles.map(c => Number(c.highKrw ?? c.closeKrw))), low = Math.min(...candles.map(c => Number(c.lowKrw ?? c.closeKrw)));
  const holding = state.portfolio?.holdings.find(h => h.symbol === data.symbol), avg = holding?.averagePriceKrw ? Number(holding.averagePriceKrw) : null;
  const label = INTERVALS.find(([value]) => value === state.chart.interval)?.[1];
  const items = [[`기간 수익률 (${label} ${candles.length}개)`, `<span class="${sign(last - first)}">${number((last - first) / first * 100, 2)}%</span>`], ['기간 최고가', price(high)], ['기간 최저가', price(low)], ['고점 대비', `${number((last - high) / high * 100, 2)}%`]];
  if (holding) items.push(['내 보유', amount(holding.quantity, holding.symbol)], ['내 평균 매수가', avg ? money(avg) : '—'], ['평가손익', `<span class="${tone(holding.profitKrw)}">${money(holding.profitKrw, true)} · ${percent(holding.profitRatePct)}</span>`], ['평단까지', avg ? `<span class="${sign(avg - last)}">${state.hidden ? '••' : `${number((avg - last) / last * 100, 2)}%`}</span>` : '—']);
  box.innerHTML = items.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${value}</dd></div>`).join('');
}
const candleLabel = (at, interval) => {
  const day = new Date(Date.parse(at) + 9 * 3600000), md = `${day.getUTCMonth() + 1}.${day.getUTCDate()}`;
  return ['day', 'week'].includes(interval) ? md : `${md} ${String(day.getUTCHours()).padStart(2, '0')}:${String(day.getUTCMinutes()).padStart(2, '0')}`;
};
function renderCandles() {
  const box = $('#candles'), data = state.chart.data;
  if (!box || !data) return;
  box.classList.remove('is-stale');
  const all = data.candles.map(c => ({ at: c.at ?? `${c.date}T00:00:00+09:00`, o: Number(c.openKrw ?? c.closeKrw), h: Number(c.highKrw ?? c.closeKrw), l: Number(c.lowKrw ?? c.closeKrw), c: Number(c.closeKrw), v: Number(c.volume ?? 0) })).filter(c => Number.isFinite(c.c));
  if (all.length < 2) { box.innerHTML = '<p class="empty">캔들 데이터가 부족합니다.</p>'; chartModels.delete('candles'); return; }
  const overlays = state.chart.overlays, width = Math.max(300, Math.round(box.clientWidth)), narrow = width < 560;
  // 좁은 화면에서는 최근 60개만 그려 캔들이 너무 가늘어지지 않게 합니다. 이동평균은 전체 캔들로 계산한 뒤 자릅니다.
  const offset = narrow ? Math.max(0, all.length - 60) : 0, candles = all.slice(offset);
  const priceH = narrow ? 240 : 330, volH = overlays.has('volume') ? (narrow ? 54 : 70) : 0, gap = volH ? 12 : 0, axisH = 26, height = priceH + gap + volH + axisH;
  const gutter = narrow ? 58 : 76, left = 6, right = width - gutter, n = candles.length, band = (right - left) / n, body = Math.max(1, Math.min(11, band * 0.64));
  const x = i => left + band * (i + 0.5), closes = all.map(c => c.c);
  const lines = [['ma5', 5], ['ma20', 20], ['ma60', 60]].filter(([key]) => overlays.has(key)).map(([key, period]) => [key, movingAverage(closes, period).slice(offset)]);
  const holding = state.portfolio?.holdings.find(h => h.symbol === data.symbol), avg = overlays.has('avg') && holding?.averagePriceKrw ? Number(holding.averagePriceKrw) : null;
  let low = Math.min(...candles.map(c => c.l)), high = Math.max(...candles.map(c => c.h));
  for (const [, values] of lines) for (const value of values) if (value !== null) { low = Math.min(low, value); high = Math.max(high, value); }
  const spread = high - low || high * 0.01 || 1, avgInside = avg !== null && avg >= low - spread * 0.35 && avg <= high + spread * 0.35;
  if (avgInside) { low = Math.min(low, avg); high = Math.max(high, avg); }
  const pad = (high - low) * 0.06 || 1;
  low -= pad; high += pad;
  const top = 10, bottom = priceH - 6, y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const vMax = Math.max(...candles.map(c => c.v), 1), vTop = priceH + gap, vy = value => vTop + volH - value / vMax * volH;
  const { ticks, step } = niceTicks(low, high, narrow ? 4 : 5), f = value => value.toFixed(1);
  const grid = ticks.map(tick => `<line class="grid" x1="${left}" x2="${right}" y1="${f(y(tick))}" y2="${f(y(tick))}"/><text class="tick" x="${width - 6}" y="${f(y(tick) + 4)}" text-anchor="end">${esc(axisLabel(tick, step))}</text>`).join('');
  const bars = candles.map((c, i) => {
    const cls = c.c >= c.o ? 'up' : 'down', yo = y(c.o), yc = y(c.c), bx = f(x(i) - body / 2);
    return `<g class="candle ${cls}"><line x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(c.h))}" y2="${f(y(c.l))}"/><rect x="${bx}" y="${f(Math.min(yo, yc))}" width="${f(body)}" height="${f(Math.max(1, Math.abs(yc - yo)))}"/>${volH ? `<rect class="vol" x="${bx}" y="${f(vy(c.v))}" width="${f(body)}" height="${f(Math.max(0.5, vTop + volH - vy(c.v)))}"/>` : ''}</g>`;
  }).join('');
  const maPaths = lines.map(([key, values]) => { const points = values.map((value, i) => value === null ? null : [x(i), y(value)]).filter(Boolean); return points.length > 1 ? `<path class="ma ma-${key}" d="${smoothPath(points)}"/>` : ''; }).join('');
  const last = candles.at(-1), up = last.c >= candles.at(-2).c ? 'up' : 'down', lastY = f(y(last.c));
  const lastLine = `<line class="last-line ${up}" x1="${left}" x2="${right}" y1="${lastY}" y2="${lastY}"/><g class="last-tag ${up}"><rect x="${right + 3}" y="${f(y(last.c) - 10)}" width="${gutter - 6}" height="20" rx="5"/><text x="${f(right + 3 + (gutter - 6) / 2)}" y="${f(y(last.c) + 4)}" text-anchor="middle">${esc(axisLabel(last.c, step))}</text></g>`;
  const avgLine = avgInside ? `<line class="avg-line" x1="${left}" x2="${right}" y1="${f(y(avg))}" y2="${f(y(avg))}"/><text class="avg-label" x="${left + 6}" y="${f(y(avg) - 6)}">내 평단 ${esc(price(avg))}</text>` : '';
  const count = width >= 760 ? 5 : narrow ? 3 : 4, indexes = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (n - 1) / (count - 1))))];
  const dates = indexes.map((index, i) => `<text class="tick" x="${f(x(index))}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === indexes.length - 1 ? 'end' : 'middle'}">${esc(candleLabel(candles[index].at, state.chart.interval))}</text>`).join('');
  box.dataset.width = String(box.clientWidth);
  chartModels.set('candles', { candles, x, y, band, left, right, top, bottom: vTop + volH, index: null, lines, points: candles });
  box.innerHTML = `<div class="candle-legend" id="candle-legend" aria-live="off"></div><div class="chart__plot" tabindex="0" role="slider" aria-label="${esc(`${data.name} ${INTERVALS.find(([v]) => v === state.chart.interval)?.[1]} 캔들 차트. 좌우 방향키로 캔들 이동`)}" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${n - 1}">
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${grid}${volH ? `<line class="baseline" x1="${left}" x2="${right}" y1="${vTop + volH}" y2="${vTop + volH}"/>` : ''}${bars}${maPaths}${avgLine}${lastLine}
      <line class="cross cross-x" x1="0" x2="0" y1="${top}" y2="${vTop + volH}"/><line class="cross cross-y" x1="${left}" x2="${right}" y1="0" y2="0"/>${dates}</svg></div>`;
  renderCandleLegend(null);
}
function renderCandleLegend(index) {
  const legend = $('#candle-legend'), model = chartModels.get('candles');
  if (!legend || !model) return;
  const i = index ?? model.candles.length - 1, c = model.candles[i], previous = model.candles[i - 1], change = previous ? (c.c - previous.c) / previous.c * 100 : null;
  const ma = model.lines.map(([key, values]) => values[i] === null ? '' : `<span class="ma-key ma-key--${key}">${key.toUpperCase()} ${esc(price(values[i]))}</span>`).join('');
  legend.innerHTML = `<span class="muted">${esc(candleLabel(c.at, state.chart.interval))}</span><span>시 <b>${esc(price(c.o))}</b></span><span>고 <b class="positive">${esc(price(c.h))}</b></span><span>저 <b class="negative">${esc(price(c.l))}</b></span><span>종 <b class="${sign(c.c - c.o)}">${esc(price(c.c))}</b></span>${change === null ? '' : `<span class="${sign(change)}">${change > 0 ? '+' : ''}${number(change, 2)}%</span>`}<span class="muted">거래량 ${esc(number(c.v, 2))}</span>${ma}`;
}
function selectCandle(index) {
  const model = chartModels.get('candles'), box = $('#candles'), c = model?.candles[index];
  if (!c) return;
  model.index = index;
  box.classList.add('is-active');
  const plot = box.querySelector?.('.chart__plot');
  if (plot) {
    for (const [name, value] of [['x1', model.x(index)], ['x2', model.x(index)]]) plot.querySelector('.cross-x')?.setAttribute(name, value.toFixed(1));
    for (const [name, value] of [['y1', model.y(c.c)], ['y2', model.y(c.c)]]) plot.querySelector('.cross-y')?.setAttribute(name, value.toFixed(1));
    plot.setAttribute('aria-valuenow', String(index));
    plot.setAttribute('aria-valuetext', `${candleLabel(c.at, state.chart.interval)} 종가 ${price(c.c)}`);
  }
  renderCandleLegend(index);
}
function releaseCandle() {
  const model = chartModels.get('candles');
  if (!model || model.index === null) return;
  model.index = null;
  $('#candles')?.classList.remove('is-active');
  renderCandleLegend(null);
}
// 차트 코인의 실시간 가격을 캔들 데이터에 넣습니다(종가·고가·저가). 마지막 캔들의 구간이 지났으면 새 캔들을 시작하고,
// 지난 캔들의 확정 값과 거래량은 잠시 뒤 거래소에서 다시 받아 옵니다. 데이터가 바뀌었으면 true입니다.
const PERIOD_MS = { '15m': 15 * 60000, '1h': 3600000, '4h': 4 * 3600000, day: 86400000, week: 7 * 86400000 };
function liveCandle() {
  const data = state.chart.data, t = data && state.ticks.get(data.symbol), last = data?.candles.at(-1), period = PERIOD_MS[data?.interval];
  if (!t || !last || !period || data.interval !== state.chart.interval) return false;
  const at = Date.parse(t.at), start = Date.parse(last.at ?? `${last.date}T00:00:00+09:00`), live = Number(t.priceKrw);
  // 받아 온 캔들보다 오래된 가격(끊겼던 동안 남은 값)은 넣지 않습니다.
  if (!Number.isFinite(at) || !Number.isFinite(start) || !(live > 0) || at < Math.max(start, Date.parse(data.asOf) || 0)) return false;
  if (at < start + period) {
    Object.assign(last, { closeKrw: String(live), highKrw: String(Math.max(Number(last.highKrw ?? last.closeKrw), live)), lowKrw: String(Math.min(Number(last.lowKrw ?? last.closeKrw), live)) });
    return true;
  }
  const open = start + Math.floor((at - start) / period) * period, iso = new Date(open).toISOString();
  data.candles.push({ at: iso, date: kstDay(iso), openKrw: String(live), highKrw: String(live), lowKrw: String(live), closeKrw: String(live), volume: '0' });
  if (data.candles.length > 200) data.candles.shift();
  if (state.chart.refetched !== open) { state.chart.refetched = open; clearTimeout(state.chart.refetch); state.chart.refetch = setTimeout(() => void loadCandles(true, true), 5000); }
  return true;
}
function redrawCandles() {
  if (!$('#candles') || !state.chart.data) return;
  const index = chartModels.get('candles')?.index ?? null;
  renderCandles();
  if (index !== null) selectCandle(index);
}

// ===== 수익률: 입출금을 뺀 실제 수익 · 월별 손익 · 실현손익 =====
async function loadReturns(force = false) {
  if (!$('#returns-body')) return;
  const months = state.returnsMonths, request = beginRequest('returns');
  if (state.returns?.months !== months) state.returns = null;
  syncSegments(); renderReturns(); renderMonthly(); renderRealized();
  try {
    const result = await api(`/api/returns?${query({ months, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.returns = result;
    renderReturns(); renderMonthly(); renderRealized();
  } catch (error) { if (request.current() && $('#returns-body')) $('#returns-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}
function waterfall(s, measured) {
  const v0 = Number(s.startValueKrw), flow = Number(s.netFlowKrw), profit = Number(s.profitKrw), v1 = Number(s.endValueKrw);
  // 좁은 화면에서는 금액을 만·억 단위로 줄이고 이름도 짧게 씁니다.
  const width = Math.max(280, Math.round(measured || 640)), narrow = width < 480;
  const short = value => Math.abs(value) >= 1e8 ? `${number(value / 1e8, 2)}억원` : `${number(value / 1e4, 0)}만원`;
  const total = value => narrow ? short(value) : money(value), signed = value => narrow ? `${value > 0 ? '+' : ''}${short(value)}` : money(value, true);
  const steps = [[narrow ? '기간 초' : '기간 초 평가금액', 0, v0, 'total', total(v0)], ['순입금', v0, v0 + flow, 'flow', signed(flow)], ['실제 수익', v0 + flow, v0 + flow + profit, profit >= 0 ? 'up' : 'down', signed(profit)], [narrow ? '현재' : '현재 평가금액', 0, v1, 'total', total(v1)]];
  const height = narrow ? 200 : 230, top = 28, bottom = height - 40, band = width / steps.length, bar = Math.min(96, band * 0.56);
  const max = Math.max(...steps.flatMap(([, from, to]) => [from, to])) * 1.04 || 1, min = Math.min(0, ...steps.flatMap(([, from, to]) => [from, to]));
  const y = value => bottom - (value - min) / (max - min) * (bottom - top), f = value => value.toFixed(1);
  return `<svg class="waterfall" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`평가금액 변화 분해: 기간 초 ${money(v0)}, 순입금 ${money(flow, true)}, 실제 수익 ${money(profit, true)}, 현재 ${money(v1)}`)}">
    <line class="baseline" x1="0" x2="${width}" y1="${f(y(0))}" y2="${f(y(0))}"/>
    ${steps.map(([label, from, to, cls, text], i) => {
      const cx = band * (i + 0.5), y0 = y(Math.min(from, to)), y1 = y(Math.max(from, to)), next = steps[i + 1];
      return `<rect class="wf wf--${cls}" x="${f(cx - bar / 2)}" y="${f(y1)}" width="${f(bar)}" height="${f(Math.max(2, y0 - y1))}" rx="4"/>
        <text class="wf-value" x="${f(cx)}" y="${f(y1 - 8)}" text-anchor="middle">${esc(text)}</text><text class="wf-label" x="${f(cx)}" y="${height - 14}" text-anchor="middle">${esc(label)}</text>
        ${next && i < steps.length - 1 ? `<line class="wf-link" x1="${f(cx + bar / 2)}" x2="${f(band * (i + 1.5) - bar / 2)}" y1="${f(y(to))}" y2="${f(y(to))}"/>` : ''}`;
    }).join('')}</svg>`;
}
function renderReturns() {
  const box = $('#returns-body'), r = state.returns;
  if (!box) return;
  syncSegments();
  if (!r) { box.innerHTML = `<div class="loading-note"><span class="skeleton chart-skeleton"></span><p class="muted small">최근 ${state.returnsMonths}개월 주문·입출금 기록을 읽고 있습니다. 거래가 많으면 몇 초 걸릴 수 있습니다.</p></div>`; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; return; }
  const s = r.summary, notes = [];
  if (!r.history.coversStart && s.startAt) notes.push(`평가금액 기록이 ${date(s.startAt)}부터라 그 이후만 계산했습니다.`);
  if (!r.coverage.complete) notes.push('조회 한도 때문에 일부 기록만 읽었습니다. 기간을 줄이면 더 정확합니다.');
  if (r.skipped.btcMarketOrders) notes.push(`BTC 마켓 주문 ${r.skipped.btcMarketOrders}건은 원화 금액이 아니라 계산에서 뺐습니다.`);
  if (r.skipped.unpricedFlows) notes.push(`그날 가격을 확인하지 못한 코인 입출금 ${r.skipped.unpricedFlows}건은 순입금에서 뺐습니다.`);
  if (!s.realizedComplete) notes.push('일부 자산은 당시 평균 매수가를 알 수 없어 실현손익에서 뺐습니다.');
  box.innerHTML = s.profitKrw === null ? '<p class="empty">기간 초 평가금액 기록이 없어 실제 수익을 계산할 수 없습니다. 대시보드를 며칠 사용하면 기록이 쌓입니다.</p>' : `
    <div class="returns-hero"><div><p class="muted small">최근 ${r.months}개월 실제 수익 · 입출금 제외</p><p class="returns-figure ${tone(s.profitKrw)}">${money(s.profitKrw, true)}</p>
      <p class="hero__delta"><span class="pill ${tone(s.profitKrw)}">${percent(s.profitRatePct)}</span><span>평가금액 변화 ${money(s.changeKrw, true)}에서 순입금 ${money(s.netFlowKrw, true)}을 뺀 값</span></p></div>
      <div class="returns-chart" id="returns-chart"></div></div>
    <dl class="kpis kpis--flat">
      <div class="kpi"><dt>입금</dt><dd><strong>${money(s.depositsKrw)}</strong><small>코인 입금 ${money(s.coinInKrw)}</small></dd></div>
      <div class="kpi"><dt>출금</dt><dd><strong>${money(s.withdrawalsKrw)}</strong><small>코인 출금 ${money(s.coinOutKrw)}</small></dd></div>
      <div class="kpi"><dt>실현손익</dt><dd><strong class="${tone(s.realizedKrw)}">${money(s.realizedKrw, true)}</strong><small>매도 금액 ${money(s.sellKrw)}</small></dd></div>
      <div class="kpi"><dt>수수료</dt><dd><strong>${money(s.feesKrw)}</strong><small>거래 ${s.trades}건 · 입출금 ${s.transfers}건</small></dd></div>
    </dl>
    <p class="card__foot">${esc(r.note)}${notes.length ? `<br>${notes.map(esc).join(' ')}` : ''}</p>`;
  renderWaterfall();
}
function renderWaterfall() {
  const holder = $('#returns-chart'), s = state.returns?.summary;
  if (!holder || !s || s.profitKrw === null) return;
  holder.dataset.width = String(holder.clientWidth);
  holder.innerHTML = waterfall(s, holder.clientWidth);
}
function renderMonthly() {
  const chart = $('#monthly-chart'), body = $('#monthly-body'), r = state.returns;
  if (!chart || !body) return;
  if (!r) { chart.innerHTML = '<span class="skeleton chart-skeleton"></span>'; body.innerHTML = ''; return; }
  if (state.hidden) { chart.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; body.innerHTML = ''; return; }
  const rows = r.monthly, values = rows.map(m => m.profitKrw === null ? null : Number(m.profitKrw)), maxAbs = Math.max(1, ...values.filter(v => v !== null).map(Math.abs));
  const width = Math.max(300, Math.round(chart.clientWidth || 640)), height = 200, top = 24, bottom = 168, zero = (top + bottom) / 2, band = width / rows.length, bar = Math.min(28, band * 0.56), f = value => value.toFixed(1);
  const best = values.indexOf(Math.max(...values.filter(v => v !== null))), worst = values.indexOf(Math.min(...values.filter(v => v !== null)));
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="월별 손익 막대 차트. 자세한 값은 아래 표">
    <line class="baseline" x1="0" x2="${width}" y1="${zero}" y2="${zero}"/>
    ${rows.map((m, i) => {
      const value = values[i], cx = band * (i + 0.5), label = `${Number(m.month.slice(5))}월`;
      if (value === null) return `<text class="tick" x="${f(cx)}" y="${height - 10}" text-anchor="middle">${label}</text><text class="tick" x="${f(cx)}" y="${zero - 6}" text-anchor="middle">—</text>`;
      const h = Math.abs(value) / maxAbs * (bottom - top) / 2, yy = value >= 0 ? zero - h : zero;
      return `<rect class="mbar ${value >= 0 ? 'up' : 'down'}" x="${f(cx - bar / 2)}" y="${f(yy)}" width="${f(bar)}" height="${f(Math.max(1, h))}" rx="3"><title>${esc(`${m.month} 월 손익 ${money(value, true)} · 순입금 ${money(m.netFlowKrw, true)}`)}</title></rect>
        ${i === best || i === worst ? `<text class="wf-value" x="${f(cx)}" y="${f(value >= 0 ? yy - 6 : yy + h + 14)}" text-anchor="middle">${esc(compact(value))}</text>` : ''}
        <text class="tick" x="${f(cx)}" y="${height - 10}" text-anchor="middle">${label}</text>`;
    }).join('')}</svg>`;
  body.innerHTML = [...rows].reverse().map(m => `<tr><td>${esc(m.month.replace('-', '.'))}</td><td class="${sign(m.netFlowKrw)}">${money(m.netFlowKrw, true)}<small>입금 ${money(Number(m.depositsKrw) + Number(m.coinInKrw))} · 출금 ${money(Number(m.withdrawalsKrw) + Number(m.coinOutKrw))}</small></td><td class="${tone(m.realizedKrw)}">${money(m.realizedKrw, true)}</td><td>${money(m.feesKrw)}</td><td>${money(m.endValueKrw)}</td><td class="${tone(m.profitKrw)}"><span class="cell-strong">${money(m.profitKrw, true)}</span><small class="${tone(m.profitKrw)}">${percent(m.profitRatePct)}</small></td></tr>`).join('');
}
function renderRealized() {
  const box = $('#realized-body'), r = state.returns;
  if (!box) return;
  if (!r) { box.innerHTML = '<span class="skeleton stack-skeleton"></span>'; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; return; }
  if (!r.realized.length) { box.innerHTML = '<p class="empty">기간 안에 매도한 기록이 없습니다.</p>'; return; }
  const known = r.realized.filter(item => item.realizedKrw !== null).map(item => Number(item.realizedKrw)), maxUp = Math.max(0, ...known), maxDown = Math.max(0, ...known.map(v => -v)), span = maxUp + maxDown || 1, zero = maxDown / span * 100;
  box.innerHTML = `<ul class="perf__list">${r.realized.map(item => {
    if (item.realizedKrw === null) return `<li class="perf__row"><span class="perf__name"><span class="avatar ${seriesClass(item.symbol)}" aria-hidden="true">${esc(monogram(item.symbol))}</span><span>${esc(item.name)}<small>매도 ${item.sells}회</small></span></span><span class="perf__track muted small">${esc(item.reason ?? '계산할 수 없습니다.')}</span><span class="perf__value">—</span></li>`;
    const value = Number(item.realizedKrw), size = Math.abs(value) / span * 100, start = value >= 0 ? zero : zero - size;
    return `<li class="perf__row"><span class="perf__name"><span class="avatar ${seriesClass(item.symbol)}" aria-hidden="true">${esc(monogram(item.symbol))}</span><span>${esc(item.name)}<small>매도 ${item.sells}회 · ${money(item.proceedsKrw)}</small></span></span>
      <span class="perf__track" aria-hidden="true"><span class="perf__zero" data-pos="${zero}"></span><span class="perf__bar ${sign(value)}" data-start="${start}" data-size="${size}"></span></span>
      <span class="perf__value ${sign(value)}">${money(value, true)}<small>원가 ${money(item.costKrw)}</small></span></li>`;
  }).join('')}</ul>`;
  for (const element of box.querySelectorAll?.('[data-start]') ?? []) { element.style.setProperty('--start', element.dataset.start); element.style.setProperty('--size', element.dataset.size); }
  for (const element of box.querySelectorAll?.('[data-pos]') ?? []) element.style.setProperty('--pos', element.dataset.pos);
}

// ===== 계산기: 물타기 · 리밸런싱 · 시나리오 (화면 안 계산, 주문하지 않음) =====
const inputNumber = id => { const value = $(id)?.value; return value === '' || value === undefined ? null : Number(value); };
function renderTools() { setupAveraging(); setupRebalance(); setupScenario(); }
function setupAveraging() {
  const select = $('#avg-symbol');
  if (!select || !state.portfolio) return;
  const coins = state.portfolio.holdings.filter(h => h.symbol !== 'KRW' && h.currentPriceKrw !== null), key = coins.map(h => h.symbol).join(',');
  if (select.dataset.key !== key) {
    select.innerHTML = coins.length ? coins.map(h => `<option value="${esc(h.symbol)}">${esc(h.name)} ${esc(h.symbol)}</option>`).join('') : '<option value="">보유 코인 없음</option>';
    select.dataset.key = key;
    fillAveraging();
  }
  computeAveraging();
}
function fillAveraging() {
  const h = state.portfolio?.holdings.find(item => item.symbol === $('#avg-symbol').value);
  $('#avg-qty').value = h ? Number(h.quantity) : '';
  $('#avg-avg').value = h?.averagePriceKrw ? Number(h.averagePriceKrw) : '';
  $('#avg-price').value = h ? Number(h.currentPriceKrw) : '';
  $('#avg-target').value = '';
}
function computeAveraging() {
  const box = $('#avg-result');
  if (!box) return;
  const symbol = $('#avg-symbol').value, current = metricsFor(symbol).price;
  const qty = inputNumber('#avg-qty'), avg = inputNumber('#avg-avg'), buyPrice = inputNumber('#avg-price'), amountKrw = inputNumber('#avg-amount') ?? 0, target = inputNumber('#avg-target');
  if (!(qty >= 0) || !(avg > 0) || !(buyPrice > 0)) { box.innerHTML = '<p class="empty">보유 수량, 평균 매수가, 추가 매수 가격을 입력하세요.</p>'; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다. 금액 보기를 누르면 계산 결과가 보입니다.</p>'; return; }
  const buyQty = amountKrw / buyPrice, after = averageAfterBuy({ quantity: qty, average: avg, buyQuantity: buyQty, buyPrice });
  const value = current ? after.quantity * current : null, profit = value === null ? null : value - after.cost, change = after.average ? (after.average - avg) / avg * 100 : 0;
  const needed = target ? quantityForTarget({ quantity: qty, average: avg, price: buyPrice, target }) : null;
  box.innerHTML = `<p class="muted small">추가 매수 후 평균 매수가</p><p class="tool__figure">${price(after.average)}</p>
    <p class="hero__delta"><span class="pill ${sign(change)}">${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${number(Math.abs(change), 2)}%</span><span>지금 ${price(avg)}에서</span></p>
    <dl class="tool__list"><div><dt>추가 수량</dt><dd>${number(buyQty, 8)} ${esc(symbol)}</dd></div><div><dt>총 보유 수량</dt><dd>${number(after.quantity, 8)} ${esc(symbol)}</dd></div>
      <div><dt>총 매수 원가</dt><dd>${money(after.cost)}</dd></div><div><dt>현재가 기준 평가손익</dt><dd class="${sign(profit)}">${profit === null ? '—' : `${money(profit, true)} · ${number(profit / after.cost * 100, 2)}%`}</dd></div>
      <div><dt>본전까지</dt><dd>${current && after.average ? `${number((after.average - current) / current * 100, 2)}% <small class="muted">현재가 ${price(current)}</small>` : '—'}</dd></div></dl>
    ${target ? `<p class="tool__note">${needed === null ? `목표 평단 ${price(target)}은 추가 매수 가격(${price(buyPrice)})과 지금 평단(${price(avg)}) 사이여야 만들 수 있습니다.` : `목표 평단 ${price(target)}을 만들려면 ${price(buyPrice)}에 <b>${number(needed, 8)} ${esc(symbol)}</b>, 약 <b>${money(needed * buyPrice)}</b>어치를 사야 합니다.`}</p>` : ''}`;
}
function setupRebalance() {
  const body = $('#reb-body');
  if (!body || !state.portfolio) return;
  const rows = state.portfolio.holdings.filter(h => h.valueKrw !== null), key = rows.map(h => h.symbol).join(',');
  const stored = store.map('targets'), custom = rows.every(h => Number.isFinite(Number(stored[h.symbol]))), targets = custom ? stored : targetPreset('current', rows);
  if (body.dataset.key !== key) {
    body.innerHTML = rows.map(h => `<tr data-symbol="${esc(h.symbol)}"><td><span class="asset"><span class="avatar ${seriesClass(h.symbol)}" aria-hidden="true">${esc(monogram(h.symbol))}</span><span class="asset__text"><span class="asset__name">${esc(h.name)}</span><span class="asset__sym">${esc(h.symbol)}</span></span></span></td>
      <td class="reb-now"></td><td><label class="pct-input"><input class="input" type="number" step="0.1" min="0" max="100" inputmode="decimal" data-reb="${esc(h.symbol)}" value="${Number(targets[h.symbol])}" aria-label="${esc(h.name)} 목표 비중(%)"><span>%</span></label></td>
      <td class="reb-target"></td><td class="reb-diff"></td><td class="reb-qty"></td></tr>`).join('');
    body.dataset.key = key;
  } else if (!custom) {
    // 직접 정한 목표가 없으면 목표 칸이 실시간 현재 비중을 따라갑니다. 입력 중인 칸은 건드리지 않습니다.
    for (const input of body.querySelectorAll('[data-reb]')) if (input !== document.activeElement) input.value = targets[input.dataset.reb] ?? 0;
  }
  computeRebalance();
}
// 소수 첫째 자리로 반올림한 비중의 합이 정확히 100%가 되도록 남는 값을 가장 큰 자산에 더합니다.
function roundShares(shares) {
  const rounded = shares.map(value => Math.round(value * 10) / 10), rest = Math.round((100 - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  if (rounded.length && rest) { const i = shares.indexOf(Math.max(...shares)); rounded[i] = Math.round((rounded[i] + rest) * 10) / 10; }
  return rounded;
}
function targetPreset(preset, rows) {
  const crypto = rows.filter(h => h.symbol !== 'KRW'), cryptoTotal = Math.max(1, crypto.reduce((sum, h) => sum + Number(h.valueKrw), 0));
  const shares = rows.map(h => preset === 'equal' ? 100 / rows.length : preset === 'cash10' ? (h.symbol === 'KRW' ? 10 : 90 * Number(h.valueKrw) / cryptoTotal) : Number(h.allocationPct ?? 0));
  return Object.fromEntries(rows.map((h, i) => [h.symbol, roundShares(shares)[i]]));
}
function rebalancePreset(preset) {
  const rows = state.portfolio?.holdings.filter(h => h.valueKrw !== null) ?? [], targets = targetPreset(preset, rows);
  for (const input of document.querySelectorAll('[data-reb]')) input.value = targets[input.dataset.reb] ?? 0;
  // '현재 비중'을 고르면 저장한 목표를 지워 다시 실시간 비중을 따라가게 합니다.
  if (preset === 'current') store.put('targets', {}); else saveTargets();
  computeRebalance();
}
const saveTargets = () => store.put('targets', Object.fromEntries([...document.querySelectorAll('[data-reb]')].map(input => [input.dataset.reb, Number(input.value) || 0])));
function computeRebalance() {
  const body = $('#reb-body');
  if (!body || !state.portfolio) return;
  const holdings = state.portfolio.holdings.filter(h => h.valueKrw !== null), stored = store.map('targets'), targets = {};
  for (const input of document.querySelectorAll('[data-reb]')) targets[input.dataset.reb] = Number(input.value) || 0;
  // 직접 정한 목표가 없으면 반올림하기 전 현재 비중으로 계산해, 현재 비중 그대로일 때 사고팔 금액이 0원이 되게 합니다.
  if (!holdings.every(h => Number.isFinite(Number(stored[h.symbol])))) {
    const now = holdings.reduce((sum, h) => sum + Number(h.valueKrw), 0);
    for (const h of holdings) targets[h.symbol] = now > 0 ? Number(h.valueKrw) / now * 100 : 0;
  }
  const result = rebalance(holdings.map(h => ({ symbol: h.symbol, name: h.name, value: Number(h.valueKrw), price: h.symbol === 'KRW' ? 1 : Number(h.currentPriceKrw), target: targets[h.symbol] ?? 0 })), inputNumber('#reb-cash') ?? 0);
  for (const row of result.rows) {
    const tr = document.querySelector(`#reb-body tr[data-symbol="${row.symbol}"]`);
    if (!tr) continue;
    const cash = row.symbol === 'KRW', side = row.diff > 0.5 ? '매수' : row.diff < -0.5 ? '매도' : '유지';
    tr.querySelector('.reb-now').innerHTML = `${money(row.value)}<small>${state.hidden ? '••' : `${number(row.value / Math.max(1, result.total - (inputNumber('#reb-cash') ?? 0)) * 100, 1)}%`}</small>`;
    tr.querySelector('.reb-target').innerHTML = money(row.targetValue);
    tr.querySelector('.reb-diff').innerHTML = `<span class="${cash ? '' : row.diff > 0.5 ? 'positive' : row.diff < -0.5 ? 'negative' : ''}">${money(Math.round(row.diff) || 0, true)}</span>`;
    tr.querySelector('.reb-qty').innerHTML = cash ? `<small class="muted">${row.diff > 0.5 ? '원화로 남김' : row.diff < -0.5 ? '원화에서 사용' : '—'}</small>` : `${state.hidden ? '••••' : `${number(Math.abs(row.quantity), 8)} ${esc(row.symbol)}`}<small>${side}</small>`;
  }
  const off = Math.abs(result.targetSum - 100) > 0.05;
  $('#reb-foot').innerHTML = `${off ? `<span class="warn-text">${icon('alert')}목표 비중 합계가 ${number(result.targetSum, 1)}%입니다. 100%가 되도록 맞추세요.</span> ` : `목표 비중 합계 100% · 총 ${money(result.total)} 기준 · `}현재가로 계산했으며 수수료·호가 단위는 빼고 계산했습니다. 실제 주문은 빗썸 앱에서 직접 하세요.`;
  const bar = (label, getter) => `<div class="reb-bar"><span class="muted small">${label}</span><span class="stack">${result.rows.map(row => `<span class="stack__seg ${seriesClass(row.symbol)}" data-share="${Math.max(0, getter(row))}" title="${esc(`${row.name} ${number(getter(row), 1)}%`)}"></span>`).join('')}</span></div>`;
  $('#reb-bars').innerHTML = bar('현재', row => row.value / Math.max(1, result.total) * 100) + bar('목표', row => row.targetValue / Math.max(1, result.total) * 100);
  applyShares($('#reb-bars'));
}
function setupScenario() {
  const box = $('#scn-sliders');
  if (!box || !state.portfolio) return;
  const coins = state.portfolio.holdings.filter(h => h.symbol !== 'KRW' && h.valueKrw !== null), key = coins.map(h => h.symbol).join(',');
  if (box.dataset.key !== key) {
    const slider = (id, label, swatch = '') => `<label class="slider"><span class="slider__label">${swatch}${label}</span><input type="range" min="-50" max="100" step="1" value="${state.scenario[id] ?? 0}" data-scn="${esc(id)}" aria-label="${esc(label)} 가격 변화(%)"><output data-scn-out="${esc(id)}">0%</output></label>`;
    box.innerHTML = `${slider('ALL', '전체 가상자산')}<div class="slider-group">${coins.map(h => slider(h.symbol, esc(h.name), `<span class="swatch ${seriesClass(h.symbol)}" aria-hidden="true"></span>`)).join('')}</div>`;
    box.dataset.key = key;
  }
  computeScenario();
}
function scenarioPreset(preset) {
  const values = { reset: 0, down20: -20, up30: 30, btc10: 0 }[preset] ?? 0;
  for (const input of document.querySelectorAll('[data-scn]')) input.value = preset === 'btc10' ? (input.dataset.scn === 'BTC' ? 10 : 0) : values;
  computeScenario();
}
function computeScenario() {
  const box = $('#scn-result');
  if (!box || !state.portfolio) return;
  const changes = {};
  for (const input of document.querySelectorAll('[data-scn]')) { state.scenario[input.dataset.scn] = Number(input.value); if (input.dataset.scn !== 'ALL') changes[input.dataset.scn] = Number(input.value); }
  for (const output of document.querySelectorAll('[data-scn-out]')) { const value = state.scenario[output.dataset.scnOut] ?? 0; output.textContent = `${value > 0 ? '+' : ''}${value}%`; output.className = sign(value); }
  for (const input of document.querySelectorAll('[data-scn]')) {
    const min = Number(input.min), span = Number(input.max) - min, at = (Number(input.value) - min) / span, zero = -min / span;
    input.style.setProperty('--zero', zero); input.style.setProperty('--lo', Math.min(at, zero)); input.style.setProperty('--hi', Math.max(at, zero));
    input.classList.toggle('positive', Number(input.value) > 0); input.classList.toggle('negative', Number(input.value) < 0);
  }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; return; }
  const result = scenario(state.portfolio.holdings.filter(h => h.valueKrw !== null), changes, 0);
  box.innerHTML = `<p class="muted small">예상 총 평가금액</p><p class="tool__figure">${money(result.total)}</p>
    <p class="hero__delta">${deltaPill(result.change, result.base)}<span>지금 ${money(result.base)}에서</span></p>
    <dl class="tool__list"><div><dt>예상 평가손익</dt><dd class="${sign(result.profit)}">${result.profit === null ? '—' : `${money(result.profit, true)} · ${percent(result.profitPct)}`}</dd></div></dl>
    <ul class="scn-rows">${result.rows.filter(row => row.symbol !== 'KRW').map(row => `<li><span>${esc(row.name)} <small class="${sign(row.pct)}">${row.pct > 0 ? '+' : ''}${row.pct}%</small></span><span>${money(row.next)}<small class="${sign(row.change)}">${money(row.change, true)}</small></span></li>`).join('')}</ul>`;
}

function openMore() {
  const items = [...document.querySelectorAll('.nav__item[data-page]')];
  $('#more-grid').innerHTML = items.map(item => `<button type="button" class="more-item${item.dataset.page === state.page ? ' is-active' : ''}" data-action="page" data-page="${item.dataset.page}">${item.innerHTML}</button>`).join('')
    + `<button type="button" class="more-item" data-action="alerts">${icon('bell')}<span>가격 알림</span></button><button type="button" class="more-item" data-action="guide">${icon('check')}<span>연결·MCP 가이드</span></button>`;
  if (!$('#more-dialog').open) $('#more-dialog').showModal();
}

function restoreFilters() {
  if (!$('#search')) return;
  const f = state.filters;
  $('#search').value = typeof f.search === 'string' ? f.search : '';
  $('#cash-filter').checked = f.excludeCash === true;
  $('#performance').value = ['all', 'gain', 'loss', 'unknown'].includes(f.performance) ? f.performance : 'all';
  $('#sort').value = ['value', 'profit', 'pnl', 'change', 'name'].includes(f.sort) ? f.sort : 'value';
}
function updateFilters() {
  state.filters = { ...state.filters, search: $('#search').value, excludeCash: $('#cash-filter').checked, performance: $('#performance').value, sort: $('#sort').value };
  saved.set(filterKey(), JSON.stringify(state.filters));
  renderHoldings();
}
function visibleHoldings() { return filterHoldings(state.portfolio?.holdings ?? [], state.filters); }

// ===== 추이 차트 · 일별 변화 달력 =====
function syncTrendControls() {
  for (const button of document.querySelectorAll('[data-view]')) { const on = button.dataset.view === state.view; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); }
  for (const button of document.querySelectorAll('[data-days]')) { const on = Number(button.dataset.days) === board()?.days; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on)); }
  if ($('#days')) $('#days').hidden = state.view === 'calendar';
}
function renderTrend() {
  if (!$('#trend')) return;
  const calendar = state.view === 'calendar';
  $('#chart').hidden = calendar;
  $('#calendar').hidden = !calendar;
  if ($('#trend-stats')) $('#trend-stats').hidden = calendar || state.hidden || !state.history;
  if (calendar) { renderCalendar(); heroReadout(null); } else renderChartArea();
}
// 단조 3차 보간: 값이 실제보다 튀어 오르지 않는 부드러운 선입니다.
function smoothPath(points) {
  const n = points.length, f = value => value.toFixed(1);
  if (n < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join(' ');
  const dx = [], slope = [], tangent = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; slope[i] = dx[i] ? (points[i + 1][1] - points[i][1]) / dx[i] : 0; }
  tangent[0] = slope[0]; tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (!slope[i]) { tangent[i] = tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tangent[i] = k * a * slope[i]; tangent[i + 1] = k * b * slope[i]; }
  }
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], h = dx[i] / 3;
    d += ` C${f(x0 + h)},${f(y0 + tangent[i] * h)} ${f(x1 - h)},${f(y1 - tangent[i + 1] * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
function niceTicks(low, high, count) {
  const raw = (high - low) / count, power = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw);
  const ticks = [];
  for (let value = Math.ceil(low / step) * step; value <= high; value += step) ticks.push(Math.round(value / step) * step);
  return { ticks, step };
}
const chartModels = new Map();
// 화면 너비에 맞춘 SVG 영역 차트. points: [{ at, value }]. 오른쪽 축에 눈금, 아래에 날짜를 둡니다.
function areaChart(box, points, { label, readout = 'full', format = value => `${number(value)}원` }) {
  const width = Math.max(280, Math.round(box.clientWidth)), compactWidth = width < 520;
  const height = box.id === 'detail-chart' ? 190 : width >= 900 ? 260 : compactWidth ? 190 : 220;
  const gutter = compactWidth ? 50 : 62, inset = compactWidth ? 16 : 28, top = 30, bottom = height - 30, right = width - gutter;
  const values = points.map(p => p.value);
  let low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max((high - low) * 0.14, Math.abs(high) * 0.002, 1);
  low -= pad; high += pad;
  const start = Date.parse(points[0].at), span = Math.max(Date.parse(points.at(-1).at) - start, 1);
  const xy = points.map(p => [inset + (Date.parse(p.at) - start) / span * (right - inset * 1.5), bottom - (p.value - low) / (high - low) * (bottom - top)]);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const line = smoothPath(xy), last = xy.at(-1);
  const { ticks, step } = niceTicks(low, high, height >= 220 ? 5 : 4);
  const grid = ticks.map(t => `<line class="grid" x1="0" x2="${right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="tick" x="${width - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(axisLabel(t, step))}</text>`).join('');
  const count = width >= 760 ? 5 : width >= 440 ? 4 : 3;
  const indexes = [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (points.length - 1) / (count - 1))))];
  const dates = indexes.map((index, i) => `<text class="tick" x="${xy[index][0].toFixed(1)}" y="${height - 9}" text-anchor="${i === 0 ? 'start' : i === indexes.length - 1 ? 'end' : 'middle'}">${esc(shortDay(points[index].at))}</text>`).join('');
  const fill = `${box.id}-fill`;
  box.dataset.width = String(box.clientWidth);
  chartModels.set(box.id, { points, xy, right, top, bottom, readout, format, index: null });
  const p = points.at(-1);
  return `<div class="chart__plot" tabindex="0" role="slider" aria-label="${esc(`${label}, ${shortDay(points[0].at)}부터 ${shortDay(p.at)}까지. 좌우 방향키로 시점 이동`)}" aria-valuemin="0" aria-valuemax="${points.length - 1}" aria-valuenow="${points.length - 1}" aria-valuetext="${esc(`${date(p.at)} · ${format(p.value)}`)}">
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      <defs><linearGradient id="${fill}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fill-top"/><stop offset="1" class="fill-bottom"/></linearGradient></defs>
      ${grid}<line class="baseline" x1="0" x2="${right}" y1="${bottom}" y2="${bottom}"/>
      <path d="${line} L${last[0].toFixed(1)},${bottom} L${xy[0][0].toFixed(1)},${bottom} Z" fill="url(#${fill})"/><path class="line" d="${line}"/>
      <circle class="dot end-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4"/>
      <line class="cursor" x1="0" x2="0" y1="${top - 8}" y2="${bottom}"/><circle class="dot cursor-dot" r="4.5" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}"/>
      <text class="cursor-label" x="${last[0].toFixed(1)}" y="14" text-anchor="middle"></text>
      ${dates}
    </svg></div>`;
}
function selectChartPoint(id, index) {
  const model = chartModels.get(id), box = document.getElementById(id);
  if (!model || !box || (id === 'chart' && state.hidden)) return;
  const p = model.points[index], at = model.xy[index];
  if (!p) return;
  model.index = index;
  box.classList.add('is-active');
  const plot = box.querySelector('.chart__plot');
  if (plot) {
    plot.querySelector('.cursor')?.setAttribute('x1', at[0].toFixed(1));
    plot.querySelector('.cursor')?.setAttribute('x2', at[0].toFixed(1));
    plot.querySelector('.cursor-dot')?.setAttribute('cx', at[0].toFixed(1));
    plot.querySelector('.cursor-dot')?.setAttribute('cy', at[1].toFixed(1));
    const text = model.readout === 'date' ? date(p.at) : `${date(p.at)} · ${model.format(p.value)}`, half = text.length * 3.4 + 6;
    const label = plot.querySelector('.cursor-label');
    if (label) { label.textContent = text; label.setAttribute('x', Math.min(Math.max(at[0], half), model.right - half).toFixed(1)); }
    plot.setAttribute('aria-valuenow', String(index));
    plot.setAttribute('aria-valuetext', `${date(p.at)} · ${model.format(p.value)}`);
  }
  if (id === 'chart') heroReadout(index);
}
function releaseChart(id) {
  const model = chartModels.get(id);
  if (!model || model.index === null) return;
  model.index = null;
  document.getElementById(id)?.classList.remove('is-active');
  if (id === 'chart') heroReadout(null);
}
function renderChartArea() {
  const box = $('#chart'), h = state.history, hero = Boolean($('#hero-delta'));
  if (!box) return;
  if (!h) { box.innerHTML = '<span class="skeleton chart-skeleton"></span>'; if ($('#trend-stats')) $('#trend-stats').hidden = true; heroReadout(null); return; }
  box.classList.remove('is-stale', 'is-active');
  if (state.hidden) { chartModels.delete('chart'); box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; $('#history-summary').textContent = '금액 숨김'; heroReadout(null); return; }
  const points = h.points.filter(p => p.valuationComplete && p.totalValueKrw !== null && Number.isFinite(Number(p.totalValueKrw)));
  const omitted = h.points.length - points.length;
  $('#history-summary').textContent = `${h.mode === 'demo' ? '합성 예시' : '로컬 기록'} · ${points.length}개 시점${h.sampled ? '(간추림)' : ''}${omitted ? ` · 가격 미확인 ${omitted}개 제외` : ''}`;
  if (points.length < 2) {
    chartModels.delete('chart');
    if ($('#trend-stats')) $('#trend-stats').hidden = true;
    box.innerHTML = '<p class="empty">기록이 두 번 이상 쌓이면 추이가 나타납니다.<br>조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 기록합니다.</p>';
    heroReadout(null);
    return;
  }
  const first = Number(points[0].totalValueKrw), last = Number(points.at(-1).totalValueKrw), change = last - first;
  if ($('#trend-stats')) {
    $('#trend-stats').hidden = false;
    $('#trend-stats').innerHTML = `<div><span>첫 기록</span><strong>${money(first)}</strong></div><div><span>최근 기록</span><strong>${money(last)}</strong></div><div><span>기록 구간 변화</span><strong class="${tone(change)}">${money(change, true)}</strong></div>`;
  }
  box.innerHTML = areaChart(box, points.map(p => ({ at: p.asOf, value: Number(p.totalValueKrw) })), { label: '평가금액 추이(수익률 아님)', readout: hero ? 'date' : 'full' });
  heroReadout(null);
}
function renderCalendar() {
  const box = $('#calendar'), d = state.daily;
  if (!box) return;
  if (!d) { box.innerHTML = '<p class="empty">불러오는 중</p>'; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; $('#history-summary').textContent = '금액 숨김'; return; }
  const days = new Map(d.daily.filter(row => row.changeKrw !== null).map(row => [row.day, row]));
  $('#history-summary').textContent = `${d.mode === 'demo' ? '합성 예시' : '로컬 기록'} · 변화 기록 ${days.size}일`;
  if (!days.size) { box.innerHTML = '<p class="empty">이틀 이상 기록되면 날짜별 자산 변화가 표시됩니다.</p>'; return; }
  const today = kstDay(new Date(now()).toISOString()), first = [...days.keys()][0].slice(0, 7), last = today.slice(0, 7);
  if (!state.month || state.month < first || state.month > last) state.month = last;
  const [year, month] = state.month.split('-').map(Number);
  if (!state.calendarDay?.startsWith(state.month) || !days.has(state.calendarDay)) state.calendarDay = [...days.keys()].filter(day => day.startsWith(state.month)).at(-1);
  const blanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // 칸 색의 진하기는 이번 달 가장 큰 변화 대비 크기입니다(4단계).
  const largest = Math.max(1, ...[...days.values()].filter(row => row.day.startsWith(state.month)).map(row => Math.abs(Number(row.changeKrw))));
  let total = 0, counted = 0;
  const cells = Array.from({ length }, (_, i) => {
    const day = `${state.month}-${String(i + 1).padStart(2, '0')}`, row = days.get(day), change = row ? Number(row.changeKrw) : 0;
    if (row) { total += change; counted++; }
    const cls = row ? sign(change) : '', level = cls ? ` l${Math.min(4, Math.max(1, Math.ceil(Math.abs(change) / largest * 4)))}` : '';
    const label = row ? `${day} 자산 변화 ${money(change, true)}, 마지막 기록 ${money(row.closeKrw)}${row.gapDays > 1 ? `, ${row.previousDay} 이후 ${row.gapDays}일 변화` : ''}` : '';
    return `<${row ? 'button type="button"' : 'div'} class="calendar__day${cls ? ` is-${cls}${level}` : ''}${day === today ? ' is-today' : ''}${day === state.calendarDay ? ' is-selected' : ''}"${row ? ` data-action="calendar-day" data-day="${day}" aria-pressed="${day === state.calendarDay}" aria-label="${esc(label)}" title="${esc(label)}"` : ''}><span class="calendar__date">${i + 1}${row?.gapDays > 1 ? '*' : ''}</span>${row ? `<strong class="calendar-value-full">${compact(change)}</strong><strong class="calendar-value-short" aria-hidden="true">${compact(change, 0)}</strong><small>${percent(row.changePct)}</small>` : ''}</${row ? 'button' : 'div'}>`;
  });
  const selected = state.calendarDay ? days.get(state.calendarDay) : null;
  box.innerHTML = `<div class="calendar__head">
      <button type="button" class="icon-button" data-action="month" data-step="-1" aria-label="이전 달"${state.month <= first ? ' disabled' : ''}>${icon('left')}</button>
      <strong>${year}년 ${month}월</strong>
      <button type="button" class="icon-button" data-action="month" data-step="1" aria-label="다음 달"${state.month >= last ? ' disabled' : ''}>${icon('right')}</button>
      <span class="calendar__total">표시 변화 합계<strong class="${counted ? sign(total) : ''}">${counted ? money(total, true) : '—'}</strong></span>
    </div>
    <div class="calendar__grid">${['일', '월', '화', '수', '목', '금', '토'].map(w => `<span class="calendar__weekday">${w}</span>`).join('')}${'<div class="calendar__day is-blank"></div>'.repeat(blanks)}${cells.join('')}</div>
    <p id="calendar-detail" class="calendar-detail" role="status">${selected ? `${state.calendarDay} · 자산 변화 <strong class="${tone(selected.changeKrw)}">${money(selected.changeKrw, true)}</strong> · 마지막 기록 ${money(selected.closeKrw)}${selected.gapDays > 1 ? ` · ${selected.gapDays}일간 변화` : ''}` : '이번 달에는 비교할 기록이 없습니다.'}</p>
    <p class="calendar__note">날짜를 누르면 정확한 금액을 확인합니다. 칸의 금액은 반올림한 값이고, 색이 진할수록 이번 달에서 변화가 큰 날입니다.<br>직전 기록일 대비 변화 · 입출금 포함 · 한국 시간 · * 표시는 기록 공백을 포함한 여러 날의 변화입니다.</p>`;
}
function setView(view) {
  if (state.view === view) return;
  cancelRequest('history');
  state.view = view;
  saved.set('view', view);
  syncTrendControls(); renderTrend();
  if (view === 'calendar' ? !state.daily : !state.history) void loadHistory();
}
function setDays(days) {
  const b = board();
  if (!b || b.days === days) return;
  b.days = days;
  syncTrendControls();
  // 새 기간을 받는 동안 지난 차트를 흐리게 유지합니다.
  $('#chart')?.classList.add('is-stale');
  void loadHistory();
  persist(b.id, { days });
}
function shiftMonth(step) {
  const [year, month] = state.month.split('-').map(Number);
  state.month = new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7);
  renderCalendar();
}
// 기간 버튼처럼 바로 저장하는 변경은 순서대로 보내 revision 충돌을 피합니다.
function persist(id, changes) {
  state.saving = state.saving.then(async () => {
    const current = state.boards.find(b => b.id === id);
    if (!current) return;
    const { name, symbols, widgets, days, refreshSeconds, revision } = { ...current, ...changes };
    try {
      const result = await api(`/api/boards/${id}`, { method: 'PUT', body: { name, symbols, widgets, days, refreshSeconds, revision } });
      state.boards = state.boards.map(b => b.id === id ? result : b);
    } catch (error) { notice(`설정을 저장하지 못했어요: ${error.message}`); await reloadBoards(); }
  });
}

// ===== 거래·입출금 =====
function activityBusy(busy) {
  if (!$('#activity-load')) return;
  $('#activity-load').disabled = busy;
  $('#activity-load').textContent = busy ? '조회 중…' : '내역 조회';
  $('#activity-cancel').hidden = !busy;
  $('#activity').setAttribute('aria-busy', String(busy));
}
function resetActivity(message = '조건을 바꿨습니다. 내역 조회를 눌러주세요.') {
  cancelRequest('activity'); state.activity = null; state.activityShown = 100;
  if (!$('#activity-body')) return;
  activityBusy(false);
  $('#activity-body').innerHTML = '<tr><td colspan="5" class="empty">조회할 조건을 선택하세요.</td></tr>';
  $('#activity-table').hidden = true;
  $('#activity-empty').hidden = false;
  $('#activity-coverage').textContent = message;
  $('#activity-hint').textContent = message;
  $('#activity-filters').hidden = true;
  $('#activity-export').disabled = true;
  $('#activity-more').hidden = true;
}
function activityPeriod(preset) {
  const range = recordDates(preset, now());
  $('#activity-from').value = range.from; $('#activity-to').value = range.to;
  resetActivity();
}
async function loadActivity(force = false) {
  if (!$('#activity-kind')) return;
  const kind = $('#activity-kind').value, button = $('#activity-load');
  const period = kind === 'pending' ? {} : { from: $('#activity-from').value, to: $('#activity-to').value };
  const invalid = kind === 'pending' ? '' : dateRangeError(period.from, period.to);
  if (invalid) { resetActivity(invalid); notice(invalid); return; }
  resetActivity();
  const request = beginRequest('activity');
  activityBusy(true);
  $('#activity-empty').hidden = true;
  $('#activity-table').hidden = false;
  $('#activity-body').innerHTML = '<tr><td colspan="5" class="empty">내역을 불러오는 중입니다.</td></tr>';
  $('#activity-coverage').textContent = '페이지를 이어서 조회하고 있습니다. 기간이 길면 시간이 걸릴 수 있습니다.';
  try {
    const result = await api(`/api/records?${query({ kind, ...period, force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.activity = result;
    state.activityShown = 100;
    $('#activity-filters').hidden = false;
    $('#activity-search').value = '';
    $('#activity-status').innerHTML = `<option value="all">상태 전체</option>${[...new Set(result.rows.map(row => row.state))].map(status => `<option value="${esc(status)}">${esc(STATES[status] ?? status)}</option>`).join('')}`;
    $('#activity-side').value = 'all';
    $('#activity-side').hidden = !['orders', 'pending'].includes(kind);
    renderActivity();
  } catch (error) {
    if (!request.current()) return;
    $('#activity-coverage').textContent = error.message;
    $('#activity-body').innerHTML = '<tr><td colspan="5" class="empty">내역 조회에 실패했습니다. 다시 조회할 수 있습니다.</td></tr>';
    notice(error.message);
  } finally { if (request.current() && button === $('#activity-load')) activityBusy(false); }
}
function visibleActivity() {
  const search = $('#activity-search')?.value ?? '';
  const translated = Object.entries(STATES).filter(([, label]) => label === search.trim()).map(([key]) => key);
  const options = { symbols: state.page === 'home' ? board()?.symbols ?? [] : [], search: translated.length ? '' : search, status: $('#activity-status')?.value ?? 'all', side: $('#activity-side')?.hidden ? 'all' : $('#activity-side')?.value ?? 'all' };
  const rows = filterActivity(state.activity?.rows ?? [], options);
  return translated.length ? rows.filter(row => translated.includes(row.state)) : rows;
}
function renderActivity() {
  const r = state.activity, body = $('#activity-body');
  if (!r || !body) return;
  const only = new Set(state.page === 'home' ? board().symbols : []), order = r.kind === 'orders' || r.kind === 'pending';
  const rows = visibleActivity();
  $('#activity-empty').hidden = true;
  $('#activity-table').hidden = false;
  body.innerHTML = rows.length ? rows.slice(0, state.activityShown).map(row => {
    if (order) {
      const [quote, base] = row.market.split('-');
      return `<tr><td><span class="kind"><span class="kind__badge ${row.side === 'bid' ? 'positive' : 'negative'}">${row.side === 'bid' ? '매수' : '매도'}</span><strong>${esc(base)}</strong></span><small>${esc(row.market)} · ${esc(row.order_type)}</small></td><td>${date(row.at ?? row.created_at)}</td><td>${amount(row.volume, base)}<small>체결 ${amount(row.executed_volume, base)}${Number(row.executed_funds) ? ` · ${amount(row.executed_funds, quote)}` : ''}</small></td><td>${amount(row.paid_fee, quote)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
    }
    return `<tr><td><span class="kind"><span class="kind__badge">${r.kind.includes('deposit') ? '입금' : '출금'}</span><strong>${esc(row.currency)}</strong></span><small>${esc(row.net_type ?? (row.currency === 'KRW' ? '원화' : '가상자산'))}</small></td><td>${date(row.at)}</td><td>${amount(row.amount, row.currency)}</td><td>${amount(row.fee, row.currency)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">선택한 조건에 해당하는 내역이 없습니다.</td></tr>';
  $('#activity-more').hidden = rows.length <= state.activityShown;
  $('#activity-more').textContent = `100건 더 보기 (${Math.min(rows.length, state.activityShown)} / ${rows.length})`;
  $('#activity-export').disabled = state.hidden || !rows.length;
  const range = r.period ? `${kstDay(r.period.from)} ~ ${kstDay(r.period.to)}` : '현재';
  $('#activity-coverage').textContent = `${r.mode === 'demo' ? '합성 예시 · ' : ''}${r.label} · ${r.rows.length}건 중 ${rows.length}건${only.size ? ` (${[...only].join('·')} 범위)` : ''} · ${range} · ${r.coverage.complete ? '요청 범위 조회 완료' : `일부만 조회됨(최대 ${r.coverage.maxPages}페이지)`} · ${date(r.asOf)} 조회 · ${r.coverage.note}`;
}

// ===== 대화상자: 자산 상세 · 요약 =====
async function showHolding(symbol) {
  const h = state.portfolio?.holdings.find(item => item.symbol === symbol);
  if (!h) return;
  const cash = h.symbol === 'KRW';
  const rows = [['보유 수량', amount(h.quantity, h.symbol)], ['가용 수량', amount(h.available, h.symbol)], ['주문 중 수량', amount(h.locked, h.symbol)],
    ['평균 매수가', cash ? '—' : money(h.averagePriceKrw)], ['현재가', cash ? '—' : h.currentPriceKrw === null ? '가격 미확인' : price(h.currentPriceKrw)],
    ['비중', state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`]];
  const oldChart = $('#detail-chart');
  if (oldChart) charts.unobserve(oldChart);
  cancelRequest('market');
  const change = cash || missing(h.priceChangePct) ? '' : ` · 전일 대비 <span class="${sign(h.priceChangePct)}">${Number(h.priceChangePct) > 0 ? '+' : ''}${number(h.priceChangePct, 2)}%</span>`;
  $('#detail').innerHTML = `<div class="drawer__head"><span class="avatar avatar--lg ${seriesClass(h.symbol)}" aria-hidden="true">${esc(monogram(h.symbol))}</span><div><h2 id="detail-title">${esc(h.name)}</h2><p>${esc(h.symbol)}${change}${h.marketWarning ? `<span class="flag" title="빗썸 거래 유의 지정">${icon('alert')}유의</span>` : ''}</p></div><button type="button" class="icon-button icon-button--quiet close" data-close aria-label="닫기">${icon('x')}</button></div>
    <div class="detail-hero"><span>평가금액</span><strong>${money(h.valueKrw)}</strong>${cash || h.profitKrw === null ? '' : `<span class="pill ${tone(h.profitKrw)}">평가손익 ${money(h.profitKrw, true)} · ${percent(h.profitRatePct)}</span>`}</div>
    ${cash ? '' : '<h3 class="section-title">원화 시세 · 최근 30일 일봉</h3><div id="detail-chart" class="chart chart--detail"><span class="skeleton chart-skeleton"></span></div>'}
    <dl class="detail-metrics">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
    <p class="note">${h.quoteAt ? `현재가 기준 ${date(h.quoteAt)}${h.priceSource?.startsWith('BTC-') ? '(BTC 마켓 환산)' : ''}. ` : ''}${h.averagePriceModified ? '수정된 평균 매수가를 사용합니다. ' : ''}수량에는 주문 중인 자산이 포함됩니다.</p>`;
  if (!$('#holding-dialog').open) $('#holding-dialog').showModal();
  state.market = null;
  if (cash) return;
  charts.observe($('#detail-chart'));
  const request = beginRequest('market');
  try {
    const market = await api(`/api/market?${query({ symbol, days: 30 })}`, { signal: request.signal });
    if (!request.current()) return;
    state.market = market;
    renderMarket();
  } catch (error) { if (request.current() && $('#detail-chart')) $('#detail-chart').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}
function renderMarket() {
  const box = $('#detail-chart'), m = state.market;
  if (!box || !m) return;
  const points = m.candles.map(c => ({ at: `${c.date}T00:00:00+09:00`, value: Number(c.closeKrw) }));
  if (points.length < 2) { box.innerHTML = '<p class="empty">일봉 데이터가 부족합니다.</p>'; return; }
  box.innerHTML = areaChart(box, points, { label: `${m.name} 원화 일봉 종가`, format: price });
}
async function showExplain() {
  const request = beginRequest('explain');
  $('#explain-body').innerHTML = '<p class="empty">현재 자산을 요약하고 있습니다.</p>';
  if (!$('#explain-dialog').open) $('#explain-dialog').showModal();
  try {
    const e = await api(`/api/explain?${query({ symbols: scope() })}`, { signal: request.signal });
    if (!request.current()) return;
    $('#explain-body').innerHTML = state.hidden ? '<p>금액 숨김을 해제하면 요약을 볼 수 있습니다.</p>' : `<p class="explain">${esc(e.summary)}</p>
      ${e.largest.length ? `<ul class="kv-list">${e.largest.map(h => `<li><span>${esc(h.name)} <small>${esc(h.symbol)}</small></span><b>${money(h.valueKrw)} · ${number(h.allocationPct, 1)}%</b></li>`).join('')}</ul>` : ''}
      ${e.warnings.length ? `<p class="note">${e.warnings.map(esc).join('<br>')}</p>` : ''}
      <p class="note">${date(e.asOf)} 기준 · ${e.mode === 'demo' ? '합성 예시' : '계좌 조회'} · 계산된 숫자만 설명하며 외부 AI로 보내지 않습니다.</p>`;
  } catch (error) { if (request.current()) $('#explain-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}

// ===== 대화상자: 화면 편집 =====
async function openEditor(mode) {
  const selected = state.boardId;
  await state.saving;
  if (selected !== state.boardId) return;
  const b = board();
  const base = mode === 'new' ? { name: '새 대시보드', symbols: [], widgets: ['summary', 'trend', 'allocation', 'holdings'], days: 30, refreshSeconds: 60 } : b;
  state.draft = { id: mode === 'edit' ? b.id : null, revision: mode === 'edit' ? b.revision : null, order: [...base.widgets, ...Object.keys(WIDGETS).filter(w => !base.widgets.includes(w))], enabled: new Set(base.widgets), confirmDelete: false };
  $('#board-title').textContent = { edit: '화면 편집', copy: '화면 복제', new: '새 대시보드' }[mode];
  $('#board-name-input').value = mode === 'copy' ? `${b.name} 복사`.slice(0, 48) : base.name;
  $('#board-symbols').value = base.symbols.join(', ');
  $('#board-days').value = String(base.days);
  $('#board-refresh').value = String(base.refreshSeconds);
  $('#board-error').hidden = true;
  $('#board-delete').textContent = '삭제';
  $('#board-delete').disabled = state.boards.length <= 1;
  for (const button of document.querySelectorAll('#board-form [data-existing]')) button.hidden = mode !== 'edit';
  renderOrder(); renderChips();
  if (!$('#board-dialog').open) $('#board-dialog').showModal();
  $('#board-name-input').focus();
  if (!state.allSymbols.length) {
    try { state.allSymbols = (await api('/api/portfolio')).holdings.map(h => h.symbol); renderChips(); } catch { /* 빠른 선택만 생략 */ }
  }
}
const typedSymbols = () => [...new Set($('#board-symbols').value.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
function renderChips() {
  const selected = new Set(typedSymbols());
  $('#symbol-chips').innerHTML = state.allSymbols.map(symbol => `<button type="button" class="chip" data-action="chip" data-symbol="${esc(symbol)}" aria-pressed="${selected.has(symbol)}">${esc(symbol)}</button>`).join('');
}
function toggleChip(symbol) {
  const list = typedSymbols(), index = list.indexOf(symbol);
  if (index >= 0) list.splice(index, 1); else list.push(symbol);
  $('#board-symbols').value = list.join(', ');
  renderChips();
}
function renderOrder() {
  const d = state.draft;
  $('#widget-order').innerHTML = d.order.map((w, i) => `<li class="${d.enabled.has(w) ? '' : 'is-off'}"><label><input type="checkbox" data-widget="${w}"${d.enabled.has(w) ? ' checked' : ''}> ${WIDGETS[w]}</label><button type="button" class="icon-button" data-action="move" data-index="${i}" data-step="-1" aria-label="${WIDGETS[w]} 위로"${i === 0 ? ' disabled' : ''}>${icon('up')}</button><button type="button" class="icon-button" data-action="move" data-index="${i}" data-step="1" aria-label="${WIDGETS[w]} 아래로"${i === d.order.length - 1 ? ' disabled' : ''}>${icon('down')}</button></li>`).join('');
}
function moveWidget(index, step) {
  const order = state.draft.order;
  [order[index], order[index + step]] = [order[index + step], order[index]];
  renderOrder();
  document.querySelector(`[data-action="move"][data-index="${index + step}"][data-step="${step}"]:not(:disabled)`)?.focus();
}
function formError(message) { $('#board-error').textContent = message; $('#board-error').hidden = false; }
async function reloadBoards() {
  cancelRequest('boards-sync');
  const request = beginRequest('boards');
  state.reloading = true;
  try {
    const result = await api('/api/boards', { signal: request.signal });
    if (!request.current()) return false;
    if (!Array.isArray(result.boards) || !result.boards.length) throw new Error('저장된 대시보드를 찾을 수 없습니다.');
    state.boards = result.boards;
    // 편집 중인 입력은 유지하고 서버의 자산 범위·위젯·갱신 주기로 화면을 다시 연결합니다.
    selectBoard(state.boards.some(b => b.id === state.boardId) ? state.boardId : state.boards[0].id);
    return true;
  } catch (error) {
    if (request.current()) showError(`화면 설정을 다시 불러오지 못했습니다. ${error.message}`);
    return false;
  }
  finally { if (request.current()) state.reloading = false; }
}
async function submitBoard(event) {
  event.preventDefault();
  const d = state.draft, widgets = d.order.filter(w => d.enabled.has(w));
  const payload = { name: $('#board-name-input').value.trim(), symbols: typedSymbols(), widgets, days: Number($('#board-days').value), refreshSeconds: Number($('#board-refresh').value) };
  if (!payload.name) return formError('이름을 입력하세요.');
  if (!widgets.length) return formError('위젯을 하나 이상 선택하세요.');
  if (payload.symbols.some(s => !/^[A-Z0-9][A-Z0-9_]{0,29}$/.test(s))) return formError('자산 심볼은 BTC, ETH처럼 영문·숫자로 입력하세요.');
  $('#board-save').disabled = true;
  try {
    const result = d.id ? await api(`/api/boards/${d.id}`, { method: 'PUT', body: { ...payload, revision: d.revision } }) : await api('/api/boards', { method: 'POST', body: payload });
    state.boards = d.id ? state.boards.map(b => b.id === result.id ? result : b) : [...state.boards, result];
    $('#board-dialog').close();
    notice('화면 설정을 저장했어요.');
    state.page = 'home';
    selectBoard(result.id);
  } catch (error) {
    if (error.status === 409) {
      await reloadBoards();
      d.revision = state.boards.find(b => b.id === d.id)?.revision ?? d.revision;
    }
    formError(error.status === 409 ? `${error.message} 다시 저장하면 지금 입력한 설정을 적용합니다.` : error.message);
  } finally { $('#board-save').disabled = false; }
}
async function deleteBoard() {
  const d = state.draft;
  if (!d.confirmDelete) { d.confirmDelete = true; $('#board-delete').textContent = '한 번 더 누르면 삭제'; return; }
  try {
    await api(`/api/boards/${d.id}`, { method: 'DELETE', body: { revision: d.revision } });
    state.boards = state.boards.filter(b => b.id !== d.id);
    $('#board-dialog').close();
    notice('화면을 삭제했어요. 자산 기록은 그대로 남습니다.');
    selectBoard(state.boards[0].id);
  } catch (error) {
    if (error.status === 409) { await reloadBoards(); d.revision = state.boards.find(b => b.id === d.id)?.revision ?? d.revision; d.confirmDelete = false; $('#board-delete').textContent = '삭제'; }
    formError(error.message);
  }
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBoards() {
  download('asset-kit-boards.json', `${JSON.stringify(state.boards.map(({ name, symbols, widgets, days, refreshSeconds }) => ({ name, symbols, widgets, days, refreshSeconds })), null, 2)}\n`, 'application/json');
  notice('화면 설정만 내보냈어요. 자산 데이터는 들어 있지 않습니다.');
}
async function importBoards(file) {
  try {
    if (file.size > 65536) throw new Error('설정 파일은 64KB 이하만 가져올 수 있습니다.');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('JSON 설정 파일이 아닙니다.'); }
    const result = await api('/api/boards/import', { method: 'POST', body: { boards: Array.isArray(data) ? data : data.boards } });
    state.boards = [...state.boards, ...result.boards];
    $('#board-dialog').close();
    notice(`화면 ${result.boards.length}개를 가져왔어요.`);
    state.page = 'home';
    selectBoard(result.boards[0].id);
  } catch (error) { formError(error.message); }
}

// ===== 기타 동작 =====
function syncPrivacy() { $('#privacy-label').textContent = state.hidden ? '금액 보기' : '금액 숨기기'; $('#privacy').setAttribute('aria-pressed', String(state.hidden)); }
function togglePrivacy() {
  state.hidden = !state.hidden;
  saved.set('hidden', state.hidden ? '1' : '0');
  syncPrivacy(); renderPortfolio(); renderTrend(); renderActivity(); renderTools(); renderReturns(); renderMonthly(); renderRealized(); renderCoinStats(); renderWatch();
}
// 저장한 테마가 없으면 운영체제 설정을 따르고, 누르면 반대 테마를 이 브라우저에 기억합니다.
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
  saved.set('theme', root.dataset.theme);
}
function exportCsv() {
  const p = state.portfolio;
  if (!p || state.hidden) return;
  const holdings = visibleHoldings();
  if (!holdings.length) return;
  const rows = [['모드', '조회시각', '자산', '이름', '수량', '가용수량', '주문중수량', '현재가KRW', '전일대비%', '평가금액KRW', '평가손익KRW', '수익률%', '비중%'], ...holdings.map(h => [p.mode, p.asOf, h.symbol, h.name, h.quantity, h.available, h.locked, h.currentPriceKrw, h.priceChangePct, h.valueKrw, h.profitKrw, h.profitRatePct, h.allocationPct])];
  download(`bithumb-assets-${p.mode}-${p.asOf.slice(0, 10)}.csv`, csvText(rows), 'text/csv;charset=utf-8');
  notice(`표시한 자산 ${holdings.length}개의 CSV 다운로드를 시작했어요.`);
}
function exportActivity() {
  const r = state.activity;
  if (!r || state.hidden) return;
  const filtered = visibleActivity();
  if (!filtered.length) return;
  const order = ['orders', 'pending'].includes(r.kind);
  const rows = [['모드', '조회시각', '조회범위완료', '종류', '시각', '마켓/자산', '매수/매도', '수량/금액', '체결수량', '체결금액', '수수료', '금액/수수료단위', '상태'], ...filtered.map(row => [r.mode, r.asOf, r.coverage.complete, r.label, row.at ?? row.created_at, row.market ?? row.currency, row.side === 'bid' ? '매수' : row.side === 'ask' ? '매도' : '', order ? row.volume : row.amount, row.executed_volume, row.executed_funds, order ? row.paid_fee : row.fee, order ? row.market.split('-')[0] : row.currency, STATES[row.state] ?? row.state])];
  download(`bithumb-${r.kind}-${r.mode}-${kstDay(r.asOf)}.csv`, csvText(rows), 'text/csv;charset=utf-8');
  notice(`필터에 맞는 내역 ${filtered.length}건의 CSV 다운로드를 시작했어요.${r.coverage.complete ? '' : ' 조회 범위의 일부만 포함합니다.'}`);
}
async function copyCommand() {
  try { await navigator.clipboard.writeText('npm run demo'); notice('실행 명령을 복사했어요.'); }
  catch { notice('npm run demo 명령을 직접 선택해 복사해주세요.'); }
}

// 차트는 칸 너비가 바뀔 때만 다시 그립니다.
const charts = new ResizeObserver(() => {
  cancelAnimationFrame(charts.frame);
  charts.frame = requestAnimationFrame(() => {
    const chart = $('#chart'), detail = $('#detail-chart');
    if (chart && !chart.hidden && state.history && Number(chart.dataset.width) !== chart.clientWidth) renderChartArea();
    if (detail && Number(detail.dataset.width) !== detail.clientWidth) renderMarket();
    const heatmap = $('#heatmap');
    if (heatmap && state.portfolio && Number(heatmap.dataset.width) !== heatmap.clientWidth) renderHeatmap();
    const candles = $('#candles');
    if (candles && state.chart.data && Number(candles.dataset.width) !== candles.clientWidth) renderCandles();
    if ($('#monthly-chart') && state.returns) renderMonthly();
    const fall = $('#returns-chart');
    if (fall && Number(fall.dataset.width) !== fall.clientWidth) renderWaterfall();
  });
});

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) { close.closest('dialog')?.close(); return; }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const actions = {
    board: () => target.dataset.id !== state.boardId && selectBoard(target.dataset.id),
    'board-new': () => openEditor('new'), 'board-edit': () => openEditor('edit'), 'board-copy': () => openEditor('copy'),
    'board-delete': deleteBoard, 'boards-export': exportBoards, 'boards-import': () => $('#board-import-file').click(),
    refresh: () => load(true), privacy: togglePrivacy, theme: toggleTheme, explain: showExplain, guide: () => $('#guide-dialog').showModal(), copy: copyCommand, export: exportCsv,
    'auto-refresh': () => { state.paused = !state.paused; connectionStatus(); if (!state.paused) void load(); },
    'sort-direction': () => { state.filters.direction = state.filters.direction === 'asc' ? 'desc' : 'asc'; updateFilters(); },
    'filter-reset': () => { state.filters = {}; restoreFilters(); updateFilters(); },
    view: () => setView(target.dataset.view), days: () => setDays(Number(target.dataset.days)), month: () => shiftMonth(Number(target.dataset.step)),
    'calendar-day': () => { state.calendarDay = target.dataset.day; renderCalendar(); document.querySelector(`[data-day="${state.calendarDay}"]`)?.focus(); },
    detail: () => showHolding(target.dataset.symbol), activity: () => loadActivity(true), 'activity-more': () => { state.activityShown += 100; renderActivity(); },
    'activity-period': () => activityPeriod(target.dataset.period), 'activity-cancel': () => resetActivity('조회를 중단했습니다. 다시 조회할 수 있습니다.'), 'activity-export': exportActivity,
    chip: () => toggleChip(target.dataset.symbol), move: () => moveWidget(Number(target.dataset.index), Number(target.dataset.step)),
    page: () => target.dataset.page !== state.page && selectPage(target.dataset.page),
    'perf-metric': () => { state.perfMetric = target.dataset.metric; syncSegments(); renderPerformance(); },
    'heat-metric': () => { state.heatMetric = target.dataset.metric; syncSegments(); renderHeatmap(); },
    'market-tab': () => { if (state.marketTab === target.dataset.tab) return; state.marketTab = target.dataset.tab; syncSegments(); void loadTickers(); },
    'alert-scope': () => { if (state.alertScope === target.dataset.scope) return; state.alertScope = target.dataset.scope; syncSegments(); void loadAlerts(); },
    more: openMore, alerts: () => openAlerts(), 'alert-new': () => openAlerts(target.dataset.symbol),
    'alert-permission': async () => { try { await globalThis.Notification?.requestPermission(); } catch { /* 권한 창을 띄울 수 없는 환경 */ } renderPermission(); },
    'alert-toggle': () => { store.put('alerts', alertRules().map(rule => rule.id === target.dataset.id ? { ...rule, enabled: !rule.enabled, armed: true } : rule)); renderAlertLists(); connectLive(); },
    'alert-delete': () => { store.put('alerts', alertRules().filter(rule => rule.id !== target.dataset.id)); renderAlertLists(); connectLive(); },
    'watch-remove': () => removeWatch(target.dataset.symbol), 'watch-suggest': () => addWatch(target.dataset.symbol),
    coin: () => selectCoin(target.dataset.symbol),
    'coin-open': () => { state.chart.symbol = target.dataset.symbol; saved.set('chart-symbol', target.dataset.symbol); state.chart.data = null; selectPage('chart'); },
    interval: () => { if (state.chart.interval === target.dataset.interval) return; state.chart.interval = target.dataset.interval; saved.set('chart-interval', state.chart.interval); state.chart.data = null; void loadCandles(); },
    overlay: () => { const key = target.dataset.overlay, set = state.chart.overlays; if (set.has(key)) set.delete(key); else set.add(key); saved.set('chart-overlays', [...set].join(',')); renderCoinHead(); renderCandles(); },
    'returns-months': () => { const months = Number(target.dataset.months); if (months === state.returnsMonths) return; state.returnsMonths = months; saved.set('returns-months', String(months)); void loadReturns(); },
    'avg-add': () => { const add = Number(target.dataset.amount); $('#avg-amount').value = add ? (inputNumber('#avg-amount') ?? 0) + add : ''; computeAveraging(); },
    'reb-preset': () => rebalancePreset(target.dataset.preset), 'scn-preset': () => scenarioPreset(target.dataset.preset),
  };
  // 더보기 시트에서 메뉴를 고르면 시트를 닫습니다.
  if (target.dataset.action === 'page' || target.dataset.action === 'alerts' || target.dataset.action === 'guide') { const sheet = target.closest('#more-dialog'); if (sheet) sheet.close(); }
  void actions[target.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (['search', 'cash-filter', 'sort', 'performance'].includes(event.target.id)) updateFilters();
  if (['activity-search', 'activity-status', 'activity-side'].includes(event.target.id)) { state.activityShown = 100; renderActivity(); }
  if (event.target.id === 'board-symbols') renderChips();
  if (['avg-qty', 'avg-avg', 'avg-price', 'avg-amount', 'avg-target'].includes(event.target.id)) computeAveraging();
  if (event.target.dataset?.reb !== undefined) saveTargets();
  if (event.target.dataset?.reb !== undefined || event.target.id === 'reb-cash') computeRebalance();
  if (event.target.dataset?.scn !== undefined) {
    // 전체 슬라이더는 모든 코인을 같은 값으로 맞춘 뒤, 코인별로 다시 조정할 수 있습니다.
    if (event.target.dataset.scn === 'ALL') for (const input of document.querySelectorAll('[data-scn]')) input.value = event.target.value;
    computeScenario();
  }
});
document.addEventListener('submit', event => {
  const id = event.target.id;
  if (!['watch-form', 'coin-form', 'alert-form'].includes(id)) return;
  event.preventDefault();
  if (id === 'watch-form') void addWatch($('#watch-input').value);
  if (id === 'alert-form') addAlert();
  if (id === 'coin-form') void loadMarketList().then(() => { const symbol = resolveSymbol($('#coin-input').value); if (symbol) { $('#coin-input').value = ''; selectCoin(symbol); } else notice('빗썸 원화 마켓에서 찾지 못했습니다. 심볼(BTC)이나 이름을 입력하세요.'); });
});
document.addEventListener('change', event => {
  const { target } = event;
  if (['activity-kind', 'activity-from', 'activity-to'].includes(target.id)) {
    const pending = $('#activity-kind').value === 'pending';
    $('#activity-from').disabled = $('#activity-to').disabled = pending;
    $('#activity-presets').hidden = pending;
    resetActivity();
  }
  if (target.dataset.widget) {
    const enabled = state.draft.enabled;
    if (target.checked) enabled.add(target.dataset.widget); else enabled.delete(target.dataset.widget);
    renderOrder();
  }
  if (target.id === 'board-import-file' && target.files[0]) { const file = target.files[0]; target.value = ''; void importBoards(file); }
  if (target.id === 'avg-symbol') { fillAveraging(); computeAveraging(); }
  if (target.id === 'alert-target') syncAlertForm(true);
  if (target.id === 'alert-type') syncAlertForm(true);
});
$('#board-form').addEventListener('submit', submitBoard);
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
});
$('#holding-dialog').addEventListener('close', () => { cancelRequest('market'); if ($('#detail-chart')) charts.unobserve($('#detail-chart')); chartModels.delete('detail-chart'); state.market = null; });
$('#explain-dialog').addEventListener('close', () => cancelRequest('explain'));
document.addEventListener('visibilitychange', () => {
  connectionStatus();
  // 보이지 않는 동안에는 실시간 연결을 끊고, 다시 보이면 이어 붙입니다. 켜 둔 알림이 있으면 연결을 유지합니다.
  if (document.hidden) { if (!alertsOn()) disconnectLive(); }
  else { connectLive(); if (state.live.stale) renderLive(); }
  if (!document.hidden) void syncBoards();
  if (!document.hidden && !state.paused && board()?.refreshSeconds && !state.loading && !document.querySelector('dialog[open]')) void load();
});
// 차트 탐색: 포인터는 가장 가까운 시점, 키보드는 ←→(Shift는 10%씩)·Home·End로 움직입니다.
const chartId = element => element?.closest?.('.chart__plot')?.parentElement?.id;
document.addEventListener('pointermove', event => {
  const id = chartId(event.target), model = chartModels.get(id), svg = event.target.closest?.('.chart__plot')?.querySelector('svg');
  if (!model || !svg) return;
  const rect = svg.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * svg.viewBox.baseVal.width;
  if (id === 'candles') { const index = Math.max(0, Math.min(model.candles.length - 1, Math.floor((x - model.left) / model.band))); if (index !== model.index) selectCandle(index); return; }
  let closest = 0, distance = Infinity;
  model.xy.forEach(([px], i) => { const d = Math.abs(px - x); if (d < distance) { closest = i; distance = d; } });
  if (closest !== model.index) selectChartPoint(id, closest);
});
document.addEventListener('pointerout', event => {
  const plot = event.target.closest?.('.chart__plot');
  if (plot && !plot.contains(event.relatedTarget) && document.activeElement !== plot) { if (plot.parentElement.id === 'candles') releaseCandle(); else releaseChart(plot.parentElement.id); }
});
document.addEventListener('focusin', event => {
  const id = event.target.classList?.contains('chart__plot') ? event.target.parentElement.id : null, model = chartModels.get(id);
  if (model) (id === 'candles' ? selectCandle : index => selectChartPoint(id, index))(model.index ?? model.points.length - 1);
});
document.addEventListener('focusout', event => { if (!event.target.classList?.contains('chart__plot')) return; if (event.target.parentElement.id === 'candles') releaseCandle(); else releaseChart(event.target.parentElement.id); });
document.addEventListener('keydown', event => {
  if (!event.target.classList?.contains('chart__plot')) return;
  const id = event.target.parentElement.id, model = chartModels.get(id);
  if (!model || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { event.target.blur(); return; }
  const last = model.points.length - 1, current = model.index ?? last, jump = event.shiftKey ? Math.max(1, Math.round(last / 10)) : 1;
  const next = { ArrowLeft: Math.max(0, current - jump), ArrowRight: Math.min(last, current + jump), Home: 0, End: last }[event.key];
  if (id === 'candles') selectCandle(next); else selectChartPoint(id, next);
});
// 비중 막대와 범례: 한쪽에 올리면 같은 자산만 또렷하게 보입니다.
document.addEventListener('pointerover', event => {
  const box = event.target.closest?.('#allocation');
  if (!box) return;
  const key = event.target.closest('[data-key]')?.dataset.key;
  box.classList.toggle('is-focusing', Boolean(key));
  for (const element of box.querySelectorAll('[data-key]')) element.classList.toggle('is-focus', element.dataset.key === key);
});
document.addEventListener('pointerleave', event => { if (event.target.id === 'allocation') event.target.classList.remove('is-focusing'); }, true);

void init();
