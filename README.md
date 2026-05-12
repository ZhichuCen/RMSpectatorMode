# RoboMaster 多视角直播 Web App

一个可直接部署到 GitHub Pages 的纯静态网页，用于读取 RoboMaster 实时直播 JSON 并同时监看多路视角。

## 功能

- 实时读取 `https://rm-static.djicdn.com/live_json/live_game_info.json`
- 自动解析赛区主视角 `zoneLiveString` 和机器人第一视角 `fpvData[].sources`
- 主画面使用最高可用清晰度，优先 `1080p/high`
- 小窗预览使用低清，优先 `540p/low`，降低多路监看的带宽占用
- 支持赛区切换、视角筛选、手动刷新和 15 秒自动刷新
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

## 录制可行性

首版没有内置录制按钮。原因是 GitHub Pages 是纯前端环境，不能稳定做服务器端录制、转码、分片合并或后台保存。

浏览器内理论上可以用 `MediaRecorder`、`video.captureStream()` 或 canvas 录制当前画面，但会遇到这些问题：

- 长时间录制容易受内存和后台标签页限速影响。
- HLS 视频和音频捕获在不同浏览器里表现不一致。
- 多路同时录制会同时增加带宽、解码、编码和文件管理压力。
- 文件保存和断点恢复能力很弱。

推荐方案：

- 只想录观看画面：用 OBS 录制浏览器窗口。
- 想保存原始直播流：从页面或实时 JSON 里取最新 m3u8 链接，再用 `ffmpeg` 或 Streamlink 录制。

示例：

```bash
ffmpeg -i "最新的完整 m3u8 链接" -c copy output.ts
```

```bash
streamlink "最新的完整 m3u8 链接" best -o output.ts
```
