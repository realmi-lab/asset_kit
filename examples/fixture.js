// 샘플 HTML 전용: 로컬 서버 대신 미리 계산한 데모 응답을 돌려줍니다. examples/build.js가 DATA를 채웁니다.
window.AssetKitFixture = (() => {
  const DATA = /*DATA*/null;
  const clone = value => JSON.parse(JSON.stringify(value));
  let boards = clone(DATA.boards);
  const fail = (message, status = 400) => Promise.reject(Object.assign(new Error(message), { status }));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `sample-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const won = value => `${Math.round(Number(value)).toLocaleString('ko-KR')}원`;

  // 원화 포함 전체 응답을 일부 자산으로 좁힙니다. 샘플 표시용 단순 계산입니다.
  function project(symbols) {
    const full = DATA.portfolio;
    if (!symbols.length) return full;
    const holdings = full.holdings.filter(h => symbols.includes(h.symbol));
    const total = holdings.reduce((sum, h) => sum + Number(h.valueKrw ?? 0), 0);
    const comparable = holdings.filter(h => h.profitKrw !== null);
    const cost = comparable.reduce((sum, h) => sum + Number(h.costKrw), 0), profit = comparable.reduce((sum, h) => sum + Number(h.profitKrw), 0);
    const cash = Number(holdings.find(h => h.symbol === 'KRW')?.valueKrw ?? 0);
    return { ...full, scope: symbols,
      holdings: holdings.map(h => ({ ...h, allocationPct: total ? (Number(h.valueKrw) / total * 100).toFixed(4) : null })),
      summary: { ...full.summary, totalValueKrw: String(total), cashKrw: String(cash), cryptoValueKrw: String(total - cash),
        profitKrw: comparable.length ? String(profit) : null, profitRatePct: cost ? (profit / cost * 100).toFixed(4) : null,
        comparableCostKrw: String(cost), assetCount: holdings.filter(h => h.symbol !== 'KRW').length } };
  }
  const ratio = symbols => symbols.length ? Number(project(symbols).summary.totalValueKrw) / Number(DATA.portfolio.summary.totalValueKrw) : 1;
  function history(params) {
    const symbols = (params.get('symbols') || '').split(',').filter(Boolean), share = ratio(symbols);
    if (params.get('daily') === '1') {
      const result = clone(DATA.daily);
      result.daily = result.daily.map(row => ({ ...row, closeKrw: String(Math.round(row.closeKrw * share)), changeKrw: row.changeKrw === null ? null : String(Math.round(row.changeKrw * share)) }));
      return { ...result, scope: symbols };
    }
    const result = clone(DATA.histories[params.get('days')] ?? DATA.histories[30]);
    result.points = result.points.map(p => ({ ...p, totalValueKrw: String(Math.round(p.totalValueKrw * share)) }));
    return { ...result, scope: symbols };
  }
  function explain(params) {
    const symbols = (params.get('symbols') || '').split(',').filter(Boolean);
    if (!symbols.length) return DATA.explain;
    const p = project(symbols), s = p.summary;
    const largest = p.holdings.filter(h => h.valueKrw !== null).sort((a, b) => b.valueKrw - a.valueKrw).slice(0, 3).map(({ symbol, name, valueKrw, allocationPct }) => ({ symbol, name, valueKrw, allocationPct }));
    const lines = [`총 평가금액은 ${won(s.totalValueKrw)}입니다. 원화 ${won(s.cashKrw)}, 가상자산 ${s.assetCount}종 ${won(s.cryptoValueKrw)}입니다.`];
    if (s.profitKrw !== null) lines.push(`보유분 평가손익은 ${Number(s.profitKrw) > 0 ? '+' : ''}${won(s.profitKrw)}${s.profitRatePct === null ? '' : ` (${Number(s.profitRatePct).toFixed(2)}%)`}입니다.`);
    if (largest.length) lines.push(`비중이 큰 자산은 ${largest.map(h => `${h.name} ${Number(h.allocationPct).toFixed(1)}%`).join(', ')}입니다.`);
    return { ...DATA.explain, scope: symbols, summary: lines.join(' '), largest };
  }
  function records(params) {
    const result = clone(DATA.records[params.get('kind')] ?? DATA.records.orders);
    if (result.kind === 'pending') return result;
    const kst = (value, end) => Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+09:00`);
    const from = params.get('from') ? kst(params.get('from')) : Date.now() - 7 * 86400000, to = params.get('to') ? kst(params.get('to'), true) : Date.now();
    result.rows = result.rows.filter(row => { const at = Date.parse(row.at ?? row.created_at); return at >= from && at <= to; });
    result.period = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    return result;
  }
  function saveBoard(input, base = {}) {
    if (!String(input?.name ?? '').trim() || !Array.isArray(input.widgets) || !input.widgets.length) return null;
    const { name, symbols = [], widgets, days = 30, refreshSeconds = 0 } = input;
    return { ...base, name: name.trim(), symbols, widgets, days, refreshSeconds, updatedAt: new Date().toISOString() };
  }
  async function request(method, path, body) {
    const url = new URL(path, 'http://sample.local'), params = url.searchParams, id = url.pathname.split('/')[3];
    if (method === 'GET') {
      switch (url.pathname) {
        case '/api/status': return clone(DATA.status);
        case '/api/boards': return { boards: clone(boards) };
        case '/api/portfolio': return clone(project((params.get('symbols') || '').split(',').filter(Boolean)));
        case '/api/history': return history(params);
        case '/api/explain': return explain(params);
        case '/api/records': return records(params);
        case '/api/market': return DATA.markets[params.get('symbol')] ? clone(DATA.markets[params.get('symbol')]) : fail('샘플 데이터에 없는 원화 마켓입니다.', 404);
      }
    }
    if (method === 'POST' && url.pathname === '/api/boards') {
      const board = saveBoard(body, { id: newId(), revision: 1 });
      if (!board) return fail('이름과 위젯을 확인하세요.');
      boards.push(board);
      return clone(board);
    }
    if (method === 'POST' && url.pathname === '/api/boards/import') {
      const created = (body.boards ?? []).map(item => saveBoard(item, { id: newId(), revision: 1 }));
      if (!created.length || created.some(item => !item)) return fail('대시보드 설정을 확인하세요.');
      boards.push(...created);
      return { boards: clone(created) };
    }
    const index = boards.findIndex(item => item.id === id);
    if (index < 0) return fail('대시보드를 찾을 수 없습니다.', 404);
    if (boards[index].revision !== body?.revision) return fail('다른 창에서 설정이 바뀌었습니다. 다시 불러온 뒤 저장하세요.', 409);
    if (method === 'PUT') {
      const board = saveBoard(body, { ...boards[index], revision: boards[index].revision + 1 });
      if (!board) return fail('이름과 위젯을 확인하세요.');
      boards[index] = board;
      return clone(board);
    }
    if (method === 'DELETE') {
      if (boards.length <= 1) return fail('대시보드는 최소 한 개가 필요합니다.');
      boards.splice(index, 1);
      return { deleted: id };
    }
    return fail('샘플 페이지에서 지원하지 않는 요청입니다.', 405);
  }
  return { request };
})();
