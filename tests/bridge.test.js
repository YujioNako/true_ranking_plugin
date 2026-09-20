import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../docs/true-ranking-bridge.user.js',import.meta.url),'utf8');
function harness(){let listener;const replies=[],requests=[];const window={addEventListener:(_,fn)=>listener=fn,postMessage:data=>replies.push(data)};vm.runInNewContext(source,{window,location:{origin:'https://yujionako.github.io'},URL,GM_xmlhttpRequest:options=>{requests.push(options);return{abort(){}};}});return{requests,replies,send:data=>listener({source:window,origin:'https://yujionako.github.io',data:{channel:'tr-request',id:'test',action:'request',...data}})};}
test('bridge only accepts the four public API routes',()=>{const h=harness();h.send({url:'https://api.bilibili.com/x/member/web/account'});h.send({url:'https://evil.example/pgc/review/user?media_id=1'});h.send({url:'https://api.bilibili.com/pgc/review/user?media_id=1&callback=evil'});assert.equal(h.requests.length,0);assert.equal(h.replies.filter(r=>r.error).length,3);});
test('bridge requests are anonymous and errors reach the page',()=>{const h=harness();h.send({url:'https://api.bilibili.com/pgc/review/user?media_id=1'});assert.equal(h.requests[0].anonymous,true);h.requests[0].onload({status:412});assert.match(h.replies[0].error,/412/);h.send({id:'two',url:'https://api.bilibili.com/pgc/review/short/list?media_id=1'});h.requests[1].onload({status:200,responseText:'{"code":0,"data":{"list":[]}}'});assert.equal(h.replies[1].data.code,0);});
test('bridge handshake works without network access',()=>{const h=harness();h.send({action:'ping'});assert.equal(h.requests.length,0);assert.equal(h.replies[0].data.version,'1.0.0');});
