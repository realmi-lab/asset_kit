import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculatePortfolio } from '../src/portfolio.js';
import { BithumbProvider, accountJwt } from '../src/bithumb.js';
import { PortfolioService } from '../src/service.js';
import { DemoProvider, demoHistory } from '../src/demo.js';
import { HistoryStore } from '../src/history.js';
import { normalizeOrders, normalizeTransfers } from '../src/activity.js';
import { KitError } from '../src/errors.js';

process.env.ASSET_KIT_DATA_DIR = mkdtempSync(join(tmpdir(), 'asset-kit-core-'));

const account = (currency,balance,locked='0',avg='10',unit='KRW') => ({currency,balance,locked,avg_buy_price:avg,unit_currency:unit,avg_buy_price_modified:false});
const ticker = (currency,price) => ({market:`KRW-${currency}`,trade_price:price,timestamp:Date.now()});

test('valuation includes locked quantities and KRW without floating point drift',()=>{
  const p=calculatePortfolio({accounts:[account('BTC','0.1','0.2','1'),account('KRW','1','2','0')],tickers:[ticker('BTC','0.1')]});
  assert.equal(p.summary.totalValueKrw,'3.03');
  const btc=p.holdings.find(h=>h.symbol==='BTC');
  assert.equal(btc.quantity,'0.3');assert.equal(btc.valueKrw,'0.03');assert.equal(btc.profitKrw,'-0.27');
  assert.equal(p.summary.cashKrw,'3');
});
test('missing prices stay null, partial valuation does not invent zero-valued holdings',()=>{
  const p=calculatePortfolio({accounts:[account('BTC','1'),account('XYZ','2'),account('KRW','100','0','0')],tickers:[ticker('BTC',20)]});
  assert.equal(p.summary.totalValueKrw,'120');assert.equal(p.summary.valuationComplete,false);
  assert.equal(p.summary.unpricedCount,1);assert.equal(p.summary.profitComplete,false);
  assert.equal(p.holdings.find(h=>h.symbol==='XYZ').valueKrw,null);
  assert.equal(p.holdings.find(h=>h.symbol==='XYZ').allocationPct,null);
  assert.ok(p.warnings.length);
});
test('unknown or non-KRW average cost is excluded from P&L',()=>{
  const p=calculatePortfolio({accounts:[account('BTC','1','0','0'),account('ETH','1','0','3','BTC')],tickers:[ticker('BTC',20),ticker('ETH',10)]});
  assert.equal(p.summary.totalValueKrw,'30');assert.equal(p.summary.profitKrw,null);
  assert.equal(p.summary.unknownCostCount,2);assert.equal(p.summary.profitRatePct,null);
});
test('zero holdings, empty account and stale quotes have explicit states',()=>{
  const p=calculatePortfolio({accounts:[account('BTC','0')],tickers:[]});
  assert.equal(p.holdings.length,0);assert.equal(p.summary.totalValueKrw,'0');assert.equal(p.summary.profitRatePct,null);
  const stale=calculatePortfolio({accounts:[account('BTC','1')],tickers:[{...ticker('BTC',10),timestamp:Date.now()-300000}]});
  assert.equal(stale.holdings[0].staleQuote,true);assert.ok(stale.warnings.length);
});
test('invalid upstream quantity causes failure rather than a fabricated balance',()=>{
  assert.throws(()=>calculatePortfolio({accounts:[account('BTC','NaN')],tickers:[]}));
});
test('demo current total and final chart sample are consistent',async()=>{
  const service=new PortfolioService({demo:true});const p=await service.portfolio();
  assert.equal(p.summary.totalValueKrw,'28074000');assert.equal(p.summary.profitKrw,'2594000');
  assert.equal(demoHistory().at(-1).totalValueKrw,p.summary.totalValueKrw);
});
test('JWT verifies with HS256, unique nonce and millisecond timestamp',()=>{
  const jwt=accountJwt('fixture-access','fixture-secret',1234567890);
  const [h,p,s]=jwt.split('.'); const payload=JSON.parse(Buffer.from(p,'base64url'));
  assert.equal(s,createHmac('sha256','fixture-secret').update(`${h}.${p}`).digest('base64url'));
  assert.equal(payload.timestamp,1234567890);assert.equal(payload.access_key,'fixture-access');
  assert.ok(!('query_hash' in payload));
  assert.notEqual(payload.nonce,JSON.parse(Buffer.from(accountJwt('fixture-access','fixture-secret').split('.')[1],'base64url')).nonce);
});
test('private query JWT binds to the exact encoded request query',async()=>{
  let observed;
  const provider=new BithumbProvider({accessKey:'fixture-access',secretKey:'fixture-secret',fetchImpl:async(url,options)=>{
    observed={url,options};return Response.json({data:[],has_next:false,next_key:null});
  }});
  await provider.getOrders(normalizeOrders({kind:'history',fromMs:1000,toMs:2000,nextKey:'a+b/=cursor'}));
  const payload=JSON.parse(Buffer.from(observed.options.headers.Authorization.split('.')[1],'base64url'));
  const query=new URL(observed.url).search.slice(1);
  assert.equal(payload.query_hash,createHash('sha512').update(query).digest('hex'));
  assert.equal(payload.query_hash_alg,'SHA512');assert.ok(query.includes('a%2Bb%2F%3Dcursor'));
  assert.equal(observed.options.method,'GET');assert.equal(observed.options.redirect,'error');
});
test('public requests omit credentials and ticker calls are batched to 100',async()=>{
  const calls=[];
  const provider=new BithumbProvider({accessKey:'fixture-access',secretKey:'fixture-secret',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json([]);}});
  await provider.getTickers(Array.from({length:205},(_,i)=>`KRW-A${i}`));
  assert.deepEqual(calls.map(c=>new URL(c.url).searchParams.get('markets').split(',').length),[100,100,5]);
  assert.ok(calls.every(c=>!c.options.headers.Authorization && c.options.method==='GET'));
});
test('missing authentication never makes a network call',async()=>{
  let called=false;
  const p=new BithumbProvider({accessKey:'',secretKey:'',fetchImpl:async()=>{called=true;}});
  await assert.rejects(p.getAccounts(),{code:'NOT_CONFIGURED'});assert.equal(called,false);
});
test('upstream auth errors are redacted and never use demo as fallback',async()=>{
  const provider=new BithumbProvider({accessKey:'fixture-access',secretKey:'fixture-secret',fetchImpl:async()=>Response.json({message:'fixture-secret leaked upstream'},{status:401})});
  const service=new PortfolioService({provider});
  await assert.rejects(service.portfolio(),err=>err.code==='AUTH_FAILED'&&!err.message.includes('fixture-secret'));
  assert.equal(service.status().mode,'live');assert.equal(service.status().lastSuccessfulFetch,null);
});
test('API timeout/network and rate limit produce distinct errors',async()=>{
  let calls=0;
  const rate=new BithumbProvider({retryDelayMs:0,fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(rate.getMarkets(),{code:'RATE_LIMITED'});assert.equal(calls,3);
  const network=new BithumbProvider({retryDelayMs:0,fetchImpl:async()=>{throw new Error('sensitive network details');}});
  await assert.rejects(network.getMarkets(),err=>err.code==='API_UNREACHABLE'&&!err.message.includes('sensitive'));
});
test('portfolio concurrent reads use one upstream request chain and TTL cache',async()=>{
  const provider=new DemoProvider();let reads=0;
  const accounts=provider.getAccounts.bind(provider);provider.getAccounts=async()=>{reads++;return accounts();};
  const service=new PortfolioService({provider});
  const [a,b]=await Promise.all([service.portfolio(),service.portfolio()]);
  assert.equal(a,b);await service.portfolio();assert.equal(reads,1);
});
test('query validation enforces seven-day windows and valid flow filters',()=>{
  assert.throws(()=>normalizeOrders({kind:'history',fromMs:1,toMs:9*86400000}),{code:'INVALID_RANGE'});
  assert.throws(()=>normalizeOrders({kind:'pending',state:'done'}),{code:'INVALID_QUERY'});
  assert.throws(()=>normalizeTransfers({direction:'withdraw',assetType:'krw',currency:'BTC'}),{code:'INVALID_QUERY'});
  assert.throws(()=>normalizeTransfers({page:0}),{code:'INVALID_QUERY'});
  assert.throws(()=>normalizeTransfers({secret:'do-not-accept'}),{code:'INVALID_QUERY'});
});
test('activity pagination preserves scope and does not claim all-time completeness',async()=>{
  const s=new PortfolioService({demo:true});
  const orders=await s.getOrders({kind:'history',fromMs:1000,toMs:7201000});
  assert.equal(orders.query.fromMs,1000);assert.equal(orders.query.toMs,7201000);assert.equal(orders.coverage.allTime,false);
  const transfers=await s.getTransfers({limit:1});assert.equal(transfers.pagination.mayHaveMore,true);
  const next=await s.getTransfers({limit:1,page:2});assert.equal(next.pagination.mayHaveMore,false);assert.equal(next.data.length,0);
});
test('report retains successful balances and labels denied activity sections',async()=>{
  const provider=new DemoProvider();provider.getTransfers=async()=>{throw new KitError('AUTH_FAILED','조회 권한 부족',401);};
  const report=await new PortfolioService({provider}).report();
  assert.equal(report.portfolio.summary.totalValueKrw,'28074000');assert.equal(report.sections.pendingOrders.available,true);
  assert.equal(report.sections.krwDeposits.available,false);assert.equal(report.coverage.realizedProfitAvailable,false);
});
test('history is separated per account, skips duplicate minute and uses private file permissions',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'asset-kit-history-'));
  try {
    const a=new HistoryStore({directory,accessKey:'account-A'}),b=new HistoryStore({directory,accessKey:'account-B'});
    const demo=new HistoryStore({directory,mode:'demo'});
    const now=Date.now()-1000,asOf=new Date(now).toISOString();
    const p={mode:'live',asOf,summary:{totalValueKrw:'123.45',valuationComplete:true}};
    await a.record(p);await a.record(p);
    assert.equal((await a.read(1))[0].totalValueKrw,'123.45');assert.equal((await a.read(1)).length,1);
    assert.equal((await b.read(1)).length,0);assert.equal((await demo.read(1)).length,0);
    const info=await stat(join(a.directory,`${asOf.slice(0,10)}.jsonl`));assert.equal(info.mode&0o777,0o600);
    await assert.rejects(demo.record(p),{code:'MODE_MISMATCH'});
  } finally {await rm(directory,{recursive:true,force:true});}
});

// ===== 0.2.0: 기존 툴킷에서 옮긴 기능 =====
import { projectPortfolio, explainPortfolio } from '../src/portfolio.js';
import { dailyCloses, downsample, pointFor } from '../src/history.js';
import { BoardStore } from '../src/boards.js';
import { recordRange } from '../src/activity.js';
import { resolveCredentials, saveCredentials } from '../src/config.js';

test('BTC-market-only coins are valued through KRW-BTC; their BTC cost stays excluded',()=>{
  const p=calculatePortfolio({accounts:[account('ALT','10','0','0.0001','BTC'),account('BTC','1')],tickers:[{market:'BTC-ALT',trade_price:'0.00002',timestamp:Date.now()},ticker('BTC','100000000')]});
  const alt=p.holdings.find(h=>h.symbol==='ALT');
  assert.equal(alt.valueKrw,'20000');assert.equal(alt.priceSource,'BTC-ALT×KRW-BTC');assert.equal(alt.costKrw,null);
  assert.ok(p.warnings.some(w=>w.includes('BTC 마켓')));
});
test('symbol projection recomputes totals, allocation and explanation for the subset only',()=>{
  const p=calculatePortfolio({accounts:[account('BTC','1','0','50'),account('ETH','2','0','10'),account('KRW','100','0','0')],tickers:[ticker('BTC',100),ticker('ETH',50)]});
  const sub=projectPortfolio(p,['BTC','ETH']);
  assert.equal(sub.summary.totalValueKrw,'200');assert.equal(sub.summary.cashKrw,'0');assert.deepEqual(sub.scope,['BTC','ETH']);
  assert.equal(sub.holdings.find(h=>h.symbol==='BTC').allocationPct,'50.0000');assert.equal(p.holdings.find(h=>h.symbol==='BTC').allocationPct,'33.3333');
  const e=explainPortfolio(sub);assert.match(e.summary,/200원/);assert.equal(e.largest.length,2);
});
test('history keeps per-asset values for filtered boards, daily closes use KST days and charts are downsampled',()=>{
  assert.deepEqual(pointFor({asOf:'2026-10-01T00:00:00Z',totalValueKrw:'10',valuationComplete:true,values:{BTC:'7',KRW:'3'}},['BTC','ETH']),{asOf:'2026-10-01T00:00:00Z',totalValueKrw:'7',valuationComplete:true});
  assert.equal(pointFor({asOf:'2026-10-01T00:00:00Z',totalValueKrw:'10',valuationComplete:true,values:null},['BTC']).totalValueKrw,null);
  const days=dailyCloses([{asOf:'2026-10-01T14:00:00Z',totalValueKrw:'100',valuationComplete:true},{asOf:'2026-10-01T16:00:00Z',totalValueKrw:'110',valuationComplete:true},{asOf:'2026-10-01T23:00:00Z',totalValueKrw:'120',valuationComplete:true}]);
  assert.deepEqual(days.map(d=>[d.day,d.closeKrw,d.changeKrw]),[['2026-10-01','100',null],['2026-10-02','120','20']]);
  const many=Array.from({length:2000},(_,i)=>({asOf:new Date(Date.UTC(2026,0,1)+i*60000).toISOString(),totalValueKrw:String(i)}));
  const small=downsample(many);assert.ok(small.length<=400);assert.equal(small.at(-1).totalValueKrw,'1999');
});
test('record ranges use Korean calendar days and reject impossible or oversized periods',()=>{
  const r=recordRange('2026-09-01','2026-09-01');
  assert.equal(r.from,'2026-08-31T15:00:00.000Z');assert.equal(r.to,'2026-09-01T14:59:59.999Z');
  assert.throws(()=>recordRange('2026-02-31','2026-03-05'),{code:'INVALID_RANGE'});
  assert.throws(()=>recordRange('2024-01-01','2025-01-01'),{code:'INVALID_RANGE'});
  assert.doesNotThrow(()=>recordRange('2024-01-01','2024-12-31'));
});
test('range collection splits order history into seven-day windows, follows cursors and stops at maxPages',async()=>{
  const provider=new DemoProvider(),windows=[];
  provider.getOrders=async o=>{windows.push([o.fromMs,o.toMs,o.nextKey]);return o.nextKey?{data:[],has_next:false,next_key:null}:{data:[],has_next:true,next_key:`k${windows.length}`};};
  const s=new PortfolioService({provider});
  const r=await s.getRecords({kind:'orders',from:'2026-09-01',to:'2026-09-20'});
  assert.equal(windows.filter(w=>!w[2]).length,3);assert.ok(windows.every(([from,to])=>to-from<7*86400000));assert.equal(r.coverage.complete,true);
  const loop=new DemoProvider();loop.getOrders=async()=>({data:[],has_next:true,next_key:'same'});
  await assert.rejects(new PortfolioService({provider:loop}).getRecords({kind:'pending'}),{code:'INVALID_CURSOR'});
  const capped=await new PortfolioService({provider,maxPages:2}).getRecords({kind:'orders',from:'2026-09-01',to:'2026-09-20'});
  assert.equal(capped.coverage.complete,false);assert.equal(capped.coverage.pages,2);
});
test('boards: default board, revision conflicts, last-board guard and all-or-nothing import with 0600 file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'asset-kit-boards-'));
  try {
    const viaMcp=new BoardStore({directory:join(directory,'mcp-first'),mode:'demo'});
    await viaMcp.create({name:'AI 보드'});assert.deepEqual((await viaMcp.list()).map(x=>x.name),['내 자산','AI 보드']);
    const store=new BoardStore({directory,mode:'demo'});
    const [first]=await store.list();assert.equal(first.name,'내 자산');assert.deepEqual(first.widgets,['summary','trend','insights','allocation','holdings','activity']);
    await assert.rejects(store.remove(first.id,first.revision),{code:'LAST_BOARD'});
    const b=await store.create({name:' BTC 장기 ',symbols:['btc','BTC'],widgets:['summary','holdings'],days:90});
    assert.equal(b.name,'BTC 장기');assert.deepEqual(b.symbols,['BTC']);
    const updated=await store.update(b.id,{...b,name:'BTC'},b.revision);assert.equal(updated.revision,2);
    await assert.rejects(store.update(b.id,{...b,name:'stale'},b.revision),{code:'CONFLICT'});
    await assert.rejects(store.importMany([{name:'ok'},{name:'bad',widgets:['trade']}]),{code:'INVALID_BOARD'});
    assert.equal((await store.list()).length,2);
    await assert.rejects(store.create({name:'x',days:12}),{code:'INVALID_BOARD'});
    assert.equal((await stat(store.file)).mode&0o777,0o600);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('credentials: environment wins over the config init file, which is written 0600 and validated',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'asset-kit-config-'));
  try {
    const env={ASSET_KIT_DATA_DIR:directory};
    assert.equal(resolveCredentials({env}).source,null);
    const file=await saveCredentials('file-access','file-secret',env);
    assert.equal((await stat(file)).mode&0o777,0o600);
    assert.deepEqual(resolveCredentials({env}),{accessKey:'file-access',secretKey:'file-secret',source:'file'});
    assert.equal(resolveCredentials({env:{...env,BITHUMB_ACCESS_KEY:'env-access',BITHUMB_SECRET_KEY:'env-secret'}}).source,'environment');
    await assert.rejects(saveCredentials(' padded','x',env),{code:'CONFIG_INVALID'});
    await writeFile(file,'{broken');assert.throws(()=>resolveCredentials({env}),{code:'CONFIG_INVALID'});
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('transient 5xx is retried with a fresh signature; daily candles never send credentials',async()=>{
  const calls=[];
  const provider=new BithumbProvider({accessKey:'fixture-access',secretKey:'fixture-secret',retryDelayMs:0,fetchImpl:async(url,options)=>{
    calls.push(options.headers.Authorization);
    if(url.includes('/v1/candles/days'))return Response.json([{market:'KRW-BTC',candle_date_time_utc:'2026-10-02T00:00:00',trade_price:2},{market:'KRW-BTC',candle_date_time_utc:'2026-10-01T00:00:00',trade_price:1}]);
    return calls.length<3?new Response('',{status:503}):Response.json([]);
  }});
  assert.deepEqual(await provider.getAccounts(),[]);assert.equal(calls.length,3);assert.notEqual(calls[0],calls[1]);
  const candles=await provider.getCandles('KRW-BTC',2);assert.equal(candles[0].trade_price,1);assert.equal(calls.at(-1),undefined);
  await assert.rejects(provider.getCandles('BTC-ETH',2),{code:'INVALID_MARKET'});
});
test('market view uses KRW markets only; demo history ends at the current total for any scope',async()=>{
  const s=new PortfolioService({demo:true});
  const m=await s.getMarket({symbol:'eth',days:5});assert.equal(m.market,'KRW-ETH');assert.equal(m.candles.length,5);assert.equal(m.candles.at(-1).closeKrw,'4180000');
  await assert.rejects(s.getMarket({symbol:'NONE'}),{code:'NO_KRW_MARKET'});
  const h=await s.getHistory({days:365,symbols:['BTC']});assert.equal(h.points.at(-1).totalValueKrw,'13550000');
  const d=await s.getHistory({days:30,daily:true});assert.equal(d.daily.length,30);assert.ok(d.daily.every(row=>row.changeKrw!==null));
  await assert.rejects(s.getHistory({days:400}),{code:'INVALID_RANGE'});
});
