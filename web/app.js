// Asset Kit 대시보드 화면. asset-kit dashboard의 로컬 /api만 사용하며 API 키는 브라우저로 오지 않습니다.
// 샘플 HTML(examples/sample-dashboard.html)에서는 window.AssetKitFixture가 같은 형식의 응답을 대신 돌려줍니다.

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
  loadRequest: 0, historyRequest: 0, marketRequest: null, timer: null, draft: null, allSymbols: [], saving: Promise.resolve(),
};
const board = () => state.boards.find(b => b.id === state.boardId);
const scope = () => board()?.symbols.join(',') ?? '';

// ===== 표시 형식 =====
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const missing = value => value === null || value === undefined || value === '';
const number = (value, digits = 0) => missing(value) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits });
const money = (value, signed = false) => state.hidden ? '••••' : missing(value) ? '—' : `${signed && Number(value) > 0 ? '+' : ''}${number(value)}원`;
const percent = value => state.hidden ? '••' : missing(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${number(value, 2)}%`;
const amount = (value, unit) => state.hidden ? '••••' : missing(value) ? '—' : `${number(value, 8)} ${esc(unit)}`;
const sign = value => Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
const tone = value => state.hidden ? '' : sign(value);
const compact = value => { const n = Math.abs(value), s = value > 0 ? '+' : value < 0 ? '-' : ''; return n >= 1e8 ? `${s}${(n / 1e8).toFixed(1).replace('.0', '')}억` : n >= 1e4 ? `${s}${(n / 1e4).toFixed(1).replace('.0', '')}만` : `${s}${number(n)}`; };
const kstDay = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
const date = value => missing(value) ? '—' : new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const query = params => new URLSearchParams(Object.entries(params).filter(([, value]) => !missing(value))).toString();

// ===== 서버 연결 =====
async function api(path, { method = 'GET', body } = {}) {
  if (fixture) return fixture.request(method, path, body);
  const options = { method, signal: AbortSignal.timeout(path.startsWith('/api/records') ? 180000 : 20000) };
  if (body !== undefined) { options.headers = { 'Content-Type': 'application/json', 'X-Asset-Kit': '1' }; options.body = JSON.stringify(body); }
  let response;
  try { response = await fetch(path, options); } catch (error) {
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
    const last = saved.get('board');
    selectBoard(state.boards.some(b => b.id === last) ? last : state.boards[0].id);
  } catch (error) { showError(error.message); }
}

// ===== 보드(화면 설정) =====
function selectBoard(id) {
  state.boardId = id;
  saved.set('board', id);
  Object.assign(state, { portfolio: null, history: null, daily: null, activity: null, activityShown: 100, month: null });
  renderTabs(); mount(); schedule(); void load();
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
      <div class="segmented" role="group" aria-label="보기 방식"><button type="button" data-action="view" data-view="chart">추이</button><button type="button" data-action="view" data-view="calendar">일별 손익</button></div>
      <div class="segmented" role="group" aria-label="조회 기간" id="days">${PERIODS.map(([days, label]) => `<button type="button" data-action="days" data-days="${days}">${label}</button>`).join('')}</div>
    </div>
    <div id="chart" class="chart" aria-live="polite"><p class="empty">불러오는 중</p></div>
    <div id="calendar" class="calendar" aria-live="polite" hidden></div>
    <div class="card__foot"><span id="history-summary">—</span><span>입출금 포함 · 수익률과 다름</span></div></section>`,
  allocation: () => `<section class="card" aria-labelledby="allocation-title"><div class="card__head"><h2 id="allocation-title">자산 비중</h2></div><div id="allocation" class="allocation"><p class="empty">불러오는 중</p></div></section>`,
  holdings: () => `<section class="card" id="holdings" aria-labelledby="holdings-title">
    <div class="card__head"><h2 id="holdings-title">보유 내역 <span class="count" id="holding-count">0</span></h2><button type="button" class="button" id="export" data-action="export" disabled>CSV 내보내기 ↓</button></div>
    <div class="toolbar"><input class="input" id="search" type="search" placeholder="자산명 또는 심볼 검색" aria-label="보유자산 검색">
      <label class="checkbox"><input type="checkbox" id="cash-filter"> 원화 제외</label>
      <select class="input" id="sort" aria-label="정렬 기준"><option value="value">평가금액순</option><option value="profit">수익률순</option><option value="name">이름순</option></select></div>
    <div class="table-scroll"><table><thead><tr><th scope="col">자산</th><th scope="col">보유 수량</th><th scope="col">현재가</th><th scope="col">평가금액</th><th scope="col">평가손익 / 수익률</th><th scope="col">비중</th></tr></thead><tbody id="holdings-body"><tr><td colspan="6" class="empty">불러오는 중</td></tr></tbody></table></div>
    <p class="card__foot">평가손익은 API 평균 매수가 기준이며 수수료와 실현손익은 포함하지 않습니다. 가격·원가 미확인 항목은 합계에서 제외됩니다.</p></section>`,
  activity: () => `<section class="card" id="activity" aria-labelledby="activity-title">
    <div class="card__head"><h2 id="activity-title">거래·입출금 내역</h2></div>
    <div class="toolbar">
      <select class="input" id="activity-kind" aria-label="내역 종류">${Object.entries(KINDS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <input class="input" type="date" id="activity-from" aria-label="시작일"><span class="muted">~</span><input class="input" type="date" id="activity-to" aria-label="종료일">
      <button type="button" class="button button--primary" id="activity-load" data-action="activity">내역 조회</button>
    </div>
    <p class="coverage muted small" id="activity-coverage">종류와 기간(최대 366일, 한국 시간)을 고른 뒤 조회하세요.</p>
    <div class="table-scroll"><table><thead><tr><th scope="col">종류 / 자산</th><th scope="col">시각</th><th scope="col">수량 / 금액</th><th scope="col">수수료</th><th scope="col">상태</th></tr></thead><tbody id="activity-body"><tr><td colspan="5" class="empty">조회 전입니다.</td></tr></tbody></table></div>
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
  if ($('#activity-from')) {
    $('#activity-to').value = kstDay(new Date().toISOString());
    $('#activity-from').value = kstDay(new Date(Date.now() - 6 * 86400000).toISOString());
  }
  syncTrendControls();
  charts.disconnect();
  if ($('#chart')) charts.observe($('#chart'));
}
function schedule() {
  clearInterval(state.timer);
  const seconds = board()?.refreshSeconds;
  if (seconds) state.timer = setInterval(() => { if (!document.hidden && !$('#refresh').disabled && !document.querySelector('dialog[open]')) void load(); }, seconds * 1000);
}

// ===== 조회 =====
async function load() {
  const b = board();
  if (!b) return;
  const request = ++state.loadRequest;
  $('#refresh').disabled = true;
  $('#summary')?.setAttribute('aria-busy', 'true');
  try {
    const portfolio = await api(`/api/portfolio?${query({ symbols: scope() })}`);
    if (request !== state.loadRequest) return;
    state.portfolio = portfolio;
    showError('');
    renderPortfolio();
    if (b.widgets.includes('trend')) void loadHistory();
    if (!fixture && state.status.mode !== 'demo') {
      const status = await api('/api/status');
      if (status.historyError) showError(`추이 기록: ${status.historyError.message}`);
    }
  } catch (error) {
    if (request !== state.loadRequest) return;
    showError(`${error.message}${state.portfolio ? ' 마지막으로 성공한 조회 결과를 표시합니다.' : ''}`);
    if (!state.portfolio) renderFailure();
  } finally {
    if (request === state.loadRequest) { $('#refresh').disabled = false; $('#summary')?.setAttribute('aria-busy', 'false'); }
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
  const request = ++state.historyRequest, calendar = state.view === 'calendar';
  const params = calendar ? { days: 365, daily: 1, symbols: scope() } : { days: b.days, symbols: scope() };
  try {
    const result = await api(`/api/history?${query(params)}`);
    if (request !== state.historyRequest) return;
    if (calendar) state.daily = result; else state.history = result;
    renderTrend();
  } catch (error) {
    if (request !== state.historyRequest) return;
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
  const p = state.portfolio, search = $('#search').value.trim().toLowerCase(), sort = $('#sort').value;
  const rows = p.holdings.filter(h => (!$('#cash-filter').checked || h.symbol !== 'KRW') && `${h.name} ${h.symbol}`.toLowerCase().includes(search));
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (sort === 'profit') rows.sort((a, b) => Number(b.profitRatePct ?? -Infinity) - Number(a.profitRatePct ?? -Infinity));
  $('#holding-count').textContent = p.holdings.length;
  $('#export').disabled = state.hidden || !p.holdings.length;
  body.innerHTML = rows.length ? rows.map(h => `<tr>
    <td><button type="button" class="asset-button" data-action="detail" data-symbol="${esc(h.symbol)}" aria-label="${esc(h.name)} 상세 보기"><span class="asset-symbol">${esc(h.symbol)}</span><span class="asset-name">${esc(h.name)}<small>${esc(h.symbol)}</small></span></button></td>
    <td>${state.hidden ? '••••' : esc(number(h.quantity, 8))}<small>${esc(h.symbol)}</small></td>
    <td>${h.symbol === 'KRW' ? '—' : h.currentPriceKrw === null ? '가격 미확인' : `${number(h.currentPriceKrw, 4)}원`}<small>${h.staleQuote ? '시세 지연' : h.symbol === 'KRW' ? '원화 잔고' : h.priceSource?.startsWith('BTC-') ? 'BTC 마켓 환산' : '원화 현재가'}</small></td>
    <td><strong>${money(h.valueKrw)}</strong>${h.valueKrw === null ? '<small>합계에서 제외</small>' : ''}</td>
    <td class="${tone(h.profitKrw)}">${h.symbol === 'KRW' ? '—' : money(h.profitKrw, true)}<small class="${tone(h.profitKrw)}">${h.symbol === 'KRW' ? '현금' : percent(h.profitRatePct)}</small></td>
    <td>${state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">표시할 자산이 없습니다.</td></tr>';
}

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
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${label} ${day(points[0])}부터 ${day(points.at(-1))}까지`)}">${grid}<path class="area" d="${line} L${right},${bottom} L${left},${bottom} Z"/><path class="line" d="${line}"/><circle cx="${x(points.at(-1)).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="4"/><text x="${left}" y="${height - 6}">${esc(day(points[0]))}</text><text x="${right}" y="${height - 6}" text-anchor="end">${esc(day(points.at(-1)))}</text></svg>`;
}
function renderChartArea() {
  const box = $('#chart'), h = state.history;
  if (!box) return;
  if (!h) { box.innerHTML = '<p class="empty">불러오는 중</p>'; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; $('#history-summary').textContent = '금액 숨김'; return; }
  const points = h.points.filter(p => p.valuationComplete && p.totalValueKrw !== null);
  const omitted = h.points.length - points.length;
  $('#history-summary').textContent = `${h.mode === 'demo' ? '합성 예시' : '로컬 기록'} · ${points.length}개 시점${h.sampled ? '(간추림)' : ''}${omitted ? ` · 가격 미확인 ${omitted}개 제외` : ''}`;
  if (points.length < 2) { box.innerHTML = '<p class="empty">기록이 두 번 이상 쌓이면 추이가 나타납니다.<br>조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 기록합니다.</p>'; return; }
  box.innerHTML = lineChart(box, points.map(p => ({ at: p.asOf, value: Number(p.totalValueKrw) })), { label: '평가금액 추이(수익률 아님)' });
}
function renderCalendar() {
  const box = $('#calendar'), d = state.daily;
  if (!box) return;
  if (!d) { box.innerHTML = '<p class="empty">불러오는 중</p>'; return; }
  if (state.hidden) { box.innerHTML = '<p class="empty">금액을 숨겼습니다.</p>'; $('#history-summary').textContent = '금액 숨김'; return; }
  const days = new Map(d.daily.filter(row => row.changeKrw !== null).map(row => [row.day, row]));
  $('#history-summary').textContent = `${d.mode === 'demo' ? '합성 예시' : '로컬 기록'} · 손익 기록 ${days.size}일`;
  if (!days.size) { box.innerHTML = '<p class="empty">이틀 이상 기록되면 날짜별 손익이 표시됩니다.</p>'; return; }
  const today = kstDay(new Date().toISOString()), first = [...days.keys()][0].slice(0, 7), last = today.slice(0, 7);
  if (!state.month || state.month < first || state.month > last) state.month = last;
  const [year, month] = state.month.split('-').map(Number);
  const blanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0, counted = 0;
  const cells = Array.from({ length }, (_, i) => {
    const day = `${state.month}-${String(i + 1).padStart(2, '0')}`, row = days.get(day), change = row ? Number(row.changeKrw) : 0;
    if (row) { total += change; counted++; }
    const cls = row ? sign(change) : '';
    return `<div class="calendar__day${cls ? ` is-${cls}` : ''}${day === today ? ' is-today' : ''}"${row ? ` title="${esc(`${day} 마감 ${number(row.closeKrw)}원`)}"` : ''}><span class="calendar__date">${i + 1}</span>${row ? `<strong>${compact(change)}</strong><small>${percent(row.changePct)}</small>` : ''}</div>`;
  });
  box.innerHTML = `<div class="calendar__head">
      <button type="button" class="button" data-action="month" data-step="-1" aria-label="이전 달"${state.month <= first ? ' disabled' : ''}>‹</button>
      <strong>${year}년 ${month}월</strong>
      <button type="button" class="button" data-action="month" data-step="1" aria-label="다음 달"${state.month >= last ? ' disabled' : ''}>›</button>
      <span class="calendar__total">월 손익<strong class="${counted ? sign(total) : ''}">${counted ? money(total, true) : '—'}</strong></span>
    </div>
    <div class="calendar__grid">${['일', '월', '화', '수', '목', '금', '토'].map(w => `<span class="calendar__weekday">${w}</span>`).join('')}${'<div class="calendar__day is-blank"></div>'.repeat(blanks)}${cells.join('')}</div>
    <p class="calendar__note">한국 시간 날짜별 마지막 평가금액의 변화 · 입출금 포함 · 최근 1년</p>`;
}
function setView(view) {
  if (state.view === view) return;
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
async function loadActivity() {
  const kind = $('#activity-kind').value, button = $('#activity-load');
  const period = kind === 'pending' ? {} : { from: $('#activity-from').value, to: $('#activity-to').value };
  button.disabled = true;
  button.textContent = '조회 중…';
  $('#activity-coverage').textContent = '페이지를 이어서 조회하고 있습니다. 기간이 길면 시간이 걸릴 수 있습니다.';
  try {
    state.activity = await api(`/api/records?${query({ kind, ...period })}`);
    state.activityShown = 100;
    renderActivity();
  } catch (error) { $('#activity-coverage').textContent = error.message; notice(error.message); }
  finally { button.disabled = false; button.textContent = '내역 조회'; }
}
function renderActivity() {
  const r = state.activity, body = $('#activity-body');
  if (!r || !body) return;
  const b = board(), only = new Set(b.symbols), order = r.kind === 'orders' || r.kind === 'pending';
  const rows = r.rows.filter(row => !only.size || only.has(row.market ? row.market.split('-')[1] : row.currency));
  body.innerHTML = rows.length ? rows.slice(0, state.activityShown).map(row => {
    if (order) {
      const [quote, base] = row.market.split('-');
      return `<tr><td>${row.side === 'bid' ? '매수' : '매도'} · <strong>${esc(base)}</strong><small>${esc(row.market)} · ${esc(row.order_type)}</small></td><td>${date(row.at ?? row.created_at)}</td><td>${amount(row.volume, base)}<small>체결 ${amount(row.executed_volume, base)}${Number(row.executed_funds) ? ` · ${amount(row.executed_funds, quote)}` : ''}</small></td><td>${amount(row.paid_fee, quote)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
    }
    return `<tr><td>${r.kind.includes('deposit') ? '입금' : '출금'} · <strong>${esc(row.currency)}</strong><small>${esc(row.net_type ?? (row.currency === 'KRW' ? '원화' : '가상자산'))}</small></td><td>${date(row.at)}</td><td>${amount(row.amount, row.currency)}</td><td>${amount(row.fee, row.currency)}</td><td>${esc(STATES[row.state] ?? row.state)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">선택한 조건에 해당하는 내역이 없습니다.</td></tr>';
  $('#activity-more').hidden = rows.length <= state.activityShown;
  const range = r.period ? `${kstDay(r.period.from)} ~ ${kstDay(r.period.to)}` : '현재';
  $('#activity-coverage').textContent = `${r.mode === 'demo' ? '합성 예시 · ' : ''}${r.label} ${rows.length}건${only.size ? `(${b.symbols.join('·')} 범위)` : ''} · ${range} · ${r.coverage.complete ? '요청 범위 조회 완료' : `일부만 조회됨(최대 ${r.coverage.maxPages}페이지)`} · ${r.coverage.note}`;
}

// ===== 대화상자: 자산 상세 · 요약 =====
async function showHolding(symbol) {
  const h = state.portfolio?.holdings.find(item => item.symbol === symbol);
  if (!h) return;
  const cash = h.symbol === 'KRW';
  const rows = [['보유 수량', amount(h.quantity, h.symbol)], ['가용 수량', amount(h.available, h.symbol)], ['주문 중 수량', amount(h.locked, h.symbol)],
    ['평균 매수가', cash ? '—' : money(h.averagePriceKrw)], ['현재가', cash ? '—' : h.currentPriceKrw === null ? '가격 미확인' : `${number(h.currentPriceKrw, 4)}원`],
    ['비중', state.hidden ? '••' : h.allocationPct === null ? '—' : `${number(h.allocationPct, 1)}%`]];
  $('#detail').innerHTML = `<div class="dialog__head"><h2 id="detail-title">${esc(h.name)} <span class="muted">${esc(h.symbol)}</span></h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="detail-hero"><span>평가금액</span><strong>${money(h.valueKrw)}</strong>${cash || h.profitKrw === null ? '' : `<span class="${tone(h.profitKrw)}">${money(h.profitKrw, true)} · ${percent(h.profitRatePct)}</span>`}</div>
    <dl class="detail-metrics">${rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${cash ? '' : '<h3 class="section-title">원화 시세 · 최근 30일 일봉</h3><div id="detail-chart" class="chart chart--small"><p class="empty">시세를 불러오는 중</p></div>'}
    <p class="note">${h.quoteAt ? `현재가 기준 ${date(h.quoteAt)}${h.priceSource?.startsWith('BTC-') ? '(BTC 마켓 환산)' : ''}. ` : ''}${h.averagePriceModified ? '수정된 평균 매수가를 사용합니다. ' : ''}수량에는 주문 중인 자산이 포함됩니다.</p>`;
  $('#holding-dialog').showModal();
  state.market = null;
  state.marketRequest = symbol;
  if (cash) return;
  charts.observe($('#detail-chart'));
  try {
    const market = await api(`/api/market?${query({ symbol, days: 30 })}`);
    if (state.marketRequest !== symbol) return;
    state.market = market;
    renderMarket();
  } catch (error) { if (state.marketRequest === symbol && $('#detail-chart')) $('#detail-chart').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
}
function renderMarket() {
  const box = $('#detail-chart'), m = state.market;
  if (!box || !m) return;
  const points = m.candles.map(c => ({ at: `${c.date}T00:00:00+09:00`, value: Number(c.closeKrw) }));
  if (points.length < 2) { box.innerHTML = '<p class="empty">일봉 데이터가 부족합니다.</p>'; return; }
  box.innerHTML = lineChart(box, points, { label: `${m.name} 원화 일봉 종가`, height: 180, tick: value => value >= 1e8 ? `${number(value / 1e8, 2)}억` : value >= 1e4 ? `${number(value / 1e4, 1)}만` : number(value, 2) });
}
async function showExplain() {
  try {
    const e = await api(`/api/explain?${query({ symbols: scope() })}`);
    $('#explain-body').innerHTML = state.hidden ? '<p>금액 숨김을 해제하면 요약을 볼 수 있습니다.</p>' : `<p class="explain">${esc(e.summary)}</p>
      ${e.largest.length ? `<ul class="kv-list">${e.largest.map(h => `<li><span>${esc(h.name)} <small>${esc(h.symbol)}</small></span><b>${money(h.valueKrw)} · ${number(h.allocationPct, 1)}%</b></li>`).join('')}</ul>` : ''}
      ${e.warnings.length ? `<p class="note">${e.warnings.map(esc).join('<br>')}</p>` : ''}
      <p class="note">${date(e.asOf)} 기준 · ${e.mode === 'demo' ? '합성 예시' : '계좌 조회'} · 계산된 숫자만 설명하며 외부 AI로 보내지 않습니다.</p>`;
    $('#explain-dialog').showModal();
  } catch (error) { notice(error.message); }
}

// ===== 대화상자: 화면 편집 =====
async function openEditor(mode) {
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
async function reloadBoards() { try { state.boards = (await api('/api/boards')).boards; renderTabs(); } catch { /* 다음 조회에서 다시 시도 */ } }
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
    if (error.status === 409) await reloadBoards();
    formError(error.message);
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
    if (error.status === 409) await reloadBoards();
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
  const rows = [['모드', '조회시각', '자산', '이름', '수량', '가용수량', '주문중수량', '현재가KRW', '평가금액KRW', '평가손익KRW', '수익률%', '비중%'], ...p.holdings.map(h => [p.mode, p.asOf, h.symbol, h.name, h.quantity, h.available, h.locked, h.currentPriceKrw, h.valueKrw, h.profitKrw, h.profitRatePct, h.allocationPct])];
  // 스프레드시트 수식으로 해석될 수 있는 값은 작은따옴표로 시작합니다.
  const cell = value => { const text = String(value ?? ''); return `"${(/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-[\d.]+$/.test(text)) ? `'${text}` : text).replace(/"/g, '""')}"`; };
  download(`bithumb-assets-${p.mode}-${p.asOf.slice(0, 10)}.csv`, `﻿${rows.map(row => row.map(cell).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8');
  notice('보유자산 CSV를 저장했어요.');
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
    refresh: load, privacy: togglePrivacy, explain: showExplain, guide: () => $('#guide-dialog').showModal(), copy: copyCommand, export: exportCsv,
    view: () => setView(target.dataset.view), days: () => setDays(Number(target.dataset.days)), month: () => shiftMonth(Number(target.dataset.step)),
    detail: () => showHolding(target.dataset.symbol), activity: loadActivity, 'activity-more': () => { state.activityShown += 100; renderActivity(); },
    chip: () => toggleChip(target.dataset.symbol), move: () => moveWidget(Number(target.dataset.index), Number(target.dataset.step)),
  };
  void actions[target.dataset.action]?.();
});
document.addEventListener('input', event => {
  if (['search', 'cash-filter', 'sort'].includes(event.target.id)) renderHoldings();
  if (event.target.id === 'board-symbols') renderChips();
});
document.addEventListener('change', event => {
  const { target } = event;
  if (target.id === 'activity-kind') $('#activity-from').disabled = $('#activity-to').disabled = target.value === 'pending';
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
$('#holding-dialog').addEventListener('close', () => { state.marketRequest = null; state.market = null; });

void init();
