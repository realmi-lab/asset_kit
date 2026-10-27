import { dec } from './decimal.js';
import { ACCOUNTS, TICKERS, validResponse } from './bithumb.js';

const sum = values => values.reduce((acc, value) => acc.plus(value ?? 0), dec(0));
const amount = value => value === null ? null : value.toFixed();
const positive = value => value !== undefined && dec(value).gt(0);

// Direct KRW quote first; otherwise a coin listed only on the BTC market is valued through KRW-BTC.
function quoteFor(currency, quotes) {
  const direct = quotes.get(`KRW-${currency}`);
  if (direct && positive(direct.trade_price)) {
    return { price: dec(direct.trade_price), source: `KRW-${currency}`, timestamp: Number(direct.timestamp), changeRate: direct.signed_change_rate };
  }
  const viaBtc = quotes.get(`BTC-${currency}`), btc = quotes.get('KRW-BTC');
  if (viaBtc && btc && positive(viaBtc.trade_price) && positive(btc.trade_price)) {
    return { price: dec(viaBtc.trade_price).times(btc.trade_price), source: `BTC-${currency}×KRW-BTC`, timestamp: Math.min(Number(viaBtc.timestamp), Number(btc.timestamp)) };
  }
  return null;
}

/** A common, decimal-string contract for CLI, MCP, and the dashboard. */
export function calculatePortfolio({ accounts, tickers, markets = [], mode = 'live', asOf = new Date().toISOString() }) {
  const validAccounts = validResponse(ACCOUNTS, accounts);
  const quotes = new Map(validResponse(TICKERS, tickers).map(ticker => [ticker.market, ticker]));
  const names = new Map(markets.map(market => [market.market, market.korean_name]));
  // market_warning: NONE 또는 CAUTION(거래 유의). 값이 없으면 확인하지 못한 것이므로 null입니다.
  const cautions = new Map(markets.map(market => [market.market, market.market_warning]));
  const holdings = validAccounts.flatMap(account => {
    const quantity = dec(account.balance).plus(account.locked);
    if (quantity.isZero()) return [];
    const cash = account.currency === 'KRW';
    const quote = cash ? null : quoteFor(account.currency, quotes);
    const currentPrice = cash ? dec(1) : quote?.price ?? null;
    // Only a KRW-denominated average cost is comparable; a BTC cost converted at today's BTC price would be misleading.
    const average = !cash && account.unit_currency === 'KRW' && positive(account.avg_buy_price) ? dec(account.avg_buy_price) : null;
    const value = currentPrice === null ? null : quantity.times(currentPrice);
    const cost = average === null ? null : quantity.times(average);
    const profit = cost === null || value === null ? null : value.minus(cost);
    return [{
      symbol: account.currency,
      name: cash ? '원화' : names.get(`KRW-${account.currency}`) ?? names.get(`BTC-${account.currency}`) ?? account.currency,
      quantity: quantity.toFixed(), available: account.balance, locked: account.locked,
      currentPriceKrw: amount(currentPrice), valueKrw: amount(value),
      averagePriceKrw: amount(average), costKrw: amount(cost), profitKrw: amount(profit),
      profitRatePct: cost === null || profit === null ? null : profit.times(100).div(cost, 4).toFixed(4),
      priceChangePct: quote?.changeRate === undefined ? null : dec(quote.changeRate).times(100).toFixed(4),
      priceSource: quote?.source ?? null,
      averagePriceModified: account.avg_buy_price_modified,
      quoteAt: quote ? new Date(quote.timestamp).toISOString() : null,
      marketWarning: cash ? null : [cautions.get(`KRW-${account.currency}`), cautions.get(`BTC-${account.currency}`)].find(flag => flag && flag !== 'NONE') ?? null,
      staleQuote: Boolean(quote && Date.parse(asOf) - quote.timestamp > 120000),
      valuationStatus: value === null ? 'unpriced' : 'priced',
    }];
  });
  return summarize(holdings, { mode, asOf });
}

/** Totals, allocation and warnings for a set of valued holdings: the whole account or one board's symbols. */
function summarize(rows, { mode, asOf, scope = [] }) {
  const total = sum(rows.map(h => h.valueKrw));
  const holdings = rows.map(h => ({
    ...h, allocationPct: h.valueKrw === null || total.isZero() ? null : dec(h.valueKrw).times(100).div(total, 4).toFixed(4),
  })).sort((a, b) => dec(b.valueKrw ?? -1).cmp(a.valueKrw ?? -1));
  const comparable = holdings.filter(h => h.profitKrw !== null);
  const comparableCost = sum(comparable.map(h => h.costKrw));
  const profit = sum(comparable.map(h => h.profitKrw));
  const unpricedCount = holdings.filter(h => h.valueKrw === null).length;
  const unknownCostCount = holdings.filter(h => h.symbol !== 'KRW' && h.costKrw === null).length;
  const warnings = [];
  if (unpricedCount) warnings.push(`현재가가 없는 ${unpricedCount}개 자산은 평가 합계와 비중에서 제외했습니다.`);
  if (unknownCostCount) warnings.push(`평균 매수가를 확인할 수 없는 ${unknownCostCount}개 자산은 평가손익에서 제외했습니다.`);
  if (holdings.some(h => h.staleQuote)) warnings.push('일부 현재가의 기준 시각이 2분 이상 지났습니다.');
  if (holdings.some(h => h.priceSource?.startsWith('BTC-'))) warnings.push('원화 마켓이 없는 자산은 BTC 마켓 가격 × KRW-BTC로 환산했습니다.');
  if (holdings.some(h => h.averagePriceModified && h.symbol !== 'KRW')) warnings.push('사용자가 수정한 평균 매수가가 계산에 포함되어 있습니다.');
  const flagged = holdings.filter(h => h.marketWarning);
  if (flagged.length) warnings.push(`빗썸이 거래 유의로 지정한 자산을 보유 중입니다: ${flagged.map(h => h.symbol).join(', ')}.`);
  return {
    schemaVersion: '1.1', mode, provider: 'bithumb', currency: 'KRW', asOf, scope,
    summary: {
      totalValueKrw: total.toFixed(), cashKrw: holdings.find(h => h.symbol === 'KRW')?.valueKrw ?? '0',
      cryptoValueKrw: sum(holdings.filter(h => h.symbol !== 'KRW').map(h => h.valueKrw)).toFixed(),
      profitKrw: comparable.length ? profit.toFixed() : null,
      profitRatePct: comparableCost.gt(0) ? profit.times(100).div(comparableCost, 4).toFixed(4) : null,
      comparableCostKrw: comparableCost.toFixed(), assetCount: holdings.filter(h => h.symbol !== 'KRW').length,
      unpricedCount, unknownCostCount, valuationComplete: unpricedCount === 0,
      profitComplete: unpricedCount === 0 && unknownCostCount === 0,
    },
    holdings, warnings,
    calculation: {
      quantity: 'balance + locked', value: '보유 수량 × 원화 현재가 (원화 마켓이 없으면 BTC 마켓 가격 × KRW-BTC)',
      profit: '현재 보유분 평가금액 − API 평균 매수가 × 보유 수량. 수수료·실현손익 제외.',
      allocation: '가격이 확인된 자산 평가금액 합계(원화 포함)를 기준으로 계산.',
      history: '기록 시점의 평가금액입니다. 입출금 영향을 포함하므로 투자 수익률이 아닙니다.',
    },
  };
}

/** The same snapshot restricted to the given symbols. Totals, allocation and warnings are recomputed for the subset. */
export function projectPortfolio(portfolio, symbols = []) {
  if (!symbols.length) return portfolio;
  const wanted = new Set(symbols);
  return summarize(portfolio.holdings.filter(h => wanted.has(h.symbol)), { mode: portfolio.mode, asOf: portfolio.asOf, scope: [...wanted] });
}

const won = value => `${dec(value).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

/** A short, number-grounded explanation of one snapshot. It never adds data the snapshot does not contain. */
export function explainPortfolio(portfolio) {
  const s = portfolio.summary;
  const priced = portfolio.holdings.filter(h => h.valueKrw !== null);
  const largest = priced.slice(0, 3).map(({ symbol, name, valueKrw, allocationPct }) => ({ symbol, name, valueKrw, allocationPct }));
  const lines = [`${s.valuationComplete ? '총 평가금액' : '가격이 확인된 자산의 평가금액'}은 ${won(s.totalValueKrw)}입니다. 원화 ${won(s.cashKrw)}, 가상자산 ${s.assetCount}종 ${won(s.cryptoValueKrw)}입니다.`];
  if (s.profitKrw !== null) lines.push(`보유분 평가손익은 ${dec(s.profitKrw).gt(0) ? '+' : ''}${won(s.profitKrw)}${s.profitRatePct === null ? '' : ` (${dec(s.profitRatePct).toFixed(2)}%)`}${s.profitComplete ? '' : ', 원가가 확인된 자산만 기준'}입니다.`);
  if (largest.length) lines.push(`비중이 큰 자산은 ${largest.map(h => `${h.name} ${h.allocationPct === null ? '' : `${dec(h.allocationPct).toFixed(1)}%`}`.trim()).join(', ')}입니다.`);
  if (s.unpricedCount) lines.push(`현재가를 확인하지 못한 ${s.unpricedCount}개 자산은 합계에서 빠져 있습니다.`);
  return {
    mode: portfolio.mode, asOf: portfolio.asOf, scope: portfolio.scope ?? [], summary: lines.join(' '), largest,
    coverage: { assets: portfolio.holdings.length, priced: priced.length, unpriced: portfolio.holdings.filter(h => h.valueKrw === null).map(h => h.symbol), unknownCost: portfolio.holdings.filter(h => h.symbol !== 'KRW' && h.costKrw === null).map(h => h.symbol) },
    warnings: portfolio.warnings,
  };
}
