const OWNER_REPO = process.env.GITHUB_REPO || 'andrewdu98-bit/stock-macd-dashboard';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const WATCHLIST_PATH = process.env.WATCHLIST_PATH || 'watchlist.txt';
const WORKFLOW_ID = process.env.WORKFLOW_ID || 'update-data.yml';

function normalizeSymbols(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input || '');
  const seen = new Set();
  return raw.split(/[\s,;，、]+/)
    .map(s => s.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, ''))
    .filter(Boolean)
    .filter(s => !seen.has(s) && seen.add(s));
}
function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Server missing GITHUB_TOKEN');
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'accept': 'application/vnd.github+json',
      'authorization': `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'stock-macd-dashboard-vercel',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(json?.message || `GitHub ${r.status}`);
  return json;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' });
  try {
    const password = req.body?.password || req.headers['x-dashboard-password'];
    if (!process.env.SHARED_PASSWORD) throw new Error('Server missing SHARED_PASSWORD');
    if (password !== process.env.SHARED_PASSWORD) return send(res, 401, { ok: false, error: '共享密码不对' });

    const symbols = normalizeSymbols(req.body?.symbols);
    if (!symbols.length) return send(res, 400, { ok: false, error: '股票列表为空' });
    if (symbols.length > 250) return send(res, 400, { ok: false, error: '股票太多了，先限制 250 个以内' });
    if (symbols.some(s => s.length > 12)) return send(res, 400, { ok: false, error: '存在异常股票代码' });

    const [owner, repo] = OWNER_REPO.split('/');
    const encodedPath = WATCHLIST_PATH.split('/').map(encodeURIComponent).join('/');
    const current = await gh(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(BRANCH)}`);
    const content = symbols.join('\n') + '\n';
    const message = `Update public watchlist (${symbols.length} symbols)`;
    await gh(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha: current.sha, branch: BRANCH })
    });

    await gh(`/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(WORKFLOW_ID)}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: BRANCH })
    });

    return send(res, 200, { ok: true, symbols, count: symbols.length, message: '已更新公共列表并触发数据刷新，通常 1-2 分钟后生效。' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message || String(e) });
  }
};
