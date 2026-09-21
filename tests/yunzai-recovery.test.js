import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {loadYunzaiPlugin} from './helpers/yunzai-host.js'

const host = await loadYunzaiPlugin(), bot = host.module
test.after(()=>host.cleanup())
const item = id => ({review_id:id,score:10,author:{level:5,mid:'private-author'},ctime:100,content:'private-comment'})
const response = (code=0,status=200,headers={get:()=>null}) => ({status,ok:status===200,headers,json:async()=>({code})})
function fakeClock() {
  let now=1000
  const sleeps=[]
  return {runtime:{nextRequestAt:0,cooldownUntil:0},now:()=>now,sleep:async ms=>{await new Promise(setImmediate);sleeps.push(ms);now+=ms},sleeps}
}
const api='/pgc/review/short/list?media_id=23679586&ps=20&cursor=123456'

test('risk retries keep the exact cursor, refresh shared Cookie and wait 120/300 seconds',async()=>{
  const clock=fakeClock(),requests=[],notices=[],file=path.join(host.root,'retry-cookie.txt')
  await fs.writeFile(file,'SESSDATA=before')
  const client=await bot.createClient({...clock,recovery:true,interval:0,cookieFile:file,
    fetchImpl:async(url,options)=>{requests.push([url,options.headers.Cookie,clock.now()]);return response(requests.length<3?-352:0)},
    onRetry:async event=>{notices.push(event);await fs.writeFile(file,'SESSDATA=after')}
  })
  await client.request(api)
  assert.deepEqual(clock.sleeps,[120000,300000])
  assert.equal(new Set(requests.map(r=>r[0])).size,1)
  assert.deepEqual(requests.map(r=>r[1]),['SESSDATA=before','SESSDATA=after','SESSDATA=after'])
  assert.equal(notices.length,2)
  // Successful pages do not reset the risk budget for this whole run.
  const failing=await bot.createClient({...fakeClock(),recovery:true,interval:0,cookie:'',fetchImpl:async()=>response(-352)})
  await assert.rejects(failing.request(api),e=>e.kind==='risk'&&e.resumeAfter>0)
})

test('risk budget is shared across successful pages in one collection run',async()=>{
  const clock=fakeClock();let calls=0
  const client=await bot.createClient({...clock,recovery:true,interval:0,cookie:'',fetchImpl:async()=>response(++calls%2?-352:0)})
  await client.request(api);await client.request(api)
  await assert.rejects(client.request(api),/-352/)
  assert.equal(calls,5);assert.deepEqual(clock.sleeps,[120000,300000])
})

test('HTTP risk codes and Retry-After are honored, excessive waits pause instead of retrying early',async()=>{
  for(const status of [412,429]) {
    const clock=fakeClock();let calls=0
    const client=await bot.createClient({...clock,recovery:true,interval:0,cookie:'',fetchImpl:async()=>++calls===1?response(0,status,{get:()=> '180'}):response()})
    await client.request(api);assert.deepEqual(clock.sleeps,[180000]);assert.equal(calls,2)
  }
  const clock=fakeClock();let calls=0
  const client=await bot.createClient({...clock,recovery:true,interval:0,cookie:'',fetchImpl:async()=>{calls++;return response(0,429,{get:()=> '1800'})}})
  await assert.rejects(client.request(api),e=>e.resumeAfter===1801000)
  assert.equal(calls,1);assert.deepEqual(clock.sleeps,[])
})

test('network and server failures have bounded exponential backoff; auth and unknown codes do not retry',async()=>{
  for (const fetchImpl of [async()=>response(0,503),async()=>{throw new TypeError('secret transport detail')}]) {
    const clock=fakeClock();let calls=0
    const client=await bot.createClient({...clock,recovery:true,interval:0,cookie:'',fetchImpl:async()=>{calls++;return fetchImpl()}})
    await assert.rejects(client.request(api),e=>e.kind==='transient'&&!e.message.includes('secret'))
    assert.equal(calls,4);assert.deepEqual(clock.sleeps,[5000,15000,45000])
  }
  for(const code of [-101,-325]) {
    const clock=fakeClock();let calls=0
    const client=await bot.createClient({...clock,recovery:true,interval:0,cookie:'',fetchImpl:async()=>{calls++;return response(code)}})
    await assert.rejects(client.request(api));assert.equal(calls,1);assert.deepEqual(clock.sleeps,[])
  }
})

test('timeout aborts the request and cancellation interrupts both network and cooldown',async()=>{
  const clock=fakeClock();let calls=0
  const client=await bot.createClient({...clock,recovery:true,interval:0,timeout:5,cookie:'',fetchImpl:async(url,{signal})=>{
    calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('transport')),{once:true}))
  }})
  await assert.rejects(client.request(api),/超时/);assert.equal(calls,4)
  const controller=new AbortController()
  const paused=await bot.createClient({recovery:true,interval:0,cookie:'',runtime:{nextRequestAt:0,cooldownUntil:0},signal:controller.signal,fetchImpl:async()=>response(-352),onRetry:async()=>controller.abort()})
  await assert.rejects(paused.request(api),e=>e.name==='AbortError')
  const inflight=new AbortController()
  const requesting=await bot.createClient({recovery:true,interval:0,cookie:'',signal:inflight.signal,runtime:{nextRequestAt:0,cooldownUntil:0},fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error('transport')),{once:true});inflight.abort()
  })})
  await assert.rejects(requesting.request(api),e=>e.name==='AbortError')
})

test('different clients share pacing and cooldown before sending another request',async()=>{
  const clock=fakeClock(),times=[]
  const opts={...clock,recovery:true,interval:3000,cookie:'',fetchImpl:async()=>{times.push(clock.now());return response()}}
  const a=await bot.createClient(opts),b=await bot.createClient(opts)
  await Promise.all([a.request(api),b.request(api)])
  assert.ok(times[1]-times[0]>=3000)
  clock.runtime.cooldownUntil=clock.now()+120000
  await b.request(api);assert.ok(times[2]-times[1]>=120000)
})

test('disk checkpoint resumes in a fresh module at saved cursor, preserving de-duplication and completed phases',async()=>{
  const store=bot.checkpointStore('recovery-user',host.root),job=bot.newCheckpoint('ep1521592',5)
  job.media={mediaId:'23679586',title:'模拟番剧',officialCount:3,officialScore:8}
  const save=()=>store.save(job);let calls=0
  await assert.rejects(bot.analyze(job.input,{request:async()=>{
    if(++calls===1)return{data:{list:[item(1)],next:'987',total:3}}
    throw new bot.RequestError('B 站触发风控（-352）。','risk')
  }},async()=>{},{job,save}),/-352/)
  // Bot's failure/cancel handler always flushes pages since the periodic save.
  job.status='paused';await save()
  const second=await loadYunzaiPlugin()
  try {
    const restored=await second.module.checkpointStore('recovery-user',host.root).load()
    const requests=[]
    const result=await second.module.analyze(restored.input,{request:async url=>{
      requests.push(url)
      return{data:{list:url.includes('/short/')?[item(1),item(2)]:[item(3)],next:0,total:url.includes('/short/')?2:1}}
    }},async()=>{},{job:restored,save:()=>store.save(restored)})
    assert.equal(requests.length,2);assert.ok(requests[0].includes('cursor=987'))
    assert.equal(result.short.length,2);assert.equal(result.long.length,1)
    const again=[]
    await second.module.analyze(restored.input,{request:async url=>{again.push(url);throw new Error('Unexpected fetch')}},async()=>{},{job:restored})
    assert.equal(again.length,0)
    const raw=JSON.stringify(await store.load())
    assert.ok(!/private-author|private-comment|SESSDATA/.test(raw))
  } finally {await second.cleanup()}
})

test('periodic checkpoint bounds progress lost on a hard process stop to nine successful pages',async()=>{
  const store=bot.checkpointStore('crash-user',host.root),job=bot.newCheckpoint('md1',0)
  job.media={mediaId:'1',title:'模拟'};let page=0
  await assert.rejects(bot.collectReviews('short','1',{request:async()=>{
    if(++page===14)throw new Error('process stop')
    return{data:{list:[item(page)],next:String(page),total:100}}
  }},100,{state:job.short,save:()=>store.save(job)}),/process stop/)
  const checkpoint=await store.load()
  assert.equal(job.short.pages,13);assert.equal(checkpoint.short.pages,10);assert.equal(checkpoint.short.cursor,'10')
})

test('stalled or empty nonterminal pages retry the same cursor once, never mark partial data complete',async()=>{
  for(const list of [[],[item(1)]]) {
    const state=bot.newCheckpoint('md1',0).short;let calls=0,stalls=0
    await assert.rejects(bot.collectReviews('short','1',{request:async()=>({data:{list:++calls===1?[item(1)]:list,next:'123',total:100}})},100,{state,onStall:async()=>{stalls++}}),/停止推进/)
    assert.equal(stalls,1);assert.equal(calls,3);assert.equal(state.pages,1);assert.equal(state.cursor,'123');assert.equal(state.done,false)
  }
})

test('observed ep1521592 tail: repeated known last review confirms EOF without duplicating rows',async()=>{
  for (const finalList of [[item(14)],[]]) {
    const state=bot.newCheckpoint('ep1521592',5).short
    Object.assign(state,{pages:2963,cursor:'9997',cursors:['9997']})
    let calls=0,confirmed=0,saved=0
    const result=await bot.collectReviews('short','23679586',{request:async url=>{
      calls++
      assert.ok(url.includes(calls===1?'cursor=9997':'cursor=9978'))
      return{data:{list:calls===1?Array.from({length:14},(_,i)=>item(i+1)):finalList,next:'9978',total:59273}}
    }},10000,{state,save:async()=>{saved++},onTail:async()=>{confirmed++}})
    assert.equal(calls,3);assert.equal(confirmed,1);assert.ok(saved>=2)
    assert.equal(result.rows.length,14);assert.equal(state.pages,2964)
    assert.equal(state.done,true);assert.equal(state.endReason,'confirmed-repeated-tail')
  }
})

test('full repeated page, unknown review, earlier loop and changing tail are never accepted as EOF',async()=>{
  for (const mode of ['full','unknown','early','changing']) {
    const state=bot.newCheckpoint('md1',5).short;let calls=0
    await assert.rejects(bot.collectReviews('short','1',{request:async()=>{
      calls++
      const list=calls===1||mode==='full'?Array.from({length:20},(_,i)=>item(i+1)):[item(mode==='unknown'?999:mode==='changing'?calls%2+1:20)]
      return {data:{list,next:'123',total:mode==='early'?100:20}}
    }},100,{state,onTail:async()=>{},onStall:async()=>{}}),e=>e.kind==='pagination')
    assert.equal(state.done,false);assert.equal(state.rows.length,20);assert.ok(calls<=6)
  }
})

test('only real risk errors suggest verification; saved progress records the actual pause reason',()=>{
  assert.match(bot.recoveryHint(new bot.RequestError('risk','risk')),/Cookie/)
  for(const error of [new bot.RequestError('pagination','pagination'),new bot.RequestError('network','transient'),new Error('disk')])assert.ok(!bot.recoveryHint(error).includes('Cookie'))
  const job=bot.newCheckpoint('md1',5)
  job.status='paused';job.lastError={kind:'pagination',message:'分页停止推进，不是风控响应。',at:Date.now()}
  assert.match(bot.progressText(job),/上次停止原因：分页停止推进/)
})

test('damaged checkpoints fail explicitly without silently starting a fresh collection',async()=>{
  const job=bot.newCheckpoint('md123',5),store=bot.checkpointStore('../../unsafe-key',host.root)
  await store.save(job);assert.equal((await store.load()).input,'md123')
  job.short.rows=[[999,5,100]];await store.save(job)
  await assert.rejects(store.load(),/进度文件损坏/)
  assert.throws(()=>bot.validateCheckpoint({...bot.newCheckpoint('md1',0),status:'complete'}))
})

test('bot cancellation during risk cooldown flushes partial pages, survives reload, exposes progress and resumes without images on failure',async t=>{
  const cwd=process.cwd(),fetcher=globalThis.fetch,screenshot=globalThis.__trueRankingScreenshot,cookie=process.env.BILIBILI_COOKIE
  process.chdir(host.root);process.env.BILIBILI_COOKIE='SESSDATA=test-only'
  t.after(()=>{process.chdir(cwd);globalThis.fetch=fetcher;globalThis.__trueRankingScreenshot=screenshot;if(cookie===undefined)delete process.env.BILIBILI_COOKIE;else process.env.BILIBILI_COOKIE=cookie})
  bot.runtime.cooldownUntil=0;bot.runtime.nextRequestAt=0
  const messages=[],instance=new bot.example();let pages=0
  const event=msg=>({self_id:'test-bot',user_id:'recovery-person',msg,reply:async message=>{
    messages.push(message)
    if(typeof message==='string'&&message.includes('当前页重试'))await instance.b_socre(event('#番剧评分取消'))
  }})
  globalThis.fetch=async url=>{
    bot.runtime.nextRequestAt=0 // Deterministic transport; pacing tested separately.
    const body=url.includes('/user?')?{code:0,result:{media:{title:'模拟番剧',rating:{score:8,count:2}}}}:
      ++pages===1?{code:0,data:{list:[item(1)],next:'998',total:2}}:{code:-352}
    return{status:200,ok:true,json:async()=>body}
  }
  globalThis.__trueRankingScreenshot=async()=>({type:'image'})
  await instance.b_socre(event('#番剧评分 md23679586'))
  assert.ok(!messages.some(m=>m?.type==='image'))
  const store=bot.checkpointStore('test-bot:recovery-person',host.root),saved=await store.load()
  assert.equal(saved.status,'cancelled');assert.equal(saved.short.pages,1);assert.equal(saved.short.cursor,'998')
  await instance.b_socre(event('#番剧评分进度'))
  assert.ok(messages.some(m=>typeof m==='string'&&m.includes('短评 1 页')))
  saved.resumeAfter=0;await store.save(saved);bot.runtime.cooldownUntil=0
  const requests=[]
  globalThis.fetch=async url=>{requests.push(url);bot.runtime.nextRequestAt=0;return{status:200,ok:true,json:async()=>({code:0,data:{list:[item(2)],next:0,total:2}})}}
  await instance.b_socre(event('#番剧评分继续'))
  assert.ok(requests[0].includes('cursor=998'));assert.equal(requests.length,2)
  assert.equal(messages.filter(m=>m?.type==='image').length,1)
  assert.equal((await store.load()).status,'complete')
})
