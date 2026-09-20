// ==UserScript==
// @name         True Ranking 网页连接助手
// @namespace    https://github.com/YujioNako/true_ranking_plugin
// @version      1.1.0
// @description  使用当前浏览器的 B 站登录会话读取番剧评分；Cookie 不暴露给网页。
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
  let blockedUntil = 0;
  const allowed = new Set(['/pgc/review/user', '/pgc/review/short/list', '/pgc/review/long/list', '/pgc/view/web/season']);
  const reply = (id, data, error, errorCode) => window.postMessage({channel:'tr-response', id, data, error, errorCode}, location.origin);
  const cooldown = () => Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
  const riskError = id => reply(id, null, `B 站触发风控（412 / -412 / 429）。请在同一浏览器打开 B 站，确认登录并处理站内验证；至少等待 ${cooldown()} 秒后再手动重试。登录不一定能解除网络或频率限制。`, 'RISK_CONTROL');
  // Authenticated API responses may include personal fields. Send only statistics
  // needed by the app; never pass cookies, headers or account details to the page.
  function publicResult(path, result) {
    if (result.code !== 0) return {code:result.code, message:'请求未成功，请在 B 站确认登录状态后重试。'};
    if (path === '/pgc/review/user') {
      const media = result.result?.media;
      return {code:0,result:{media:media ? {title:media.title,media_id:media.media_id,rating:media.rating ? {score:media.rating.score,count:media.rating.count} : undefined} : undefined}};
    }
    if (path === '/pgc/view/web/season') return {code:0,result:{media_id:result.result?.media_id}};
    return {code:0,data:{total:result.data?.total,next:result.data?.next,list:Array.isArray(result.data?.list) ? result.data.list.map(item => ({review_id:item.review_id,score:item.score,ctime:item.ctime,author:{level:item.author?.level}})) : undefined}};
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'tr-request') return;
    const {id, action, url} = event.data;
    if (typeof id !== 'string' || id.length > 100) return;
    if (action === 'ping') { reply(id, {version:'1.1.0',authenticatedRequests:true,sessionCheck:true,cooldownSeconds:cooldown()}); return; }
    if (action === 'abort') { active.get(id)?.abort(); active.delete(id); return; }
    if (!['request','session'].includes(action)) return;
    try {
      const sessionCheck = action === 'session';
      // The session action uses a fixed URL and only returns a boolean.
      const target = new URL(sessionCheck ? 'https://api.bilibili.com/x/web-interface/nav' : url);
      if (!sessionCheck && (target.origin !== 'https://api.bilibili.com' || target.username || target.password || !allowed.has(target.pathname) || [...target.searchParams].some(([key,value]) => !['media_id','ep_id','season_id','cursor','ps'].includes(key) || !/^\d{1,30}$/.test(value)))) throw new Error('连接助手拒绝了非评分接口请求。');
      if (cooldown()) { riskError(id); return; }
      if (active.size >= 2 || active.has(id)) throw new Error('请求过多，请等待当前统计完成。');
      active.set(id, GM_xmlhttpRequest({method:'GET', url:target.href, anonymous:false, timeout:30000,
        cookiePartition:{topLevelSite:'https://bilibili.com'},
        headers:{Referer:'https://www.bilibili.com/'},
        onload: response => {
          active.delete(id);
          if ([412,429].includes(response.status)) { blockedUntil = Date.now() + 60000; riskError(id); return; }
          if ([401,403].includes(response.status)) { reply(id, null, `B 站返回 HTTP ${response.status}。请打开 B 站确认登录和访问权限，再检测登录状态。`, 'AUTH_REQUIRED'); return; }
          if (response.status !== 200) { reply(id, null, `B 站返回 HTTP ${response.status}，请稍后重试。`); return; }
          try {
            if (response.finalUrl && new URL(response.finalUrl).origin !== target.origin) throw new Error('unexpected redirect');
            const result = JSON.parse(response.responseText);
            if ([-412,-509].includes(result?.code)) { blockedUntil = Date.now() + 60000; riskError(id); return; }
            if (sessionCheck) {
              if (result.code === -101) { reply(id, {loggedIn:false}); return; }
              if (result.code !== 0 || typeof result.data?.isLogin !== 'boolean') { reply(id, null, '无法确认登录状态；这不等于未登录，请稍后重新检测。'); return; }
              reply(id, {loggedIn:result.data.isLogin});
            } else {
              if (result.code === -101) { reply(id, null, 'B 站登录已失效，请在同一浏览器登录后重新检测。', 'AUTH_REQUIRED'); return; }
              reply(id, publicResult(target.pathname, result));
            }
          } catch { reply(id, null, 'B 站未返回有效 JSON 或跳转到了验证页面，请打开 B 站检查后重试。'); }
        },
        onerror: () => {active.delete(id); reply(id, null, '连接失败，请检查网络和脚本的跨域访问权限。');},
        ontimeout: () => {active.delete(id); reply(id, null, 'B 站接口请求超时。');},
        onabort: () => {active.delete(id);}
      }));
    } catch (error) { reply(id, null, error.message); }
  });
})();
