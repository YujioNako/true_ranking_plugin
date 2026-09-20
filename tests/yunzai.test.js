import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {loadYunzaiPlugin} from './helpers/yunzai-host.js'
import * as web from '../docs/core.js'
const host=await loadYunzaiPlugin()
const bot=host.module
test.after(()=>host.cleanup())
const rows=[[2,0,1700000000],[6,4,1701000000],[10,5,1702000000],[10,6,1703000000]]
const data={mediaId:'123',title:'测试番剧',timestamp:'2026-09-20T03:00:00Z',officialScore:8,officialCount:100,short:rows,long:[],totals:{short:100,long:0},skipped:0}

test('production module only exports the class understood by the Yunzai plugin loader',()=>{
  assert.deepEqual(host.source.match(/^export\s+.*$/gm),['export class example extends plugin {'])
})

test('Yunzai commands retain bare IDs and support filter zero, EP/SS and share links',()=>{
  assert.deepEqual(bot.parseCommand('#番剧评分 md123 等级0'),{input:'md123',filterLevel:0})
  assert.deepEqual(bot.parseCommand('番剧评分 123'),{input:'123',filterLevel:5})
  assert.equal(bot.parseTarget('ep123').type,'ep');assert.equal(bot.parseTarget('ss123').type,'ss')
  assert.equal(bot.parseTarget('分享番剧 https://b23.tv/abc').type,'short')
  for(const input of ['','https://evil.test/md123','https://b23.tv@evil.test/abc'])assert.throws(()=>bot.parseTarget(input))
  assert.throws(()=>bot.parseCommand('#番剧评分 md123 等级7'))
})
test('Yunzai image statistics match the web/userscript calculation for valid samples',()=>{
  assert.deepEqual(bot.summarize(rows),web.summarize(rows))
  assert.deepEqual(bot.trend(rows),web.trend(rows))
  assert.equal(bot.probability(rows,100),web.probability(rows,100))
  assert.deepEqual(bot.filterRows(rows,5),web.filterRows(rows,5))
  assert.equal(bot.summarize([]).average,null);assert.equal(bot.probability([rows[0]],100),null)
})
test('review pagination deduplicates and does not refetch the first page at cursor zero',async()=>{
  let calls=0
  const item=id=>({review_id:id,score:10,author:{level:5},ctime:100})
  const client={request:async()=>++calls===1?{data:{list:[item(1)],next:'99',total:2}}:{data:{list:[item(1),item(2)],next:'0',total:2}}}
  const result=await bot.collectReviews('short','123',client)
  assert.equal(calls,2);assert.equal(result.rows.length,2);assert.equal(result.total,2)
  await assert.rejects(bot.collectReviews('short','123',{request:async()=>({data:{list:[item(1)],next:'99'}})}),/停止推进/)
})
test('missing author level and dates keep valid scores in the original unfiltered mean',async()=>{
  const result=await bot.collectReviews('short','123',{request:async()=>({data:{list:[{review_id:1,score:8}],next:0}})})
  assert.equal(bot.summarize(result.rows).average,8)
  assert.equal(bot.filterRows(result.rows,5).length,0)
  assert.equal(bot.filterRows(result.rows,0).length,1)
  assert.deepEqual(bot.trend(result.rows),[])
})
test('Bilibili cookies go only to fixed API requests, never short links or redirects',async()=>{
  const requests=[]
  const client=await bot.createClient({interval:0,cookie:'SESSION=test-secret',fetchImpl:async(url,options)=>{
    requests.push({url,options})
    if(url.startsWith('https://b23.tv/'))return{status:302,headers:{get:()=> 'https://www.bilibili.com/bangumi/play/ep123'}}
    return{status:200,ok:true,json:async()=>({code:0})}
  }})
  assert.deepEqual(await client.expand('https://b23.tv/abc'),{type:'ep',id:'123'})
  await client.request('/pgc/review/user?media_id=1')
  assert.equal(requests[0].options.headers.Cookie,undefined)
  assert.equal(requests[1].options.headers.Cookie,'SESSION=test-secret')
  assert.equal(requests[1].options.redirect,'manual')
  await assert.rejects(client.request('https://evil.test/pgc/review/user?media_id=1'),/拒绝/)
  const unsafe=await bot.createClient({interval:0,fetchImpl:async()=>({status:302,headers:{get:()=> 'http://127.0.0.1/private'}})})
  await assert.rejects(unsafe.expand('https://b23.tv/abc'),/只接受/)
})
test('HTTP 412 stops analysis instead of producing a success image from partial data',async()=>{
  let calls=0
  const client=await bot.createClient({interval:0,cookie:'secret-value',fetchImpl:async()=>{calls++;return{status:412}}})
  await assert.rejects(bot.analyze('md123',client),error=>/风控/.test(error.message)&&!error.message.includes('secret-value'))
  assert.equal(calls,1)
})
test('panel escapes titles, has both distributions/trends and no NaN on empty data',()=>{
  const html=bot.buildPanelHtml({...data,title:'<img src=x onerror=alert(1)> {{danger}}'},5)
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'))
  for(const label of ['短评统计','长评统计','分数分布统计','平均分变化统计','B站官方评分'])assert.ok(html.includes(label))
  const empty=bot.buildPanelHtml({...data,short:[],long:[],officialScore:null,officialCount:null},6)
  assert.ok(!/NaN|Infinity/.test(empty));assert.ok(empty.includes('暂无'))
  assert.ok(!/NaN|Infinity/.test(bot.buildPanelHtml({...data,short:[[10,5,100],[10,5,100]]},5)))
})
test('concurrent renders use the host screenshot contract, unique files and trusted template data',async()=>{
  const captured=[]
  const renderer={screenshot:async(name,options)=>{
    captured.push(options)
    assert.equal(name,'true-ranking');assert.equal(options.imgType,'png')
    assert.equal(await fs.readFile(options.tplFile,'utf8'),'{{@html}}')
    const directory=path.join(host.root,'temp/html/true-ranking');await fs.mkdir(directory,{recursive:true})
    await fs.writeFile(path.join(directory,options.saveId+'.html'),'temporary')
    return{type:'image',file:options.saveId}
  }}
  const results=await Promise.all([bot.renderPanel(data,5,{root:host.root,renderer}),bot.renderPanel({...data,title:'另一部番剧'},0,{root:host.root,renderer})])
  assert.notEqual(results[0].file,results[1].file)
  assert.ok(captured[0].html.includes('测试番剧'));assert.ok(captured[1].html.includes('另一部番剧'))
  for(const item of captured)await assert.rejects(fs.access(path.join(host.root,'temp/html/true-ranking',item.saveId+'.html')))
})
test('bot sends an image, isolates concurrent users and falls back to text if rendering fails',async t=>{
  const previousFetch=globalThis.fetch,previousScreenshot=globalThis.__trueRankingScreenshot,previousCookie=process.env.BILIBILI_COOKIE,previousCwd=process.cwd()
  process.chdir(host.root)
  delete process.env.BILIBILI_COOKIE
  t.after(()=>{process.chdir(previousCwd);globalThis.fetch=previousFetch;globalThis.__trueRankingScreenshot=previousScreenshot;if(previousCookie===undefined)delete process.env.BILIBILI_COOKIE;else process.env.BILIBILI_COOKIE=previousCookie})
  globalThis.fetch=async url=>{
    const id=new URL(url).searchParams.get('media_id')
    return{status:200,ok:true,json:async()=>url.includes('/user?')?{code:0,result:{media:{title:'番剧'+id,rating:{score:8,count:1}}}}:{code:0,data:{total:1,next:0,list:[{review_id:1,score:id==='123'?2:10,author:{level:5},ctime:100}]}}}
  }
  globalThis.__trueRankingScreenshot=async(name,options)=>options.html.includes('番剧456')?false:{type:'image',html:options.html}
  const one=[],two=[]
  const event=(id,list)=>({user_id:id,msg:`#番剧评分 md${id}`,reply:async message=>{list.push(message)}})
  const instance=new bot.example()
  await Promise.all([instance.b_socre(event(123,one)),instance.b_socre(event(456,two))])
  const image=one.find(item=>item?.type==='image')
  assert.ok(image);assert.ok(image.html.includes('番剧123'));assert.ok(!image.html.includes('番剧456'))
  assert.ok(two.some(item=>typeof item==='string'&&item.includes('回退文字结果')&&item.includes('10.0')))
})
