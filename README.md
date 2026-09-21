# grabit-mcp

**全平台高清视频下载器** —— 一个包三种用法：命令行 CLI、MCP Server（给 AI Agent 用）、手机网页。
支持 YouTube / X(Twitter) / Telegram / B站 / 抖音 / TikTok / 小红书 / Instagram 等，默认**最高画质原始码流**（ffmpeg 合并、无转码），抖音可接无水印 API。

> 仅供个人备份与已授权内容。请尊重各平台版权与服务条款，勿用于二次分发或商业用途。

## 特性

- 🎯 **最高画质默认**：`bestvideo+bestaudio` 自动合并 mp4，可选 4K/1080/720/480/仅音频
- 🎞️ **下载即混剪**：下载完成自动做去重混剪（智能镜像·检测到画面文字自动改裁剪/抽帧/变速/噪点/每10秒随机删1~3帧）+ 画质优化，一次编码，**只留成品、自动删原片**
- 🪄 **环境自愈**：首次运行自动检测并下载 yt-dlp / ffmpeg 到 `~/.grabit/bin`（免管理员、不污染 PATH）
- ✨ **本地画质优化**：`grabit enhance` 去压缩伪影+锐化重编码（light/strong 两档），改善平台重压缩的模糊色块
- 🤖 **MCP Server**：7 个结构化工具，DSH / Claude Desktop 等任意 MCP 客户端可用
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
grabit "https://www.bilibili.com/video/BV..."            # 最高画质，完成后自动混剪优化（只留成品）
grabit "https://x.com/user/status/123" -q 1080           # 指定画质
grabit "https://youtu.be/xxx" -q audio                   # 仅音频 mp3（音频不做混剪）
grabit "https://..." --no-remix                          # 只要原片，不混剪
grabit info "https://..."                                # 查标题/可用画质
grabit batch urls.txt                                    # 批量（每行一个链接，同样自动混剪）
grabit remix <文件或目录> [选项]                          # 对本地视频单独混剪
grabit enhance <文件或目录> --strong                      # 本地画质优化（去伪影+锐化）
grabit serve                                             # 启动手机网页（默认 :8787）
grabit doctor [--fix]                                    # 环境自检/自动修复
grabit config outputDir "D:/Videos"                      # 改输出目录
grabit config autoRemix false                            # 关闭下载后自动混剪
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
| `media_download` | 下载（默认完成后自动混剪优化；`remix=false` 关闭） |
| `media_batch` | 批量下载并汇总结果 |
| `media_remix` | 对本地视频做混剪去重（智能镜像/抽帧/变速/噪点/随机删帧等参数可调） |
| `media_cookies` | 设置/清除浏览器登录态 |
| `media_doctor` | 环境自检 |

## 下载后自动混剪（去重）

下载完成会自动对视频做「混剪 + 优化」并**删除原片，只留成品**（`原名_混剪优化.mp4`）：

| 动作 | 默认 | 说明 |
|---|---|---|
| 智能镜像 | 开 | 先 OCR 抽帧检测画面文字（内嵌字幕/水印）：**无字 → 水平镜像；有字 → 跳过镜像，改随机裁剪放大 1.02~1.08 倍**（避免文字被翻转没法看）；`--no-ocr` 关闭检测（始终镜像）、`--no-mirror` 全关 |
| 抽帧 | 自动 | 源高于 30fps 时降到 30；`--fps` 可指定 |
| 变速 | 随机 0.97~1.06x | 幅度小到无感；`--speed` 可固定 |
| 加噪点 | 强度 6 | 轻度时域噪点；`--noise 0` 关闭 |
| 随机删帧 | 每 10 秒删 1~3 帧 | 音画同步切除；`--window/--min/--max` 可调 |
| 画质优化 | 开 | 去压缩伪影+锐化（同 enhance 轻档），与混剪合并为一次编码 |

- 全部动作在**一次 ffmpeg 编码**里完成，没有中间文件；混剪失败会保留原片并在输出里说明原因
- 智能镜像的 OCR 数据（约 6.4 MB，tesseract fast 中/英）首次使用时自动下载到 `~/.grabit/ocr`，之后离线可用；检测失败自动回退为直接镜像，不会阻塞混剪
- 裁剪放大范围可用 `--zoom-min / --zoom-max` 调整（默认 1.02~1.08，上限 1.5）
- 随机参数可用 `--seed` 复现；输出帧率/删帧数实测后写进结果（JSON 里 `remixed` / `applied`）
- 单次关闭：`grabit <url> --no-remix`；永久关闭：`grabit config autoRemix false`
- 对已下载的本地视频补做：`grabit remix <文件或目录>`（默认保留源文件，`--delete` 才删）

```bash
grabit remix video.mp4                       # 全默认（智能镜像+自动抽帧+随机变速+噪点6+每10s删1~3帧+优化）
grabit remix "D:/Downloads/grabit"           # 整个目录批量（自动跳过已是成品的）
grabit remix video.mp4 --speed 1.05 --noise 8 --fps 30 --seed 42
grabit remix video.mp4 --no-ocr              # 跳过文字检测，始终镜像
grabit remix video.mp4 --zoom-max 1.03       # 收紧裁剪放大上限
grabit remix video.mp4 --no-mirror --no-enhance --window 15 --min 2 --max 3
```


## 本地画质优化（enhance）

平台（尤其 X）会重压缩视频导致模糊/色块。`grabit enhance` 用 ffmpeg 做本地修复：

```bash
grabit enhance video.mp4                # 轻优化：去噪(hqdn3d) + 锐化(cas)，CRF16 重编码
grabit enhance video.mp4 --strong       # 强优化：加强去噪 + 双重锐化
grabit enhance "D:/Downloads/grabit"    # 整个目录批量（自动跳过已优化的）
```

输出为 `原名_优化.mp4` / `原名_强优化.mp4`，源文件不动。
预期：观感更干净锐利（尤其文字与静止画面）；**不会凭空恢复被平台压缩掉的真实细节**。

AI 超分（Real-ESRGAN，逐帧处理再合成）：需要支持 Vulkan 的 GPU（近 8 年的独显/核显均可）；
老显卡（如 Fermi 系 GTX 5xx）无 Vulkan 无法运行，CPU 纯跑速度不可接受。

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
| `ytDlpPath` / `ffmpegPath` / `ffprobePath` | 显式指定已有二进制路径 |
| `autoRemix` | 下载后自动混剪+优化（默认 `true`） |
| `cookiesFromBrowser` | edge / chrome / firefox ... |
| `cookiesFile` | Netscape cookie 文件 |
| `douyinApi` | 抖音无水印解析 API 地址 |

## DSH 集成（MCP + Skill，换机三步）

### 第 1 步：安装工具本体
运行上面的一键安装命令（`setup.ps1` / `setup.sh`）。

### 第 2 步：挂 MCP —— 编辑 `~/.dsh/profiles/web/cordis.patch.yml`，追加：

```yaml
# grabit MCP — 全平台视频下载 (YouTube/X/Telegram/抖音/B站/TikTok/小红书)
# Tools register as mcp__grabit__* (media_info / media_download / media_batch /
# media_cookies / media_doctor).
- insert:
    - id: mcp-grabit
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: grabit
        transport: stdio
        command: node
        args:
          - C:/Users/<你>/AppData/Roaming/npm/node_modules/grabit-mcp/dist/mcp-server.js
```

> - `args` 里的路径换成自己的 npm 全局目录（`npm root -g` 查看；macOS/Linux 一般是 `/usr/local/lib/node_modules/...` 或 `~/.npm-global/lib/node_modules/...`）
> - DSH 要求 `command` 为绝对路径，所以用 `node` + js 绝对路径的方式
> - 验证：`dsh --profile web --dump-config | grep mcp-grabit`；**重启 dsh web 后**工具生效

### 第 3 步：装 Skill

```powershell
# Windows（macOS/Linux 路径为 ~/.dsh/skills/grabit/SKILL.md）
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills\grabit" | Out-Null
Copy-Item "<仓库目录>\skill\GRABIT.md" "$env:USERPROFILE\.dsh\skills\grabit\SKILL.md"
```

保存后即时生效（无需重启）。之后对 Agent 说"下载这个视频链接"就会直接触发。

## 换电脑恢复 = 上面的三步

**① 一键安装命令**（工具本体 + 环境自愈） → **② cordis.patch 挂 MCP**（重启 dsh web 生效） → **③ 拷 Skill**（即时生效）。

环境、配置、下载全在本机自动完成，无需迁移。

## 开发

```bash
npm install
npm run build        # tsc 编译到 dist/
npm run smoke:mcp    # MCP stdio 握手冒烟测试
```

## License

[MIT](./LICENSE)
