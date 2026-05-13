# RoboMaster 多视角直播 Web App

一个可直接部署到 GitHub Pages 的纯静态网页，用于读取 RoboMaster 实时直播 JSON 并同时监看多路视角。

## 功能

- 实时读取 `https://rm-static.djicdn.com/live_json/live_game_info.json`，并在 GitHub Pages 部署时禁用 Referer 以避开 DJI CDN 的来源拦截
- 自动解析赛区主视角 `zoneLiveString` 和机器人第一视角 `fpvData[].sources`
- 主画面使用最高可用清晰度，优先 `1080p/high`
- 小窗预览使用低清，优先 `540p/low`，降低多路监看的带宽占用
- 支持 `1 大 + 右侧 N 小`、`2 大并排 + 下方 N 小`、`4 大四宫格 + 下方 N 小`、`4x4 全小视角` 布局
- 支持在 `1 大` 模式直接替换大画面，在 `2 大`/`4 大` 模式为每个大屏槽位分别指定直播源
- 支持大画面清晰度切换；`4 大四宫格` 默认使用 `720p/middle`
- 支持赛区切换、视角筛选、手动刷新、GitHub 仓库跳转和 15 秒自动刷新
- 使用 `hls.js` 播放 HLS，Safari 会优先走原生 HLS

## 本地预览

在仓库目录启动一个静态服务器：

```bash
python3 -m http.server 8080
```

然后打开：

```text
http://localhost:8080
```

直接双击 `index.html` 也能加载页面，但浏览器对本地文件的网络和模块策略可能不同，建议用本地服务器预览。

## GitHub Pages 部署

1. 把 `index.html`、`styles.css`、`app.js`、`README.md` 推送到 GitHub 仓库。
2. 在仓库设置里进入 `Pages`。
3. Source 选择当前分支，目录选择仓库根目录。
4. 保存后访问 GitHub Pages 给出的 URL。

这个应用不需要后端和构建步骤。

## 直播源说明

DJI 的 HLS 链接带有 `auth_key`，链接可能会过期或被更新。页面不会长期缓存旧链接，而是每 15 秒重新读取 JSON，并用最新完整 URL 播放。

如果直播加载失败，通常有三类原因：

- 当前赛区或视角还未开播。
- `auth_key` 已失效，点击刷新或等待自动刷新。
- 当前网络无法访问 DJI CDN。
