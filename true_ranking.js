import plugin from '../../lib/plugins/plugin.js'
import { segment } from "oicq";
import { createRequire } from "module";
import fetch from "node-fetch"
//const require_ = createRequire(import.meta.url);

//const axios = require_('axios');

var md_id = ""; //

var allScore = []
let totalCount = {
    short: 0,
    long: 0,
}
//let render = null

var offical_title = "";
var offical_score = 0;
var offical_count = 0;

export class example extends plugin {
    constructor() {
        super({
            name: 'true_score',
            event: 'message',
            priority: 1000,
            rule: [
                {
                  reg: "^#?番剧评分帮助$",
                  fnc: 'b_socre_help'
                },
                {
                    reg: '^#?番剧评分.*$',
                    fnc: 'b_socre'
                }
            ]
        })
    }

    
    async b_socre(e) {
        //beforeRender()
        allScore = [] //重置
        totalCount = { //重置
            short: 0,
            long: 0,
        }
        md_id = e.msg.replace(/#| |番剧评分| /g, "")
        
        const reg = /^[0-9]+.?[0-9]*$/
        
        if (md_id==""){
            this.reply("不可为空ID！\n若不明白如何使用该插件，请向bot发送“#番剧评分帮助”获取使用方式。")
            //this.reply(md_id)
            return
        }
        if(md_id.search(/(https:\/\/|http:\/\/)(b23\.tv\/|(www\.)?bilibili\.com\/)/g)!=-1){
            this.reply("您使用了一个地址，正在尝试转换为md_id……")
            if(md_id.search(/md/g)!=-1){
                var md_id_arr = md_id.match(/\/md(\d+)/g)
                this.reply(md_id_arr[0])
                var md_id_result = md_id_arr[0].replace('/md','')
                md_id_result = md_id_result.replace('/','')
                md_id = md_id_result
            }
            if(md_id.search(/ep/g)!=-1)
                await this.turn2md(md_id)
            this.reply(`已获取到md_id:${md_id}`)
        }
        else{
            if(md_id.search(/md/g)!=-1){
                var md_id_arr = md_id.match(/md(\d+)/g)
                this.reply(md_id_arr[0])
                var md_id_result = md_id_arr[0].replace('md','')
                md_id = md_id_result
            }
            if(md_id.search(/ep/g)!=-1){
                this.reply(`将由ep_id转为md_id`)
                var ep_id_arr = md_id.match(/ep(\d+)/g)
                await this.turn2md("https://b23.tv/"+ep_id_arr)
            }
            this.reply(`已获取到md_id:${md_id}`)
            if (!reg.test(md_id)){
                this.reply("你输入的不是合法的Bilibili番剧链接/ID。\n您应该在番剧详情页地址栏获取md后的ID，或者直接发送番剧分享链接。")
                this.reply(md_id)
                return
            }
        }
        
        await this.baseInfo(md_id)
        console.log("--统计短评");
        e.reply("统计短评中")
        await this.scoreMain('short', e, md_id)
        console.log("--统计长评");
        e.reply("统计长评中")
        await this.scoreMain('long', e, md_id)
        this.average(e)
        //rmDialog()
        
    }
    
    async turn2md(url){
        url = url.match(/(https?:\/\/[^\s]+)/g);
        const ep_res = await fetch(url, { "method": "GET" });
        var ep_src = await ep_res.text();
        var md_id_arr = ep_src.match(/www\.bilibili\.com\/bangumi\/media\/md(\d+)/g)
        if(md_id_arr==[]){
            this.reply("ep转md错误，请直接发送md号")
            return
        }
        var md_id_result = md_id_arr[0].replace('www.bilibili.com/bangumi/media/md','')
        md_id = md_id_result
        //return md_id_result
    }
    
    async baseInfo(md_id){
        let baseinfo_url = `https://api.bilibili.com/pgc/review/user?media_id=${md_id}`
        const baseinfo_res = await fetch(baseinfo_url, { "method": "GET" });
        var baseinfo  = await baseinfo_res.json()
        //this.reply(JSON.stringify(baseinfo.result.media.title))
        offical_title = JSON.stringify(baseinfo.result.media.title).replace(/"/g, '');
        try {
            offical_score = JSON.stringify(baseinfo.result.media.rating.score);
        } catch {
            offical_score = "暂无评分";
        }
        try {
            offical_count = JSON.stringify(baseinfo.result.media.rating.count);
        } catch {
            offical_count = "NaN";
        }
    }
    
    async getScore(next, type, e) {
        await this.delay(200);
    
        //var local_url = window.location.href;
        
        //var md_id = local_url.match(/media\/md(\S*)\/\?/)[1];
        
        
    
        let url = `https://api.bilibili.com/pgc/review/${type}/list?media_id=${md_id}`
    
        if (next) {
            url += `&cursor=${next}`
        }
        const res = await fetch(url, { "headers": { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", "Reference": "https://www.bilibili.com"}, "method": "GET" });
        let { data, code } = await res.json();
        if (code === 0) {
            console.log("GET")
            if (totalCount[type] == 0) {
                totalCount[type] = data.total
            }
        } else {
            this.reply('可能出现风控 ERR:' + JSON.stringify(code));
            data = JSON.parse(`{"list":[], "next":0}`)
            //data = await this.getScore(next, type, e);
        }
        return data
    }
    
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async scoreMain(type, e) {
        let { list, next } = await this.getScore(undefined, type, e, md_id)
        this.handlerList(list)
    
        while (true) {
            const data = await this.getScore(next, type, e, md_id)
            this.handlerList(data.list)
            //render(type)
            next = data.next
            if (next == 0) {
                return
            }
        }
    }
    async average(e) {
        const total = allScore.reduce((p, v) => {
            return p + v
        }, 0)
        const s = total / allScore.length
        const sf = s.toFixed(1)
        console.log('平均分:', sf)
        this.reply(`番剧名：${offical_title}\n真实平均分：${sf}\n基于实际收集到的${allScore.length}个评价（含${totalCount.short}个短评与${totalCount.long}个长评，实际收集数据可能因风控等原因不与标称值相同）\n----------\n官方平均分：${offical_score}\n基于${offical_count}个评价（含长短评）`)
    }
    async handlerList(list) {
        allScore.push(...list.map(item => item.score))
    }
    
    //main()
    
  async b_socre_help(e){
      await e.reply("回复“#番剧评分”+番剧mdID/分享链接即可查看番剧真实评分")
  }
}
