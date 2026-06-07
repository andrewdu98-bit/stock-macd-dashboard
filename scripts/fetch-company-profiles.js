const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'company-profiles.json');
const DATA = path.join(ROOT, 'data.json');
const USER_AGENT = 'Mozilla/5.0';
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'NYSEArca', 'BATS Trading', 'NYSE American']);
const translationCache = new Map();
const FUNDAMENTAL_TYPES = ['annualTotalRevenue', 'annualGrossProfit', 'annualOperatingIncome', 'annualNetIncome'];

const SECTOR_MAP = {
  'Technology': '科技',
  'Consumer Defensive': '必需消费',
  'Consumer Cyclical': '可选消费',
  'Communication Services': '通信服务',
  'Industrials': '工业',
  'Financial Services': '金融服务',
  'Healthcare': '医疗健康',
  'Energy': '能源',
  'Utilities': '公用事业',
  'Basic Materials': '基础材料',
  'Real Estate': '房地产'
};

const INDUSTRY_MAP = {
  'Semiconductors': '半导体',
  'Semiconductor Equipment & Materials': '半导体设备与材料',
  'Consumer Electronics': '消费电子',
  'Discount Stores': '折扣零售',
  'Internet Content & Information': '互联网内容与信息服务',
  'Aerospace & Defense': '航空航天与国防',
  'Oil & Gas E&P': '油气勘探与生产',
  'Oil & Gas Refining & Marketing': '炼油与成品油销售',
  'Oil & Gas Equipment & Services': '油服与能源设备',
  'Software - Infrastructure': '基础软件与云基础设施',
  'Software - Application': '应用软件',
  'Electronic Components': '电子元件',
  'Communication Equipment': '通信设备',
  'Memory Chips': '存储芯片',
  'Diagnostics & Research': '诊断与研究',
  'Drug Manufacturers—General': '综合制药',
  'Biotechnology': '生物科技'
};

const THEME_HINTS = {
  '算力': 'AI 算力与高性能计算',
  '服务器': '服务器与数据中心基础设施',
  '能源': '电力与能源基础设施',
  '石油': '原油与传统能源',
  '半导体内存': '半导体与存储芯片',
  '量子计算': '量子计算',
  '太空卫星': '太空与卫星通信',
  '社交媒体': '社交媒体与互联网平台',
  '加密货币': '加密资产与相关金融服务',
  '国防军工': '国防军工',
  '热门股': '高热度成长题材',
  '消费': '消费零售',
  '科技股': '大型科技与数字化服务'
};

function loadBaseData() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const latestSummary = new Map(
    (data.views?.summary?.items || []).map((item) => [item.symbol, item])
  );
  const latestMacd = new Map(
    (data.views?.macd?.items || []).map((item) => [item.symbol, item])
  );
  return { watchlist: data.watchlist || [], latestSummary, latestMacd };
}

async function fetchSearch(symbol) {
  const url =
    'https://query1.finance.yahoo.com/v1/finance/search?q=' +
    encodeURIComponent(symbol) +
    '&quotesCount=10&newsCount=0';
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = await res.json();
  const quotes = json.quotes || [];
  const trusted = quotes.filter((quote) => quote.symbol === symbol && US_EXCHANGES.has(quote.exchDisp || ''));
  return (
    trusted[0] ||
    quotes.find((quote) => quote.symbol === symbol) ||
    quotes.find((quote) => quote.quoteType === 'EQUITY') ||
    quotes.find((quote) => quote.quoteType === 'ETF') ||
    quotes[0] ||
    null
  );
}

async function fetchFundamentals(symbol) {
  const period1 = 1577836800;
  const period2 = 1812153600;
  const url =
    'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' +
    encodeURIComponent(symbol) +
    '?type=' + FUNDAMENTAL_TYPES.join(',') +
    `&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fundamentals ${res.status}`);
  const json = await res.json();
  return json.timeseries?.result || [];
}

function latestSeriesValue(result, key) {
  const row = result.find((item) => Array.isArray(item[key]) && item[key].length);
  if (!row) return null;
  const values = row[key]
    .map((entry) => ({
      asOfDate: entry.asOfDate,
      raw: entry.reportedValue?.raw
    }))
    .filter((entry) => Number.isFinite(entry.raw))
    .sort((a, b) => String(a.asOfDate).localeCompare(String(b.asOfDate)));
  if (!values.length) return null;
  return { latest: values[values.length - 1], prev: values[values.length - 2] || null };
}

function ratio(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function yoy(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return cur / prev - 1;
}

function fmtPct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '暂无';
}

function fmtUsdYi(value) {
  if (!Number.isFinite(value)) return '暂无';
  return `${(value / 1e8).toFixed(1)}亿美元`;
}

function buildFinancialSnapshot(result) {
  const revenue = latestSeriesValue(result, 'annualTotalRevenue');
  const gross = latestSeriesValue(result, 'annualGrossProfit');
  const op = latestSeriesValue(result, 'annualOperatingIncome');
  const net = latestSeriesValue(result, 'annualNetIncome');
  const revenueRaw = revenue?.latest?.raw ?? null;
  const prevRevenueRaw = revenue?.prev?.raw ?? null;
  const grossRaw = gross?.latest?.raw ?? null;
  const opRaw = op?.latest?.raw ?? null;
  const netRaw = net?.latest?.raw ?? null;
  return {
    asOfDate: revenue?.latest?.asOfDate || gross?.latest?.asOfDate || op?.latest?.asOfDate || net?.latest?.asOfDate || '',
    revenue: revenueRaw,
    revenuePrev: prevRevenueRaw,
    revenueYoY: yoy(revenueRaw, prevRevenueRaw),
    grossProfit: grossRaw,
    operatingIncome: opRaw,
    netIncome: netRaw,
    grossMargin: ratio(grossRaw, revenueRaw),
    operatingMargin: ratio(opRaw, revenueRaw),
    netMargin: ratio(netRaw, revenueRaw)
  };
}

function normalizeName(symbol, quote, fallback) {
  return (
    quote?.longname ||
    quote?.shortname ||
    fallback?.name ||
    symbol
  );
}

async function translateText(text) {
  const key = String(text || '').trim();
  if (!key) return '';
  if (translationCache.has(key)) return translationCache.get(key);
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' +
    encodeURIComponent(key);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  const json = await res.json();
  const out = (json?.[0] || []).map((part) => part?.[0] || '').join('') || key;
  translationCache.set(key, out);
  return out;
}

async function translateTerm(term) {
  if (!term) return '';
  if (INDUSTRY_MAP[term]) return INDUSTRY_MAP[term];
  if (SECTOR_MAP[term]) return SECTOR_MAP[term];
  return translateText(term);
}

function inferProducts(industry, tags, quoteType) {
  if (quoteType === 'ETF') return '相关主题、行业或资产类别的投资敞口';
  const items = [];
  if (/半导体|存储|电子元件/i.test(industry)) items.push('芯片、存储器件和相关半导体解决方案');
  if (/软件|云|Infrastructure|Application/i.test(industry)) items.push('企业软件、云平台和数字化服务');
  if (/折扣零售|消费电子产品|Internet Content|社交/i.test(industry)) items.push('面向消费者的硬件、平台或零售服务');
  if (/航空航天|国防/i.test(industry)) items.push('航天、卫星或国防相关系统');
  if (/油气|炼油|能源设备/i.test(industry)) items.push('原油、天然气或能源相关产品与服务');
  if ((tags || []).includes('算力')) items.push('AI 算力平台与数据中心相关产品');
  if ((tags || []).includes('服务器')) items.push('服务器与数据中心基础设施');
  if ((tags || []).includes('加密货币')) items.push('加密资产交易、托管或相关金融产品');
  if ((tags || []).includes('太空卫星')) items.push('太空、卫星或航天基础设施服务');
  return items[0] || '核心行业相关产品与服务';
}

function isTrustedUsQuote(quote) {
  return !!(quote && US_EXCHANGES.has(quote.exchDisp || ''));
}

async function buildProfile(symbol, quote, fallback) {
  const name = normalizeName(symbol, quote, fallback);
  const tags = fallback?.tags || [];
  const trustedQuote = isTrustedUsQuote(quote);
  if (!trustedQuote && fallback?.companyProfile) return fallback.companyProfile;
  const sector = await translateTerm(quote?.sectorDisp || quote?.sector || '');
  const industry = await translateTerm(quote?.industryDisp || quote?.industry || '');
  const exchange = quote?.exchDisp || '';
  const quoteType = quote?.quoteType || '';
  const theme = tags.map((tag) => THEME_HINTS[tag]).filter(Boolean);

  if (quoteType === 'ETF') {
    if (theme.length) {
      return `${name}，是在${exchange || '美国'}上市的 ETF，主要提供${theme.slice(0, 2).join('、')}方向的市场敞口。`;
    }
    return `${name}，是在${exchange || '美国'}上市的 ETF，用来跟踪一篮子资产或某个主题指数。`;
  }

  if (quoteType === 'MUTUALFUND') {
    return `${name}，是一只在${exchange || '美国'}交易的基金产品，主要提供特定资产配置或主题投资敞口。`;
  }

  if (sector && industry) {
    return `${name}，在${exchange || '美国'}上市，属于${sector}板块，细分行业是${industry}，主要业务围绕${industry}展开。`;
  }

  if (sector) {
    return `${name}，在${exchange || '美国'}上市，属于${sector}板块，主营业务与${sector}相关。`;
  }

  if (theme.length) {
    return `${name}，是在美国上市的公司，当前更偏向${theme.slice(0, 2).join('、')}方向。`;
  }

  return fallback?.companyProfile || `${name}，是在美国上市的公司。`;
}

function buildRichProfile(name, quote, fallback, financials) {
  const tags = fallback?.tags || [];
  const industry = INDUSTRY_MAP[quote?.industry] || INDUSTRY_MAP[quote?.industryDisp] || quote?.industryDisp || quote?.industry || '';
  const sector = SECTOR_MAP[quote?.sector] || SECTOR_MAP[quote?.sectorDisp] || quote?.sectorDisp || quote?.sector || '';
  const exchange = quote?.exchDisp || '美国';
  const quoteType = quote?.quoteType || '';
  const products = inferProducts(industry, tags, quoteType);

  if (quoteType === 'ETF') {
    return `${name} 是在${exchange}上市的 ETF，主要提供${products}。由于这类产品本质上是资产组合工具，不适合用企业营收和利润率来衡量，跟踪时更适合看其对应主题、持仓方向、资金流以及价格趋势是否持续。`;
  }

  const revenue = fmtUsdYi(financials.revenue);
  const yoyText = Number.isFinite(financials.revenueYoY) ? `，同比${financials.revenueYoY >= 0 ? '增长' : '下滑'}${Math.abs(financials.revenueYoY * 100).toFixed(1)}%` : '';
  const grossMargin = fmtPct(financials.grossMargin);
  const opMargin = fmtPct(financials.operatingMargin);
  const netMargin = fmtPct(financials.netMargin);
  const profitState = Number.isFinite(financials.netIncome)
    ? (financials.netIncome > 0 ? `净利润约${fmtUsdYi(financials.netIncome)}` : `净利润仍为亏损${fmtUsdYi(Math.abs(financials.netIncome))}`)
    : '净利润数据暂缺';
  const sectorText = sector ? `，属于${sector}板块` : '';
  const industryText = industry ? `，细分行业是${industry}` : '';

  return `${name} 在${exchange}上市${sectorText}${industryText}，主营${products}。从最新年度口径看，公司营收约${revenue}${yoyText}，${profitState}。如果按本地计算口径看，毛利率约${grossMargin}、营业利润率约${opMargin}、净利率约${netMargin}，可以帮助快速判断这家公司当前更像高成长、高盈利，还是仍在投入扩张阶段。`;
}

async function main() {
  const { watchlist, latestSummary, latestMacd } = loadBaseData();
  const result = {};
  for (let i = 0; i < watchlist.length; i += 1) {
    const symbol = watchlist[i];
    const fallback = latestSummary.get(symbol) || latestMacd.get(symbol) || { symbol, name: symbol };
    try {
      const quote = await fetchSearch(symbol);
      const fundamentals = (quote?.quoteType === 'EQUITY' || quote?.quoteType === 'MUTUALFUND')
        ? await fetchFundamentals(symbol).catch(() => [])
        : [];
      const financials = buildFinancialSnapshot(fundamentals);
      const shortProfile = await buildProfile(symbol, quote, fallback);
      result[symbol] = {
        symbol,
        name: normalizeName(symbol, quote, fallback),
        exchange: quote?.exchDisp || '',
        quoteType: quote?.quoteType || '',
        sector: quote?.sectorDisp || quote?.sector || '',
        industry: quote?.industryDisp || quote?.industry || '',
        profile: buildRichProfile(normalizeName(symbol, quote, fallback), quote, fallback, financials),
        shortProfile,
        financials
      };
    } catch (error) {
      result[symbol] = {
        symbol,
        name: fallback.name || symbol,
        profile: fallback.companyProfile || `${fallback.name || symbol}，是在美国上市的公司。`,
        shortProfile: fallback.companyProfile || `${fallback.name || symbol}，是在美国上市的公司。`,
        error: error.message || String(error)
      };
    }
    if ((i + 1) % 50 === 0 || i === watchlist.length - 1) {
      console.log(`profiles ${i + 1}/${watchlist.length}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: Object.keys(result).length,
    profiles: result
  }, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
