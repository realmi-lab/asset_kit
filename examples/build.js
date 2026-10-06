#!/usr/bin/env node
// 서버 없이 열리는 단일 파일 샘플 대시보드(examples/sample-dashboard.html)를 만듭니다.
// 실제 화면 코드(web/)와 데모 서비스가 계산한 합성 데이터만 담습니다. 실제 계좌 데이터는 넣지 않습니다.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortfolioService } from '../src/service.js';
import { RECORD_KINDS } from '../src/activity.js';

const root = new URL('../', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path, root), encoding);
const inline = text => text.replace(/<\/script/gi, '<\\/script');

const directory = await mkdtemp(join(tmpdir(), 'asset-kit-sample-'));
try {
  const service = new PortfolioService({ demo: true, directory });
  const portfolio = await service.portfolio();
  const histories = Object.fromEntries(await Promise.all([7, 30, 90, 365].map(async days => [days, await service.getHistory({ days })])));
  const markets = Object.fromEntries(await Promise.all(portfolio.holdings.filter(h => h.symbol !== 'KRW').map(async h => [h.symbol, await service.getMarket({ symbol: h.symbol, days: 30 })])));
  const records = Object.fromEntries(await Promise.all(Object.keys(RECORD_KINDS).map(async kind => [kind, await service.getRecords({ kind })])));
  const data = {
    status: { ...service.status(), sample: true },
    boards: [
      { id: randomUUID(), revision: 1, name: '내 자산', symbols: [], widgets: ['summary', 'trend', 'allocation', 'holdings', 'activity'], days: 30, refreshSeconds: 0 },
      { id: randomUUID(), revision: 1, name: 'BTC·ETH 장기 보유', symbols: ['BTC', 'ETH'], widgets: ['summary', 'trend', 'allocation', 'holdings'], days: 90, refreshSeconds: 0 },
    ],
    portfolio, histories, daily: await service.getHistory({ days: 365, daily: true }), markets, records, explain: await service.explain(),
  };
  const [html, css, app, fixture, logo] = await Promise.all([read('web/index.html'), read('web/styles.css'), read('web/app.js'), read('examples/fixture.js'), read('web/assets/bithumb-logo.png', null)]);
  const page = html
    .replace('<title>내 자산 · Asset Kit</title>', () => '<title>샘플 · 내 자산 · Asset Kit</title>')
    .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${css}</style>`)
    .replace('<script src="/app.js" type="module"></script>', () => `<script>\n${inline(fixture.replace('/*DATA*/null', () => JSON.stringify(data)))}</script>\n<script type="module">\n${inline(app)}</script>`)
    .replace('src="/assets/bithumb-logo.png"', () => `src="data:image/png;base64,${logo.toString('base64')}"`)
    .replace('href="/"', () => 'href="#"');
  if (page.includes('src="/') || page.includes('href="/styles.css"')) throw new Error('외부 파일 참조가 남아 있습니다.');
  await mkdir(new URL('examples/', root), { recursive: true });
  await writeFile(new URL('examples/sample-dashboard.html', root), page);
  console.log(`examples/sample-dashboard.html (${Math.round(Buffer.byteLength(page) / 1024)}KB) · 합성 데이터 · 서버 없이 열립니다`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
