# grabit-mcp

**全平台高清视频下载器** —— 一个包三种用法：命令行 CLI、MCP Server（给 AI Agent 用）、手机网页。
支持 YouTube / X(Twitter) / Telegram / B站 / 抖音 / TikTok / 小红书 / Instagram 等，默认**最高画质原始码流**（ffmpeg 合并、无转码），抖音可接无水印 API。

> 仅供个人备份与已授权内容。请尊重各平台版权与服务条款，勿用于二次分发或商业用途。

## 特性

- 🎯 **最高画质默认**：`bestvideo+bestaudio` 自动合并 mp4，可选 4K/1080/720/480/仅音频
- 🪄 **环境自愈**：首次运行自动检测并下载 yt-dlp / ffmpeg 到 `~/.grabit/bin`（免管理员、不污染 PATH）
- 🤖 **MCP Server**：5 个结构化工具，DSH / Claude Desktop 等任意 MCP 客户端可用
- 📱 **手机网页**：`grabit serve` 一键启动，手机浏览器直接下载 + 取回电脑上已下载的文件
- 🧩 **平台路由**：URL 自动识别平台；抖音预留无水印 API 通道
- 📦 **换机零成本**：GitHub + npm 托管代码，新电脑两条命令完全恢复

## 安装

**Windows（PowerShell 一条命令）：**

```powershell
irm https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.ps1 | iex
```

**macOS / Linux：**

```bash
curl -fsSL https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.sh | bash
```

脚本做的事：克隆到 `~/.grabit/app` → `npm i -g` 本地目录（dist 已预编译，无需构建）→ `grabit doctor --fix` 自动补齐 yt-dlp/ffmpeg。
**更新版本 = 重跑同一条命令。**

> npm 注册表版（`npm i -g grabit-mcp`）等账号就绪后提供；当前 GitHub 直装即全功能。

从源码构建：

```bash
git clone git@github.com:RookieApe-tao/grabit-mcp.git
cd grabit-mcp && npm install && npm run build
node dist/cli.js --help
```

## CLI 用法

```bash
grabit "https://www.bilibili.com/video/BV..."            # 最高画质
grabit "https://x.com/user/status/123" -q 1080           # 指定画质
grabit "https://youtu.be/xxx" -q audio                   # 仅音频 mp3
grabit info "https://..."                                # 查标题/可用画质
grabit batch urls.txt                                    # 批量（每行一个链接）
grabit serve                                             # 启动手机网页（默认 :8787）
grabit doctor [--fix]                                    # 环境自检/自动修复
grabit config outputDir "D:/Videos"                      # 改输出目录
```

会员/登录内容（如 B 站大会员画质）：

```bash
grabit "https://..." --cookies-from-browser edge
```

## MCP 接入

通用配置（Claude Desktop / 任意 MCP 客户端）：

```json
{
  "mcpServers": {
    "grabit": { "command": "grabit-mcp" }
  }
}
```

工具列表：

| 工具 | 说明 |
|---|---|
| `media_info` | 查询标题/时长/UP主/可用画质/平台 |
| `media_download` | 下载（quality/audio、输出目录、cookies 等参数） |
| `media_batch` | 批量下载并汇总结果 |
| `media_cookies` | 设置/清除浏览器登录态 |
| `media_doctor` | 环境自检 |

## 手机端（不需要服务器）

```bash
grabit serve --host 0.0.0.0   # 默认已监听 0.0.0.0
```

- **在家**：手机连同一 Wi-Fi，访问启动时打印的 `局域网访问` 地址，可"添加到主屏幕"当 App 用
- **出门**：电脑和手机都装 [Tailscale](https://tailscale.com)（免费），手机随时访问电脑的 Tailscale IP
- 页面里可以直接**取回电脑上已下载的文件**（走 `/api/file` 流式传输）

⚠ 仅供局域网/个人组网使用，不要把端口暴露到公网（服务无鉴权）。

## 抖音无水印（可选增强）

抖音默认走 yt-dlp（可能带水印/需 cookies）。要稳定无水印，自托管一次解析 API：

```bash
docker run -d -p 8000:8000 --name douyin-api evil0ctal/douyin-tiktok-download-api
grabit config douyinApi http://127.0.0.1:8000
```

之后 `grabit "https://v.douyin.com/xxx/"` 直接得到无水印原片。

## 配置项（`~/.grabit/config.json`，`grabit config show` 查看）

| 键 | 说明 |
|---|---|
| `outputDir` | 下载输出目录（默认 `~/Downloads/grabit`） |
| `binDir` | yt-dlp/ffmpeg 存放目录（默认 `~/.grabit/bin`） |
| `ytDlpPath` / `ffmpegPath` | 显式指定已有二进制路径 |
| `cookiesFromBrowser` | edge / chrome / firefox ... |
| `cookiesFile` | Netscape cookie 文件 |
| `douyinApi` | 抖音无水印解析 API 地址 |

## 换电脑恢复（共 2 步）

1. 装 Node.js + Git 后，运行上面的**一键安装命令**
2. MCP 客户端配置里加一行（见上文）；或直接 `grabit doctor --fix`

可选：把 `skill/GRABIT.md` 复制为 `~/.dsh/skills/grabit/SKILL.md`，让 Agent 一句话触发下载。

环境、配置、下载全在本机自动完成，无需迁移。

## 开发

```bash
npm install
npm run build        # tsc 编译到 dist/
npm run smoke:mcp    # MCP stdio 握手冒烟测试
```

## License

[MIT](./LICENSE)
