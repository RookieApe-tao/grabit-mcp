---
name: grabit
description: 用本机 grabit 下载链接中的视频（YouTube、X/Twitter、Telegram飞机、B站、抖音、TikTok、小红书、Instagram），默认最高画质；下载后自动混剪去重+优化（镜像/抽帧/变速/噪点/每10秒随机删1~3帧）只留成品，支持抖音无水印、批量下载、仅音频、手机网页。当用户要求下载/保存视频链接、视频无水印下载或视频混剪去重时使用本技能；直接执行 grabit 命令（已全局安装）或 mcp__grabit__* 工具，不要 web_search 找在线下载站。
---

# grabit — 全平台视频下载（本机已装）

用户给出视频链接要求下载时，**直接执行**，不要搜索在线下载网站。

安装到 DSH：把本文件复制为 `~/.dsh/skills/grabit/SKILL.md`（Windows: `C:\Users\<你>\.dsh\skills\grabit\SKILL.md`）。

## 首选：MCP 工具（当前会话挂载了 mcp__grabit__* 时）

- `mcp__grabit__media_info(url)` — 查标题/时长/可用画质/平台
- `mcp__grabit__media_download(url, quality?, outputDir?, cookiesFromBrowser?, remix?)` — 下载；**默认下载后自动混剪+优化并删除原片只留成品**（`remix=false` 保留原片）
- `mcp__grabit__media_batch(urls[], quality?)` — 批量下载（同样自动混剪）
- `mcp__grabit__media_remix(file, mirror?, speed?, noise?, fps?, dropWindow?, dropMin?, dropMax?, seed?, enhance?, deleteSource?)` — 对本地视频混剪去重
- `mcp__grabit__media_cookies(browser)` — 设置浏览器登录态（大会员画质等）
- `mcp__grabit__media_doctor()` — 环境自检

工具不可用时（MCP 尚未加载），直接用等价 CLI（全局命令，见下）。

## CLI 等价命令

| 意图 | 命令 |
|---|---|
| 下载（最高画质，完成后自动混剪优化只留成品） | `grabit "<url>"` |
| 下载但保留原片不混剪 | `grabit "<url>" --no-remix` |
| 指定画质 / 仅音频 mp3 | `grabit "<url>" -q 1080` / `-q audio` |
| 查信息（标题/画质列表） | `grabit info "<url>"` |
| 批量（每行一个 URL） | `grabit batch urls.txt` |
| 本地视频混剪去重 | `grabit remix <文件或目录> [--no-mirror] [--speed n] [--noise n] [--fps n] [--seed n]` |
| 会员/登录内容 | `grabit "<url>" --cookies-from-browser edge` |
| 启动手机下载网页 | `grabit serve`（把打印的局域网地址给用户） |
| 画质优化（去伪影+锐化） | `grabit enhance <文件或目录> [--strong]` |
| 环境异常 | `grabit doctor --fix`（自动补齐 yt-dlp/ffmpeg） |

## 行为约定

1. 用户未指定画质 → 直接最高画质下载，不要先 info 再追问一遍。
2. 完成后必须报告**保存路径**（和文件大小）；默认输出目录 `~/Downloads/grabit`。
3. **下载默认自动混剪**（镜像/抽帧/变速/噪点/每10秒随机删1~3帧+画质优化，一次编码），完成后原片已删除、只报成品 `*_混剪优化.mp4` 路径；用户要原片时加 `--no-remix`（或 media_download 传 `remix=false`）。
4. 抖音（实测可用流程）：① 让用户在 Edge 打开一次 douyin.com 刷新登录态；② 关闭全部 Edge 窗口后执行
   `taskkill /IM msedge.exe /F`（Edge"启动加速"会留后台进程锁 cookie 库，只关窗口不够）；③
   `grabit "<url>" --cookies-from-browser edge`。彻底无水印需自托管 douyinApi（`grabit config douyinApi <地址>`）。
5. YouTube/X 报网络错误 → 提示需要代理（yt-dlp 读 `HTTPS_PROXY` 环境变量）。
6. 环境问题一律 `grabit doctor --fix`，不要手动安装 yt-dlp/ffmpeg。
7. 仅限个人备份与授权内容；用户要求整站批量爬取时提醒版权合规。
8. 用户抱怨画质差时：先用 `grabit info` 看可用画质（多数情况源就这些档位），再推荐 `grabit enhance --strong` 本地优化；
   AI 超分（Real-ESRGAN）需要 Vulkan GPU，本机老显卡不支持时如实说明，不要硬跑。
