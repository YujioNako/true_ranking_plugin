// Derived from TamperMonkey-trueRanking.js by YujioNako & 看你看过的霓虹.
export const SCORES = [2, 4, 6, 8, 10];
export function parseInput(value) {
  const input = String(value).trim();
  if (/^\d+$/.test(input)) return { type: 'md', id: input };
  const bare = input.match(/^(md|ep|ss)(\d+)$/i);
  if (bare) return { type: bare[1].toLowerCase(), id: bare[2] };
  try {
    const url = new URL(input);
    if (!['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname) || !['https:', 'http:'].includes(url.protocol)) throw 0;
    const match = url.pathname.match(/^\/bangumi\/(?:media|play)\/(md|ep|ss)(\d+)\/?$/i);
    if (match) return { type: match[1].toLowerCase(), id: match[2] };
  } catch { /* show a useful validation error */ }
  throw new Error('请输入 md / ep / ss 编号或完整番剧链接；b23.tv 短链接请先在浏览器展开。');
}
export function filterRows(rows, level) {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error('过滤等级必须为 0–6 的整数。');
  return rows.filter(r => r[1] >= level);
}
export function summarize(rows) {
  const count = rows.length;
  const counts = SCORES.map(score => rows.reduce((n, r) => n + (r[0] === score ? 1 : 0), 0));
  return { count, average: count ? rows.reduce((s, r) => s + r[0], 0) / count : null, counts, percentages: counts.map(n => count ? n / count * 100 : 0) };
}
// Original normal-approximation formula, retained as a model estimate, NOT a confidence guarantee.
export function probability(rows, population) {
  const n = rows.length;
  if (n < 2 || !Number.isFinite(population) || population <= 0) return null;
  if (n >= population) return 1;
  const mean = summarize(rows).average;
  const variance = rows.reduce((s, r) => s + (r[0] - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n * (population - n) / (population - 1));
  if (!se) return 1;
  const x = 0.1 / se / Math.sqrt(2), t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.max(0, Math.min(1, 1 - y * Math.exp(-x * x)));
}
export function trend(rows) {
  const valid = rows.filter(r => Number.isFinite(r[2]) && r[2] > 0).sort((a, b) => a[2] - b[2]);
  if (!valid.length) return [];
  const min = valid[0][2], max = Math.min(valid.at(-1)[2], min + 2 * 365 * 86400);
  if (min === max) return [{ time: min, average: summarize(valid).average }];
  let pos = 0, sum = 0;
  return Array.from({ length: 8 }, (_, i) => {
    const end = min + (max - min) * (i + 1) / 8;
    while (pos < valid.length && valid[pos][2] <= end) sum += valid[pos++][0];
    return { time: end, average: pos ? sum / pos : null };
  });
}
export function normalizeReview(item) {
  const score = Number(item.score), level = Number(item.author?.level), time = Number(item.ctime);
  if (!SCORES.includes(score) || !Number.isInteger(level) || level < 0 || level > 6 || !Number.isFinite(time) || time < 0) return null;
  return [score, level, time];
}
export function validateDataset(value) {
  if (!value || value.version !== 1 || !/^\d+$/.test(value.mediaId) || typeof value.title !== 'string' || value.title.length > 500 || !Number.isFinite(Date.parse(value.timestamp))) throw new Error('不是有效的 True Ranking 数据文件。');
  for (const type of ['short', 'long']) {
    if (!Array.isArray(value[type]) || value[type].length > 500000 || !value[type].every(r => Array.isArray(r) && r.length === 3 && SCORES.includes(r[0]) && Number.isInteger(r[1]) && r[1] >= 0 && r[1] <= 6 && Number.isFinite(r[2]) && r[2] >= 0 && r[2] < 8640000000000)) throw new Error('评论数据格式无效。');
  }
  const numberOrNull = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  return { version: 1, mediaId: String(value.mediaId), title: value.title, timestamp: value.timestamp, officialScore: numberOrNull(value.officialScore), officialCount: numberOrNull(value.officialCount), totals: {short: numberOrNull(value.totals?.short), long: numberOrNull(value.totals?.long)}, short: value.short, long: value.long, complete: value.complete === true };
}
