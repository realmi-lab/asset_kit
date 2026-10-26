// Asset Kit 대시보드 화면. asset-kit dashboard의 로컬 /api만 사용하며 API 키는 브라우저로 오지 않습니다.
// 샘플 HTML(examples/sample-dashboard.html)에서는 window.AssetKitFixture가 같은 형식의 응답을 대신 돌려줍니다.
import { filterHoldings, filterActivity, csvText, recordDates, dateRangeError } from './dashboard-utils.js';

const $ = selector => document.querySelector(selector);
const fixture = globalThis.AssetKitFixture;
const WIDGETS = { summary: '자산 요약', trend: '자산 추이', allocation: '자산 비중', holdings: '보유 내역', activity: '거래·입출금' };
const PERIODS = [[7, '7일'], [30, '30일'], [90, '90일'], [365, '1년']];
const REFRESH = { 0: '수동 갱신', 30: '30초마다 갱신', 60: '1분마다 갱신', 300: '5분마다 갱신' };
const KINDS = { orders: '종료 주문', pending: '대기 주문', krw_deposits: '원화 입금', krw_withdrawals: '원화 출금', deposits: '코인 입금', withdrawals: '코인 출금' };
const STATES = { wait: '미체결', watch: '예약 대기', done: '체결 완료', cancel: '취소', DONE: '완료', ACCEPTED: '완료', DEPOSIT_ACCEPTED: '입금 완료', PROCESSING: '처리 중', DEPOSIT_PROCESSING: '입금 처리 중', CANCELLED: '취소', REJECTED: '거절' };
const COLORS = ['#F37321', '#2C6BED', '#14B8A6', '#8B5CF6', '#F5B700', '#8B95A1', '#D5DAE0'];

const saved = {
  get: key => { try { return localStorage.getItem(`asset-kit:${key}`); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(`asset-kit:${key}`, value); } catch { /* 저장할 수 없으면 이 창에서만 유지 */ } },
};
const state = {
  status: null, boards: [], boardId: null, portfolio: null, history: null, daily: null, market: null, activity: null, activityShown: 100,
  hidden: saved.get('hidden') === '1', view: saved.get('view') === 'calendar' ? 'calendar' : 'chart', month: null,
  timer: null, syncTimer: null, draft: null, allSymbols: [], saving: Promise.resolve(),
  filters: {}, paused: false, failed: false, loading: false, lastLoaded: null,
};
const board = () => state.boards.find(b => b.id === state.boardId);
const scope = () => board()?.symbols.join(',') ?? '';
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
const sign = value => Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
const tone = value => state.hidden ? '' : sign(value);
const compact = (value, digits = 1) => { const n = Math.abs(value), s = value > 0 ? '+' : value < 0 ? '-' : ''; return n >= 1e8 ? `${s}${(n / 1e8).toFixed(digits).replace('.0', '')}억` : n >= 1e4 ? `${s}${(n / 1e4).toFixed(digits).replace('.0', '')}만` : `${s}${number(n)}`; };
const kstDay = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const date = value => missing(value) || !Number.isFinite(Date.parse(value)) ? '—' : dateFormat.format(new Date(value));
const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => !missing(value))).toString();

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
    $('#mode-label').textContent = demo ? 'DEMO' : state.status.configured ? 'LOCAL · READ ONLY' : '계좌 연결 전';
    $('#mode-label').classList.toggle('is-demo', demo);
    $('#setup').hidden = state.status.configured;
    $('#dashboard').hidden = $('#board-add').hidden = !state.status.configured;
    if (!state.status.configured) return;
    state.boards = (await api('/api/boards')).boards;
    // MCP의 dashboard_open·dashboard_save_board(open)가 준 ?board=<id>를 마지막으로 본 보드보다 먼저 씁니다.
    const requested = new URLSearchParams(globalThis.location?.search ?? '').get('board');
    selectBoard([requested, saved.get('board')].find(id => state.boards.some(b => b.id === id)) ?? state.boards[0].id);
    state.syncTimer = setTimeout(syncBoards, BOARD_SYNC_MS);
  } catch (error) { showError(error.message); }
}

// ===== 보드(화면 설정) =====
function selectBoard(id) {
  for (const key of ['portfolio', 'history', 'activity', 'explain', 'market']) cancelRequest(key);
  chartModels.delete('chart');
  state.boardId = id;
  saved.set('board', id);
  if (!state.status?.sample) globalThis.history?.replaceState(null, '', `?board=${encodeURIComponent(id)}`);
  Object.assign(state, { portfolio: null, history: null, daily: null, activity: null, activityShown: 100, month: null, calendarDay: null, lastLoaded: null, failed: false });
  try { state.filters = JSON.parse(saved.get(`filters:${id}`)) || {}; } catch { state.filters = {}; }
  showError(''); $('#warnings').hidden = true;
  renderTabs(); mount(); schedule(); void load();
}
// MCP나 다른 창에서 바꾼 화면 설정을 보이는 동안 몇 초마다 확인합니다. 편집 중이거나 저장 중에는 건드리지 않습니다.
const BOARD_SYNC_MS = 5000;
const boardKey = boards => boards.map(b => `${b.id}:${b.revision}`).join(',');
async function syncBoards() {
  clearTimeout(state.syncTimer);
  if (state.status?.sample || !state.status?.configured) return;
  const saving = state.saving, quiet = () => !document.hidden && !document.querySelector('dialog[open]') && saving === state.saving;
  if (quiet()) {
    // 화면 설정 다시 불러오기와 같은 요청 채널을 써서 더 나중 요청의 결과만 반영합니다.
    const request = beginRequest('boards');
    try {
      await saving;
      const { boards } = await api('/api/boards', { signal: request.signal });
      if (request.current() && quiet() && Array.isArray(boards) && boards.length && boardKey(boards) !== boardKey(state.boards)) {
        const current = boards.find(b => b.id === state.boardId);
        const changed = current?.revision !== board()?.revision;
        state.boards = boards;
        if (!current) selectBoard(boards[0].id); else if (changed) selectBoard(current.id); else renderTabs();
        notice('다른 곳에서 바꾼 화면 설정을 반영했어요.');
      }
    } catch { /* 다음 확인에서 다시 시도합니다. */ }
  }
  state.syncTimer = setTimeout(syncBoards, BOARD_SYNC_MS);
}
function renderTabs() {
  $('#board-tabs').innerHTML = state.boards.map(b => `<button type="button" class="tab${b.id === state.boardId ? ' is-active' : ''}" data-action="board" data-id="${esc(b.id)}"${b.id === state.boardId ? ' aria-current="page"' : ''}>${esc(b.name)}</button>`).join('');
}
const TEMPLATES = {
  summary: () => `<section class="summary" id="summary" aria-label="자산 요약" aria-busy="true">
    <div class="summary__total"><span class="label" id="total-label">총 평가금액</span><div class="total" id="total">—<span>원</span></div><span class="summary__updated" id="updated">불러오는 중</span></div>
    <dl class="summary__metrics">
      <div class="card"><dt>보유분 평가손익</dt><dd id="profit">—</dd><span id="profit-rate" class="sub">—</span></div>
      <div class="card"><dt>보유 원화</dt><dd id="cash">—</dd><span class="sub">주문 중 금액 포함</span></div>
      <div class="card"><dt>보유 가상자산</dt><dd id="count">—</dd><span class="sub" id="crypto-total">—</span></div>
    </dl></section>`,
  trend: () => `<section class="card" id="trend" aria-labelledby="trend-title">
    <div class="card__head"><h2 id="trend-title">자산 추이</h2>
      <div class="segmented" role="group" aria-label="보기 방식"><button type="button" data-action="view" data-view="chart">추이</button><button type="button" data-action="view" data-view="calendar">일별 변화</button></div>
      <div class="segmented" role="group" aria-label="조회 기간" id="days">${PERIODS.map(([days, label]) => `<button type="button" data-action="days" data-days="${days}">${label}</button>`).join('')}</div>
    </div>
    <div id="trend-stats" class="trend-stats" hidden></div>
    <div id="chart" class="chart" aria-live="polite"><p class="empty">불러오는 중</p></div>
    <div id="calendar" class="calendar" aria-live="polite" hidden></div>
    <div class="card__foot"><span id="history-summary">—</span><span>입출금 포함 · 수익률과 다름</span></div></section>`,
  allocation: () => `<section class="card" aria-labelledby="allocation-title"><div class="card__head"><h2 id="allocation-title">자산 비중</h2></div><div id="allocation" class="allocation"><p class="empty">불러오는 중</p></div></section>`,
  holdings: () => `<section class="card" id="holdings" aria-labelledby="holdings-title">
    <div class="card__head"><h2 id="holdings-title">보유 내역 <span class="count" id="holding-count">0</span></h2><button type="button" class="button" id="export" data-action="export" disabled>표시 자산 CSV ↓</button></div>
    <div class="toolbar"><input class="input" id="search" type="search" placeholder="자산명 또는 심볼 검색" aria-label="보유자산 검색">
      <label class="checkbox"><input type="checkbox" id="cash-filter"> 원화 제외</label>
      <select class="input" id="performance" aria-label="손익 필터"><option value="all">손익 전체</option><option value="gain">수익 자산</option><option value="loss">손실 자산</option><option value="unknown">손익 미확인</option></select>
      <select class="input" id="sort" aria-label="정렬 기준"><option value="value">평가금액순</option><option value="profit">수익률순</option><option value="pnl">평가손익순</option><option value="change">전일 대비순</option><option value="name">이름순</option></select>
      <button type="button" class="button" id="sort-direction" data-action="sort-direction" aria-label="정렬 방향">높은 순 ↓</button>
      <button type="button" class="button button--ghost" data-action="filter-reset">초기화</button></div>
    <p class="filter-summary small muted" id="holding-filter-summary" role="status"></p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="보유자산 표"><table><thead><tr><th scope="col">자산</th><th scope="col">보유 수량</th><th scope="col">현재가 / 전일 대비</th><th scope="col">평가금액</th><th scope="col">평가손익 / 수익률</th><th scope="col">비중</th></tr></thead><tbody id="holdings-body"><tr><td colspan="6" class="empty">불러오는 중</td></tr></tbody></table></div>
    <p class="card__foot">평가손익은 API 평균 매수가 기준이며 수수료와 실현손익은 포함하지 않습니다. 가격·원가 미확인 항목은 합계에서 제외됩니다.</p></section>`,
  activity: () => `<section class="card" id="activity" aria-labelledby="activity-title">
    <div class="card__head"><h2 id="activity-title">거래·입출금 내역</h2><button type="button" class="button" id="activity-export" data-action="activity-export" disabled>조회 내역 CSV ↓</button></div>
    <div class="toolbar">
      <select class="input" id="activity-kind" aria-label="내역 종류">${Object.entries(KINDS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <input class="input" type="date" id="activity-from" aria-label="시작일"><span class="muted">~</span><input class="input" type="date" id="activity-to" aria-label="종료일">
      <button type="button" class="button button--primary" id="activity-load" data-action="activity">내역 조회</button>
      <button type="button" class="button button--ghost" id="activity-cancel" data-action="activity-cancel" hidden>조회 중단</button>
    </div>
    <div class="toolbar" id="activity-presets"><span class="muted small">빠른 기간</span><button type="button" class="chip" data-action="activity-period" data-period="7">최근 7일</button><button type="button" class="chip" data-action="activity-period" data-period="30">최근 30일</button><button type="button" class="chip" data-action="activity-period" data-period="month">이번 달</button></div>
    <div class="toolbar" id="activity-filters" hidden><input type="search" class="input" id="activity-search" aria-label="거래 내역 검색" placeholder="자산·마켓·상태 검색"><select class="input" id="activity-status" aria-label="거래 상태"><option value="all">상태 전체</option></select><select class="input" id="activity-side" aria-label="매수·매도"><option value="all">매수·매도 전체</option><option value="bid">매수</option><option value="ask">매도</option></select></div>
    <p class="coverage muted small" id="activity-coverage">종류와 기간(최대 366일, 한국 시간)을 고른 뒤 조회하세요.</p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="거래·입출금 내역 표"><table><thead><tr><th scope="col">종류 / 자산</th><th scope="col">시각</th><th scope="col">수량 / 금액</th><th scope="col">수수료</th><th scope="col">상태</th></tr></thead><tbody id="activity-body"><tr><td colspan="5" class="empty">조회 전입니다.</td></tr></tbody></table></div>
    <div class="pagination"><button type="button" class="button" id="activity-more" data-action="activity-more" hidden>더 보기</button></div></section>`,
};
// 위젯을 보드 순서대로 배치합니다. 추이와 비중이 이어지면 한 줄에 나란히 둡니다.
function mount() {
  const b = board(), widgets = b.widgets, pair = ['trend', 'allocation'], parts = [];
  $('#board-name').textContent = b.name;
  $('#board-scope').textContent = `${b.symbols.length ? b.symbols.join(' · ') : '원화 포함 전체 자산'} · ${REFRESH[b.refreshSeconds]}`;
  for (let i = 0; i < widgets.length; i++) {
    if (pair.includes(widgets[i]) && pair.includes(widgets[i + 1]) && widgets[i] !== widgets[i + 1]) {
      parts.push(`<div class="grid-2${widgets[i] === 'allocation' ? ' is-reversed' : ''}">${TEMPLATES[widgets[i]]()}${TEMPLATES[widgets[i + 1]]()}</div>`);
      i++;
    } else parts.push(TEMPLATES[widgets[i]]());
  }
  $('#widgets').innerHTML = parts.join('');
  restoreFilters();
  if ($('#activity-from')) {
    const range = recordDates(7, now());
    $('#activity-to').value = range.to;
    $('#activity-from').value = range.from;
  }
  syncTrendControls();
  charts.disconnect();
  if ($('#chart')) charts.observe($('#chart'));
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
  const request = beginRequest('portfolio');
  state.loading = true; connectionStatus();
  $('#refresh').disabled = true;
  $('#refresh').textContent = '갱신 중…';
  $('#summary')?.setAttribute('aria-busy', 'true');
  try {
    const portfolio = await api(`/api/portfolio?${query({ symbols: scope(), force: force ? 1 : '' })}`, { signal: request.signal });
    if (!request.current()) return;
    state.portfolio = portfolio;
    state.lastLoaded = portfolio.asOf; state.failed = false;
    showError('');
    renderPortfolio();
    if (b.widgets.includes('trend')) { if (state.view === 'calendar') state.history = null; else state.daily = null; void loadHistory(); }
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
    if (request.current()) { state.loading = false; connectionStatus(); $('#refresh').disabled = false; $('#refresh').textContent = '새로고침 ↻'; $('#summary')?.setAttribute('aria-busy', 'false'); }
  }
}
function renderFailure() {
  if ($('#updated')) $('#updated').textContent = '조회 실패 · 새로고침으로 다시 시도하세요.';
  if ($('#holdings-body')) $('#holdings-body').innerHTML = '<tr><td colspan="6" class="empty">계좌 데이터를 가져오지 못했습니다.</td></tr>';
  if ($('#allocation')) $('#allocation').innerHTML = '<p class="empty">자산 데이터가 없습니다.</p>';
  if ($('#chart')) $('#chart').innerHTML = '<p class="empty">연결 후 추이를 확인할 수 있습니다.</p>';
}
async function loadHistory() {
  const b = board();
  if (!b?.widgets.includes('trend')) return;
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
    if (box) box.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    if ($('#history-summary')) $('#history-summary').textContent = '조회 실패';
  }
}

// ===== 요약·비중·보유 내역 =====
function renderPortfolio() {
  const p = state.portfolio;
  if (!p) return;
  $('#warnings').textContent = p.warnings.join(' ');
  $('#warnings').hidden = !p.warnings.length;
  renderSummary(); renderAllocation(); renderHoldings();
}
function renderSummary() {
  const p = state.portfolio;
  if (!p || !$('#summary')) return;
  const s = p.summary;
  $('#total-label').textContent = s.valuationComplete ? '총 평가금액' : '확인된 평가금액';
  $('#total').innerHTML = `${state.hidden ? '••••••••' : number(s.totalValueKrw)}<span>원</span>`;
  $('#profit').textContent = money(s.profitKrw, true);
  $('#profit').className = tone(s.profitKrw);
  $('#profit-rate').textContent = `${percent(s.profitRatePct)}${s.profitComplete ? '' : ' · 일부 자산 기준'}`;
  $('#profit-rate').className = `sub ${tone(s.profitKrw)}`;
  $('#cash').textContent = money(s.cashKrw);
  $('#count').textContent = state.hidden ? '••종' : `${s.assetCount}종`;
  $('#crypto-total').textContent = money(s.cryptoValueKrw);
  $('#updated').textContent = `${date(p.asOf)} 기준 · ${p.mode === 'demo' ? '합성 예시' : '30초 조회 캐시'}`;
}
function renderAllocation() {
  const box = $('#allocation');
  if (!box || !state.portfolio) return;
  const holdings = state.portfolio.holdings.filter(h => h.allocationPct !== null && Number(h.allocationPct) > 0);
  if (state.hidden || !holdings.length) { box.innerHTML = `<p class="empty">${state.hidden ? '금액과 자산 비중을 숨겼습니다.' : '평가 가능한 자산이 없습니다.'}</p>`; return; }
  const shown = holdings.slice(0, 5);
  if (holdings.length > 5) shown.push({ name: '기타', symbol: '', allocationPct: String(holdings.slice(5).reduce((sum, h) => sum + Number(h.allocationPct), 0)) });
  let offset = 0;
  const arcs = shown.map((h, i) => {
    const share = Number(h.allocationPct);
    const arc = `<circle cx="66" cy="66" r="52" pathLength="100" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="15" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"/>`;
    offset += share;
    return arc;
  }).join('');
  const swatch = i => `<svg class="swatch" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="${COLORS[i % COLORS.length]}"/></svg>`;
  box.innerHTML = `<div class="donut"><svg viewBox="0 0 132 132" role="img" aria-label="자산 비중 도넛 차트. 상세는 아래 목록">${arcs}</svg><div class="donut__label"><strong>${holdings.length}</strong><span>평가 자산</span></div></div>
    <ul class="legend">${shown.map((h, i) => h.symbol
      ? `<li><button type="button" data-action="detail" data-symbol="${esc(h.symbol)}">${swatch(i)}<span>${esc(h.name)}</span><b>${number(h.allocationPct, 1)}%</b></button></li>`
      : `<li><span class="legend__row">${swatch(i)}<span>${esc(h.name)}</span><b>${number(h.allocationPct, 1)}%</b></span></li>`).join('')}</ul>`;
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
  body.innerHTML = rows.length ? rows.map(h => `<tr>
    <td><button type="button" class="asset-button" data-action="detail" data-symbol="${esc(h.symbol)}" aria-label="${esc(h.name)} 상세 보기"><span class="asset-symbol">${esc(h.symbol)}</span><span class="asset-name">${esc(h.name)}<small>${esc(h.symbol)}</small></span></button></td>
    <td>${state.hidden ? '••••' : esc(number(h.quantity, 8))}<small>${esc(h.symbol)}</small></td>
    <td>${h.symbol === 'KRW' ? '—' : h.currentPriceKrw === null ? '가격 미확인' : `${number(h.currentPriceKrw, 4)}원`}<small class="${sign(h.priceChangePct)}">${h.staleQuote ? '시세 지연 · ' : ''}${h.symbol === 'KRW' ? '원화 잔고' : h.priceSource?.startsWith('BTC-') ? 'BTC 마켓 환산' : missing(h.priceChangePct) ? '전일 대비 미확인' : `${Number(h.priceChangePct) > 0 ? '+' : ''}${number(h.priceChangePct, 2)}%`}</small></td>
    <td><strong>${money(h.valueKrw)}</strong>${h.valueKrw === null ? '<small>합계에서 제외</small>' : ''}</td>
    <td class="${tone(h.profitKrw)}">${h.symbol === 'KRW' ? '—' : money(h.profitKrw, true)}<small class="${tone(h.profitKrw)}">${h.symbol === 'KRW' ? '현금' : percent(h.profitRatePct)}</small></td>
    <td>${state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">표시할 자산이 없습니다.</td></tr>';
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
  saved.set(`filters:${state.boardId}`, JSON.stringify(state.filters));
  renderHoldings();
}
function visibleHoldings() { return filterHoldings(state.portfolio?.holdings ?? [], state.filters); }

// ===== 추이 차트 · 일별 손익 달력 =====
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
  $('#trend-stats').hidden = calendar || state.hidden || !state.history;
  if (calendar) renderCalendar(); else renderChartArea();
}
// 화면 너비에 맞춘 SVG 선 차트. points: [{ at, value }]
function lineChart(box, points, { label, height = 210, tick = value => `${number(value / 10000)}만` }) {
  const values = points.map(p => p.value);
  let low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max((high - low) * 0.2, Math.abs(high) * 0.001, 1);
  low -= pad; high += pad;
  const start = Date.parse(points[0].at), span = Math.max(Date.parse(points.at(-1).at) - start, 1);
  const width = Math.max(280, Math.round(box.clientWidth) - 32), left = 54, right = width - 12, top = 18, bottom = height - 30;
  const x = p => left + (Date.parse(p.at) - start) / span * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const day = p => new Date(p.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
  const grid = [low, (low + high) / 2, high].map(t => `<line class="grid-line" x1="${left}" x2="${right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="0" y="${(y(t) + 4).toFixed(1)}">${esc(tick(t))}</text>`).join('');
  box.dataset.width = String(box.clientWidth);
  const previous = chartModels.get(box.id);
  const index = Math.min(previous?.index ?? points.length - 1, points.length - 1), p = points[index];
  chartModels.set(box.id, { points, index, x, y, width });
  return `<div class="chart-readout"><span id="${box.id}-date">${esc(date(p.at))}</span><output id="${box.id}-value">${number(p.value)}원</output></div>
    <svg data-chart="${box.id}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${label} ${day(points[0])}부터 ${day(points.at(-1))}까지`)}">${grid}<path class="area" d="${line} L${right},${bottom} L${left},${bottom} Z"/><path class="line" d="${line}"/><line class="chart-cursor" x1="${x(p)}" x2="${x(p)}" y1="${top}" y2="${bottom}"/><circle class="chart-point" cx="${x(p)}" cy="${y(p.value)}" r="4"/><text x="${left}" y="${height - 6}">${esc(day(points[0]))}</text><text x="${right}" y="${height - 6}" text-anchor="end">${esc(day(points.at(-1)))}</text></svg>
    <label class="chart-scrubber"><span>시점 탐색</span><input type="range" data-chart="${box.id}" aria-label="${esc(label)} 시점 탐색" min="0" max="${points.length - 1}" step="1" value="${index}" aria-valuetext="${esc(`${date(p.at)} · ${number(p.value)}원`)}"><small>← → 키로 이동</small></label>`;
}
const chartModels = new Map();
function selectChartPoint(id, index) {
  const model = chartModels.get(id), box = document.getElementById(id);
  if (!model || !box || (id === 'chart' && state.hidden)) return;
  const p = model.points[index];
  if (!p) return;
  model.index = index;
  box.querySelector('.chart-cursor')?.setAttribute('x1', model.x(p));
  box.querySelector('.chart-cursor')?.setAttribute('x2', model.x(p));
  box.querySelector('.chart-point')?.setAttribute('cx', model.x(p));
  box.querySelector('.chart-point')?.setAttribute('cy', model.y(p.value));
  const range = box.querySelector('input[type="range"]');
  if (!range) return;
  range.value = index; range.setAttribute('aria-valuetext', `${date(p.at)} · ${number(p.value)}원`);
  document.getElementById(`${id}-date`).textContent = date(p.at);
  document.getElementById(`${id}-value`).textContent = `${number(p.value)}원`;
}
function renderChartArea() {
  const box = $('#chart'), h = state.history;
  if (!box) return;
  if (!h) { box.innerHTML = '<p class="empty">불러오는 중</p>'; $('#trend-stats').hidden = true; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; $('#history-summary').textContent = '금액 숨김'; return; }
  const points = h.points.filter(p => p.valuationComplete && p.totalValueKrw !== null && Number.isFinite(Number(p.totalValueKrw)));
  const omitted = h.points.length - points.length;
  $('#history-summary').textContent = `${h.mode === 'demo' ? '합성 예시' : '로컬 기록'} · ${points.length}개 시점${h.sampled ? '(간추림)' : ''}${omitted ? ` · 가격 미확인 ${omitted}개 제외` : ''}`;
  if (points.length < 2) { $('#trend-stats').hidden = true; box.innerHTML = '<p class="empty">기록이 두 번 이상 쌓이면 추이가 나타납니다.<br>조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 기록합니다.</p>'; return; }
  const first = Number(points[0].totalValueKrw), last = Number(points.at(-1).totalValueKrw), change = last - first;
  $('#trend-stats').hidden = false;
  $('#trend-stats').innerHTML = `<div><span>첫 기록</span><strong>${money(first)}</strong></div><div><span>최근 기록</span><strong>${money(last)}</strong></div><div><span>기록 구간 변화</span><strong class="${tone(change)}">${money(change, true)}</strong></div>`;
  box.innerHTML = lineChart(box, points.map(p => ({ at: p.asOf, value: Number(p.totalValueKrw) })), { label: '평가금액 추이(수익률 아님)' });
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
  let total = 0, counted = 0;
  const cells = Array.from({ length }, (_, i) => {
    const day = `${state.month}-${String(i + 1).padStart(2, '0')}`, row = days.get(day), change = row ? Number(row.changeKrw) : 0;
    if (row) { total += change; counted++; }
    const cls = row ? sign(change) : '';
    const label = row ? `${day} 자산 변화 ${money(change, true)}, 마지막 기록 ${money(row.closeKrw)}${row.gapDays > 1 ? `, ${row.previousDay} 이후 ${row.gapDays}일 변화` : ''}` : '';
    return `<${row ? 'button type="button"' : 'div'} class="calendar__day${cls ? ` is-${cls}` : ''}${day === today ? ' is-today' : ''}${day === state.calendarDay ? ' is-selected' : ''}"${row ? ` data-action="calendar-day" data-day="${day}" aria-pressed="${day === state.calendarDay}" aria-label="${esc(label)}" title="${esc(label)}"` : ''}><span class="calendar__date">${i + 1}${row?.gapDays > 1 ? '*' : ''}</span>${row ? `<strong class="calendar-value-full">${compact(change)}</strong><strong class="calendar-value-short" aria-hidden="true">${compact(change, 0)}</strong><small>${percent(row.changePct)}</small>` : ''}</${row ? 'button' : 'div'}>`;
  });
  box.innerHTML = `<div class="calendar__head">
      <button type="button" class="button" data-action="month" data-step="-1" aria-label="이전 달"${state.month <= first ? ' disabled' : ''}>‹</button>
      <strong>${year}년 ${month}월</strong>
      <button type="button" class="button" data-action="month" data-step="1" aria-label="다음 달"${state.month >= last ? ' disabled' : ''}>›</button>
      <span class="calendar__total">표시 변화 합계<strong class="${counted ? sign(total) : ''}">${counted ? money(total, true) : '—'}</strong></span>
    </div>
    <div class="calendar__grid">${['일', '월', '화', '수', '목', '금', '토'].map(w => `<span class="calendar__weekday">${w}</span>`).join('')}${'<div class="calendar__day is-blank"></div>'.repeat(blanks)}${cells.join('')}</div>
    <p id="calendar-detail" class="calendar-detail" role="status">${state.calendarDay ? `${state.calendarDay} · 자산 변화 <strong class="${tone(days.get(state.calendarDay).changeKrw)}">${money(days.get(state.calendarDay).changeKrw, true)}</strong> · 마지막 기록 ${money(days.get(state.calendarDay).closeKrw)}${days.get(state.calendarDay).gapDays > 1 ? ` · ${days.get(state.calendarDay).gapDays}일간 변화` : ''}` : '이번 달에는 비교할 기록이 없습니다.'}</p>
    <p class="calendar__note">날짜를 누르면 정확한 금액을 확인합니다. 칸의 금액은 반올림한 값입니다.<br>직전 기록일 대비 변화 · 입출금 포함 · 한국 시간<br>* 표시는 기록 공백을 포함한 여러 날의 변화입니다. 빈 날짜는 기록이 없습니다.</p>`;
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
  chartModels.delete('chart');
  syncTrendControls();
  state.history = null; renderTrend(); void loadHistory();
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
  $('#activity-coverage').textContent = message;
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
  const options = { symbols: board()?.symbols ?? [], search: translated.length ? '' : search, status: $('#activity-status')?.value ?? 'all', side: $('#activity-side')?.hidden ? 'all' : $('#activity-side')?.value ?? 'all' };
  const rows = filterActivity(state.activity?.rows ?? [], options);
  return translated.length ? rows.filter(row => translated.includes(row.state)) : rows;
}
function renderActivity() {
  const r = state.activity, body = $('#activity-body');
  if (!r || !body) return;
  const b = board(), only = new Set(b.symbols), order = r.kind === 'orders' || r.kind === 'pending';
  const rows = visibleActivity();
  body.innerHTML = rows.length ? rows.slice(0, state.activityShown).map(row => {
    if (order) {
      const [quote, base] = row.market.split('-');
      return `<tr><td>${row.side === 'bid' ? '매수' : '매도'} · <strong>${esc(base)}</strong><small>${esc(row.market)} · ${esc(row.order_type)}</small></td><td>${date(row.at ?? row.created_at)}</td><td>${amount(row.volume, base)}<small>체결 ${amount(row.executed_volume, base)}${Number(row.executed_funds) ? ` · ${amount(row.executed_funds, quote)}` : ''}</small></td><td>${amount(row.paid_fee, quote)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
    }
    return `<tr><td>${r.kind.includes('deposit') ? '입금' : '출금'} · <strong>${esc(row.currency)}</strong><small>${esc(row.net_type ?? (row.currency === 'KRW' ? '원화' : '가상자산'))}</small></td><td>${date(row.at)}</td><td>${amount(row.amount, row.currency)}</td><td>${amount(row.fee, row.currency)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">선택한 조건에 해당하는 내역이 없습니다.</td></tr>';
  $('#activity-more').hidden = rows.length <= state.activityShown;
  $('#activity-more').textContent = `100건 더 보기 (${Math.min(rows.length, state.activityShown)} / ${rows.length})`;
  $('#activity-export').disabled = state.hidden || !rows.length;
  const range = r.period ? `${kstDay(r.period.from)} ~ ${kstDay(r.period.to)}` : '현재';
  $('#activity-coverage').textContent = `${r.mode === 'demo' ? '합성 예시 · ' : ''}${r.label} · ${r.rows.length}건 중 ${rows.length}건${only.size ? ` (${b.symbols.join('·')} 범위)` : ''} · ${range} · ${r.coverage.complete ? '요청 범위 조회 완료' : `일부만 조회됨(최대 ${r.coverage.maxPages}페이지)`} · ${date(r.asOf)} 조회 · ${r.coverage.note}`;
}

// ===== 대화상자: 자산 상세 · 요약 =====
async function showHolding(symbol) {
  const h = state.portfolio?.holdings.find(item => item.symbol === symbol);
  if (!h) return;
  const cash = h.symbol === 'KRW';
  const rows = [['보유 수량', amount(h.quantity, h.symbol)], ['가용 수량', amount(h.available, h.symbol)], ['주문 중 수량', amount(h.locked, h.symbol)],
    ['평균 매수가', cash ? '—' : money(h.averagePriceKrw)], ['현재가', cash ? '—' : h.currentPriceKrw === null ? '가격 미확인' : `${number(h.currentPriceKrw, 4)}원`],
    ['비중', state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`]];
  const oldChart = $('#detail-chart');
  if (oldChart) charts.unobserve(oldChart);
  cancelRequest('market');
  $('#detail').innerHTML = `<div class="dialog__head"><h2 id="detail-title">${esc(h.name)} <span class="muted">${esc(h.symbol)}</span></h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="detail-hero"><span>평가금액</span><strong>${money(h.valueKrw)}</strong>${cash || h.profitKrw === null ? '' : `<span class="${tone(h.profitKrw)}">${money(h.profitKrw, true)} · ${percent(h.profitRatePct)}</span>`}</div>
    <dl class="detail-metrics">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${cash ? '' : '<h3 class="section-title">원화 시세 · 최근 30일 일봉</h3><div id="detail-chart" class="chart chart--small"><p class="empty">시세를 불러오는 중</p></div>'}
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
  box.innerHTML = lineChart(box, points, { label: `${m.name} 원화 일봉 종가`, height: 180, tick: value => value >= 1e8 ? `${number(value / 1e8, 2)}억` : value >= 1e4 ? `${number(value / 1e4, 1)}만` : number(value, 2) });
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
  $('#widget-order').innerHTML = d.order.map((w, i) => `<li class="${d.enabled.has(w) ? '' : 'is-off'}"><label><input type="checkbox" data-widget="${w}"${d.enabled.has(w) ? ' checked' : ''}> ${WIDGETS[w]}</label><button type="button" class="icon-button" data-action="move" data-index="${i}" data-step="-1" aria-label="${WIDGETS[w]} 위로"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="move" data-index="${i}" data-step="1" aria-label="${WIDGETS[w]} 아래로"${i === d.order.length - 1 ? ' disabled' : ''}>↓</button></li>`).join('');
}
function moveWidget(index, step) {
  const order = state.draft.order;
  [order[index], order[index + step]] = [order[index + step], order[index]];
  renderOrder();
  document.querySelector(`[data-action="move"][data-index="${index + step}"][data-step="${step}"]:not(:disabled)`)?.focus();
}
function formError(message) { $('#board-error').textContent = message; $('#board-error').hidden = false; }
async function reloadBoards() {
  const request = beginRequest('boards');
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
    selectBoard(result.boards[0].id);
  } catch (error) { formError(error.message); }
}

// ===== 기타 동작 =====
function syncPrivacy() { $('#privacy').textContent = state.hidden ? '금액 보기' : '금액 숨기기'; $('#privacy').setAttribute('aria-pressed', String(state.hidden)); }
function togglePrivacy() {
  state.hidden = !state.hidden;
  saved.set('hidden', state.hidden ? '1' : '0');
  syncPrivacy(); renderPortfolio(); renderTrend(); renderActivity();
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
    if (chart && !chart.hidden && Number(chart.dataset.width) !== chart.clientWidth) renderChartArea();
    if (detail && Number(detail.dataset.width) !== detail.clientWidth) renderMarket();
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
    refresh: () => load(true), privacy: togglePrivacy, explain: showExplain, guide: () => $('#guide-dialog').showModal(), copy: copyCommand, export: exportCsv,
    'auto-refresh': () => { state.paused = !state.paused; connectionStatus(); if (!state.paused) void load(); },
    'sort-direction': () => { state.filters.direction = state.filters.direction === 'asc' ? 'desc' : 'asc'; updateFilters(); },
    'filter-reset': () => { state.filters = {}; restoreFilters(); updateFilters(); },
    view: () => setView(target.dataset.view), days: () => setDays(Number(target.dataset.days)), month: () => shiftMonth(Number(target.dataset.step)),
    'calendar-day': () => { state.calendarDay = target.dataset.day; renderCalendar(); document.querySelector(`[data-day="${state.calendarDay}"]`)?.focus(); },
    detail: () => showHolding(target.dataset.symbol), activity: () => loadActivity(true), 'activity-more': () => { state.activityShown += 100; renderActivity(); },
    'activity-period': () => activityPeriod(target.dataset.period), 'activity-cancel': () => resetActivity('조회를 중단했습니다. 다시 조회할 수 있습니다.'), 'activity-export': exportActivity,
    chip: () => toggleChip(target.dataset.symbol), move: () => moveWidget(Number(target.dataset.index), Number(target.dataset.step)),
  };
  void actions[target.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (['search', 'cash-filter', 'sort', 'performance'].includes(event.target.id)) updateFilters();
  if (['activity-search', 'activity-status', 'activity-side'].includes(event.target.id)) { state.activityShown = 100; renderActivity(); }
  if (event.target.matches('input[type="range"][data-chart]')) selectChartPoint(event.target.dataset.chart, Number(event.target.value));
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
document.addEventListener('pointermove', event => {
  const svg = event.target.closest('svg[data-chart]');
  if (!svg) return;
  const model = chartModels.get(svg.dataset.chart);
  if (!model) return;
  const rect = svg.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * model.width;
  let closest = 0, distance = Infinity;
  model.points.forEach((p, i) => { const d = Math.abs(model.x(p) - x); if (d < distance) { closest = i; distance = d; } });
  if (closest !== model.index) selectChartPoint(svg.dataset.chart, closest);
});

void init();
