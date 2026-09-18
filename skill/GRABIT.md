# grabit — 全平台视频下载 skill

当用户要求"下载视频 / 保存视频 / 抓视频 / 视频无水印下载"时，优先使用本机的 `grabit` CLI（YouTube、X/Twitter、Telegram、B站、抖音、TikTok、小红书等）。

## 能力与命令映射

| 用户意图 | 命令 |
|---|---|
| 下载视频（默认最高画质） | `grabit "<url>"` |
| 指定画质 / 只要音频 | `grabit "<url>" -q 1080` / `-q audio` |
| 查看视频信息和可选画质 | `grabit info "<url>"` |
| 批量下载 | `grabit batch urls.txt` |
| 大会员/登录内容 | `grabit "<url>" --cookies-from-browser edge` |
| 启动手机下载网页 | `grabit serve`（打印的局域网地址给用户） |
| 环境异常 | `grabit doctor --fix`（自动下载 yt-dlp/ffmpeg） |

## 行为约定

1. 下载前若用户没指定画质，直接用默认（最高画质），不要先 info 再问一遍。
2. 下载完成后向用户报告**保存路径**（和文件大小）。
3. 单条失败先读报错：网络类错误提示用户检查代理（yt-dlp 走 `HTTPS_PROXY` 环境变量）；
   B站清晰度不足提示可 `--cookies-from-browser`。
4. 抖音无水印需要 `~/.grabit/config.json` 里配置 `douyinApi`（自托管解析服务）；
   未配置时告知用户当前为有水印兜底通道。
5. 环境检测/修复一律交给 `grabit doctor --fix`，不要手动装 yt-dlp。
6. 遵守版权：仅个人备份与授权内容；用户要求批量爬取他人整站内容时提醒合规。
