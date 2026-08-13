const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WATCHLIST = path.join(ROOT, 'watchlist.txt');
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const MANIFEST = path.join(HISTORY_DIR, 'manifest.json');
const TEN_YEARS_MS = 365.25 * 10 * 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const CONCURRENCY = Math.max(1, Number(process.env.HISTORY_CONCURRENCY || 4));

function readWatchlist(){
  return fs.readFileSync(WATCHLIST, 'utf8')
    .split(/\r?\n/)
    .map(s => s.trim().toUpperCase())
    .filter(s => s && !s.startsWith('#'));
}
function safeFile(symbol){return symbol.replace(/[^A-Z0-9.^-]/g, '_') + '.json'}
function parseDateMs(date){return Date.parse(date + 'T00:00:00Z')}
function toUnixSeconds(ms){return Math.floor(ms / 1000)}
function sleep(ms){return new Promise(resolve => setTimeout(resolve, ms))}
function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(file, 'utf8'))}catch{return fallback}}
function atomicWriteJson(file, data){
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
function entryFromFile(symbol){
  const file = path.join(HISTORY_DIR, safeFile(symbol));
  const j = readJson(file, null);
  if(!j?.rows?.length) return null;
  return {symbol, ok:true, file:`data/history/${safeFile(symbol)}`, rows:j.rows.length, start:j.start || j.rows[0]?.date || null, end:j.end || j.rows[j.rows.length - 1]?.date || null};
}
function adjustYahooRows(rows){
  return rows.map(row => {
    const close = Number(row.close);
    const adjClose = Number(row.adjClose);
    const ratio = Number.isFinite(close) && close !== 0 && Number.isFinite(adjClose) ? adjClose / close : 1;
    return {
      date: row.date,
      open: Number(row.open) * ratio,
      high: Number(row.high) * ratio,
      low: Number(row.low) * ratio,
      close: Number.isFinite(adjClose) ? adjClose : Number(row.close),
      volume: Number(row.volume)
    };
  });
}
function mergeRows(existingRows, incomingRows, cutoffMs){
  const byDate = new Map();
  for(const row of [...(existingRows||[]), ...(incomingRows||[])]){
    if(!row || !row.date || parseDateMs(row.date) < cutoffMs) continue;
    const clean = {
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume)
    };
    if([clean.open, clean.high, clean.low, clean.close, clean.volume].every(Number.isFinite)) byDate.set(clean.date, clean);
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date));
}
async function fetchYahooRows(symbol, period1, period2){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%2Csplits`;
  const r = await fetch(url, {headers:{'user-agent':USER_AGENT}});
  if(!r.ok) throw new Error(`Yahoo ${r.status}`);
  const j = await r.json();
  const x = j.chart?.result?.[0];
  if(!x?.timestamp?.length) throw new Error('no chart data');
  const q = x.indicators?.quote?.[0] || {};
  const adj = x.indicators?.adjclose?.[0]?.adjclose || [];
  return adjustYahooRows(x.timestamp.map((t,i) => ({
    date: new Date(t * 1000).toISOString().slice(0,10),
    open: q.open?.[i],
    high: q.high?.[i],
    low: q.low?.[i],
    close: q.close?.[i],
    adjClose: adj[i],
    volume: q.volume?.[i]
  }))).filter(row => [row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite));
}
async function updateSymbol(symbol){
  const file = path.join(HISTORY_DIR, safeFile(symbol));
  const existing = readJson(file, null);
  const nowMs = Date.now();
  const cutoffMs = nowMs - TEN_YEARS_MS;
  const period2 = toUnixSeconds(nowMs + 2 * 24 * 60 * 60 * 1000);
  let period1 = toUnixSeconds(cutoffMs - 7 * 24 * 60 * 60 * 1000);
  const existingRows = existing?.rows || [];
  const lastDate = existingRows.length ? existingRows[existingRows.length - 1].date : null;
  if(lastDate){
    period1 = toUnixSeconds(Math.max(cutoffMs, parseDateMs(lastDate) - 7 * 24 * 60 * 60 * 1000));
  }
  const rows = await fetchYahooRows(symbol, period1, period2);
  const merged = mergeRows(existingRows, rows, cutoffMs);
  const payload = {
    symbol,
    source: 'Yahoo Finance chart API, daily OHLCV, split/dividend adjusted by Yahoo chart endpoint',
    updatedAt: new Date().toISOString(),
    start: merged[0]?.date || null,
    end: merged[merged.length - 1]?.date || null,
    rows: merged
  };
  atomicWriteJson(file, payload);
  return {symbol, ok:true, file:`data/history/${safeFile(symbol)}`, rows:merged.length, start:payload.start, end:payload.end};
}
async function worker(queue, results){
  while(queue.length){
    const symbol = queue.shift();
    try{
      results.push(await updateSymbol(symbol));
      process.stdout.write('.');
    }catch(e){
      results.push({symbol, ok:false, error:e.message || String(e)});
      process.stdout.write('x');
    }
    await sleep(150);
  }
}
(async () => {
  const args = process.argv.slice(2);
  const argSymbols = args.find(a => a.startsWith('--symbols='))?.slice('--symbols='.length);
  const symbols = (argSymbols ? argSymbols.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean) : readWatchlist())
    .filter((s,i,a) => a.indexOf(s) === i);
  fs.mkdirSync(HISTORY_DIR, {recursive:true});
  const queue = symbols.slice();
  const results = [];
  console.log(`updating ${symbols.length} history files with concurrency ${CONCURRENCY}`);
  await Promise.all(Array.from({length:Math.min(CONCURRENCY, symbols.length)}, () => worker(queue, results)));
  console.log('\nwriting manifest');
  const resultBySymbol = new Map(results.map(x => [x.symbol, x]));
  const manifestSymbols = readWatchlist().map(symbol => resultBySymbol.get(symbol) || entryFromFile(symbol) || {symbol, ok:false, error:'history not generated'});
  const sorted = manifestSymbols.sort((a,b) => a.symbol.localeCompare(b.symbol));
  atomicWriteJson(MANIFEST, {
    generatedAt: new Date().toISOString(),
    lookbackYears: 10,
    count: sorted.length,
    ok: sorted.filter(x=>x.ok).length,
    failed: sorted.filter(x=>!x.ok).length,
    symbols: sorted
  });
  const failed = sorted.filter(x=>!x.ok);
  console.log(`history ok=${sorted.length-failed.length} failed=${failed.length}`);
  if(failed.length){
    console.log(failed.slice(0,20).map(x => `${x.symbol}: ${x.error}`).join('\n'));
  }
  if(sorted.length && failed.length === sorted.length) process.exitCode = 1;
})();
