---
name: grabit
description: 用本机 grabit 下载链接中的视频（YouTube、X/Twitter、Telegram飞机、B站、抖音、TikTok、小红书、Instagram），默认最高画质，支持抖音无水印、批量下载、仅音频、手机网页。当用户要求下载/保存视频链接、视频无水印下载时使用本技能；直接执行 grabit 命令（已全局安装）或 mcp__grabit__* 工具，不要 web_search 找在线下载站。
---

# grabit — 全平台视频下载（本机已装）

用户给出视频链接要求下载时，**直接执行**，不要搜索在线下载网站。

安装到 DSH：把本文件复制为 `~/.dsh/skills/grabit/SKILL.md`（Windows: `C:\Users\<你>\.dsh\skills\grabit\SKILL.md`）。

## 首选：MCP 工具（当前会话挂载了 mcp__grabit__* 时）

- `mcp__grabit__media_info(url)` — 查标题/时长/可用画质/平台
- `mcp__grabit__media_download(url, quality?, outputDir?, cookiesFromBrowser?)` — 下载（quality: best/2160/1080/720/480/audio）
- `mcp__grabit__media_batch(urls[], quality?)` — 批量下载
- `mcp__grabit__media_cookies(browser)` — 设置浏览器登录态（大会员画质等）
- `mcp__grabit__media_doctor()` — 环境自检

工具不可用时（MCP 尚未加载），直接用等价 CLI（全局命令，见下）。

## CLI 等价命令

| 意图 | 命令 |
|---|---|
| 下载（默认最高画质，自动合并） | `grabit "<url>"` |
| 指定画质 / 仅音频 mp3 | `grabit "<url>" -q 1080` / `-q audio` |
| 查信息（标题/画质列表） | `grabit info "<url>"` |
| 批量（每行一个 URL） | `grabit batch urls.txt` |
| 会员/登录内容 | `grabit "<url>" --cookies-from-browser edge` |
| 启动手机下载网页 | `grabit serve`（把打印的局域网地址给用户） |
| 环境异常 | `grabit doctor --fix`（自动补齐 yt-dlp/ffmpeg） |

## 行为约定

1. 用户未指定画质 → 直接最高画质下载，不要先 info 再追问一遍。
2. 完成后必须报告**保存路径**（和文件大小）；默认输出目录 `~/Downloads/grabit`。
3. 抖音无水印依赖 `~/.grabit/config.json` 的 `douyinApi`（自托管解析服务）；未配置时走兜底通道，如实告知可能带水印。
4. YouTube/X 报网络错误 → 提示需要代理（yt-dlp 读 `HTTPS_PROXY` 环境变量）。
5. 环境问题一律 `grabit doctor --fix`，不要手动安装 yt-dlp/ffmpeg。
6. 仅限个人备份与授权内容；用户要求整站批量爬取时提醒版权合规。
