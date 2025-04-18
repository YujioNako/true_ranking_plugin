# true_ranking_plugin
通过获取b站番剧长短评计算实际的评分数据，适用于Yunzai-Bot，核心代码来自Bilibili@看你看过的霓虹

现已增加油猴脚本与浏览器脚本，方便在浏览器上使用

## 使用方法
### Yunzai版
将`true_ranking.js`扔进/plugins/example后配置相关参数后重启即可使用

使用方法参考 #番剧评分帮助
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
### Yunzai版
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
