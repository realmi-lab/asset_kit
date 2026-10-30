// 샘플 HTML 전용: 로컬 서버 대신 미리 계산한 데모 응답을 돌려줍니다. examples/build.js가 DATA를 채웁니다.
window.AssetKitFixture = (() => {
  const DATA = /*DATA*/null;
  const clone = value => JSON.parse(JSON.stringify(value));
  let boards = clone(DATA.boards);
  const fail = (message, status = 400, code = 'INVALID_BOARD') => Promise.reject(Object.assign(new Error(message), { status, code }));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `sample-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const won = value => `${Math.round(Number(value)).toLocaleString('ko-KR')}원`;
  const WIDGETS = ['summary', 'trend', 'insights', 'allocation', 'heatmap', 'performance', 'holdings', 'market', 'warnings', 'activity'];
  const DEFAULT_WIDGETS = ['summary', 'trend', 'insights', 'allocation', 'holdings', 'activity'];
  const MAX_BOARDS = 50;
  const invalidBoard = () => Object.assign(new Error('대시보드 설정을 확인하세요. 이름 1~48자, 지원하는 위젯 1개 이상(중복 없음), 자산 심볼 최대 100개, 기간 7/30/90/365일, 갱신 0/30/60/300초입니다.'), { status: 400, code: 'INVALID_BOARD' });

  // 실시간 흉내용: 한 자산을 새 현재가로 다시 평가합니다. 샘플 표시용 단순 계산입니다.
  function reprice(h, tick) {
    if (!tick || h.currentPriceKrw === null) return h;
    const value = Number(h.quantity) * Number(tick.priceKrw), cost = h.costKrw === null ? null : Number(h.costKrw), profit = cost === null ? null : value - cost;
    return { ...h, currentPriceKrw: tick.priceKrw, valueKrw: String(Math.round(value)), priceChangePct: tick.changePct ?? h.priceChangePct, quoteAt: tick.at,
      profitKrw: profit === null ? null : String(Math.round(profit)), profitRatePct: profit === null || !cost ? h.profitRatePct : (profit / cost * 100).toFixed(4) };
  }
  // 원화 포함 전체 응답을 일부 자산으로 좁히고, 실시간 가격이 있으면 다시 평가합니다. 샘플 표시용 단순 계산입니다.
  function project(symbols, ticks) {
    const full = DATA.portfolio;
    if (!symbols.length && !ticks) return full;
    const holdings = full.holdings.filter(h => !symbols.length || symbols.includes(h.symbol)).map(h => reprice(h, ticks?.get(h.symbol)));
    const total = holdings.reduce((sum, h) => sum + Number(h.valueKrw ?? 0), 0);
    const comparable = holdings.filter(h => h.profitKrw !== null);
    const cost = comparable.reduce((sum, h) => sum + Number(h.costKrw), 0), profit = comparable.reduce((sum, h) => sum + Number(h.profitKrw), 0);
    const cash = Number(holdings.find(h => h.symbol === 'KRW')?.valueKrw ?? 0);
    const moved = holdings.filter(h => h.symbol !== 'KRW' && h.valueKrw !== null && h.priceChangePct !== null);
    const day = moved.reduce((sum, h) => sum + Number(h.valueKrw) - Number(h.valueKrw) / (1 + Number(h.priceChangePct) / 100), 0);
    return { ...full, scope: symbols, asOf: ticks ? new Date().toISOString() : full.asOf,
      holdings: holdings.map(h => ({ ...h, allocationPct: total ? (Number(h.valueKrw) / total * 100).toFixed(4) : null })),
      summary: { ...full.summary, totalValueKrw: String(total), cashKrw: String(cash), cryptoValueKrw: String(total - cash),
        profitKrw: comparable.length ? String(profit) : null, profitRatePct: cost ? (profit / cost * 100).toFixed(4) : null,
        comparableCostKrw: String(cost), assetCount: holdings.filter(h => h.symbol !== 'KRW').length,
        dayChangeKrw: moved.length ? String(Math.round(day)) : null, dayChangePct: moved.length && total - day > 0 ? (day / (total - day) * 100).toFixed(4) : null,
        dayChangeComplete: moved.length === holdings.filter(h => h.symbol !== 'KRW').length } };
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
  // 시장 개요: 빌드 때 만든 전체 시세를 서버와 같은 조건으로 정렬·제한합니다.
  function tickers(params) {
    const scope = params.get('scope') === 'holdings' ? 'holdings' : 'all', sort = ['change', 'price', 'name'].includes(params.get('sort')) ? params.get('sort') : 'value24h';
    const factor = params.get('direction') === 'asc' ? 1 : -1, limit = Math.min(Math.max(Math.trunc(Number(params.get('limit'))) || 10, 1), 50);
    const field = { change: 'changePct', value24h: 'value24hKrw', price: 'priceKrw' }[sort], wanted = (params.get('symbols') || '').split(',').filter(Boolean);
    const rows = DATA.tickers.rows.filter(row => (scope === 'all' || row.held) && (!wanted.length || wanted.includes(row.symbol)))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ko') * factor : (Number(a[field]) - Number(b[field])) * factor || a.symbol.localeCompare(b.symbol));
    return { ...clone(DATA.tickers), scope, sort, direction: factor > 0 ? 'asc' : 'desc', total: rows.length, rows: clone(rows.slice(0, limit)) };
  }
  // 차트 캔들: 빌드 때 줄여 담은 배열을 서버 응답 모양으로 되돌립니다. interval이 없으면 기존처럼 days일 일봉입니다.
  function market(params) {
    const symbol = params.get('symbol'), interval = params.get('interval') ?? 'day', packed = DATA.candles[symbol]?.[interval];
    if (!packed) return fail(DATA.candles[symbol] ? '샘플 페이지에는 보유 코인만 15분·1시간·4시간·주 캔들이 있습니다. 일봉으로 보세요.' : '샘플 데이터에 없는 원화 마켓입니다.', 404, 'NO_KRW_MARKET');
    const count = Math.min(Math.max(Math.trunc(Number(params.get(params.has('interval') ? 'count' : 'days'))) || (params.has('interval') ? 120 : 30), 1), 200);
    const { rows, ...rest } = packed;
    return { ...clone(rest), candles: rows.slice(-count).map(([minute, open, high, low, close, volume]) => {
      const at = new Date(minute * 60000 + 9 * 3600000).toISOString().slice(0, 19);
      return { date: at.slice(0, 10), at: `${at}+09:00`, openKrw: String(open), highKrw: String(high), lowKrw: String(low), closeKrw: String(close), volume: String(volume) };
    }) };
  }
  // 실시간 시세 흉내: 빌드 때 시세를 기준으로 ±3% 안에서 1.5초마다 조금씩 움직입니다. 서버의 데모 모드와 같은 방식입니다.
  function stream(params, handlers) {
    const symbols = (params.symbols || '').split(',').filter(Boolean), watch = (params.watch || '').split(',').filter(Boolean);
    const held = DATA.portfolio.holdings.filter(h => h.symbol !== 'KRW' && h.currentPriceKrw !== null && (!symbols.length || symbols.includes(h.symbol))).map(h => h.symbol);
    const base = new Map([...new Set([...held, ...watch])].map(symbol => [symbol, DATA.tickers.rows.find(row => row.symbol === symbol)]).filter(([, row]) => row));
    // 시각은 샘플을 만든 때부터 흐르게 해서 차트의 마지막 캔들과 이어지게 합니다.
    const ticks = new Map(), started = Date.now(), sampleTime = Date.parse(DATA.portfolio.asOf) + 1000;
    const tick = () => {
      const tickers = [...base].map(([symbol, row]) => {
        const origin = Number(row.priceKrw), previous = Number(ticks.get(symbol)?.priceKrw ?? origin);
        const next = Math.min(origin * 1.03, Math.max(origin * 0.97, previous * (1 + (Math.random() - 0.5) * 0.004))), value = next >= 100 ? Math.round(next) : Number(next.toFixed(2));
        const rate = row.changePct === null ? null : ((1 + Number(row.changePct) / 100) * value / origin - 1) * 100;
        const item = { symbol, priceKrw: String(value), changePct: rate === null ? null : rate.toFixed(4), highKrw: row.highKrw === null ? null : String(Math.max(Number(row.highKrw), value)),
          lowKrw: row.lowKrw === null ? null : String(Math.min(Number(row.lowKrw), value)), value24hKrw: row.value24hKrw, at: new Date(sampleTime + Date.now() - started).toISOString() };
        ticks.set(symbol, item);
        return item;
      });
      if (tickers.length) handlers.tick({ tickers });
      if (held.length) handlers.portfolio(clone(project(symbols, ticks)));
    };
    handlers.status({ live: 'live', mode: DATA.status.mode });
    const first = setTimeout(tick, 400), timer = setInterval(tick, 1500);
    return { close: () => { clearTimeout(first); clearInterval(timer); } };
  }
  function warnings(params) {
    const scope = params.get('scope') === 'holdings' ? 'holdings' : 'all', rows = DATA.warnings.rows.filter(row => scope === 'all' || row.held);
    return { ...clone(DATA.warnings), scope, total: rows.length, rows: clone(rows) };
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
    // 서버 없이도 src/boards.js의 BOARD_FIELDS와 같은 입력 규칙을 적용합니다.
    const { name, symbols = [], widgets = [...DEFAULT_WIDGETS], days = 30, refreshSeconds = 60 } = input ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 48 || !Array.isArray(symbols) || symbols.length > 100
      || symbols.some(symbol => typeof symbol !== 'string' || !/^[A-Z0-9][A-Z0-9_]{0,29}$/.test(symbol.trim().toUpperCase()))
      || !Array.isArray(widgets) || !widgets.length || widgets.length > WIDGETS.length || new Set(widgets).size !== widgets.length
      || widgets.some(widget => !WIDGETS.includes(widget)) || ![7, 30, 90, 365].includes(days) || ![0, 30, 60, 300].includes(refreshSeconds)) throw invalidBoard();
    return { ...base, name: name.trim(), symbols: [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()))],
      widgets: [...widgets], days, refreshSeconds, updatedAt: new Date().toISOString() };
  }
  async function request(method, path, body) {
    const url = new URL(path, 'http://sample.local'), params = url.searchParams, id = url.pathname.split('/')[3];
    if (method === 'GET') {
      switch (url.pathname) {
        case '/api/status': return clone({ ...DATA.status, sampleAsOf: DATA.portfolio.asOf });
        case '/api/boards': return { boards: clone(boards) };
        case '/api/portfolio': return clone(project((params.get('symbols') || '').split(',').filter(Boolean)));
        case '/api/history': return history(params);
        case '/api/explain': return explain(params);
        case '/api/tickers': return tickers(params);
        case '/api/warnings': return warnings(params);
        case '/api/records': return records(params);
        case '/api/market': return market(params);
        case '/api/markets': return { markets: clone(DATA.marketList) };
        case '/api/returns': return DATA.returns[params.get('months') ?? '12'] ? clone(DATA.returns[params.get('months') ?? '12']) : fail('수익률 기간은 3, 6, 12개월 중 하나입니다.', 400, 'INVALID_RANGE');
      }
    }
    if (method === 'POST' && url.pathname === '/api/boards') {
      if (boards.length >= MAX_BOARDS) return fail(`대시보드는 최대 ${MAX_BOARDS}개까지 저장할 수 있습니다.`, 400, 'BOARD_LIMIT');
      const board = saveBoard(body, { id: newId(), revision: 1 });
      boards.push(board);
      return clone(board);
    }
    if (method === 'POST' && url.pathname === '/api/boards/import') {
      const list = body?.boards;
      if (!Array.isArray(list) || !list.length || list.length > MAX_BOARDS) return fail(`1~${MAX_BOARDS}개의 대시보드 설정 배열이 필요합니다.`);
      const created = list.map(item => saveBoard(item, { id: newId(), revision: 1 }));
      if (boards.length + created.length > MAX_BOARDS) return fail(`대시보드는 최대 ${MAX_BOARDS}개까지 저장할 수 있습니다.`, 400, 'BOARD_LIMIT');
      boards.push(...created);
      return { boards: clone(created) };
    }
    const index = boards.findIndex(item => item.id === id);
    if (index < 0) return fail('대시보드를 찾을 수 없습니다.', 404, 'BOARD_NOT_FOUND');
    if (boards[index].revision !== body?.revision) return fail(`다른 창에서 설정이 바뀌었습니다. 다시 불러온 뒤 ${method === 'DELETE' ? '삭제' : '저장'}하세요.`, 409, 'CONFLICT');
    if (method === 'PUT') {
      const board = saveBoard(body, { ...boards[index], revision: boards[index].revision + 1 });
      boards[index] = board;
      return clone(board);
    }
    if (method === 'DELETE') {
      if (boards.length <= 1) return fail('대시보드는 최소 한 개가 필요합니다.', 400, 'LAST_BOARD');
      boards.splice(index, 1);
      return { deleted: id };
    }
    return fail('샘플 페이지에서 지원하지 않는 요청입니다.', 405);
  }
  return { request, stream };
})();
