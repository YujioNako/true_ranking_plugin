// ==UserScript==
// @name         B站番剧评分统计
// @namespace    https://pro-ivan.com/
// @version      1.4.2
// @description  自动统计B站番剧评分，支持短评/长评综合统计
// @author       YujioNako & 看你看过的霓虹
// @match        https://www.bilibili.com/bangumi/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://back-proxy.pro-ivan.cn/proxy/https://raw.githubusercontent.com/YujioNako/true_ranking_plugin/refs/heads/main/TamperMonkey-trueRanking.js
// @downloadURL  https://back-proxy.pro-ivan.cn/proxy/https://raw.githubusercontent.com/YujioNako/true_ranking_plugin/refs/heads/main/TamperMonkey-trueRanking.js
// @homepage     https://github.com/YujioNako/true_ranking_plugin/
// @icon         https://pro-ivan.com/favicon.ico
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    class ControlPanel {
        constructor() {
            this.isOpen = false;
            this.currentMd = null;
            this.createUI();
            this.bindEvents();
            //this.autoFillInput();
        }

        createUI() {
            // 侧边栏按钮
            this.toggleBtn = document.createElement('div');
            this.toggleBtn.className = 'control-btn';
            this.toggleBtn.textContent = '评分统计';

            // 控制台主体
            this.panel = document.createElement('div');
            this.panel.className = 'control-panel';
            this.panel.innerHTML = `
                <div class="panel-header">
                    <h3>B站番剧评分统计</h3>
                    <button class="close-btn">×</button>
                </div>
                <div class="panel-content">
                    <div class="input-group">
                        <label>输入MD/EP ID或链接：</label>
                        <input type="text" id="bInput" class="b-input" placeholder="md123456 或 B站链接">
                    </div>
                    <button class="start-btn" id="start-btn">开始统计</button>
                    <div class="progress-area"></div>
                    <div class="result-area"></div>
                </div>
            `;

            document.body.appendChild(this.toggleBtn);
            document.body.appendChild(this.panel);
        }

        bindEvents() {
            this.toggleBtn.addEventListener('click', () => this.togglePanel());
            this.panel.querySelector('.close-btn').addEventListener('click', () => this.togglePanel());
            this.panel.querySelector('.start-btn').addEventListener('click', () => this.startAnalysis());
        }

        togglePanel() {
            this.isOpen = !this.isOpen;
            this.panel.style.transform = `translateY(-50%) translateX(${this.isOpen ? '0' : '100%'})`;
            this.toggleBtn.style.opacity = this.isOpen ? '0' : '1';
            this.toggleBtn.style.pointerEvents = this.isOpen ? 'none' : '';

            // 新增自动填充逻辑
            if (this.isOpen) {
                this.autoFillInput();
            }
        }

        autoFillInput() {
            const currentUrl = window.location.href;
            const input = this.panel.querySelector('#bInput');
            
            const mdMatch = currentUrl.match(/(\/md|md)(\d+)/i);
            const epMatch = currentUrl.match(/(\/ep|ep)(\d+)/i);
            const ssMatch = currentUrl.match(/(\/ss|ss)(\d+)/i);
        
            // 清空原有内容
            input.value = '正在获取md号...';
            
            if (mdMatch) {
                this.currentMd = mdMatch[2];
                input.value = `md${this.currentMd}`;
                this.loadSavedData();
            } else if (epMatch) {
                this.epToMd(`https://www.bilibili.com/bangumi/play/ep${epMatch[2]}`)
                    .then(md => {
                        this.currentMd = md.replace('md', '');
                        input.value = md;
                        this.loadSavedData();
                    });
            } else if (ssMatch) {
                this.epToMd(`https://www.bilibili.com/bangumi/play/ss${ssMatch[2]}`)
                    .then(md => {
                        this.currentMd = md.replace('md', '');
                        input.value = md;
                        this.loadSavedData();
                    });
            }
        }

         async loadSavedData() {
             if (!this.currentMd) return;
             const saved = GM_getValue(`md${this.currentMd}`);
             if (saved) {
                 saved.isCached = true;
                 this.showResults(saved);
                 console.log('找到cache');
             }
         }

        async epToMd(url) {
            try {
                const res = await fetch(url);
                const text = await res.text();
                const mdMatch = text.match(/www\.bilibili\.com\/bangumi\/media\/md(\d+)/);
                return mdMatch ? `md${mdMatch[1]}` : '';
            } catch (e) {
                console.log("EP转MD失败:", e);
                return '';
            }
        }

        startAnalysis() {
             if (this.currentMd) {
                 GM_deleteValue(`md${this.currentMd}`);
             }

            this.panel.querySelector('#start-btn').innerHTML = '正在统计';
            this.panel.querySelector('#start-btn').style = 'pointer-events: none; background: gray;';
            const input = this.panel.querySelector('#bInput').value.trim();
            if (!input) {
                this.showMessage('输入不能为空！', 'error');
                return;
            }

            this.clearResults();
            new BScoreAnalyzer(this).analyze(input);
        }

        showMessage(message, type = 'info') {
            const progressArea = this.panel.querySelector('.progress-area');
            const msg = document.createElement('div');
            msg.className = `message ${type}`;
            msg.textContent = message;
            progressArea.appendChild(msg);
        }

        updateProgress(type, progress, current, total) {
            const progressArea = this.panel.querySelector('.progress-area');
            const existing = progressArea.querySelector(`.${type}-progress`);
            
            if (existing) {
                existing.innerHTML = `${type}进度：${progress}% (${current}/${total})`;
            } else {
                const p = document.createElement('div');
                p.className = `progress-item ${type}-progress`;
                p.innerHTML = `${type}进度：${progress}% (${current}/${total})`;
                progressArea.appendChild(p);
            }
        }

        showResults(data) {
            const resultArea = this.panel.querySelector('.result-area');
            resultArea.innerHTML = `
                <div class="result-section">
                    <h4>${data.title}<br><small>${data.isCached ? `${new Date(data.timestamp).toLocaleString('sv-SE')}<span style="color:#00a1d6">(缓存数据)</span>` : new Date().toLocaleString('sv-SE')}</small><br><small style="color: gray;">过滤等级：${data.filterLevel}</small></h4>
                    <div class="result-grid">
                        <div class="result-item">
                            <span class="label">官方评分：</span>
                            <span class="value">${data.offical_score}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">统计评分：</span>
                            <span class="value">${data.total_avg_filtered}(${data.total_probability_filtered}%)/${data.total_avg}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">标称评论数：</span>
                            <span class="value">${data.offical_count}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">总样本数：</span>
                            <span class="value">${data.total_samples_filtered}/${data.total_samples}</span>
                        </div>
                    </div>
                    <div class="details">
                        <div class="detail-section short">
                            <h5>短评统计</h5>
                            <p>平均分：${data.short_avg_filtered}(${data.short_probability_filtered}%)/${data.short_avg}</p>
                            <p>样本数：${data.short_samples_filtered}/${data.short_samples}</p>
                        </div>
                        <div class="detail-section long">
                            <h5>长评统计</h5>
                            <p>平均分：${data.long_avg_filtered}(${data.long_probability_filtered}%)/${data.long_avg}</p>
                            <p>样本数：${data.long_samples_filtered}/${data.long_samples}</p>
                        </div>
                    </div>
                    <div class="score-distribution">
                        <h5>分数分布统计</h5>
                        <div class="chart-container">
                            ${[2,4,6,8,10].map(score => `
                                <div class="bar-item">
                                    <div class="bar" style="height: ${50 * data.scoreDistributionFiltered[score] / Math.max(...Object.values(data.scoreDistributionFiltered)) || 0}px"></div>
                                    <span>${score}分<br>${data.scoreDistributionNum[score] || 0}<br>(${data.scoreDistributionFiltered[score] || 0}%)</span>
                                </div>
                            `).join('')}
                        </div>
                        <h5>分数分布统计（未过滤）</h5>
                        <div class="chart-container">
                            ${[2,4,6,8,10].map(score => `
                                <div class="bar-item">
                                    <div class="bar" style="height: ${50 * data.scoreDistribution[score] / Math.max(...Object.values(data.scoreDistribution)) || 0}px"></div>
                                    <span>${score}分<br>${data.scoreDistributionNum[score] || 0}<br>(${data.scoreDistribution[score] || 0}%)</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="score-distribution">
                        <h5>平均分变化统计</h5>
                        <div class="chart-container">
                            ${[0,1,2,3,4,5,6,7].map(score => `
                                <div class="bar-item">
                                    <div class="bar" style="height: ${50 * (data.scoreTrendFiltered[score] - Math.min(...Object.values(data.scoreTrendFiltered))) / (Math.max(...Object.values(data.scoreTrendFiltered)) - Math.min(...Object.values(data.scoreTrendFiltered))) || 0}px"></div>
                                    <span>${new Date(data.scoreTrendTimeFiltered[score] * 1000).toISOString().slice(5, 10)}<br>${data.scoreTrendFiltered[score] || 0}</span>
                                </div>
                            `).join('')}
                        </div>
                        <h5>平均分变化统计（未过滤）</h5>
                        <div class="chart-container">
                            ${[0,1,2,3,4,5,6,7].map(score => `
                                <div class="bar-item">
                                    <div class="bar" style="height: ${50 * (data.scoreTrend[score] - Math.min(...Object.values(data.scoreTrend))) / (Math.max(...Object.values(data.scoreTrend)) - Math.min(...Object.values(data.scoreTrend))) || 0}px"></div>
                                    <span>${new Date(data.scoreTrendTime[score] * 1000).toISOString().slice(5, 10)}<br>${data.scoreTrend[score] || 0}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        clearResults() {
            this.panel.querySelector('.progress-area').innerHTML = '';
            this.panel.querySelector('.result-area').innerHTML = '';
        }
    }

    class BScoreAnalyzer {
        constructor(ui) {
            this.ui = ui;
            this.shortScores = [];
            this.longScores = [];
            this.shortScoresFiltered = [];
            this.longScoresFiltered = [];
            this.totalCount = { short: 0, long: 0 };
            this.metadata = {};
            this.retryLimit = 5;
            this.banWaitTime = 60000;
            this.mdId = null;
            this.filterLevel = 5;
        }

        async analyze(input) {
            try {
                const mdId = await this.processInput(input);
                this.mdId = mdId;
                if (!mdId) return;

                await this.fetchBaseInfo(mdId);
                await this.fetchReviews('short', mdId);
                await this.fetchReviews('long', mdId);
                this.showFinalResults();
            } catch (e) {
                this.ui.showMessage(`错误: ${e.message}`, 'error');
            }
        }

        async processInput(input) {
            let mdId = input.replace(/#| |番剧评分| /g, "");
            
            if (mdId.match(/^(https?:)/)) {
                const epId = mdId.match(/ep(\d+)/)?.[1];
                if (epId) return this.ep2md(epId);
                return mdId.match(/md(\d+)/)?.[1];
            }
            return mdId.replace(/^md/, '');
        }

        async ep2md(epId) {
            const url = `https://www.bilibili.com/bangumi/play/ep${epId}`;
            const res = await fetch(url);
            const text = await res.text();
            const mdMatch = text.match(/www\.bilibili\.com\/bangumi\/media\/md(\d+)/);
            return mdMatch[1];
        }

        async fetchBaseInfo(mdId) {
            const res = await fetch(`https://api.bilibili.com/pgc/review/user?media_id=${mdId}`);
            const data = await res.json();
            
            this.metadata = {
                title: data.result.media.title,
                official_score: data.result.media.rating?.score || "暂无",
                official_count: data.result.media.rating?.count || "NaN"
            };
        }

        async fetchReviews(type, mdId) {
            let cursor;
            let collected = 0;
            
            do {
                const result = await this.getReviewPage(type, mdId, cursor);
                if (!result?.data?.list) break;

                const scores = result.data.list.map(item => [item.score, item.author.level, item.ctime]);
                type === 'short' ? this.shortScores.push(...scores) : this.longScores.push(...scores);
                
                collected += result.data.list.length;
                this.totalCount[type] = result.data.total || this.totalCount[type];
                
                const progress = ((collected / this.totalCount[type]) * 100).toFixed(1);
                this.ui.updateProgress(type, progress, collected, this.totalCount[type]);

                if (cursor && cursor == result.data.next) break;
                
                cursor = result.data.next;
                await this.delay(200);
            } while (cursor && cursor !== "0");
        }

        async getReviewPage(type, mdId, cursor) {
            let retry = 0;
            while (retry < this.retryLimit) {
                try {
                    const url = new URL(`https://api.bilibili.com/pgc/review/${type}/list`);
                    url.searchParams.set('media_id', mdId);
                    if (cursor) url.searchParams.set('cursor', cursor);

                    const res = await fetch(url, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                            "Referer": "https://www.bilibili.com"
                        },
                        credentials: 'include'
                    });

                    const data = await res.json();
                    if (data.code !== 0) {
                        document.querySelector('#start-btn').innerHTML = `等待第${retry + 1}次重试`;
                        console.log(`等待第${retry + 1}次重试`);
                        await this.delay(this.banWaitTime);
                        retry++;
                        document.querySelector('#start-btn').innerHTML = `正在统计`;
                        continue;
                    }
                    return data;
                } catch (e) {
                    document.querySelector('#start-btn').innerHTML = `等待第${retry + 1}次重试`;
                    console.log(`等待第${retry + 1}次重试`);
                    await this.delay(1000);
                    retry++;
                    document.querySelector('#start-btn').innerHTML = `正在统计`;
                }
            }
            throw new Error('请求失败，请稍后重试');
        }

        showFinalResults() {
            function filterData(data, filterLevel) {
                return data.filter(item => item[1] >= filterLevel);
            }

            this.shortScoresFiltered = filterData(this.shortScores, this.filterLevel);
            this.longScoresFiltered = filterData(this.longScores, this.filterLevel);

            const totalScores = [...this.shortScores, ...this.longScores];
            const totalScoresFiltered = [...this.shortScoresFiltered, ...this.longScoresFiltered];

            const calcAvg = scores => scores.length
                ? (scores.reduce((sum, item) => sum + item[0], 0) / scores.length).toFixed(1)
                : '暂无';

            function calculateProbability(totalScores, officialCount) {
                totalScores = totalScores.map(item => item[0]); // 提取原数据的分数项目方便计算

                const n = totalScores.length;
                console.log(n,officialCount,totalScores);
                if (n === 0 || officialCount === 0) return 0; // 处理无效输入
                if (n >= officialCount) return 1; // 记录数等于甚至大于标称，无误差，概率为1

                // 计算样本均值和样本标准差
                const sum = totalScores.reduce((acc, score) => acc + score, 0);
                const sampleMean = sum / n;
                const sumSquaredDiffs = totalScores.reduce((acc, score) => acc + Math.pow(score - sampleMean, 2), 0);
                const sampleVariance = sumSquaredDiffs / (n - 1);
                const s = Math.sqrt(sampleVariance);

                // 计算标准误，考虑有限总体校正
                let standardError;
                const populationSize = officialCount;
                if (populationSize <= 1) {
                    standardError = 0;
                } else {
                    const finitePopulationCorrection = Math.sqrt((populationSize - n) / (populationSize - 1));
                    standardError = (s / Math.sqrt(n)) * finitePopulationCorrection;
                }

                if (standardError === 0) return 1; // 无误差，概率为1

                const Z = 0.1 / standardError;
                console.log(2 * standardNormalCDF(Z) - 1);
                return 2 * standardNormalCDF(Z) - 1;
            }

            // 标准正态分布CDF近似计算
            function standardNormalCDF(x) {
                const sign = x < 0 ? -1 : 1;
                x = Math.abs(x) / Math.sqrt(2);
                const t = 1.0 / (1.0 + 0.3275911 * x);
                const y = t * (0.254829592 + t*(-0.284496736 + t*(1.421413741 + t*(-1.453152027 + t*1.061405429))));
                const erf = 1 - y * Math.exp(-x * x);
                return 0.5 * (1 + sign * erf);
            }

            // 统计分数分布（基于每个子数组的第一个元素）
            const scoreDistribution = (totalScores) =>
            [2,4,6,8,10].reduce((acc, score) => {
                const count = totalScores.filter(s => s[0] === score).length;
                acc[score] = totalScores.length === 0
                    ? "0.0"
                : (count / totalScores.length * 100).toFixed(1);
                return acc;
            }, {});

            // 统计分数分布数量（基于每个子数组的第一个元素）
            const scoreDistributionNum = (totalScores) =>
            [2,4,6,8,10].reduce((acc, score) => {
                acc[score] = totalScores.filter(s => s[0] === score).length;
                return acc;
            }, {});

            // 计算随时间变化的平均分变化情况
            function computeAverageScores(data) {
                if (data.length === 0) return [];

                // 提取时间戳
                const times = data.map(item => item[2]);
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                const totalSpan = maxTime - minTime;

                if (totalSpan === 0) {
                    // 所有时戳相同，返回所有评分的平均值
                    const avg = data.reduce((sum, item) => sum + item[0], 0) / data.length;
                    return Array(8).fill(avg);
                }

                // 初始化8个时间段的统计
                const intervals = Array(8).fill(0).map(() => ({ sum: 0, count: 0 }));
                const intervalLength = totalSpan / 8;

                for (const item of data) {
                    const timestamp = item[2];
                    const score = item[0];

                    // 计算属于哪个时间段
                    let intervalIndex = Math.floor((timestamp - minTime) / intervalLength);
                    if (intervalIndex >= 8) intervalIndex = 7;

                    intervals[intervalIndex].sum += score;
                    intervals[intervalIndex].count += 1;
                }

                // 修改后的累积平均分计算
                return intervals.reduce((acc, interval, index) => {
                    // 累加当前段的sum和count
                    const prev = acc[index - 1] || { cumulativeSum: 0, cumulativeCount: 0 };
                    const cumulativeSum = prev.cumulativeSum + interval.sum;
                    const cumulativeCount = prev.cumulativeCount + interval.count;

                    // 计算并保存当前累积平均值
                    const avg = cumulativeCount > 0
                    ? (cumulativeSum / cumulativeCount).toFixed(2)
                    : '0.0';

                    return [...acc, {
                        cumulativeSum,
                        cumulativeCount,
                        avg
                    }];
                }, []).map(item => item.avg);
            }

            function computeAverageScoresTime(data) {
                if (data.length === 0) return [];

                // 提取时间戳
                const times = data.map(item => item[2]);
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                const totalSpan = maxTime - minTime;

                if (totalSpan === 0) {
                    // 所有时戳相同，返回minTime
                    return Array(8).fill(minTime);
                }

                // 初始化8个时间段的统计
                const intervals = Array(8).fill(0).map(() => ({ sum: 0, count: 0 }));
                const intervalLength = totalSpan / 8;
                return Array.from({length: 8}, (_, i) => (minTime + (i+1)*intervalLength).toFixed(0));
            }

            const resultData = {
                title: this.metadata.title,
                offical_score: this.metadata.official_score,
                total_avg: calcAvg(totalScores),
                total_avg_filtered: calcAvg(totalScoresFiltered),
                offical_count: this.metadata.official_count,
                total_samples: totalScores.length,
                total_samples_filtered: totalScoresFiltered.length,
                total_probability: (100*calculateProbability(totalScores, this.metadata.official_count)).toFixed(2),
                total_probability_filtered: (100*calculateProbability(totalScoresFiltered, this.metadata.official_count)).toFixed(2),
                short_avg: calcAvg(this.shortScores),
                short_avg_filtered: calcAvg(this.shortScoresFiltered),
                short_samples: this.shortScores.length,
                short_samples_filtered: this.shortScoresFiltered.length,
                short_probability: (100*calculateProbability(this.shortScores, this.totalCount.short)).toFixed(2),
                short_probability_filtered: (100*calculateProbability(this.shortScoresFiltered, this.totalCount.short)).toFixed(2),
                long_avg: calcAvg(this.longScores),
                long_avg_filtered: calcAvg(this.longScoresFiltered),
                long_samples: this.longScores.length,
                long_samples_filtered: this.longScoresFiltered.length,
                long_probability: (100*calculateProbability(this.longScores, this.totalCount.long)).toFixed(2),
                long_probability_filtered: (100*calculateProbability(this.longScoresFiltered, this.totalCount.long)).toFixed(2),
                scoreDistribution: scoreDistribution(totalScores),
                scoreDistributionFiltered: scoreDistribution(totalScoresFiltered),
                scoreDistributionNum: scoreDistributionNum(totalScores),
                scoreDistributionNumFiltered: scoreDistributionNum(totalScoresFiltered),
                scoreTrend: computeAverageScores(totalScores),
                scoreTrendFiltered: computeAverageScores(totalScoresFiltered),
                scoreTrendTime: computeAverageScoresTime(totalScores),
                scoreTrendTimeFiltered: computeAverageScoresTime(totalScoresFiltered),
                filterLevel: this.filterLevel,
                timestamp: new Date().toISOString()
            };
            console.log(computeAverageScores(totalScores));
            GM_setValue(`md${this.mdId}`, resultData);
            console.log('cache已保存');
            this.ui.showResults(resultData);

            document.querySelector('#start-btn').innerHTML = '开始统计';
            document.querySelector('#start-btn').style = '';
        }

        delay(ms) {
            return new Promise(r => setTimeout(r, ms));
        }
    }

    // 添加样式
    GM_addStyle(`
        .control-btn {
            position: fixed;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            background: #00a1d6;
            color: white;
            padding: 12px 20px;
            border-radius: 25px 0 0 25px;
            cursor: pointer;
            transition: all 0.3s;
            z-index: 9999;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }

        .control-panel {
            position: fixed;
            right: 0;
            top: 50%;
            transform: translateY(-50%) translateX(100%);
            width: 350px;
            background: white;
            border-radius: 10px 0 0 10px;
            box-shadow: -2px 0 10px rgba(0,0,0,0.1);
            transition: transform 0.3s;
            z-index: 9998;
            padding: 20px;
            max-height: 90vh;
            overflow-y: auto;
        }

        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }

        .input-group {
            margin-bottom: 15px;
        }

        .b-input {
            width: 100%;
            padding: 8px;
            margin-top: 5px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }

        .start-btn {
            width: 100%;
            padding: 10px;
            background: #00a1d6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.3s;
        }

        .start-btn:hover {
            background: #0087b3;
        }

        .progress-area {
            margin: 15px 0;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 4px;
        }

        .result-area {
            margin-top: 15px;
        }

        .result-section {
            background: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
        }

        .result-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin: 10px 0;
        }

        .result-item {
            background: white;
            padding: 10px;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .detail-section {
            padding: 10px;
            background: white;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        span,p {
            font-size: smaller;
        }

        .score-distribution {
            margin-top: 15px;
            padding: 15px;
            background: #f9f9f9;
            border-radius: 4px;
        }

        .chart-container {
            display: flex;
            justify-content: space-around;
            align-items: flex-end;
            height: 100px;
            margin-top: 10px;
        }

        .bar-item {
            width: 18%;
            text-align: center;
        }

        .bar {
            background: #00a1d6;
            transition: height 0.5s;
            border-radius: 3px 3px 0 0;
            position: relative;
        }

        .bar:hover {
            background: #0087b3;
            cursor: pointer;
        }

        .bar-item span {
            display: block;
            margin-top: 5px;
            font-size: 12px;
            color: #666;
        }
    `);

    // 初始化控制台
    new ControlPanel();
})();

