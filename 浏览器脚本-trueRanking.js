
// 在浏览器控制台中运行以下代码后，调用 startBScore() 开始使用
async function startBScore() {
    // 自动检测当前页面ID
    const currentUrl = window.location.href;
    let defaultInput = '';
    
    // 匹配媒体页md格式：/md123456
    const mdMatch = currentUrl.match(/(\/md|md)(\d+)/i);
    // 匹配分集页ep格式：/ep123456
    const epMatch = currentUrl.match(/(\/ep|ep)(\d+)/i);
    
    if (mdMatch) {
        defaultInput = `md${mdMatch[2]}`;
    } else if (epMatch) {
        defaultInput = await turn2md(`https://www.bilibili.com/bangumi/play/ep${epMatch[2]}`);
    }

    const userInput = prompt("请输入B站番剧mdID或分享链接：", defaultInput);
    if (!userInput) {
        console.log("输入不能为空！");
        return;
    }
    await new BScore().b_socre(userInput);
}

    async function turn2md(url) {
        try {
            const res = await fetch(url);
            const text = await res.text();
            const mdMatch = text.match(/www\.bilibili\.com\/bangumi\/media\/md(\d+)/);
            return mdMatch[1];
        } catch (e) {
            console.log("EP转MD失败:", e);
        }
    }

class BScore {
    constructor() {
        this.shortScores = [];
        this.longScores = [];
        this.totalCount = { short: 0, long: 0 };
        this.offical_title = "";
        this.offical_score = "";
        this.offical_count = "";
        this.retryLimit = 3;
        this.banWaitTime = 60000;
    }

    async b_socre(input) {
        try {
            let md_id = input.replace(/#| |番剧评分| /g, "");
            
            // URL处理逻辑
            if (md_id.match(/(https:\/\/|http:\/\/)/)) {
                console.log("检测到链接，尝试提取md_id...");
                const epMatch = md_id.match(/\/md(\d+)/);
                if (epMatch) {
                    md_id = epMatch[1];
                } else {
                    const epId = md_id.match(/ep(\d+)/)?.[1];
                    if (epId) {
                        md_id = await this.ep2md(epId);
                    }
                }
            }

            if (!md_id.match(/^\d+$/)) {
                console.log("无效的ID，请确认输入的是正确的md数字ID或番剧链接");
                return;
            }

            console.log("正在获取基础信息...");
            await this.baseInfo(md_id);
            
            console.log("开始统计短评...");
            await this.scoreMain('short', md_id);
            
            console.log("\n开始统计长评...");
            await this.scoreMain('long', md_id);
            
            this.showResult();
        } catch (e) {
            console.error("处理过程中发生错误：", e);
        }
    }

    async baseInfo(md_id) {
        const res = await fetch(`https://api.bilibili.com/pgc/review/user?media_id=${md_id}`);
        const data = await res.json();
        
        this.offical_title = data.result.media.title;
        this.offical_score = data.result.media.rating?.score || "暂无";
        this.offical_count = data.result.media.rating?.count || "NaN";
    }

    async getReviews(type, cursor) {
        let retryCount = 0;
        
        while (retryCount < this.retryLimit) {
            try {
                const url = new URL(`https://api.bilibili.com/pgc/review/${type}/list`);
                url.searchParams.set('media_id', this.md_id);
                if (cursor) url.searchParams.set('cursor', cursor);

                const res = await fetch(url, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                        "Referer": "https://www.bilibili.com"
                    },
                    credentials: "include",
                    referrerPolicy: "strict-origin-when-cross-origin"
                });
                
                const result = await res.json();
                
                if (result.code !== 0) {
                    console.warn(`API返回异常代码：${result.code}，消息：${result.message}`);
                    if (result.code === -412 && retryCount < this.retryLimit) {
                        console.log(`触发风控，等待 ${this.banWaitTime/1000} 秒后重试...`);
                        await this.delay(this.banWaitTime);
                        retryCount++;
                        continue;
                    }
                    throw new Error(`API请求失败：${result.message}`);
                }

                return result;
            } catch (e) {
                if (retryCount < this.retryLimit) {
                    console.log(`请求失败，${this.banWaitTime/1000}秒后重试... (${retryCount+1}/${this.retryLimit})`);
                    await this.delay(this.banWaitTime);
                    retryCount++;
                } else {
                    throw e;
                }
            }
        }
    }

    async scoreMain(type, md_id) {
        this.md_id = md_id;
        let cursor;
        let collected = 0;
        
        do {
            try {
                const result = await this.getReviews(type, cursor);
                const { data } = result;
                
                if (!data?.list) {
                    console.warn("未获取到有效数据，可能已达最大重试次数");
                    break;
                }

                // 分别存储不同评价类型
                if (type === 'short') {
                    this.shortScores.push(...data.list.map(item => item.score));
                } else {
                    this.longScores.push(...data.list.map(item => item.score));
                }
                
                collected += data.list.length;
                
                // 设置总数
                if (this.totalCount[type] === 0 && data.total) {
                    this.totalCount[type] = data.total;
                }
                
                cursor = data.next;
                await this.delay(200);
                
                // 进度显示
                const progress = collected / this.totalCount[type];
                console.log(`${type === 'short' ? '短评' : '长评'}进度：${(progress * 100).toFixed(1)}% (${collected}/${this.totalCount[type]})`);

            } catch (e) {
                console.error("数据获取失败：", e);
                break;
            }
        } while (cursor && cursor !== "0");
    }

    showResult() {
        const allScores = [...this.shortScores, ...this.longScores];
        
        const calculateAverage = (scores) => {
            if (scores.length === 0) return '暂无';
            return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        };

        console.log([
            `\n======= 详细统计结果 =======`,
            `当前时间：${new Date().toLocaleString()}`,
            `番剧名称：${this.offical_title}`,
            `----------------------------`,
            `短评统计：`,
            `• 平均分：${calculateAverage(this.shortScores)}`,
            `• 有效样本：${this.shortScores.length} 条`,
            `• 官方标称总数：${this.totalCount.short} 条`,
            `----------------------------`,
            `长评统计：`,
            `• 平均分：${calculateAverage(this.longScores)}`,
            `• 有效样本：${this.longScores.length} 条`,
            `• 官方标称总数：${this.totalCount.long} 条`,
            `----------------------------`,
            `综合统计：`,
            `• 总平均分：${calculateAverage(allScores)}`,
            `• 总有效样本：${allScores.length} 条`,
            `----------------------------`,
            `官方数据：`,
            `• 官方评分：${this.offical_score}`,
            `• 官方样本：${this.offical_count} 条`,
            `==============================\n`
        ].join("\n"));
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 使用方法：
// 1. 在控制台粘贴全部代码
// 2. 输入 startBScore() 并回车
// 3. 根据提示输入番剧mdID或分享链接