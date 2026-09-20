import {parseInput, normalizeReview} from './core.js';
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, {once:true});
});
export function bridgeCall(action, payload = {}, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); };
    const abort = () => { window.postMessage({channel:'tr-request', action:'abort', id}, location.origin); cleanup(); reject(signal.reason); };
    const receive = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'tr-response' || event.data.id !== id) return;
      cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.data);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(action === 'ping' ? '尚未连接油猴脚本' : '请求超时，请稍后重试。')); }, action === 'ping' ? 1200 : 35000);
    window.addEventListener('message', receive);
    signal?.addEventListener('abort', abort, {once:true});
    window.postMessage({channel:'tr-request', action, id, ...payload}, location.origin);
  });
}
export function makeTransport(mode, proxy, signal) {
  let prefix;
  if (mode === 'proxy') {
    try { prefix = new URL(proxy); } catch { throw new Error('请输入有效的 HTTPS 代理前缀。'); }
    if (prefix.protocol !== 'https:' || prefix.username || prefix.password || prefix.search || prefix.hash) throw new Error('代理前缀必须是 HTTPS 地址，不能包含账户、查询或锚点。');
  }
  return async path => {
    signal?.throwIfAborted();
    const url = 'https://api.bilibili.com' + path;
    let data;
    if (mode === 'bridge') data = await bridgeCall('request', {url}, signal);
    else {
      const timer = AbortSignal.timeout(30000);
      const response = await fetch(prefix.href.replace(/\/?$/, '/') + url, {signal: AbortSignal.any([signal, timer].filter(Boolean)), credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}，可能触发风控，请稍后再试。`);
      try { data = await response.json(); } catch { throw new Error('代理未返回 JSON，请检查地址或 B 站风控状态。'); }
    }
    if (data.code !== 0) throw new Error(`B 站接口错误 ${data.code}：${data.message || '请稍后再试'}`);
    return data;
  };
}
export async function collectReviews(type, mediaId, request, signal, progress, delay = 350) {
  const rows = [], seen = new Set(), cursors = new Set();
  let cursor = '', total = null, skipped = 0;
  for (let page = 0; page < 20000; page++) {
    signal?.throwIfAborted();
    const params = new URLSearchParams({media_id:mediaId, ps:'20'});
    if (cursor) params.set('cursor', cursor);
    const response = await request(`/pgc/review/${type}/list?${params}`);
    const data = response.data;
    if (!data || !Array.isArray(data.list)) throw new Error('评论接口返回了未知的数据结构。');
    if (Number.isFinite(Number(data.total))) total = Number(data.total);
    for (const item of data.list) {
      const row = normalizeReview(item);
      if (!row) { skipped++; continue; }
      const key = String(item.review_id ?? `${item.author?.mid}:${row.join(':')}`);
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
    progress({type, count:rows.length, total, skipped});
    const next = data.next == null ? '' : String(data.next);
    if (!next || next === '0') return {rows, total, skipped};
    if (!data.list.length || cursors.has(next)) throw new Error('评论分页停止推进，未将不完整结果保存为成功。请稍后重试。');
    cursors.add(next); cursor = next;
    await sleep(delay, signal);
  }
  throw new Error('评论数量超过安全上限，请缩小任务后重试。');
}
export async function analyze(input, request, signal, progress = () => {}) {
  const parsed = parseInput(input);
  let mediaId = parsed.id;
  if (parsed.type !== 'md') {
    const param = parsed.type === 'ep' ? 'ep_id' : 'season_id';
    const season = await request(`/pgc/view/web/season?${param}=${parsed.id}`);
    mediaId = String(season.result?.media_id ?? '');
    if (!/^\d+$/.test(mediaId)) throw new Error('无法将 EP / SS 转换为 MD 编号。');
  }
  const base = await request(`/pgc/review/user?media_id=${mediaId}`);
  const media = base.result?.media;
  if (!media?.title) throw new Error('番剧不存在或暂时无法获取。');
  const short = await collectReviews('short', mediaId, request, signal, progress);
  const long = await collectReviews('long', mediaId, request, signal, progress);
  return {version:1, mediaId, title:media.title, officialScore:media.rating?.score ?? null, officialCount:media.rating?.count ?? null, totals:{short:short.total,long:long.total}, short:short.rows, long:long.rows, timestamp:new Date().toISOString(), complete:true};
}
