import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../docs/true-ranking-bridge.user.js',import.meta.url),'utf8');
function harness() {
  let listener, now=100000, aborted=0;
  const replies=[],requests=[];
  const window={addEventListener:(_,fn)=>listener=fn,postMessage:data=>replies.push(JSON.parse(JSON.stringify(data)))};
  vm.runInNewContext(source,{window,location:{origin:'https://yujionako.github.io'},URL,Date:{now:()=>now},GM_xmlhttpRequest:options=>{requests.push(options);return{abort(){aborted++;options.onabort();}};}});
  return {requests,replies,advance:ms=>{now+=ms;},aborted:()=>aborted,
    send:(data,foreign=false)=>listener({source:foreign?{}:window,origin:'https://yujionako.github.io',data:{channel:'tr-request',id:'test',action:'request',...data}}),
    respond:(data,status=200)=>requests.at(-1).onload({status,responseText:JSON.stringify(data)})};
}
const publicUrl='https://api.bilibili.com/pgc/review/user?media_id=1';
test('bridge rejects other APIs, hosts, callbacks and foreign windows',()=>{
  const h=harness();
  for(const url of ['https://api.bilibili.com/x/member/web/account','https://api.bilibili.com/x/web-interface/nav','https://evil.example/pgc/review/user?media_id=1','https://api.bilibili.com/pgc/review/user?media_id=1&callback=evil'])h.send({url});
  h.send({url:publicUrl},true);
  assert.equal(h.requests.length,0);assert.equal(h.replies.filter(r=>r.error).length,4);
});
test('requests let the extension attach Bilibili cookies without exposing cookie values',()=>{
  const h=harness();h.send({url:publicUrl});
  const request=h.requests[0];assert.equal(request.anonymous,false);assert.equal(request.cookiePartition.topLevelSite,'https://bilibili.com');
  assert.equal(request.cookie,undefined);assert.equal(request.headers.Cookie,undefined);assert.equal(request.method,'GET');
});
test('handshake identifies session-aware helper without a network request',()=>{
  const h=harness();h.send({action:'ping'});assert.equal(h.requests.length,0);
  assert.deepEqual(h.replies[0].data,{version:'1.1.0',authenticatedRequests:true,sessionCheck:true,cooldownSeconds:0});
});
test('login check uses a fixed URL and returns only a boolean',()=>{
  const h=harness();h.send({action:'session',url:'https://evil.example/'});
  assert.equal(h.requests[0].url,'https://api.bilibili.com/x/web-interface/nav');
  h.respond({code:0,data:{isLogin:true,uname:'private',mid:42,money:999,wbi_img:{}}});
  assert.deepEqual(h.replies[0].data,{loggedIn:true});
  h.send({action:'session',id:'second'});h.respond({code:-101,message:'not logged in'});
  assert.deepEqual(h.replies[1].data,{loggedIn:false});
});
test('unknown login response is an error, never a false logged-out result',()=>{
  const h=harness();h.send({action:'session'});h.respond({code:0,data:{}});
  assert.match(h.replies[0].error,/无法确认/);assert.equal(h.replies[0].data,null);
});
test('HTTP and JSON risk responses pause requests for 60 seconds without automatic retry',()=>{
  for(const [status,code] of [[412,0],[429,0],[200,-412],[200,-509]]){
    const h=harness();h.send({url:publicUrl});h.respond({code},status);
    assert.equal(h.replies[0].errorCode,'RISK_CONTROL');assert.match(h.replies[0].error,/60 秒/);
    h.send({url:publicUrl,id:'blocked'});assert.equal(h.requests.length,1);
    h.send({action:'ping',id:'ping'});assert.equal(h.replies.at(-1).data.cooldownSeconds,60);
    h.advance(60001);h.send({url:publicUrl,id:'retry'});assert.equal(h.requests.length,2);
  }
});
test('authenticated metadata and reviews are projected to statistical fields only',()=>{
  const h=harness();h.send({url:publicUrl});
  h.respond({code:0,result:{media:{title:'Test',media_id:1,rating:{score:8,count:10},secret:'omit'},review:{content:'my private review'},user:{mid:42}}});
  assert.deepEqual(h.replies[0].data,{code:0,result:{media:{title:'Test',media_id:1,rating:{score:8,count:10}}}});
  h.send({id:'review',url:'https://api.bilibili.com/pgc/review/short/list?media_id=1'});
  h.respond({code:0,data:{total:1,next:0,list:[{review_id:123,score:8,ctime:100,content:'not required',author:{level:5,mid:42,uname:'name'}}]}});
  assert.deepEqual(h.replies[1].data.data.list,[{review_id:123,score:8,ctime:100,author:{level:5}}]);
});
test('expired session is surfaced and pending requests can be cancelled',()=>{
  const h=harness();h.send({url:publicUrl});h.respond({code:-101});assert.equal(h.replies[0].errorCode,'AUTH_REQUIRED');
  h.send({url:publicUrl,id:'pending'});h.send({action:'abort',id:'pending'});assert.equal(h.aborted(),1);
  h.send({url:publicUrl,id:'next'});assert.equal(h.requests.length,3);
});
