#!/usr/bin/env node
import fs from "node:fs";
import { installBinaries } from "./core/binaries.js";
import { configFile, loadConfig, saveConfig } from "./core/config.js";
import { doctorText, mediaBatch, mediaDownload, mediaInfo } from "./core/api.js";
import { serve } from "./http/server.js";
const VERSION = "0.1.0";
const HELP = `grabit v${VERSION} — 全平台高清视频下载（CLI + MCP + 手机网页）

用法:
  grabit <url>                        下载视频（默认最高画质，自动合并音轨）
  grabit info <url>                   查看标题/时长/可用画质
  grabit batch <file>                 批量下载（每行一个 URL，# 开头为注释）
  grabit serve [--port 8787] [--host 0.0.0.0]
                                      启动手机网页（同局域网/Tailscale 访问）
  grabit doctor [--fix]               环境自检（--fix 自动下载缺失的 yt-dlp/ffmpeg）
  grabit config [show|path|<key> <value>]
                                      查看/修改配置（outputDir、douyinApi、cookiesFromBrowser...）

下载选项:
  -q, --quality <q>        best | 2160 | 1080 | 720 | 480 | audio（audio=提取 mp3）
  -o, --output <dir>       输出目录（默认: 配置中的 outputDir）
      --playlist           允许下载列表/合集（默认只取单视频）
      --cookies-from-browser <b>   会员/登录内容: edge | chrome | firefox ...
      --json               以 JSON 输出结果

示例:
  grabit "https://www.bilibili.com/video/BV..."
  grabit "https://x.com/xxx/status/123" -q 1080
  grabit "https://v.douyin.com/xxxx/"           # 需配置 douyinApi 才无水印
  grabit serve                                  # 手机访问 http://电脑IP:8787

仓库: https://github.com/RookieApe-tao/grabit-mcp
仅供个人备份与授权内容，尊重各平台版权与条款。`;
function parse(argv) {
    const get = (...names) => {
        for (let i = 0; i < argv.length; i++) {
            for (const n of names) {
                if (argv[i] === n)
                    return argv[i + 1];
                if (argv[i].startsWith(n + "="))
                    return argv[i].slice(n.length + 1);
            }
        }
        return undefined;
    };
    const flag = (name) => argv.includes(name);
    return { get, flag };
}
function positional(argv) {
    return argv.find((a) => !a.startsWith("-") && !(argv[argv.indexOf(a) - 1] ?? "").startsWith("-") || !a.startsWith("-"));
}
async function main() {
    const [, , cmd, ...rest] = process.argv;
    if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
        console.log(HELP);
        return 0;
    }
    if (cmd === "--version" || cmd === "-V" || cmd === "-v") {
        console.log(VERSION);
        return 0;
    }
    const { get, flag } = parse(rest);
    switch (cmd) {
        case "info": {
            const url = rest.find((a) => !a.startsWith("-"));
            if (!url) {
                console.error("用法: grabit info <url>");
                return 1;
            }
            const info = await mediaInfo(url);
            if (flag("--json")) {
                console.log(JSON.stringify(info, null, 2));
            }
            else {
                console.log([
                    `标题 : ${info.title}`,
                    `平台 : ${info.platform}`,
                    `UP主 : ${info.uploader ?? "-"}`,
                    `时长 : ${info.duration ? `${Math.round(info.duration)}s` : "-"}`,
                    `画质 : ${info.availableHeights.map((h) => `${h}p`).join(" / ") || "-"}`,
                    info.isLive ? "⚠ 直播中" : "",
                ]
                    .filter(Boolean)
                    .join("\n"));
            }
            return 0;
        }
        case "batch": {
            const file = rest.find((a) => !a.startsWith("-"));
            if (!file) {
                console.error("用法: grabit batch <urls.txt>");
                return 1;
            }
            const lines = fs
                .readFileSync(file, "utf8")
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith("#"));
            console.log(`共 ${lines.length} 条链接`);
            const results = await mediaBatch(lines, {
                quality: get("-q", "--quality"),
                outputDir: get("-o", "--output"),
                playlist: flag("--playlist"),
                cookiesFromBrowser: get("--cookies-from-browser"),
            }, (item, i, total) => {
                console.log(`[${i + 1}/${total}] ${item.ok ? "✔" : "✖"} ${item.url}${item.error ? ` :: ${item.error}` : ""}`);
            });
            const okCount = results.filter((r) => r.ok).length;
            console.log(`\n完成: ${okCount}/${results.length} 成功`);
            return okCount === results.length ? 0 : 1;
        }
        case "doctor": {
            if (flag("--fix")) {
                console.log("检查并补齐环境（下载到 ~/.grabit/bin，不影响系统）...");
                await installBinaries(loadConfig());
            }
            console.log(await doctorText());
            return 0;
        }
        case "serve": {
            const port = parseInt(get("-p", "--port") ?? "8787", 10);
            const host = get("--host") ?? "0.0.0.0";
            await serve(host, Number.isNaN(port) ? 8787 : port);
            return 0;
        }
        case "config": {
            const key = rest.find((a) => !a.startsWith("-"));
            const cfg = loadConfig();
            if (!key || key === "show") {
                console.log(JSON.stringify(cfg, null, 2));
                return 0;
            }
            if (key === "path") {
                console.log(configFile());
                return 0;
            }
            const value = rest[rest.indexOf(key) + 1];
            if (value === undefined) {
                console.log(`${key} = ${cfg[key] ?? "(未设置)"}`);
                return 0;
            }
            const next = { ...cfg };
            if (value === "" || value === "(clear)")
                delete next[key];
            else
                next[key] = value;
            saveConfig(next);
            console.log(`✔ ${key} 已${value === "" || value === "(clear)" ? "清除" : `设为 ${value}`}`);
            return 0;
        }
        default: {
            // 默认当作下载命令
            const url = cmd.startsWith("-") ? rest.find((a) => !a.startsWith("-")) : cmd;
            if (!url || url.startsWith("-")) {
                console.log(HELP);
                return 1;
            }
            const json = flag("--json");
            const onLine = json
                ? undefined
                : (line) => {
                    if (/^\[download\]\s+\d|^\[Merger\]|^\[ExtractAudio\]|^\[info\]/.test(line)) {
                        process.stdout.write(`\r${line.slice(0, 120).padEnd(120)}`);
                    }
                };
            const r = await mediaDownload(url, {
                quality: get("-q", "--quality"),
                outputDir: get("-o", "--output"),
                playlist: flag("--playlist"),
                cookiesFromBrowser: get("--cookies-from-browser"),
                onLine,
            });
            if (!json)
                process.stdout.write("\n");
            if (json) {
                console.log(JSON.stringify(r, null, 2));
            }
            else {
                const size = r.sizeBytes ? `（${(r.sizeBytes / 1048576).toFixed(1)} MB）` : "";
                console.log(`✔ 完成 [${r.platformLabel}${r.engine === "douyin-api" ? "·无水印" : ""}] ${size}`);
                console.log(r.file || "(未获取到文件路径)");
            }
            return r.file ? 0 : 1;
        }
    }
}
main()
    .then((code) => {
    process.exitCode = code;
})
    .catch((err) => {
    process.stdout.write("\n");
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
});
