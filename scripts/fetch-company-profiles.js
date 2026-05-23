const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'company-profiles.json');
const DATA = path.join(ROOT, 'data.json');
const USER_AGENT = 'Mozilla/5.0';
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'NYSEArca', 'BATS Trading', 'NYSE American']);
const translationCache = new Map();

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
  'Memory Chips': '存储芯片'
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

async function main() {
  const { watchlist, latestSummary, latestMacd } = loadBaseData();
  const result = {};
  for (let i = 0; i < watchlist.length; i += 1) {
    const symbol = watchlist[i];
    const fallback = latestSummary.get(symbol) || latestMacd.get(symbol) || { symbol, name: symbol };
    try {
      const quote = await fetchSearch(symbol);
      result[symbol] = {
        symbol,
        name: normalizeName(symbol, quote, fallback),
        exchange: quote?.exchDisp || '',
        quoteType: quote?.quoteType || '',
        sector: quote?.sectorDisp || quote?.sector || '',
        industry: quote?.industryDisp || quote?.industry || '',
        profile: await buildProfile(symbol, quote, fallback)
      };
    } catch (error) {
      result[symbol] = {
        symbol,
        name: fallback.name || symbol,
        profile: fallback.companyProfile || `${fallback.name || symbol}，是在美国上市的公司。`,
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
