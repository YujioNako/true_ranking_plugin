import plugin from '../../lib/plugins/plugin.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

// 单文件安装：复制到 Yunzai 的 plugins/example/true_ranking.js 后重启。
// 模板自动生成，图片由宿主 lib/puppeteer/puppeteer.js 负责渲染和消息封装。
// 每次查询读取 data/cha_chengfen/bilibili_cookies.txt；BILIBILI_COOKIE 可覆盖。
// BILIBILI_COOKIE_FILE 可指定其他文件；不要通过群聊提交 Cookie。
const CONFIG = Object.freeze({ filterLevel: 5, requestInterval: 3000, timeout: 30000, maxPages: 10000, checkpointPages: 10 })
const SCORES = [2, 4, 6, 8, 10]
// Keep cancellation handles and the shared request clock across hot reloads.
const runtimeKey = Symbol.for('true-ranking.recovery.v1')
const runtime = globalThis[runtimeKey] ||= { jobs: new Map(), nextRequestAt: 0, cooldownUntil: 0 }
const templateWrites = new Map()
const cancelled = () => Object.assign(new Error('已取消采集，进度已保留。'), { name: 'AbortError' })
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
class RequestError extends Error {
  constructor(message, kind = 'fatal', retryAfter = 0) { super(message); this.kind = kind; this.retryAfter = retryAfter }
}
const count = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
const score = value => Number.isFinite(value) ? value.toFixed(1) : '暂无'
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null

function parseCommand(message) {
  let input = String(message).replace(/^#?番剧评分\s*/, '').trim()
  let filterLevel = CONFIG.filterLevel
  const match = input.match(/(?:^|\s)(?:等级|过滤|lv)\s*(\d+)\s*$/i)
  if (match) {
    filterLevel = Number(match[1]); input = input.slice(0, match.index).trim()
    if (!Number.isInteger(filterLevel) || filterLevel < 0 || filterLevel > 6) throw new Error('过滤等级必须是 0–6，例如：#番剧评分 md4315402 等级5')
  }
  if (!input) throw new Error('请输入番剧编号。例如：#番剧评分 md4315402；发送 #番剧评分帮助 查看用法。')
  return { input, filterLevel }
}

function parseTarget(input) {
  const raw = String(input).trim()
  const id = raw.match(/^(md|ep|ss)?(\d{1,30})$/i)
  if (id) return { type: (id[1] || 'md').toLowerCase(), id: id[2] }
  const link = raw.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[，。！、）)]+$/, '')
  if (link) {
    let url
    try { url = new URL(link) } catch { throw new Error('番剧链接格式无效。') }
    if (url.username || url.password || url.port || !['www.bilibili.com','bilibili.com','m.bilibili.com','b23.tv'].includes(url.hostname)) throw new Error('只接受 B 站番剧链接或 b23.tv 分享链接。')
    url.protocol = 'https:'
    if (url.hostname === 'b23.tv') return { type: 'short', url: url.href }
    const match = url.pathname.match(/^\/bangumi\/(?:media|play)\/(md|ep|ss)(\d{1,30})\/?$/i)
    if (match) return { type: match[1].toLowerCase(), id: match[2] }
  }
  throw new Error('请输入有效的 MD / EP / SS 编号或番剧分享链接。')
}

async function loadCookie(options = {}) {
  const validate = value => {
    if (typeof value !== 'string' || /[\r\n]/.test(value.trim())) throw new Error('B 站 Cookie 配置格式无效，请管理员检查。')
    return value.trim()
  }
  if (options.cookie !== undefined) return validate(options.cookie)
  if (process.env.BILIBILI_COOKIE) return validate(process.env.BILIBILI_COOKIE)
  const configuredFile = options.cookieFile ?? process.env.BILIBILI_COOKIE_FILE
  const file = configuredFile || path.join(process.cwd(),'data','cha_chengfen','bilibili_cookies.txt')
  let handle
  try {
    handle = await fs.open(file,'r')
    // Read a bounded amount, including when another plugin refreshes the file.
    const buffer = Buffer.alloc(65537)
    const { bytesRead } = await handle.read(buffer,0,buffer.length,0)
    if (bytesRead > 65536) throw new Error('B 站 Cookie 文件过大，请管理员检查。')
    const value = validate(buffer.subarray(0,bytesRead).toString('utf8'))
    if (!value || !value.includes('=') || value === '{}') throw new Error('B 站 Cookie 文件为空或尚未配置，请先更新「查成分」的 Cookie。')
    return value
  } catch (error) {
    if (error.code === 'ENOENT' && !configuredFile) return ''
    if (error.code) throw new Error('无法读取 B 站 Cookie 文件，请管理员检查路径和权限。')
    throw error
  } finally { await handle?.close() }
}

async function createClient(options = {}) {
  const fetcher = options.fetchImpl || globalThis.fetch || (await import('node-fetch')).default
  let cookie = await loadCookie(options)
  const interval = options.interval ?? CONFIG.requestInterval
  const clock = options.now || Date.now, sleep = options.sleep || delay
  const shared = options.runtime || (options.recovery ? runtime : { nextRequestAt:0, cooldownUntil:0 }), signal = options.signal
  let riskRetries = 0, transientRetries = 0
  const check = () => { if (signal?.aborted) throw cancelled() }
  async function pace() {
    // Recheck after waking: another task may have encountered a risk response.
    for (;;) {
      check()
      const wait = Math.max(shared.nextRequestAt, shared.cooldownUntil) - clock()
      if (wait > 0) { await sleep(wait, signal); continue }
      shared.nextRequestAt = clock() + interval
      return
    }
  }
  async function getOnce(url, useCookie, handler) {
    await pace()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeout ?? CONFIG.timeout)
    try {
      check()
      const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' }
      if (useCookie && cookie) headers.Cookie = cookie
      const response = await fetcher(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal })
      check()
      const hint = response.headers?.get('retry-after')
      const retryAfter = hint ? Math.max(0, /^\d+$/.test(hint) ? Number(hint)*1000 : Date.parse(hint)-clock()) || 0 : 0
      if ([412,429].includes(response.status)) throw new RequestError(`B 站触发风控（HTTP ${response.status}）。`, 'risk', retryAfter)
      if ([401,403].includes(response.status)) throw new RequestError(`B 站拒绝访问（HTTP ${response.status}），请管理员检查登录会话及访问权限。`)
      if (response.status === 408 || response.status >= 500) throw new RequestError(`B 站接口暂时不可用（HTTP ${response.status}）。`, 'transient', retryAfter)
      return await handler(response)
    } catch (error) {
      check()
      if (controller.signal.aborted) throw new RequestError('B 站接口请求超时。', 'transient')
      // Never expose request options, Cookie, raw upstream bodies or fetch errors.
      if (error instanceof TypeError || error?.name === 'FetchError') throw new RequestError('连接 B 站失败。', 'transient')
      throw error
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  async function get(url, useCookie, handler) {
    let attempt = 0
    for (;;) {
      try { return await getOnce(url, useCookie, handler) } catch (error) {
        if (!['risk','transient'].includes(error.kind)) throw error
        const risk = error.kind === 'risk'
        const waits = risk ? [120000,300000] : [5000,15000,45000]
        const index = risk ? riskRetries : attempt
        const exhausted = !options.recovery || index >= waits.length || (!risk && transientRetries >= 10)
        const wait = Math.max(error.retryAfter || 0, waits[Math.min(index,waits.length-1)])
        // Shared pacing also protects other users querying through this plugin.
        shared.cooldownUntil = Math.max(shared.cooldownUntil, clock()+wait)
        error.resumeAfter = shared.cooldownUntil
        if (exhausted || wait > 900000) throw error
        if (risk) riskRetries++; else { attempt++; transientRetries++ }
        await options.onRetry?.({ error, wait, resumeAfter: error.resumeAfter })
        await sleep(wait, signal)
        check()
        // The shared file may have been refreshed while waiting.
        cookie = await loadCookie(options)
      }
    }
  }
  return {
    async request(apiPath) {
      const url = new URL(apiPath, 'https://api.bilibili.com')
      if (url.origin !== 'https://api.bilibili.com' || !['/pgc/review/user','/pgc/review/short/list','/pgc/review/long/list','/pgc/view/web/season'].includes(url.pathname)) throw new Error('拒绝非番剧接口请求。')
      return get(url.href, true, async response => {
        if (!response.ok) throw new RequestError(`B 站接口返回 HTTP ${response.status}，统计未完成。`)
        let result
        try { result = await response.json() } catch { throw new RequestError('B 站未返回有效 JSON，可能需要处理站内验证。') }
        if (!result || typeof result.code !== 'number') throw new RequestError('B 站接口数据结构异常。')
        if ([-352,-412,-509].includes(result.code)) throw new RequestError(`B 站触发风控（${result.code}）。`, 'risk')
        if (result.code === -101) throw new RequestError('B 站登录会话失效，请管理员更新共享 Cookie 文件或 BILIBILI_COOKIE。')
        if (result.code !== 0) throw new RequestError(`B 站接口返回错误码 ${result.code}，统计未完成。`)
        return result
      })
    },
    async expand(url) {
      let target = parseTarget(url)
      for (let i = 0; i < 5 && target.type === 'short'; i++) {
        const current = target.url
        target = await get(current, false, async response => {
          const location = response.headers.get('location')
          if (![301,302,303,307,308].includes(response.status) || !location) throw new Error('无法展开分享链接，请直接发送 MD / EP / SS 编号。')
          return parseTarget(new URL(location, current).href)
        })
      }
      if (target.type === 'short') throw new Error('分享链接跳转过多，请直接发送番剧编号。')
      return target
    }
  }
}

const emptyCollection = () => ({ rows: [], seen: [], cursors: [], cursor: '', total: null, skipped: 0, pages: 0, done: false })
function reviewKey(item) {
  const value = Number(item.score), level = Number(item.author?.level), time = Number(item.ctime)
  const row = [value, Number.isInteger(level) && level >= 0 && level <= 6 && item.author?.level != null ? level : null, Number.isFinite(time) && time > 0 ? time : null]
  return createHash('sha256').update(String(item.review_id ?? `${item.author?.mid}:${row.join(':')}`)).digest('hex')
}
function newCheckpoint(input, filterLevel) {
  return { version: 1, input, target: JSON.stringify(parseTarget(input)), filterLevel, status: 'running', phase: '解析番剧', updatedAt: Date.now(), resumeAfter: 0, short: emptyCollection(), long: emptyCollection() }
}
function validateCheckpoint(value) {
  const validInt = n => Number.isSafeInteger(n) && n >= 0
  if (!value || value.version !== 1 || typeof value.input !== 'string' || value.input.length > 4096 || value.target !== JSON.stringify(parseTarget(value.input)) || !Number.isInteger(value.filterLevel) || value.filterLevel < 0 || value.filterLevel > 6 || !['running','waiting','paused','cancelled','complete'].includes(value.status) || !validInt(value.updatedAt) || !validInt(value.resumeAfter) || !['解析番剧','短评','长评','完成'].includes(value.phase)) throw new Error('Invalid checkpoint')
  if (value.media && (!/^\d{1,30}$/.test(value.media.mediaId) || typeof value.media.title !== 'string' || value.media.title.length > 4096)) throw new Error('Invalid media')
  for (const type of ['short','long']) {
    const part = value[type]
    if (!part || !Array.isArray(part.rows) || part.rows.length > 200000 || !part.rows.every(row => Array.isArray(row) && row.length === 3 && SCORES.includes(row[0]) && (row[1] === null || Number.isInteger(row[1]) && row[1] >= 0 && row[1] <= 6) && (row[2] === null || Number.isFinite(row[2]) && row[2] > 0)) || !Array.isArray(part.seen) || part.seen.length > 200000 || !part.seen.every(s => typeof s === 'string' && s.length <= 256) || part.seen.length < part.rows.length || !Array.isArray(part.cursors) || part.cursors.length > CONFIG.maxPages || !part.cursors.every(s => typeof s === 'string' && s.length <= 256) || typeof part.cursor !== 'string' || part.cursor.length > 256 || !validInt(part.pages) || part.pages > CONFIG.maxPages || !validInt(part.skipped) || typeof part.done !== 'boolean' || !(part.total === null || validInt(part.total))) throw new Error('Invalid collection')
  }
  if ((value.short.pages || value.long.pages) && !value.media || value.status === 'complete' && (!value.media || !value.short.done || !value.long.done)) throw new Error('Incomplete checkpoint')
  return value
}
function checkpointStore(key, root = process.cwd()) {
  const directory = path.join(root,'data','true-ranking','jobs')
  const file = path.join(directory,createHash('sha256').update(key).digest('hex')+'.json')
  return {
    async load() {
      let handle
      try {
        handle = await fs.open(file,'r')
        const size = (await handle.stat()).size
        if (size > 64*1024*1024) throw new Error('Too large')
        return validateCheckpoint(JSON.parse(await handle.readFile('utf8')))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw new Error('进度文件损坏或无法读取；可发送「#番剧评分重来 番剧编号」重新采集。')
      } finally { await handle?.close() }
    },
    async save(job) {
      job.updatedAt = Date.now()
      await fs.mkdir(directory,{recursive:true,mode:0o700})
      const temporary = file+'.'+randomUUID()+'.tmp'
      try {
        await fs.writeFile(temporary,JSON.stringify(job),{mode:0o600})
        await fs.rename(temporary,file)
      } catch { throw new Error('无法保存采集进度，请管理员检查磁盘空间和目录权限。') }
      finally { await fs.unlink(temporary).catch(()=>{}) }
    }
  }
}

async function collectReviews(type, mediaId, client, maxPages = CONFIG.maxPages, options = {}) {
  const state = options.state || emptyCollection()
  const seen = new Set(state.seen), cursors = new Set(state.cursors)
  let stalls = 0, tailCandidate = null
  const save = options.save || (async()=>{})
  while (!state.done && state.pages < maxPages) {
    if (options.signal?.aborted) throw cancelled()
    const query = new URLSearchParams({ media_id: mediaId, ps: '20' })
    if (state.cursor) query.set('cursor', state.cursor)
    const { data } = await client.request(`/pgc/review/${type}/list?${query}`)
    if (!data || !Array.isArray(data.list) || data.list.length > 20) throw new Error('评论接口结构异常，统计未完成。')
    const next = data.next == null ? '' : String(data.next)
    if (next.length > 256) throw new Error('评论游标异常，统计未完成。')
    const terminal = !next || next === '0'
    // Bilibili can repeat its last visible review with next == cursor instead
    // of next == 0. Confirm the identical short, entirely known tail twice.
    // Page coverage is only a guard against an early loop, not proof of EOF.
    const total = Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : state.total
    const knownTail = !terminal && state.pages > 0 && next === state.cursor && data.list.length < 20 && total != null && state.pages * 20 >= total && data.list.every(item => seen.has(reviewKey(item)))
    const fingerprint = knownTail ? JSON.stringify([next,total,data.list.map(reviewKey)]) : null
    if (knownTail) {
      if (fingerprint === tailCandidate) {
        state.done = true; state.total = total; state.endReason = 'confirmed-repeated-tail'
        await save()
        return { rows:state.rows, total:state.total, skipped:state.skipped }
      }
      if (tailCandidate === null) {
        tailCandidate = fingerprint
        await save()
        if (options.onTail) await options.onTail()
        else await delay(3000,options.signal)
        continue
      }
    }
    tailCandidate = null
    // Other stalled pages are retried at the SAME cursor and remain errors.
    if (!terminal && (!data.list.length || cursors.has(next) || next === state.cursor)) {
      if (stalls++ === 0 && options.onStall) { await save(); await options.onStall(); continue }
      throw new RequestError('评论分页停止推进，尚未确认到达末页；这不是风控响应，未将部分数据当作完整结果。', 'pagination')
    }
    stalls = 0
    if (Number.isSafeInteger(data.total) && data.total >= 0) state.total = data.total
    for (const item of data.list) {
      const value = Number(item.score), level = Number(item.author?.level), time = Number(item.ctime)
      const row = [value, Number.isInteger(level) && level >= 0 && level <= 6 && item.author?.level != null ? level : null, Number.isFinite(time) && time > 0 ? time : null]
      // Hash the fallback too; don't store author IDs or comment bodies.
      const key = reviewKey(item)
      if (seen.has(key)) continue
      seen.add(key); state.seen.push(key)
      if (SCORES.includes(value)) state.rows.push(row); else state.skipped++
    }
    state.pages++; state.done = terminal
    if (!terminal) { cursors.add(next); state.cursors.push(next); state.cursor = next }
    if (state.pages % CONFIG.checkpointPages === 0 || terminal) await save()
    await options.onPage?.(state)
  }
  if (!state.done) throw new Error('评论页数超过安全上限，进度已保留；请管理员检查接口及 CONFIG.maxPages。')
  return { rows: state.rows, total: state.total, skipped: state.skipped }
}

async function analyze(input, client, progress = async () => {}, options = {}) {
  const job = options.job || newCheckpoint(input,CONFIG.filterLevel)
  const save = options.save || (async()=>{})
  if (!job.media) {
    let target = parseTarget(input)
    if (target.type === 'short') target = await client.expand(target.url)
    let mediaId = target.id
    if (target.type !== 'md') {
      const response = await client.request(`/pgc/view/web/season?${target.type === 'ep' ? 'ep_id' : 'season_id'}=${target.id}`)
      mediaId = String(response.result?.media_id ?? '')
      if (!/^\d{1,30}$/.test(mediaId)) throw new Error('无法转换为 MD 编号，请直接发送 MD 编号。')
    }
    const { result } = await client.request(`/pgc/review/user?media_id=${mediaId}`)
    if (typeof result?.media?.title !== 'string' || !result.media.title) throw new Error('番剧不存在或暂时不可访问。')
    const media = result.media
    job.media = { mediaId, title: media.title, officialScore: numeric(media.rating?.score), officialCount: numeric(media.rating?.count) }
    await save()
  }
  for (const [type,label] of [['short','短评'],['long','长评']]) {
    if (job[type].done) continue
    job.phase = label
    await save(); await progress(label)
    await collectReviews(type,job.media.mediaId,client,CONFIG.maxPages,{ ...options, state:job[type], save })
  }
  return { ...job.media, short:job.short.rows, long:job.long.rows, totals:{short:job.short.total,long:job.long.total}, skipped:job.short.skipped+job.long.skipped, timestamp:new Date().toISOString() }
}

function progressText(job) {
  const labels = { running:'采集中',waiting:'冷却等待',paused:'已暂停',cancelled:'已取消（保留进度）',complete:'已完成' }
  const remaining = Math.max(0, Math.ceil((job.resumeAfter-Date.now())/1000))
  const reason = job.lastError && ['paused','cancelled'].includes(job.status) ? `\n上次停止原因：${job.lastError.message}` : ''
  return `${job.media?.title || job.input}：${labels[job.status] || '已暂停'} · ${job.phase}\n短评 ${job.short.pages} 页 / ${count(job.short.rows.length)} 条有效样本；长评 ${job.long.pages} 页 / ${count(job.long.rows.length)} 条有效样本。${reason}${remaining ? `\n冷却还需约 ${remaining} 秒。` : ''}\n发送 #番剧评分继续 续采；#番剧评分取消 停止当前采集并保留进度。`
}

function recoveryHint(error) {
  if (error.kind === 'risk') return '风控响应持续时，请先在 B 站处理验证并更新共享 Cookie。'
  if (error.kind === 'pagination') return '分页异常与风控不同；等待不会保证恢复，请管理员检查分页响应。'
  if (error.kind === 'transient') return '请检查网络或稍后重试。'
  return ''
}

function summarize(rows) {
  const counts = SCORES.map(value => rows.filter(row => row[0] === value).length)
  return { count: rows.length, average: rows.length ? rows.reduce((sum,row) => sum + row[0],0) / rows.length : null, counts, percentages: counts.map(n => rows.length ? n / rows.length * 100 : 0) }
}
function filterRows(rows, level) { return level === 0 ? rows : rows.filter(row => row[1] != null && row[1] >= level) }
function trend(rows) {
  const valid = rows.filter(row => Number.isFinite(row[2]) && row[2] > 0).sort((a,b) => a[2]-b[2])
  if (!valid.length) return []
  const min = valid[0][2], max = Math.min(valid[valid.length-1][2], min + 2*365*86400)
  if (min === max) return [{time:min,average:summarize(valid).average}]
  let pos = 0, sum = 0
  return Array.from({length:8},(_,i) => {
    const time = min+(max-min)*(i+1)/8
    while (pos < valid.length && valid[pos][2] <= time) sum += valid[pos++][0]
    return {time,average:pos ? sum/pos : null}
  })
}
function probability(rows, population) {
  const n = rows.length
  if (n < 2 || !Number.isFinite(population) || population <= 0) return null
  if (n >= population) return 1
  const mean = summarize(rows).average
  const variance = rows.reduce((sum,row) => sum+(row[0]-mean)**2,0)/(n-1)
  const se = Math.sqrt(variance/n*(population-n)/(population-1))
  if (!se) return 1
  const x = 0.1/se/Math.sqrt(2), t = 1/(1+0.3275911*x)
  return Math.max(0,Math.min(1,1-t*(0.254829592+t*(-0.284496736+t*(1.421413741+t*(-1.453152027+t*1.061405429))))*Math.exp(-x*x)))
}

function distributionHtml(stats) {
  return SCORES.map((value,i) => `<div class="bar-row"><b>${value}分</b><div class="track"><i style="width:${stats.percentages[i]}%"></i></div><span>${stats.percentages[i].toFixed(1)}%<small>${count(stats.counts[i])} 条</small></span></div>`).reverse().join('')
}
function trendHtml(rows, filtered = false) {
  const points = trend(rows)
  if (!points.length) return '<div class="chart-empty">暂无有效日期数据</div>'
  const min = points[0].time, max = points[points.length-1].time
  const x = p => max === min ? 160 : 28+(p.time-min)/(max-min)*278
  const y = p => 146-p.average/10*120
  const color = filtered ? '#078bb9' : '#7a899b'
  const line = points.map((p,i) => `${i?'L':'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ')
  const grid = [2,4,6,8,10].map(v => `<line x1="28" x2="306" y1="${146-v*12}" y2="${146-v*12}" stroke="#e5ebf1"/><text x="10" y="${151-v*12}">${v}</text>`).join('')
  const labels = points.map(p => `<circle cx="${x(p)}" cy="${y(p)}" r="3" fill="${color}"/><text x="${x(p)}" y="${y(p)-9}" text-anchor="middle">${p.average.toFixed(1)}</text>`).join('')
  const date = time => new Date(time*1000).toISOString().slice(0,10)
  return `<svg viewBox="0 0 334 182" role="img" aria-label="累计平均分变化">${grid}<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5"/>${labels}<text x="28" y="174">${date(min)}</text><text x="306" y="174" text-anchor="end">${date(max)}</text></svg>`
}

function buildPanelHtml(data, level = CONFIG.filterLevel) {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error('过滤等级必须为 0–6。')
  const allRows = [...data.short,...data.long], filteredRows = filterRows(allRows,level)
  const all = summarize(allRows), filtered = summarize(filteredRows)
  const model = rows => {const value = probability(rows,data.officialCount); return value == null ? '暂无' : `${(value*100).toFixed(2)}%`}
  const detail = (type,label) => {
    const full = summarize(data[type]), kept = summarize(filterRows(data[type],level))
    return `<section class="card"><h3>${label}统计</h3><div class="detail-score"><strong>${score(kept.average)}</strong><span>过滤后 / 10</span><small>全部样本 ${score(full.average)}</small></div><dl><div><dt>过滤后样本</dt><dd>${count(kept.count)}</dd></div><div><dt>全部有效样本</dt><dd>${count(full.count)}</dd></div><div><dt>接口标称数</dt><dd>${count(data.totals[type])}</dd></div></dl></section>`
  }
  const time = new Date(data.timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;background:#edf3f8;color:#1c3145;font:16px/1.55 "Microsoft YaHei","Noto Sans CJK SC","PingFang SC",sans-serif}#container{width:760px;padding:28px;background:#edf3f8}.header{background:#087fa9;color:white;border-radius:16px;padding:25px 28px;margin-bottom:18px}.kicker{font-size:14px;letter-spacing:2px;opacity:.9}h1{font-size:30px;line-height:1.4;margin:10px 0;overflow-wrap:anywhere}h2{font-size:19px;margin:0 0 16px}h3{font-size:17px;margin:0 0 13px}.meta{font-size:14px;opacity:.9}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.metrics{grid-template-columns:repeat(3,1fr)}.card{background:white;border:1px solid #dce6ee;border-radius:12px;padding:20px;min-width:0}.metric p{margin:0;font-size:14px;color:#586c80}.metric strong{display:block;font-size:39px;line-height:1.3;font-variant-numeric:tabular-nums}.metric.selected{border-color:#5ec1dc;background:#e7f7fd}.metric.selected strong{color:#067da5}.metric small{display:block;color:#586c80;font-size:13px;margin-top:4px}.samples{display:flex;justify-content:space-between;background:white;border:1px solid #dce6ee;border-radius:12px;padding:16px 20px;margin-bottom:16px;font-size:14px;color:#586c80}.samples b{font-size:20px;color:#1c3145;margin-left:5px}.detail-score{border-bottom:1px solid #e5ebf1;padding-bottom:12px;display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}.detail-score strong{font-size:29px;color:#087fa9}.detail-score span,.detail-score small{font-size:13px;color:#667b8d}dl{margin:12px 0 0}dl>div{display:flex;justify-content:space-between;margin:5px 0;font-size:14px}dt{color:#63768a}dd{margin:0;font-weight:bold}.section{margin:20px 0 10px}.bar-row{display:grid;grid-template-columns:32px 1fr 88px;align-items:center;gap:10px;margin:11px 0;font-size:14px}.bar-row span{text-align:right;font-variant-numeric:tabular-nums}.bar-row small{display:block;font-size:12px;color:#718396}.track{height:13px;background:#edf3f8;border-radius:4px;overflow:hidden}.track i{display:block;height:100%;background:#10a1cd}.unfiltered .track i{background:#9aabba}.chart-card{padding:16px 12px}.chart-card h3{margin-left:8px}.chart-card svg{display:block;width:100%}.chart-card text{font:12px sans-serif;fill:#677b8d}.chart-empty{height:182px;display:flex;align-items:center;justify-content:center;color:#778797}.note{font-size:13px;color:#62768a;margin:10px 0 0}.model{font-size:14px;padding:16px 20px;background:white;border:1px solid #dce6ee;border-radius:12px}.footer{font-size:13px;color:#667b8d;text-align:center;margin-top:18px}.demo{background:#fff4d7;padding:10px 14px;border-radius:8px;margin-bottom:16px;color:#805b12}
  </style></head><body><main id="container">
    ${data.demo ? '<div class="demo">布局演示 · 以下为模拟数据，并非真实番剧评分</div>' : ''}
    <header class="header"><div class="kicker">TRUE RANKING · B站番剧评分统计</div><h1>${escapeHtml(data.title)}</h1><div class="meta">MD ${escapeHtml(data.mediaId)} · 最低等级 Lv.${level} · ${escapeHtml(time)}（北京时间）</div></header>
    <div class="row metrics"><section class="card metric selected"><p>计算评分 · 等级过滤后</p><strong>${score(filtered.average)}</strong><small>保留 Lv.${level} 及以上用户</small></section><section class="card metric"><p>计算评分 · 全部样本</p><strong>${score(all.average)}</strong><small>长短评按条数等权合并</small></section><section class="card metric"><p>B站官方评分</p><strong>${score(data.officialScore)}</strong><small>标称 ${count(data.officialCount)} 人</small></section></div>
    <div class="samples"><span>全部有效样本 <b>${count(all.count)}</b></span><span>过滤后样本 <b>${count(filtered.count)}</b></span><span>过滤等级 <b>Lv.${level}</b></span></div>
    <div class="row">${detail('short','短评')}${detail('long','长评')}</div>
    <h2 class="section">分数分布统计</h2><div class="row"><section class="card"><h3>过滤后 · ${count(filtered.count)} 条</h3>${distributionHtml(filtered)}</section><section class="card unfiltered"><h3>全部样本 · ${count(all.count)} 条</h3>${distributionHtml(all)}</section></div>
    <h2 class="section">平均分变化统计</h2><div class="row"><section class="card chart-card"><h3>过滤后 · 累计均分</h3>${trendHtml(filteredRows,true)}</section><section class="card chart-card"><h3>全部样本 · 累计均分</h3>${trendHtml(allRows)}</section></div>
    <div class="model">原脚本模型估计（误差 ±0.1）：过滤后 <b>${model(filteredRows)}</b> / 全部 <b>${model(allRows)}</b><p class="note">仅为随机抽样假设下的近似值，不是准确性或置信保证；过滤后的总体人数未知。</p></div>
    <p class="note">趋势按每组最早评论起，最多统计两年；总均分包含所有有效样本。接口可见评论不等于全部评分，结果仅供参考。未知等级仅进入全部样本与 Lv.0；缺失日期不进入趋势。${data.skipped ? `跳过 ${count(data.skipped)} 条无效评分。` : ''}</p>
    <footer class="footer">Yunzai 图片版 · YujioNako &amp; 看你看过的霓虹</footer>
  </main></body></html>`
}

function buildTextResult(data, level) {
  const rows = [...data.short,...data.long], all = summarize(rows), filtered = summarize(filterRows(rows,level))
  return `番剧：${data.title}（md${data.mediaId}）\n等级过滤：Lv.${level} 及以上\n过滤后均分：${score(filtered.average)}（${count(filtered.count)} 条）\n全部样本均分：${score(all.average)}（${count(all.count)} 条）\n官方评分：${score(data.officialScore)}（标称 ${count(data.officialCount)} 人）\n短评有效样本：${data.short.length} / 接口标称 ${count(data.totals.short)}\n长评有效样本：${data.long.length} / 接口标称 ${count(data.totals.long)}\n接口可见样本不等于全部评分，结果仅供参考。`
}

async function renderPanel(data, level, options = {}) {
  const root = options.root || process.cwd()
  const directory = path.join(root,'data','true-ranking')
  const tplFile = path.join(directory,'panel-v2.html')
  // Only this trusted placeholder is compiled by art-template. User-provided
  // titles are HTML-escaped and inserted as data, never as template source.
  if (!templateWrites.has(tplFile)) templateWrites.set(tplFile,(async () => {
    await fs.mkdir(directory,{recursive:true})
    await fs.writeFile(tplFile,'{{@html}}','utf8')
  })().catch(error => {templateWrites.delete(tplFile);throw error}))
  await templateWrites.get(tplFile)
  const renderer = options.renderer || (await import('../../lib/puppeteer/puppeteer.js')).default
  const saveId = randomUUID()
  try {
    return await renderer.screenshot('true-ranking',{tplFile,saveId,html:buildPanelHtml(data,level),imgType:'png',pageGotoParams:{waitUntil:'load',timeout:30000}})
  } finally {
    // Remove only this request's generated HTML; never delete shared directories.
    await fs.unlink(path.join(root,'temp','html','true-ranking',`${saveId}.html`)).catch(() => {})
  }
}

export class example extends plugin {
  constructor() {
    super({name:'true_score',event:'message',priority:1000,rule:[{reg:'^#?番剧评分帮助$',fnc:'b_socre_help'},{reg:'^#?番剧评分.*$',fnc:'b_socre'}]})
  }
  async b_socre(e) {
    const key = `${e.self_id || ''}:${e.user_id || e.sender?.user_id || 'unknown'}`
    const store = checkpointStore(key)
    const action = String(e.msg).replace(/^#?番剧评分\s*/, '').trim()
    if (action === '进度' || action === '取消') {
      try {
        const active = runtime.jobs.get(key)
        if (action === '取消' && active) {
          active.controller.abort()
          await e.reply('正在取消请求并保存进度；稍后可发送 #番剧评分继续。')
        } else {
          const job = active?.job || await store.load()
          if (job && !active && ['running','waiting'].includes(job.status)) job.status = 'paused'
          await e.reply(job ? progressText(job) : '你还没有番剧评分任务。')
        }
      } catch (error) { await e.reply(error.message) }
      return true
    }
    if (runtime.jobs.has(key)) { await e.reply('你的番剧评分任务正在进行；发送 #番剧评分进度 查看，或 #番剧评分取消 保存进度并停止。'); return true }
    const active = { controller:new AbortController(), job:null }
    // Reserve before disk I/O so simultaneous messages cannot start two jobs.
    runtime.jobs.set(key,active)
    let job, save = async()=>{}, lastLog = 0
    const notify = text => e.reply(text).catch(()=>{})
    try {
      const restart = /^重来(?:\s|$)/.test(action)
      const previous = restart ? null : await store.load()
      let command
      if (action === '继续') {
        if (!previous) throw new Error('没有可继续的任务，请先发送番剧编号。')
        command = {input:previous.input,filterLevel:previous.filterLevel}
      } else command = parseCommand('#番剧评分 '+(restart ? action.replace(/^重来\s*/, '') : action))
      const target = JSON.stringify(parseTarget(command.input))
      if (previous && previous.status !== 'complete' && previous.target !== target) throw new Error('你有另一部番剧的未完成进度。发送 #番剧评分继续 续采；或 #番剧评分重来 番剧编号 替换旧进度。')
      const resumed = previous && previous.target === target && (previous.status !== 'complete' || action === '继续')
      job = resumed ? previous : newCheckpoint(command.input,command.filterLevel)
      active.job = job; job.filterLevel = command.filterLevel; delete job.lastError
      save = () => store.save(job)
      job.status = 'running'
      await save()
      await e.reply(`${resumed ? '从保存的进度继续统计' : '开始统计'}，保留 Lv.${job.filterLevel} 及以上样本；完成后发送评分面板图片。请求统一间隔至少 3 秒，大量评论可能耗时数小时。\n可发送 #番剧评分进度 或 #番剧评分取消。`)
      const wait = async (milliseconds, reason, resumeAfter = Date.now()+milliseconds) => {
        job.status = 'waiting'; job.resumeAfter = resumeAfter
        await save()
        await notify(`${reason}\n已保存进度，约 ${Math.ceil(milliseconds/1000)} 秒后从当前页重试；可发送 #番剧评分取消。`)
      }
      const pending = Math.max(job.resumeAfter,runtime.cooldownUntil)-Date.now()
      if (pending > 0) {
        await wait(pending,'仍处于请求冷却期。')
        await delay(pending,active.controller.signal)
      }
      job.status = 'running'; job.resumeAfter = 0
      const client = await createClient({recovery:true,signal:active.controller.signal,onRetry:async({error,wait:ms,resumeAfter})=>{
        await wait(ms,error.message,resumeAfter)
      }})
      const data = await analyze(job.input,client,label=>notify(`正在采集${label}…\n${progressText(job)}`),{
        job,save,signal:active.controller.signal,
        onTail:async()=>{
          await notify('接口疑似已到评论末页，正在复核重复游标；不是风控，将保留已采集样本。')
          await delay(3000,active.controller.signal)
        },
        onStall:async()=>{
          await wait(15000,'评论分页暂时停止推进。')
          await delay(15000,active.controller.signal)
        },
        onPage:async()=>{
          job.status = 'running'; job.resumeAfter = 0
          if (Date.now()-lastLog >= 60000) {
            lastLog = Date.now()
            globalThis.logger?.mark?.(`[true-ranking] md${job.media.mediaId} ${job.phase} shortPages=${job.short.pages} longPages=${job.long.pages} samples=${job.short.rows.length+job.long.rows.length}`)
          }
        }
      })
      if (active.controller.signal.aborted) throw cancelled()
      job.status = 'complete'; job.phase = '完成'; job.resumeAfter = 0
      await save()
      let image
      try { image = await renderPanel(data,job.filterLevel) } catch { image = false }
      if (active.controller.signal.aborted) throw cancelled()
      if (image) {
        try { await e.reply(image) } catch { await e.reply(`图片发送失败，改发文字结果。\n${buildTextResult(data,job.filterLevel)}`) }
      } else {
        await e.reply(`图片渲染失败，已回退文字结果。请管理员检查 Yunzai 的 Puppeteer / Chromium 和中文字体。\n${buildTextResult(data,job.filterLevel)}`)
      }
    } catch (error) {
      let saved = false, saveError
      if (job) {
        job.status = active.controller.signal.aborted ? 'cancelled' : 'paused'
        job.lastError = { kind:active.controller.signal.aborted ? 'cancelled' : error.kind || 'other', message:String(error.message).slice(0,500), at:Date.now() }
        job.resumeAfter = Math.max(job.resumeAfter,error.resumeAfter || 0)
        try { await save(); saved = true } catch (failure) { saveError = failure.message }
      }
      await e.reply(`统计未完成：${error.message}${saved ? '\n进度已保存。发送 #番剧评分继续 或重发相同番剧编号，从断点继续。'+recoveryHint(error) : ''}${saveError ? '\n'+saveError+' 最近一次成功落盘后的进度可能丢失。' : ''}`)
    } finally { runtime.jobs.delete(key) }
    return true
  }
  async b_socre_help(e) {
    await e.reply('番剧评分 · 图片面板版\n#番剧评分 md4315402\n#番剧评分 ep705756\n#番剧评分 ss26257\n#番剧评分 番剧分享链接\n#番剧评分 md4315402 等级5\n#番剧评分进度\n#番剧评分取消（保留进度）\n#番剧评分继续\n#番剧评分重来 ep1521592（替换旧进度）\n等级可选 0–6，默认 5；0 表示不按等级过滤。\n输出含官方/计算评分、长短评明细、分布与两年趋势。\n网络错误有限退避重试；-352/412 等风控冷却后重试，仍失败会保存进度并暂停。重启后可继续。Cookie 仅由管理员在服务器配置，不要发到聊天中。')
    return true
  }
}
