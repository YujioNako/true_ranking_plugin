import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSessionBridge,bridgeCall,makeTransport} from '../docs/api.js';
test('old anonymous helpers are rejected before analysis starts',()=>{
  assert.throws(()=>assertSessionBridge({version:'1.0.0'}),/版本过旧/);
  assert.doesNotThrow(()=>assertSessionBridge({version:'1.1.0',authenticatedRequests:true,sessionCheck:true}));
});
test('proxy risk errors explain that local cookies are unavailable; credentials remain omitted',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const [status,code] of [[412,0],[429,0],[200,-412],[200,-509]]){
    globalThis.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');assert.ok(url.startsWith('https://proxy.example/'));return{ok:status===200,status,json:async()=>({code})};};
    await assert.rejects(makeTransport('proxy','https://proxy.example/',new AbortController().signal)('/pgc/review/user?media_id=1'),/本机.*会话/);
  }
});
test('bridge errors preserve risk classification for the application',async t=>{
  const previousWindow=globalThis.window,previousLocation=globalThis.location;
  t.after(()=>{globalThis.window=previousWindow;globalThis.location=previousLocation;});
  let listener;
  globalThis.location={origin:'https://yujionako.github.io'};
  globalThis.window={addEventListener:(_,fn)=>{listener=fn;},removeEventListener:()=>{},postMessage:message=>queueMicrotask(()=>listener({source:window,origin:location.origin,data:{channel:'tr-response',id:message.id,error:'暂停请求',errorCode:'RISK_CONTROL'}}))};
  await assert.rejects(bridgeCall('request',{url:'https://api.bilibili.com/pgc/review/user?media_id=1'}),error=>error.code==='RISK_CONTROL');
});
