// ==UserScript==
// @name         B站番剧评分统计
// @namespace    https://pro-ivan.com/
// @version      1.2.3
// @description  自动统计B站番剧评分，支持短评/长评综合统计
// @author       YujioNako & 看你看过的霓虹
// @match        https://www.bilibili.com/bangumi/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://back-proxy.pro-ivan.cn/proxy/https://raw.githubusercontent.com/YujioNako/true_ranking_plugin/refs/heads/main/油猴脚本-trueRanking.js
// @downloadURL  https://back-proxy.pro-ivan.cn/proxy/https://raw.githubusercontent.com/YujioNako/true_ranking_plugin/refs/heads/main/油猴脚本-trueRanking.js
// @homepage     https://github.com/YujioNako/true_ranking_plugin/
// @icon         https://pro-ivan.com/favicon.ico
// ==/UserScript==

(function() {
    'use strict';

    class ControlPanel {
        constructor() {
            this.isOpen = false;
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
                    <button class="start-btn">开始统计</button>
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
            this.panel.style.transform = `translateX(${this.isOpen ? '0' : '100%'})`;
            this.toggleBtn.style.opacity = this.isOpen ? '0' : '1';

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
                input.value = `md${mdMatch[2]}`;
            } else if (epMatch) {
                this.epToMd(`https://www.bilibili.com/bangumi/play/ep${epMatch[2]}`)
                    .then(md => input.value = md);
            } else if (ssMatch) {
                this.epToMd(`https://www.bilibili.com/bangumi/play/ss${ssMatch[2]}`)
                    .then(md => input.value = md);
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
                    <h4>${data.title}</h4>
                    <div class="result-grid">
                        <div class="result-item">
                            <span class="label">官方评分：</span>
                            <span class="value">${data.offical_score}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">统计评分：</span>
                            <span class="value">${data.total_avg}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">标称评论数：</span>
                            <span class="value">${data.offical_count}</span>
                        </div>
                        <div class="result-item">
                            <span class="label">总样本数：</span>
                            <span class="value">${data.total_samples}</span>
                        </div>
                    </div>
                    <div class="details">
                        <div class="detail-section short">
                            <h5>短评统计</h5>
                            <p>平均分：${data.short_avg}</p>
                            <p>样本数：${data.short_samples}</p>
                        </div>
                        <div class="detail-section long">
                            <h5>长评统计</h5>
                            <p>平均分：${data.long_avg}</p>
                            <p>样本数：${data.long_samples}</p>
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
            this.totalCount = { short: 0, long: 0 };
            this.metadata = {};
            this.retryLimit = 5;
            this.banWaitTime = 60000;
        }

        async analyze(input) {
            try {
                const mdId = await this.processInput(input);
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

                const scores = result.data.list.map(item => item.score);
                type === 'short' ? this.shortScores.push(...scores) : this.longScores.push(...scores);
                
                collected += result.data.list.length;
                this.totalCount[type] = result.data.total || this.totalCount[type];
                
                const progress = ((collected / this.totalCount[type]) * 100).toFixed(1);
                this.ui.updateProgress(type, progress, collected, this.totalCount[type]);
                
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
                        }
                    });

                    const data = await res.json();
                    if (data.code === -412) {
                        await this.delay(this.banWaitTime);
                        retry++;
                        continue;
                    }
                    return data;
                } catch (e) {
                    retry++;
                    await this.delay(1000);
                }
            }
            throw new Error('请求失败，请稍后重试');
        }

        showFinalResults() {
            const totalScores = [...this.shortScores, ...this.longScores];
            
            const calcAvg = scores => scores.length 
                ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
                : '暂无';

            this.ui.showResults({
                title: this.metadata.title,
                offical_score: this.metadata.official_score,
                total_avg: calcAvg(totalScores),
                offical_count: this.metadata.official_count,
                total_samples: totalScores.length,
                short_avg: calcAvg(this.shortScores),
                short_samples: this.shortScores.length,
                long_avg: calcAvg(this.longScores),
                long_samples: this.longScores.length
            });
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
            top: 15%;
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
    `);

    // 初始化控制台
    new ControlPanel();
})();
