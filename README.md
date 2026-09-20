# true_ranking_plugin
通过获取b站番剧长短评计算实际的评分数据，适用于Yunzai-Bot，核心代码来自Bilibili@看你看过的霓虹

现已增加油猴脚本与浏览器脚本，方便在浏览器上使用

## 网页应用

**[打开 True Ranking 番剧评分观察室](https://yujionako.github.io/true_ranking_plugin/)**

纯静态应用位于 `docs/`，支持 GitHub Pages，无构建依赖，不需要配置密钥。网页、油猴、控制台和 Yunzai 图片版均可独立使用。

### 实时统计

1. 在浏览器安装 Tampermonkey，并允许用户脚本运行。
2. [安装或更新网页连接助手](https://yujionako.github.io/true_ranking_plugin/true-ranking-bridge.user.js) 至 **1.1.0 或更新版本**，刷新网页。仅刷新网页不会更新已安装的旧版脚本。
3. 在同一浏览器配置中登录 B 站，回到网页点击「检测登录状态」；确认会话后输入 `md4315402`、`ep705756`、`ss26257` 或对应完整番剧链接，点击开始统计。
4. 调整最低用户等级（0–6）即时重新计算，查看长短评明细、分数分布及最早评论起两年的累计趋势。

GitHub Pages 不能直接跨域读取 B 站 API。连接助手通过 Tampermonkey 的跨域请求能力访问限定的评分接口，由扩展自动携带当前浏览器的 B 站 Cookie（`anonymous: false`，支持的版本同时使用 B 站 Cookie 分区）。Cookie 只发往 B 站，不读取、复制到网页、存储到本站或传给代理。登录检测仅返回是否登录，不返回账户详情；评分响应也仅保留统计必需字段。安装连接助手不会修改原有油猴脚本。

**遇到 412：** 旧版 1.0.0 强制匿名请求，无法使用现有登录会话。请先升级连接助手，再登录 B 站并检测会话。HTTP 412 / 429 或接口 -412 / -509 会停止采集，并暂停助手请求至少 60 秒，不自动重试。分页间隔已从 350 ms 调整为 1200 ms。412 也可能来自网络、频率等风控，登录不保证解除；请在 B 站页面处理其提示的验证，稍后手动重试。已登录但检测不到会话时，确认是同一浏览器配置（而非另一个配置或隐私窗口），并更新 Tampermonkey。代理模式不能使用本机 Cookie。

不支持扩展的设备可使用自己的 HTTPS CORS 代理（选择「自定义代理」），代理接口格式为 `代理前缀 + https://api.bilibili.com/接口路径`，例如 `https://your-server.example/proxy/https://api.bilibili.com/pgc/review/user?media_id=4315402`。代理需返回原始 JSON 和允许网页来源的 CORS 头。仓库原脚本的更新代理不作为网页默认数据服务。

### 数据与统计口径

- 默认过滤低于 Lv.5 的样本，Lv.0 表示不按等级过滤。缺失或非法等级、非法评分的记录不纳入计算。
- 每类评论按评论 ID 去重；同一用户的长评与短评仍作为两个样本，与原脚本口径一致。
- API 可见分页读完不代表全体评分已采集。采集评论数和官方评分人数口径不同，比值可能超过 100%。
- 原脚本的正态模型估计保留在「计算方法与结果说明」，不作为置信保证。等级过滤后的总体人数未知，估计尤其需要谨慎解读。
- 最近 5 部番剧的数据仅保存在当前浏览器；无账户、遥测或上传。JSON 导入/导出只包含评分、等级、时间，不包含评论正文、昵称或用户 ID。可清除站点数据移除缓存。
- 导入数据无需连接助手或代理；文件上限 30 MB。短链接 `b23.tv` 请先展开成完整番剧链接。

### 开发与部署

使用 Node.js 20+：`npm run dev` 启动 `http://127.0.0.1:4173`，`npm run check` 检查脚本语法，`npm test` 运行统计与网络边界测试。无需 `npm install`。

`.github/workflows/pages.yml` 在 `main` 更新后检查并发布 `docs/`。首次部署需先在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，然后运行 **Publish True Ranking**；默认工作流令牌不能替你首次启用 Pages。也可移除该部署工作流后选择从 `main` 的 `/docs` 目录直接发布。

连接助手默认只匹配本仓库的 Pages 地址和本地 4173 端口；部署到其他域名时需同步修改它的 `@match`、`@downloadURL` 与 `@updateURL`。

## 使用方法
### Yunzai版
将 [`true_ranking.js`](./true_ranking.js) 复制到机器人的 `plugins/example/true_ranking.js`，替换旧版本后重启。仍是单文件插件，不需要复制 `docs/`、测试文件或手工安装 HTML 模板。

默认发送类似油猴面板的 **PNG 图片**，包括：官方评分、过滤前后计算均分、样本数、短评/长评明细、两组分数分布、两年累计均分趋势，以及原脚本模型估计说明。图片模板首次运行时自动生成在机器人 `data/true-ranking/` 中。

```text
#番剧评分 md4315402
#番剧评分 4315402
#番剧评分 ep705756
#番剧评分 ss26257
#番剧评分 https://www.bilibili.com/bangumi/media/md4315402
#番剧评分 md4315402 等级5
#番剧评分 md4315402 等级0
#番剧评分帮助
```

- 最低等级默认 5，可指定 0–6；`等级0` 不按等级过滤。全部样本的评分口径与旧版保持一致。缺失等级的有效评分仍计入全部样本与 Lv.0，但不进入更高等级的过滤结果；缺失日期不进入趋势。
- 支持完整番剧链接和 `b23.tv` 分享链接。解析分享链接不发送 Cookie，并检查每次重定向目标。
- 使用宿主的 `lib/puppeteer/puppeteer.js` 截图接口，适用于提供该兼容接口的 Yunzai V3 / Miao-Yunzai。需要机器人本身的 Chromium / Puppeteer 可正常截图；Linux 建议安装中文字体，如 Noto Sans CJK。**截图或图片发送失败会自动回退文字结果**。
- 推荐 Node.js 18+；更早的宿主需要自带 `node-fetch`。插件不再绑定特定的 `oicq` / `icqq` 消息库，由宿主截图组件返回图片消息。
- 每次统计使用独立数据，避免多人查询混入另一部番剧结果。同一用户的重复请求会提示等待；分页按评论 ID 去重，风控或分页异常时明确报错，不把未完成的采集伪装为成功。
- 默认请求间隔 1200 ms、单次超时 30 秒；可在文件顶部 `CONFIG` 中调整。评论多的番剧可能需要数分钟。

如果机器人遇到 412 或登录失效，可由管理员在**机器人进程的环境变量**中配置 `BILIBILI_COOKIE` 并重启。服务器不能继承查询用户浏览器里的 B 站登录状态；不要在群聊、源码仓库或截图中放 Cookie。插件只向固定 B 站 API 发送该配置，且不会打印它。登录不保证解除 B 站的频率或网络风控。

图片布局预览（模拟数据）：

![Yunzai 评分面板布局示例](./examples/yunzai-panel-preview.png)

### 油猴脚本
将`TamperMonkey-trueRanking.js`导入油猴后，在任意番剧页面通过右侧按钮打开面板使用

或者在[Greasyfork脚本网站](https://greasyfork.org/zh-CN/scripts/529380-b站番剧评分统计)快捷安装后，在任意番剧页面通过右侧按钮打开面板使用

### 浏览器脚本
复制`console-trueRanking.js`到浏览器开发者工具的控制台，然后按脚本内说明使用

## 注意
输入的番剧号（md号）指的是番剧详情页面的网址中，“https://www.bilibili.com/bangumi/media/md” 后面跟着的那一串数字；

如三体动画的：https://www.bilibili.com/bangumi/media/md4315402 ，番剧号就是4315402，使用插件时发送 #番剧评分 4315402 即可

<b>现在直接在#番剧评分 后面贴分享链接（含ep号）也可以计算评分了</b>

此外，因为无法获取到所有数据，所谓“真实评分”可能是有偏差的，结果仅供参考，与核心代码作者及YujioNako无关

对于Yunzai版的用户，针对报错fetch is not defined，可以参考这个>>>https://github.com/ldcivan/Yunzai_imgSearcher/issues/3
## 示例
### Yunzai 旧版文字输出（历史示例）
<img src="https://i0.hdslb.com/bfs/new_dyn/ca832d860bc9bdc7431fb641864b713711022578.jpg@1554w.webp" width=50%>

### 油猴脚本
#### 整体效果
<img style="max-height: 350px;" alt="1744849868124" src="https://github.com/user-attachments/assets/108a91aa-3e41-4c4e-8346-c598fd74e6ad" />

#### 面板细节展示
<img style="max-height: 350px;" alt="1744849868124" src="https://github.com/user-attachments/assets/22745de9-67fd-429a-af1d-d100156a6174" />

## 其他
感谢：

* [官方Yunzai-Bot-V3](https://github.com/Le-niao/Yunzai-Bot) : [Gitee](https://gitee.com/Le-niao/Yunzai-Bot)
  / [Github](https://github.com/Le-niao/Yunzai-Bot)
* [看你看过的霓虹](https://space.bilibili.com/295614485) : [【技术】还三体动画一个公道！](https://www.bilibili.com/video/BV1WG4y117mz)
