import {SCORES, parseInput, summarize, filterRows, trend, confidenceStats, validateDataset} from './core.js';
import {bridgeCall, makeTransport, analyze, assertSessionBridge} from './api.js';
const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : n.toLocaleString('zh-CN');
const score = n => n == null ? '—' : n.toFixed(1);
const percent = n => n == null ? '—' : (n * 100).toFixed(1) + '%';
const date = time => new Date(time * 1000).toLocaleDateString('zh-CN',{year:'2-digit',month:'2-digit',day:'2-digit'});
let current = null, controller = null, history = [], currentSource = 'live';
try {
  const saved = Number(localStorage.getItem('tr-level') ?? 5);
  if (Number.isInteger(saved) && saved >= 0 && saved <= 6) $('filter-level').value = saved;
  const cached = JSON.parse(localStorage.getItem('tr-history') || '[]');
  if (Array.isArray(cached)) history = cached.slice(0,5).map(validateDataset);
} catch { history = []; }
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function element(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function setBusy(busy) {
  for (const id of ['start','media-input','connection-mode','proxy-url','import-button','check-session']) $(id).disabled = busy;
  $('cancel').hidden = !busy; $('start').textContent = busy ? '正在统计…' : '开始统计 →';
  $('progress').hidden = !busy;
  renderHistory();
}
async function detect() {
  $('bridge-status').textContent = '正在检测连接助手…';
  try { const info = assertSessionBridge(await bridgeCall('ping')); $('bridge-status').textContent = `连接助手 ${info.version} 已就绪${info.cooldownSeconds ? ` · 风控等待 ${info.cooldownSeconds} 秒` : ''}`; }
  catch (error) { $('bridge-status').textContent = error.message; }
}
async function checkSession() {
  $('check-session').disabled = true;
  $('session-status').textContent = '正在向 B 站确认登录状态…';
  try {
    assertSessionBridge(await bridgeCall('ping'));
    const session = await bridgeCall('session');
    $('session-status').textContent = session.loggedIn ? 'B 站已识别登录会话，可以开始统计。' : '未识别到登录会话。请先在同一浏览器登录 B 站；已登录仍失败时，请检查是否使用相同浏览器配置、更新 Tampermonkey 后重新检测。';
  } catch (error) { $('session-status').textContent = error.message; }
  finally { $('check-session').disabled = Boolean(controller); }
}
function remember(data) {
  history = [data, ...history.filter(item => item.mediaId !== data.mediaId)].slice(0,5);
  try { localStorage.setItem('tr-history', JSON.stringify(history)); }
  catch { status('统计完成；浏览器存储空间不足，请导出 JSON 保存结果。'); }
  renderHistory();
}
function renderHistory() {
  $('history').replaceChildren();
  if (!history.length) { $('history').append(element('p','完成的统计会保存在当前浏览器。','hint')); return; }
  for (const data of history) {
    const button = element('button',data.title,'history-item'); button.type = 'button'; button.disabled = Boolean(controller);
    button.append(element('span',`md${data.mediaId} · ${new Date(data.timestamp).toLocaleDateString('zh-CN')}`));
    button.addEventListener('click',() => {current = data; currentSource = 'cache'; $('media-input').value = `md${data.mediaId}`; render(); status('已加载本机缓存；点击开始统计可重新采集。');});
    $('history').append(button);
  }
}
function renderDistribution(all, filtered) {
  $('distribution').replaceChildren();
  if (!all.count) { $('distribution').append(element('p','接口未返回有效评分样本。','empty')); return; }
  SCORES.slice().reverse().forEach(value => {
    const i = SCORES.indexOf(value), row = element('div',null,'bar-row');
    row.append(element('span',`${value} 分`,'bar-label'));
    const tracks = element('div',null,'bar-tracks');
    for (const [stats, cls, label] of [[filtered,'','过滤后'],[all,'all','全部样本']]) {
      const track = element('div',null,`bar-track ${cls}`), bar = element('span');
      bar.style.width = stats.percentages[i] + '%';
      track.title = `${label}：${stats.counts[i]} 条 · ${stats.percentages[i].toFixed(1)}%`; track.append(bar); tracks.append(track);
    }
    const count = element('div',null,'bar-count');
    count.append(element('div',`${filtered.percentages[i].toFixed(1)}% · ${fmt(filtered.counts[i])}`),element('div',`${all.percentages[i].toFixed(1)}% · ${fmt(all.counts[i])}`));
    row.append(tracks,count); $('distribution').append(row);
  });
}
function renderConfidence(level) {
  $('confidence').replaceChildren();
  for (const group of confidenceStats(current,level)) {
    const card = element('article',null,'confidence-card'); card.dataset.type = group.type;
    card.append(element('h3',group.label));
    for (const [key,label] of [['filtered',`过滤后 · Lv.${level}+`],['all','全部样本']]) {
      const result = group[key], row = element('div',null,`confidence-row ${key}`);
      row.append(element('span',label),element('strong',result.value == null ? '暂不可估' : `${(result.value*100).toFixed(2)}%`));
      card.append(row,element('p',`有效样本 ${fmt(result.count)} 条`,'hint confidence-samples'));
      if (result.note) card.append(element('p',`${key === 'filtered' ? '过滤后' : '全部样本'}：${result.note}`,'hint estimate-note'));
    }
    card.append(element('p',`${group.populationLabel}：${fmt(group.population)}`,'hint population'));
    $('confidence').append(card);
  }
}
function renderTrend(allRows, filteredRows) {
  const sets = [trend(allRows),trend(filteredRows)], flat = sets.flat();
  $('trend').replaceChildren(); $('trend-table').replaceChildren(); $('trend-detail').hidden = !flat.length;
  if (!flat.length) { $('trend').append(element('p','暂无可用于趋势图的日期数据。','empty')); return; }
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (tag,attrs,text) => {const el = document.createElementNS(ns,tag); for (const [key,val] of Object.entries(attrs)) el.setAttribute(key,val); if (text != null) el.textContent = text; return el;};
  [1,0].forEach(index => {
    const points = sets[index], valid = points.filter(p => p.average != null), color = index ? '#1261d9' : '#73859f';
    const section = element('section',null,'trend-series'), label = index ? '过滤后 · 累计均分' : '全部样本 · 累计均分';
    section.append(element('h3',label)); $('trend').append(section);
    if (!valid.length) {section.append(element('p','暂无可用于趋势图的日期数据。','empty')); return;}
    const min = valid[0].time, max = valid.at(-1).time;
    const x = t => max === min ? 360 : 50 + (t-min)/(max-min)*620;
    const y = value => 162 - value/10*130;
    const svg = svgEl('svg',{viewBox:'0 0 720 210',role:'img','aria-label':`${label}，每个点标注日期与评分。下方可展开数据表。`});
    [2,4,6,8,10].forEach(value => {svg.append(svgEl('line',{x1:50,x2:670,y1:y(value),y2:y(value),stroke:'#e5eaf1'}),svgEl('text',{x:18,y:y(value)+4,'text-anchor':'middle'},value));});
    if (valid.length) svg.append(svgEl('path',{d:valid.map((p,i) => `${i?'L':'M'}${x(p.time)},${y(p.average)}`).join(' '),stroke:color,'stroke-width':index?3:2,fill:'none'}));
    valid.forEach(p => {const point = svgEl('circle',{cx:x(p.time),cy:y(p.average),r:3,fill:color}); point.append(svgEl('title',{},`${index?'过滤后':'全部样本'} ${date(p.time)}：${p.average.toFixed(2)}`));svg.append(point,svgEl('text',{x:x(p.time),y:y(p.average)-12,'text-anchor':'middle',class:'trend-value'},p.average.toFixed(2)),svgEl('text',{x:x(p.time),y:193,'text-anchor':'middle'},date(p.time)));});
    const scroll = element('div',null,'trend-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role','region'); scroll.setAttribute('aria-label',`${label}，窄屏可横向滚动`); scroll.append(svg); section.append(scroll);
  });
  const table = element('table'), head = element('tr'); ['样本','日期','累计均分'].forEach(s => head.append(element('th',s))); table.append(head);
  sets.forEach((points,index) => points.forEach(p => {const row = element('tr'); [index?'过滤后':'全部样本',date(p.time),p.average?.toFixed(2) ?? '—'].forEach(s => row.append(element('td',s)));table.append(row);})); $('trend-table').append(table);
}
function render() {
  const level = Number($('filter-level').value);
  $('level-label').textContent = `Lv.${level}`; $('filtered-caption').textContent = `保留 Lv.${level} 及以上用户`;
  if (!current) return;
  const allRows = [...current.short,...current.long], filteredRows = filterRows(allRows,level);
  const all = summarize(allRows), filtered = summarize(filteredRows);
  $('result-tag').textContent = `MD${current.mediaId} · ${current.complete?'接口采集已完成':'导入的部分数据'}`;
  $('result-title').textContent = current.title;
  $('result-meta').textContent = `${{live:'本次采集',cache:'本机缓存',import:'导入数据'}[currentSource]} · 数据时间 ${new Date(current.timestamp).toLocaleString('zh-CN')} · 切换等级即时重算`;
  $('bili-link').hidden = false; $('bili-link').href = `https://www.bilibili.com/bangumi/media/md${current.mediaId}`;
  $('filtered-score').textContent = score(filtered.average); $('all-score').textContent = score(all.average); $('official-score').textContent = score(current.officialScore);
  $('official-count').textContent = `标称评分人数 ${fmt(current.officialCount)}`;
  $('all-count').textContent = fmt(all.count); $('filtered-count').textContent = fmt(filtered.count);
  $('coverage').textContent = current.officialCount > 0 ? percent(all.count/current.officialCount) : '—';
  $('retention').textContent = all.count > 0 ? percent(filtered.count/all.count) : '—';
  renderConfidence(level); renderDistribution(all,filtered); renderTrend(allRows,filteredRows);
  $('review-table').replaceChildren();
  for (const [type,label] of [['short','短评'],['long','长评']]) {
    const a = summarize(current[type]), f = summarize(filterRows(current[type],level));
    const tr = element('tr'); [label,score(a.average),score(f.average),fmt(a.count),fmt(f.count),fmt(current.totals[type])].forEach(s => tr.append(element('td',s))); $('review-table').append(tr);
  }
  $('export').disabled = false;
}
async function runAnalysis(input) {
  if (controller) throw new Error('已有统计任务正在运行。');
  parseInput(input);
  controller = new AbortController(); setBusy(true);
  $('progress-text').textContent = '正在读取番剧信息…'; $('progress-bar').removeAttribute('value'); status('正在连接数据源…');
  try {
    if ($('connection-mode').value === 'bridge') assertSessionBridge(await bridgeCall('ping',{},controller.signal));
    const request = makeTransport($('connection-mode').value,$('proxy-url').value,controller.signal);
    const result = await analyze(input,request,controller.signal, p => {
      const type = p.type === 'short' ? '短评' : '长评';
      $('progress-text').textContent = `${type}：${fmt(p.count)} / ${fmt(p.total)} 条${p.skipped ? ` · 跳过 ${p.skipped} 条无效记录` : ''}`;
      if (p.total > 0) $('progress-bar').value = Math.min(100,p.count / p.total * 100); else $('progress-bar').removeAttribute('value');
      status('正在逐页采集，可随时取消。上一次结果会保留到本次采集完成。');
    });
    current = validateDataset(result); currentSource = 'live'; render(); status('统计完成。可切换用户等级比较结果。'); remember(current);
    return {mediaId:current.mediaId,title:current.title,samples:current.short.length+current.long.length};
  } catch (error) {
    if (controller.signal.aborted) status('已取消，本次未完成的数据未保存。');
    else status(error.message || '网络请求失败，请检查连接助手或代理配置。',true);
    throw error;
  } finally { controller = null; setBusy(false); }
}
$('analysis-form').addEventListener('submit',event => {event.preventDefault(); runAnalysis($('media-input').value).catch(error => {if (error.name !== 'AbortError') status(error.message,true);});});
$('cancel').addEventListener('click',() => controller?.abort());
$('detect').addEventListener('click',detect);
$('check-session').addEventListener('click',checkSession);
$('connection-mode').addEventListener('change',() => {const proxy = $('connection-mode').value === 'proxy';$('proxy-field').hidden = !proxy;$('bridge-field').hidden = proxy;});
$('filter-level').addEventListener('input',() => {try {localStorage.setItem('tr-level',$('filter-level').value);} catch {} render();});
$('import-button').addEventListener('click',() => $('import-file').click());
$('import-file').addEventListener('change',async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('数据文件不能超过 30 MB。');
    const data = validateDataset(JSON.parse(await file.text()));
    if (controller) throw new Error('请等待当前统计任务完成后再导入。');
    current = data; currentSource = 'import'; $('media-input').value = `md${current.mediaId}`; render(); status('已导入数据，未发起网络请求。'); remember(current);
  } catch (error) { status(error instanceof SyntaxError ? '文件不是有效的 JSON。' : error.message,true); }
  finally { event.target.value = ''; }
});
$('export').addEventListener('click',() => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current,null,2)],{type:'application/json'}), url = URL.createObjectURL(blob), link = element('a');
  link.href = url; link.download = `true-ranking-md${current.mediaId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
const lifecycle = new AbortController();
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({name:'analyze_bangumi',description:'用当前选择的数据连接采集番剧评分，并更新页面结果。',inputSchema:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async args => {if (!args || typeof args.input !== 'string') throw new Error('input 必须是番剧编号或链接。');parseInput(args.input);if(controller) throw new Error('已有任务运行中。');$('media-input').value=args.input;return runAnalysis(args.input);}}, {signal:lifecycle.signal})).catch(() => {});
  } catch { /* optional browser capability */ }
}
window.addEventListener('pagehide',() => {controller?.abort();lifecycle.abort();},{once:true});
render(); renderHistory(); detect();
