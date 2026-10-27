// Asset Kit 대시보드 화면. asset-kit dashboard의 로컬 /api만 사용하며 API 키는 브라우저로 오지 않습니다.
// 샘플 HTML(examples/sample-dashboard.html)에서는 window.AssetKitFixture가 같은 형식의 응답을 대신 돌려줍니다.
import { filterHoldings, filterActivity, csvText, recordDates, dateRangeError } from './dashboard-utils.js';

const $ = selector => document.querySelector(selector);
const fixture = globalThis.AssetKitFixture;
const WIDGETS = { summary: '자산 요약', trend: '자산 추이', insights: '인사이트', allocation: '자산 비중', heatmap: '자산 히트맵', performance: '손익 분석', holdings: '보유 내역', market: '시장 개요', warnings: '시장 경보', activity: '거래·입출금' };
// 왼쪽 메뉴의 고정 화면입니다. 대시보드(home)만 보드 설정을 따르고, 나머지는 원화 포함 전체 자산을 봅니다.
const PAGES = {
  home: {},
  assets: { title: '자산', description: '원화 포함 전체 자산의 구성과 보유 내역', widgets: ['summary', 'heatmap', 'allocation', 'holdings'] },
  analysis: { title: '손익 분석', description: '평균 매수가 기준 손익과 기간별 평가금액 변화 · 수수료·실현손익 제외', widgets: ['insights', 'performance', 'trend'] },
  market: { title: '시장', description: '빗썸 원화 마켓 시세와 경보 · 내 자산 평가가 아니며 투자 권유가 아닙니다', widgets: ['market', 'warnings'] },
  activity: { title: '거래내역', description: '주문·입출금 기록 조회 · 조회 전용', widgets: ['activity'] },
};
// 넓은 위젯과 좁은 위젯이 이어지면 한 줄에 나란히 둡니다.
const WIDE = new Set(['trend', 'heatmap', 'market', 'performance']), NARROW = new Set(['allocation', 'warnings']);
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
};
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
  const timeout = AbortSignal.timeout(path.startsWith('/api/records') ? 180000 : 30000);
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
    $('#dashboard').hidden = $('#board-add').hidden = $('#nav').hidden = !state.status.configured;
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
  for (const key of ['portfolio', 'history', 'activity', 'explain', 'market', 'tickers', 'alerts']) cancelRequest(key);
  chartModels.delete('chart');
  state.boardId = id;
  saved.set('board', id);
  if (!state.status?.sample) globalThis.history?.replaceState(null, '', `?board=${encodeURIComponent(id)}${state.page === 'home' ? '' : `&page=${state.page}`}`);
  Object.assign(state, { portfolio: null, history: null, daily: null, activity: null, activityShown: 100, month: null, calendarDay: null, lastLoaded: null, failed: false, tickers: null, alerts: null });
  try { state.filters = JSON.parse(saved.get(filterKey())) || {}; } catch { state.filters = {}; }
  showError(''); $('#warnings').hidden = true;
  renderTabs(); mount(); schedule(); void load();
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
  for (const id of ['#chart', '#heatmap']) if ($(id)) charts.observe($(id));
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
    renderPortfolio();
    if (widgets.includes('trend')) { if (state.view === 'calendar') state.history = null; else state.daily = null; void loadHistory(); }
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
  heroReadout(null);
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
  delta.innerHTML = points.length > 1
    ? `${deltaPill(points.at(-1).value - points[0].value, points[0].value)}<span>${PERIOD_LABEL[board()?.days] ?? '기록 구간'} · 입출금 포함</span>`
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
  box.innerHTML = `<div class="stack" role="img" aria-label="${esc(`자산 비중: ${slices.map(s => `${s.name} ${number(s.pct, 1)}%`).join(', ')}`)}">${slices.map(s => `<span class="stack__seg ${s.cls}" data-key="${esc(s.key)}" data-share="${s.pct}"></span>`).join('')}</div>
    <ul class="legend">${slices.map(s => `<li>${s.symbol
      ? `<button type="button" class="legend__item ${s.cls}" data-action="detail" data-symbol="${esc(s.symbol)}" data-key="${esc(s.key)}">${item(s)}</button>`
      : `<div class="legend__item ${s.cls}" data-key="other" title="${esc(s.title)}">${item(s)}</div>`}</li>`).join('')}</ul>`;
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
  body.innerHTML = rows.length ? rows.map(holdingRow).join('') : '<tr><td colspan="6" class="empty">표시할 자산이 없습니다.</td></tr>';
  applyShares(body);
  void loadSparks(rows.filter(h => h.symbol !== 'KRW' && !h.priceSource?.startsWith('BTC-')).map(h => h.symbol));
}
function holdingRow(h) {
  const cash = h.symbol === 'KRW', cls = seriesClass(h.symbol);
  const change = h.staleQuote ? '시세 지연 · ' : '';
  const changeText = cash ? '원화 잔고' : h.priceSource?.startsWith('BTC-') ? 'BTC 마켓 환산' : missing(h.priceChangePct) ? '전일 대비 미확인' : `${Number(h.priceChangePct) > 0 ? '+' : ''}${number(h.priceChangePct, 2)}%`;
  const allocation = state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`;
  return `<tr>
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
  const pairs = [['perf-metric', 'metric', state.perfMetric], ['heat-metric', 'metric', state.heatMetric], ['market-tab', 'tab', state.marketTab], ['alert-scope', 'scope', state.alertScope]];
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
  box.innerHTML = `<ul class="perf__list">${rows.map((h, i) => {
    const value = values[i], size = Math.abs(value) / span * 100, start = value >= 0 ? zero : zero - size;
    return `<li class="perf__row"><button type="button" class="perf__name" data-action="detail" data-symbol="${esc(h.symbol)}"><span class="avatar ${seriesClass(h.symbol)}" aria-hidden="true">${esc(monogram(h.symbol))}</span><span>${esc(h.name)}<small>${esc(h.symbol)}</small></span></button>
      <span class="perf__track" aria-hidden="true"><span class="perf__zero" data-pos="${zero}"></span><span class="perf__bar ${sign(value)}" data-start="${start}" data-size="${size}"></span></span>
      <span class="perf__value ${sign(value)}">${key === 'profitKrw' ? money(value, true) : percent(value)}<small>${key === 'profitKrw' ? percent(h.profitRatePct) : money(h.profitKrw, true)}</small></span></li>`;
  }).join('')}</ul>`;
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
  box.innerHTML = tiles.map(({ holding: h, x, y, w, h: tall }) => {
    const value = h.symbol === 'KRW' ? null : h[metric.key], level = missing(value) || Number(value) === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.abs(Number(value)) / metric.cap * 4)));
    const cls = h.symbol === 'KRW' ? 'heat-cash' : level ? `heat-${Number(value) > 0 ? 'up' : 'down'}-${level}` : 'heat-flat';
    const text = h.symbol === 'KRW' ? '원화' : missing(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${number(value, 2)}%`;
    const label = `${h.name} ${h.symbol}, 평가금액 ${money(h.valueKrw)}, 비중 ${number(h.allocationPct, 1)}%, ${metric.label} ${text}`;
    const roomy = w >= 64 && tall >= 46, large = w >= 140 && tall >= 92;
    return `<button type="button" class="heat-tile ${cls}" data-action="detail" data-symbol="${esc(h.symbol)}" data-box="${(x / width * 100).toFixed(3)},${(y / height * 100).toFixed(3)},${(w / width * 100).toFixed(3)},${(tall / height * 100).toFixed(3)}" aria-label="${esc(label)}" title="${esc(label)}">${roomy ? `<strong>${esc(h.symbol === 'KRW' ? '원화' : h.symbol)}</strong><span>${h.symbol === 'KRW' ? `${number(h.allocationPct, 1)}%` : esc(text)}</span>${large ? `<small>${esc(h.name)} · ${money(h.valueKrw)}</small>` : ''}` : ''}</button>`;
  }).join('');
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
  body.innerHTML = t.rows.length ? t.rows.map((row, i) => `<tr>
    <td><span class="asset"><span class="rank">${i + 1}</span><span class="avatar ${row.held ? seriesClass(row.symbol) : 'c-none'}" aria-hidden="true">${esc(monogram(row.symbol))}</span><span class="asset__text"><span class="asset__name">${esc(row.name)}${row.held ? '<span class="tag">보유</span>' : ''}${row.marketWarning ? `<span class="flag" title="빗썸 거래 유의 지정">${icon('alert')}유의</span>` : ''}</span><span class="asset__sym">${esc(row.symbol)}</span></span></span></td>
    <td>${price(row.priceKrw)}<small>고가 ${price(row.highKrw)} · 저가 ${price(row.lowKrw)}</small></td>
    <td class="${sign(row.changePct)}"><span class="cell-strong">${missing(row.changePct) ? '—' : `${Number(row.changePct) > 0 ? '▲ ' : Number(row.changePct) < 0 ? '▼ ' : ''}${number(Math.abs(Number(row.changePct)), 2)}%`}</span></td>
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
  syncPrivacy(); renderPortfolio(); renderTrend(); renderActivity();
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
  };
  void actions[target.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (['search', 'cash-filter', 'sort', 'performance'].includes(event.target.id)) updateFilters();
  if (['activity-search', 'activity-status', 'activity-side'].includes(event.target.id)) { state.activityShown = 100; renderActivity(); }
  if (event.target.id === 'board-symbols') renderChips();
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
  if (!document.hidden) void syncBoards();
  if (!document.hidden && !state.paused && board()?.refreshSeconds && !state.loading && !document.querySelector('dialog[open]')) void load();
});
// 차트 탐색: 포인터는 가장 가까운 시점, 키보드는 ←→(Shift는 10%씩)·Home·End로 움직입니다.
const chartId = element => element?.closest?.('.chart__plot')?.parentElement?.id;
document.addEventListener('pointermove', event => {
  const id = chartId(event.target), model = chartModels.get(id), svg = event.target.closest?.('.chart__plot')?.querySelector('svg');
  if (!model || !svg) return;
  const rect = svg.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * svg.viewBox.baseVal.width;
  let closest = 0, distance = Infinity;
  model.xy.forEach(([px], i) => { const d = Math.abs(px - x); if (d < distance) { closest = i; distance = d; } });
  if (closest !== model.index) selectChartPoint(id, closest);
});
document.addEventListener('pointerout', event => {
  const plot = event.target.closest?.('.chart__plot');
  if (plot && !plot.contains(event.relatedTarget) && document.activeElement !== plot) releaseChart(plot.parentElement.id);
});
document.addEventListener('focusin', event => {
  const id = event.target.classList?.contains('chart__plot') ? event.target.parentElement.id : null, model = chartModels.get(id);
  if (model) selectChartPoint(id, model.index ?? model.points.length - 1);
});
document.addEventListener('focusout', event => { if (event.target.classList?.contains('chart__plot')) releaseChart(event.target.parentElement.id); });
document.addEventListener('keydown', event => {
  if (!event.target.classList?.contains('chart__plot')) return;
  const id = event.target.parentElement.id, model = chartModels.get(id);
  if (!model || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { event.target.blur(); return; }
  const last = model.points.length - 1, current = model.index ?? last, jump = event.shiftKey ? Math.max(1, Math.round(last / 10)) : 1;
  selectChartPoint(id, { ArrowLeft: Math.max(0, current - jump), ArrowRight: Math.min(last, current + jump), Home: 0, End: last }[event.key]);
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
