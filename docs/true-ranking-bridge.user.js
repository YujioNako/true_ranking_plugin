// ==UserScript==
// @name         True Ranking 网页连接助手
// @namespace    https://github.com/YujioNako/true_ranking_plugin
// @version      1.0.0
// @description  让 True Ranking 网页从本机获取 B 站公开番剧评分数据，无需代理服务器。
// @author       YujioNako
// @match        https://yujionako.github.io/true_ranking_plugin/*
// @match        http://localhost:4173/*
// @match        http://127.0.0.1:4173/*
// @connect      api.bilibili.com
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @license      MIT
// @downloadURL  https://yujionako.github.io/true_ranking_plugin/true-ranking-bridge.user.js
// @updateURL    https://yujionako.github.io/true_ranking_plugin/true-ranking-bridge.user.js
// ==/UserScript==
(() => {
  'use strict';
  const active = new Map();
  const allowed = new Set(['/pgc/review/user', '/pgc/review/short/list', '/pgc/review/long/list', '/pgc/view/web/season']);
  const reply = (id, data, error) => window.postMessage({channel:'tr-response', id, data, error}, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'tr-request') return;
    const {id, action, url} = event.data;
    if (typeof id !== 'string' || id.length > 100) return;
    if (action === 'ping') { reply(id, {version:'1.0.0'}); return; }
    if (action === 'abort') { active.get(id)?.abort(); active.delete(id); return; }
    if (action !== 'request') return;
    try {
      const target = new URL(url);
      if (target.origin !== 'https://api.bilibili.com' || target.username || target.password || !allowed.has(target.pathname) || [...target.searchParams].some(([key,value]) => !['media_id','ep_id','season_id','cursor','ps'].includes(key) || !/^\d{1,30}$/.test(value))) throw new Error('连接助手拒绝了非评分接口请求。');
      if (active.size >= 2 || active.has(id)) throw new Error('请求过多，请等待当前统计完成。');
      active.set(id, GM_xmlhttpRequest({method:'GET', url:target.href, anonymous:true, timeout:30000,
        headers:{Referer:'https://www.bilibili.com/'},
        onload: response => {
          active.delete(id);
          if (response.status !== 200) { reply(id, null, `B 站返回 HTTP ${response.status}，请稍后重试。`); return; }
          try { reply(id, JSON.parse(response.responseText)); } catch { reply(id, null, 'B 站未返回有效 JSON。'); }
        },
        onerror: () => {active.delete(id); reply(id, null, '连接失败，请检查网络和脚本的跨域访问权限。');},
        ontimeout: () => {active.delete(id); reply(id, null, 'B 站接口请求超时。');},
        onabort: () => {active.delete(id);}
      }));
    } catch (error) { reply(id, null, error.message); }
  });
})();
