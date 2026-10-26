import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as dashboardUtils from '../web/dashboard-utils.js';

const [source, html] = await Promise.all(['../web/app.js', '../web/index.html'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
const flush = () => new Promise(resolve => setImmediate(resolve));

// Model only DOM state touched by these asynchronous workflows; layout is tested in a browser.
// Replacing widget markup removes its old IDs, so accesses to detached widgets fail as in the browser.
function dashboard() {
  const elements = new Map(), pending = [], storage = new Map(), intervals = new Map();
  let timerId = 0;
  class Element {
    constructor(id, tag = 'div') {
      Object.assign(this, { id, tagName: tag.toUpperCase(), value: '', textContent: '', hidden: false, disabled: false,
        checked: false, open: false, dataset: {}, attributes: {}, children: new Set(), listeners: {}, clientWidth: 600 });
      const classes = new Set();
      this.classList = { toggle: (name, force) => { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
    }
    set innerHTML(value) {
      for (const id of this.children) elements.delete(id);
      this.children.clear();
      this.markup = String(value);
      for (const match of this.markup.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
        const element = new Element(match[2], match[1]);
        element.hidden = /\shidden(?:\s|>)/.test(match[0]);
        element.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
        elements.set(element.id, element);
        this.children.add(element.id);
      }
    }
    get innerHTML() { return this.markup ?? ''; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    showModal() { this.open = true; }
    close() { this.open = false; for (const callback of this.listeners.close ?? []) callback({ target: this }); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 300, width: 600 }; }
  }
  new Element('document').innerHTML = html;
  const document = {
    hidden: false,
    querySelector(selector) {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) ?? null;
      if (selector === 'dialog[open]') return [...elements.values()].find(element => element.tagName === 'DIALOG' && element.open) ?? null;
      return null;
    },
    querySelectorAll: selector => selector === 'dialog' ? [...elements.values()].filter(element => element.tagName === 'DIALOG') : [],
    getElementById: id => elements.get(id) ?? null,
    addEventListener() {},
  };
  const context = { ...dashboardUtils, document, AbortController, AbortSignal, URLSearchParams, URL, Intl,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {},
    setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    AssetKitFixture: { request(method, path, body) {
      return new Promise((resolve, reject) => pending.push({ method, path, body, resolve, reject, taken: false }));
    } },
  };
  context.window = context;
  const executable = source.replace(/^import .* from '\.\/dashboard-utils\.js';\s*$/m, '')
    .replace(/void init\(\);\s*$/, 'globalThis.app = { state, beginRequest, cancelRequest, selectBoard, load, loadHistory, loadActivity, showExplain, reloadBoards, syncBoards, resetActivity: (...args) => resetActivity(...args) };');
  runInNewContext(executable, context, { filename: 'web/app.js' });
  assert.ok(context.app, 'The harness must expose actual app functions instead of initializing a server connection.');
  Object.assign(context.app.state, { status: { mode: 'demo', sample: true, sampleAsOf: '2026-10-06T06:00:00.000Z' },
    boards: [
      { id: 'a', name: 'BTC', symbols: ['BTC'], widgets: ['trend', 'activity'], days: 30, refreshSeconds: 0 },
      { id: 'b', name: 'ETH', symbols: ['ETH'], widgets: ['trend'], days: 7, refreshSeconds: 0 },
    ] });
  return { app: context.app, elements, pending, intervals, next(prefix) {
    const request = pending.find(item => !item.taken && item.path.startsWith(prefix));
    assert.ok(request, `Expected pending request for ${prefix}`);
    request.taken = true;
    return request;
  } };
}

const portfolio = symbol => ({ mode: 'demo', asOf: '2026-10-06T06:00:00.000Z', scope: [symbol], warnings: [], holdings: [] });
const history = symbol => ({ mode: 'demo', scope: [symbol], points: [], sampled: false });
const activity = { mode: 'demo', kind: 'orders', label: '종료 주문', rows: [], period: null,
  coverage: { complete: true, note: 'synthetic fixture' } };
async function ready() {
  const h = dashboard();
  h.app.selectBoard('a');
  h.next('/api/portfolio').resolve(portfolio('BTC'));
  await flush();
  h.elements.get('activity-kind').value = 'orders';
  return h;
}

test('request channels invalidate superseded work without cancelling unrelated reads', () => {
  const { app } = dashboard();
  const old = app.beginRequest('portfolio'), other = app.beginRequest('history'), current = app.beginRequest('portfolio');
  assert.equal(old.current(), false);
  assert.equal(old.signal.aborted, true);
  assert.equal(other.current(), true);
  assert.equal(current.current(), true);
  app.cancelRequest('portfolio');
  assert.equal(current.current(), false);
  assert.equal(current.signal.aborted, true);
  assert.equal(other.current(), true);
});

test('switching boards ignores a late portfolio and leaves the new board loading', async () => {
  const h = dashboard();
  h.app.selectBoard('a');
  const old = h.next('/api/portfolio');
  h.app.selectBoard('b');
  const current = h.next('/api/portfolio');
  assert.match(current.path, /symbols=ETH/);
  old.resolve(portfolio('BTC'));
  await flush();
  assert.equal(h.app.state.portfolio, null);
  assert.equal(h.app.state.loading, true);
  assert.equal(h.elements.get('refresh').disabled, true);
  current.resolve(portfolio('ETH'));
  await flush();
  assert.equal(h.app.state.portfolio.scope[0], 'ETH');
  assert.equal(h.app.state.loading, false);
  assert.equal(h.elements.get('refresh').disabled, false);
});

test('switching boards invalidates an old history before the new portfolio responds', async () => {
  const h = await ready();
  const old = h.next('/api/history');
  h.app.selectBoard('b');
  old.resolve(history('BTC'));
  await flush();
  assert.equal(h.app.state.history, null);
  h.next('/api/portfolio').resolve(portfolio('ETH'));
  await flush();
  h.next('/api/history').resolve(history('ETH'));
  await flush();
  assert.equal(h.app.state.history.scope[0], 'ETH');
});

test('late activity success and failure cannot touch a board without an activity widget', async t => {
  for (const outcome of ['resolve', 'reject']) await t.test(outcome, async () => {
    const h = await ready();
    const completion = h.app.loadActivity();
    const old = h.next('/api/records');
    h.app.selectBoard('b');
    assert.equal(h.elements.has('activity-coverage'), false);
    old[outcome](outcome === 'resolve' ? activity : new Error('old activity error'));
    await completion;
    assert.equal(h.app.state.activity, null);
    assert.equal(h.elements.get('error').textContent, '');
  });
});

test('resetting activity conditions discards an in-flight response and enables a fresh query', async () => {
  const h = await ready();
  const completion = h.app.loadActivity();
  const old = h.next('/api/records');
  h.elements.get('activity-kind').value = 'deposits';
  h.app.resetActivity();
  old.resolve(activity);
  await completion;
  assert.equal(h.app.state.activity, null);
  assert.equal(h.elements.get('activity-load').disabled, false);
  assert.equal(h.elements.get('activity-export').disabled, true);
  assert.doesNotMatch(h.elements.get('activity-coverage').textContent, /synthetic fixture/);
  const fresh = h.app.loadActivity();
  const current = h.next('/api/records');
  assert.match(current.path, /kind=deposits/);
  current.resolve({ ...activity, kind: 'deposits', label: '코인 입금' });
  await fresh;
  assert.equal(h.app.state.activity.kind, 'deposits');
});

test('a late explanation cannot replace the dialog content after switching boards', async () => {
  const h = await ready();
  const completion = h.app.showExplain();
  const old = h.next('/api/explain');
  h.app.selectBoard('b');
  const content = h.elements.get('explain-body').innerHTML;
  old.resolve({ mode: 'demo', asOf: '2026-10-06T06:00:00.000Z', summary: 'obsolete BTC summary', largest: [], warnings: [] });
  await completion;
  assert.equal(h.elements.get('explain-body').innerHTML, content);
  assert.doesNotMatch(h.elements.get('explain-body').innerHTML, /obsolete BTC summary/);
});

test('closing an explanation while it loads prevents a late response from reopening it', async () => {
  const h = await ready();
  const completion = h.app.showExplain();
  const old = h.next('/api/explain');
  h.elements.get('explain-dialog').close();
  h.app.selectBoard('b');
  old.resolve({ mode: 'demo', asOf: '2026-10-06T06:00:00.000Z', summary: 'obsolete BTC summary', largest: [], warnings: [] });
  await completion;
  assert.doesNotMatch(h.elements.get('explain-body').innerHTML, /obsolete BTC summary/);
  assert.equal(h.elements.get('explain-dialog').open, false);
});

test('a failed refresh keeps the last successful portfolio and restores the refresh control', async () => {
  const h = await ready(), previous = h.app.state.portfolio;
  const completion = h.app.load();
  h.next('/api/portfolio').reject(new Error('synthetic offline'));
  await completion;
  assert.equal(h.app.state.portfolio, previous);
  assert.equal(h.app.state.failed, true);
  assert.equal(h.app.state.loading, false);
  assert.equal(h.elements.get('refresh').disabled, false);
  assert.match(h.elements.get('error').textContent, /synthetic offline/);
  assert.match(h.elements.get('error').textContent, /마지막으로 성공한 조회 결과/);
});

test('reloading changed board settings remounts scope and widgets, reschedules, and rejects old reads', async () => {
  const h = dashboard();
  h.app.state.boards[0].refreshSeconds = 30;
  h.app.selectBoard('a');
  h.next('/api/portfolio').resolve(portfolio('BTC'));
  await flush();
  const oldHistory = h.next('/api/history');
  const refresh = h.app.load(), oldPortfolio = h.next('/api/portfolio');
  h.elements.get('activity-kind').value = 'orders';
  const activityCompletion = h.app.loadActivity(), oldActivity = h.next('/api/records');
  const draft = { id: 'a', revision: 1, name: 'unsaved draft' };
  h.app.state.draft = draft;
  h.elements.get('board-name-input').value = 'Keep my edit';
  assert.equal([...h.intervals.values()][0].delay, 30000);

  const completion = h.app.reloadBoards();
  h.next('/api/boards').resolve({ boards: [{ id: 'a', revision: 2, name: 'Changed on server', symbols: ['ETH'], widgets: ['trend'], days: 7, refreshSeconds: 60 }] });
  assert.equal(await completion, true);
  assert.equal(h.app.state.boardId, 'a');
  assert.equal(h.app.state.draft, draft);
  assert.equal(h.elements.get('board-name-input').value, 'Keep my edit');
  assert.equal(h.elements.get('board-name').textContent, 'Changed on server');
  assert.equal(h.elements.has('activity-body'), false);
  assert.equal(h.intervals.size, 1);
  assert.equal([...h.intervals.values()][0].delay, 60000);

  oldPortfolio.resolve(portfolio('BTC'));
  oldHistory.resolve(history('BTC'));
  oldActivity.resolve(activity);
  await Promise.all([refresh, activityCompletion]);
  await flush();
  assert.equal(h.app.state.portfolio, null);
  assert.equal(h.app.state.history, null);
  assert.equal(h.app.state.activity, null);
  const current = h.next('/api/portfolio');
  assert.match(current.path, /symbols=ETH/);
  current.resolve(portfolio('ETH'));
  await flush();
  const currentHistory = h.next('/api/history');
  assert.match(currentHistory.path, /days=7/);
  currentHistory.resolve(history('ETH'));
  await flush();
  assert.equal(h.app.state.portfolio.scope[0], 'ETH');
  assert.equal(h.app.state.history.scope[0], 'ETH');
});

test('reloading a deleted active board selects the first remaining board', async () => {
  const h = await ready();
  const remaining = h.app.state.boards[1];
  const completion = h.app.reloadBoards();
  h.next('/api/boards').resolve({ boards: [remaining] });
  assert.equal(await completion, true);
  assert.equal(h.app.state.boardId, 'b');
  assert.equal(h.elements.get('board-name').textContent, 'ETH');
  assert.match(h.next('/api/portfolio').path, /symbols=ETH/);
});

test('failed board reload is visible and preserves the last known board and edit', async () => {
  const h = await ready(), previous = h.app.state.boards, previousPortfolio = h.app.state.portfolio;
  const draft = { id: 'a', revision: 1 };
  h.app.state.draft = draft;
  const completion = h.app.reloadBoards();
  h.next('/api/boards').reject(new Error('synthetic reload failure'));
  assert.equal(await completion, false);
  assert.equal(h.app.state.boards, previous);
  assert.equal(h.app.state.portfolio, previousPortfolio);
  assert.equal(h.app.state.draft, draft);
  assert.equal(h.elements.get('error').hidden, false);
  assert.match(h.elements.get('error').textContent, /synthetic reload failure/);
});

test('board changes saved elsewhere (MCP) reach an open dashboard without touching unrelated state', async () => {
  const h = await ready();
  await h.app.syncBoards();
  assert.equal(h.pending.some(item => !item.taken && item.path === '/api/boards'), false, 'Offline samples never poll boards.');
  h.app.state.status = { mode: 'demo', configured: true };
  h.app.state.boards = h.app.state.boards.map(b => ({ ...b, revision: 1 }));
  const [a, b] = h.app.state.boards;

  // A new board only adds a tab; the active board keeps its data.
  const added = h.app.syncBoards();
  await flush();
  h.next('/api/boards').resolve({ boards: [a, b, { ...b, id: 'c', name: 'AI가 만든 보드' }] });
  await added;
  assert.equal(h.app.state.boards.length, 3);
  assert.match(h.elements.get('board-tabs').innerHTML, /AI가 만든 보드/);
  assert.equal(h.pending.some(item => !item.taken && item.path.startsWith('/api/portfolio')), false);

  // An edited active board is re-mounted with its new scope.
  const edited = h.app.syncBoards();
  await flush();
  h.next('/api/boards').resolve({ boards: [{ ...a, revision: 2, name: 'BTC·ETH', symbols: ['BTC', 'ETH'] }, b] });
  await edited;
  assert.equal(h.elements.get('board-name').textContent, 'BTC·ETH');
  assert.match(h.next('/api/portfolio').path, /symbols=BTC%2CETH/);

  // Open dialogs and unchanged lists are left alone.
  const same = h.app.syncBoards();
  await flush();
  h.next('/api/boards').resolve({ boards: h.app.state.boards });
  await same;
  assert.equal(h.pending.some(item => !item.taken && item.path.startsWith('/api/portfolio')), false);
  h.elements.get('board-dialog').open = true;
  await h.app.syncBoards();
  assert.equal(h.pending.some(item => !item.taken && item.path === '/api/boards'), false);
});

// A cancelled recovery reload never settles, so a regression would hang without the timeout.
test('board sync never runs before the first board is chosen, never cancels a recovery reload, and keeps work on a rename', { timeout: 5000 }, async () => {
  // Before init() picks a board (page loading in a background tab): nothing to compare, no toast.
  const loading = dashboard();
  Object.assign(loading.app.state, { status: { mode: 'demo', configured: true }, boardId: null });
  await loading.app.syncBoards();
  assert.equal(loading.pending.length, 0);

  const h = await ready();
  h.app.state.status = { mode: 'demo', configured: true };
  h.app.state.boards = h.app.state.boards.map(b => ({ ...b, revision: 1 }));
  const [a, b] = h.app.state.boards;

  // A reload after a failed save restores server settings; a poll must neither cancel nor race it.
  const reload = h.app.reloadBoards();
  await h.app.syncBoards();
  assert.equal(h.pending.filter(item => !item.taken && item.path === '/api/boards').length, 1);
  h.next('/api/boards').resolve({ boards: [a, b] });
  assert.equal(await reload, true);
  h.next('/api/portfolio').resolve(portfolio('BTC'));
  await flush();

  // A rename made elsewhere keeps an in-flight history query and the dates the user typed.
  h.elements.get('activity-kind').value = 'orders';
  h.elements.get('activity-from').value = '2026-01-01';
  const records = h.app.loadActivity(), recordsRequest = h.next('/api/records');
  const renamed = h.app.syncBoards();
  await flush();
  h.next('/api/boards').resolve({ boards: [{ ...h.app.state.boards[0], revision: 2, name: '새 이름' }, h.app.state.boards[1]] });
  await renamed;
  assert.equal(h.elements.get('board-name').textContent, '새 이름');
  assert.equal(h.elements.get('activity-from').value, '2026-01-01');
  assert.equal(h.pending.some(item => !item.taken && item.path.startsWith('/api/portfolio')), false);
  recordsRequest.resolve(activity);
  await records;
  assert.equal(h.app.state.activity, activity);
});
