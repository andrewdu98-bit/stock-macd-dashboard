const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const PROFILES = path.join(ROOT, 'company-profiles.json');
const OUT = path.join(ROOT, 'stock-reports.json');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function num(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function joinZh(items) {
  const arr = items.filter(Boolean);
  if (!arr.length) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]}和${arr[1]}`;
  return `${arr.slice(0, -1).join('、')}和${arr[arr.length - 1]}`;
}

function marketTone(summary) {
  const buys = summary?.buys?.length || 0;
  const sells = summary?.sells?.length || 0;
  const holds = summary?.holds?.length || 0;
  if (buys >= 2 && sells === 0) return { key: 'bullish', label: '偏强', color: 'buy' };
  if (sells >= 2) return { key: 'cautious', label: '偏弱', color: 'sell' };
  if (buys >= 1 && sells === 0) return { key: 'constructive', label: '改善中', color: 'hold' };
  if (sells >= 1 && buys === 0) return { key: 'defensive', label: '防守', color: 'sell' };
  if (holds >= 2) return { key: 'steady', label: '趋势跟踪', color: 'hold' };
  return { key: 'neutral', label: '中性观察', color: 'watch' };
}

function betaBucket(beta) {
  if (!Number.isFinite(beta)) return '未知';
  if (beta >= 1.5) return '高波动';
  if (beta >= 1.0) return '中高波动';
  if (beta >= 0.7) return '中性波动';
  return '低波动';
}

function tagsToThemes(tags) {
  return (tags || []).map((tag) => ({
    '算力': 'AI 算力',
    '服务器': '服务器基础设施',
    '能源': '能源与公用事业',
    '石油': '油气与传统能源',
    '半导体内存': '半导体与存储',
    '量子计算': '量子计算',
    '太空卫星': '太空与卫星',
    '社交媒体': '社交媒体',
    '加密货币': '加密资产',
    '国防军工': '国防军工',
    '热门股': '高热度题材',
    '消费': '消费零售',
    '科技股': '大型科技'
  }[tag] || tag));
}

function signalSentence(label, item) {
  if (!item?.signal) return `${label}暂无明确信号。`;
  const badge = item.signal.badge || item.signal.label || item.signal.key;
  if (item.signal.key === 'buy') return `${label}当前给出${badge}，短线趋势有重新启动迹象。`;
  if (item.signal.key === 'sell') return `${label}当前处在${badge}，需要优先防守节奏。`;
  if (item.signal.key === 'hold') return `${label}当前是${badge}，更像顺势跟踪状态。`;
  return `${label}当前为${badge}，还在等待更明确的确认。`;
}

function makeCatalysts(tags, signals) {
  const ideas = [];
  if ((tags || []).includes('算力') || (tags || []).includes('半导体内存')) ideas.push('关注 AI 资本开支、服务器出货和半导体景气度是否继续抬升。');
  if ((tags || []).includes('科技股')) ideas.push('留意大型科技财报指引、云支出节奏以及估值扩张是否延续。');
  if ((tags || []).includes('石油') || (tags || []).includes('能源')) ideas.push('跟踪油价、电价与宏观政策变化，这些往往决定板块弹性。');
  if ((tags || []).includes('太空卫星')) ideas.push('观察订单、发射节点、政府合同和商业化进展是否有实质催化。');
  if ((tags || []).includes('加密货币')) ideas.push('留意比特币价格、ETF 资金流和监管消息带来的放大波动。');
  if (signals?.ema?.signal?.key === 'buy') ideas.push('EMA 8/21 已经形成金叉，后续重点看能否维持在快慢线上方运行。');
  if (signals?.macd?.signal?.key === 'buy') ideas.push('MACD 已转强，后面更值得跟踪柱体是否继续放大。');
  if (!ideas.length) ideas.push('优先观察下一次财报、行业景气变化和价格是否延续当前趋势。');
  return ideas.slice(0, 3);
}

function makeRisks(beta, signals, summary) {
  const risks = [];
  if (Number.isFinite(beta) && beta >= 1.5) risks.push(`Beta 为 ${beta.toFixed(2)}，属于高波动标的，仓位控制比择时更重要。`);
  if (signals?.kdj?.signal?.badge?.includes('超买')) risks.push('KDJ 已经处在高位区，短线容易先震荡消化。');
  if (signals?.macd?.signal?.key === 'sell') risks.push('MACD 处于偏弱区，反弹如果没有量价配合，容易变成短线修复。');
  if (signals?.ema?.crossAge?.weakening) risks.push('EMA 多头结构虽然还在，但扩散度已经明显回落，趋势质量需要复核。');
  if ((summary?.sells?.length || 0) >= 2) risks.push('多个维度同时转弱，说明趋势一致性不够，追价性价比偏低。');
  if (!risks.length) risks.push('当前最大的风险不是单一信号，而是后续价格无法继续确认现有趋势。');
  return risks.slice(0, 3);
}

function reportForSymbol(symbol, bundle, profileEntry) {
  const summary = bundle.summary;
  if (!summary || summary.error) {
    return {
      symbol,
      name: profileEntry?.name || summary?.name || symbol,
      asOf: summary?.date || bundle.macd?.date || '',
      error: summary?.error || '暂无足够数据生成报告'
    };
  }

  const tags = summary.tags || [];
  const themes = tagsToThemes(tags);
  const tone = marketTone(summary);
  const price = summary.price;
  const beta = summary.beta;
  const signals = {
    macd: bundle.macd,
    ema: bundle.ema,
    kdj: bundle.kdj,
    priceCross: bundle.priceCross,
    volumeCross: bundle.volumeCross
  };

  const overview = `${profileEntry?.profile || summary.companyProfile || `${summary.name} 是一只值得继续跟踪的股票。`} 当前报告日期是 ${summary.date}，收盘价约 $${price.toFixed(2)}，Beta ${Number.isFinite(beta) ? beta.toFixed(2) : '暂无'}，整体判断偏向${tone.label}。`;
  const technical = [
    signalSentence('MACD', signals.macd),
    signalSentence('EMA 8/21', signals.ema),
    signalSentence('KDJ', signals.kdj),
    signalSentence('价格均线', signals.priceCross),
    signalSentence('量价结构', signals.volumeCross)
  ];
  const thesis = `这只股票当前更接近“${tone.label}”而不是单纯追涨或抄底。它所处的核心主题是${themes.length ? joinZh(themes.slice(0, 3)) : '常规行业'}，而当前技术面最大的看点在于${summary.signal.badge}与${joinZh((summary.crosses || []).filter((x) => x.signal.key === 'buy' || x.signal.key === 'hold').map((x) => x.label).slice(0, 2)) || '趋势延续性'}是否能够继续保持。`;
  const checklist = [
    `先确认价格是否还站在关键均线之上，目前收盘价为 $${price.toFixed(2)}。`,
    `再看 Beta 所代表的波动级别，目前属于${betaBucket(beta)}。`,
    `最后结合 ${summary.signal.badge} 与 ${summary.crosses?.length || 0} 个观察维度，判断是顺势持有还是等待更好的位置。`
  ];

  return {
    symbol,
    name: profileEntry?.name || summary.name || symbol,
    asOf: summary.date,
    price: num(price),
    beta: Number.isFinite(beta) ? num(beta, 3) : null,
    betaBucket: betaBucket(beta),
    tags,
    tone,
    profile: profileEntry?.profile || summary.companyProfile || '',
    overview,
    thesis,
    technical,
    catalysts: makeCatalysts(tags, signals),
    risks: makeRisks(beta, signals, summary),
    checklist,
    metrics: {
      macd: {
        signal: signals.macd?.signal?.badge || '',
        dif: num(signals.macd?.dif, 3),
        dea: num(signals.macd?.dea, 3),
        hist: num(signals.macd?.hist, 3)
      },
      ema: {
        signal: signals.ema?.signal?.badge || '',
        ema8: num(signals.ema?.ema8),
        ema21: num(signals.ema?.ema21),
        ema20: num(signals.ema?.ema20),
        ema50: num(signals.ema?.ema50)
      },
      kdj: {
        signal: signals.kdj?.signal?.badge || '',
        k: num(signals.kdj?.k),
        d: num(signals.kdj?.d),
        j: num(signals.kdj?.j)
      }
    }
  };
}

function main() {
  const data = loadJson(DATA);
  const profiles = loadJson(PROFILES);
  const viewMaps = Object.fromEntries(
    Object.entries(data.views || {}).map(([key, view]) => [key, new Map((view.items || []).map((item) => [item.symbol, item]))])
  );

  const reports = {};
  for (const symbol of data.watchlist || []) {
    reports[symbol] = reportForSymbol(symbol, {
      macd: viewMaps.macd?.get(symbol),
      ema: viewMaps.ema?.get(symbol),
      kdj: viewMaps.kdj?.get(symbol),
      priceCross: viewMaps.priceCross?.get(symbol),
      volumeCross: viewMaps.volumeCross?.get(symbol),
      summary: viewMaps.summary?.get(symbol)
    }, profiles.profiles?.[symbol]);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceDate: data.generatedAt,
    count: Object.keys(reports).length,
    reports
  }, null, 2) + '\n');
  console.log(`wrote ${OUT} with ${Object.keys(reports).length} reports`);
}

main();
