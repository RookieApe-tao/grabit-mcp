#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { installBinaries } from "./core/binaries.js";
import { configFile, loadConfig, saveConfig } from "./core/config.js";
import { doctorText, mediaBatch, mediaDownload, mediaEnhance, mediaInfo, mediaRemix } from "./core/api.js";
import { isRemixOutput } from "./core/remix.js";
import { serve } from "./http/server.js";
const VERSION = "0.3.0";
const HELP = `grabit v${VERSION} — 全平台高清视频下载（CLI + MCP + 手机网页）

用法:
  grabit <url>                        下载视频（默认最高画质；完成后自动混剪优化，只留成品）
  grabit info <url>                   查看标题/时长/可用画质
  grabit remix <文件|目录> [选项]      本地混剪：智能镜像/抽帧/变速/噪点/每10秒随机删1~3帧+画质优化
  grabit enhance <文件|目录> [--strong]  本地画质优化（去压缩伪影+锐化；--strong 更强）
  grabit batch <file>                 批量下载（每行一个 URL，# 开头为注释）
  grabit serve [--port 8787] [--host 0.0.0.0]
                                      启动手机网页（同局域网/Tailscale 访问）
  grabit doctor [--fix]               环境自检（--fix 自动下载缺失的 yt-dlp/ffmpeg）
  grabit config [show|path|<key> <value>]
                                      查看/修改配置（outputDir、autoRemix、douyinApi...）

下载选项:
  -q, --quality <q>        best | 2160 | 1080 | 720 | 480 | audio（audio=提取 mp3）
  -o, --output <dir>       输出目录（默认: 配置中的 outputDir）
      --no-remix           本次下载不做自动混剪（保留原片）
      --playlist           允许下载列表/合集（默认只取单视频）
      --cookies-from-browser <b>   会员/登录内容: edge | chrome | firefox ...
      --json               以 JSON 输出结果

混剪选项（remix 子命令，均可省略用默认）:
      --no-mirror          关闭镜像
      --no-ocr             关闭智能镜像的文字检测（始终镜像，不检测）
      --zoom-min <n>       检测到文字时随机裁剪放大下限（默认 1.02）
      --zoom-max <n>       检测到文字时随机裁剪放大上限（默认 1.08，最大 1.5）
      --speed <n|off>      变速倍率，如 1.05；省略=随机 0.97~1.06；off=不变速
      --noise <n>          噪点强度 0~60（默认 6，0=关闭）
      --fps <n|off>        抽帧到指定帧率（默认：源高于30自动降到30；off=保持）
      --window <s>         删帧窗口秒数（默认 10）
      --min <n> --max <n>  每窗口随机删帧数范围（默认 1~3）
      --seed <n>           固定随机种子（可复现）
      --no-enhance         跳过画质优化（只做混剪动作）
      --delete             完成后删除源文件（默认保留）
  -o, --output <dir>       输出目录（默认与源文件同目录）

示例:
  grabit "https://www.bilibili.com/video/BV..."
  grabit "https://x.com/xxx/status/123" -q 1080
  grabit "https://v.douyin.com/xxxx/"           # 需配置 douyinApi 才无水印
  grabit "https://..." --no-remix               # 只要原片，不混剪
  grabit remix "D:/Videos"                      # 整个目录批量混剪
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
        case "enhance": {
            const target = rest.find((a) => !a.startsWith("-"));
            if (!target) {
                console.error("用法: grabit enhance <文件或目录> [--strong]");
                return 1;
            }
            if (!fs.existsSync(target)) {
                console.error(`✖ 路径不存在: ${target}`);
                return 1;
            }
            const preset = flag("--strong") ? "strong" : "light";
            const st = fs.statSync(target);
            const files = st.isDirectory()
                ? fs
                    .readdirSync(target)
                    .filter((n) => /\.(mp4|mkv|webm|mov)$/i.test(n) && !/(优化|强优化)\.mp4$/i.test(n))
                    .map((n) => path.join(target, n))
                : [target];
            if (!files.length) {
                console.error("✖ 目录里没有可优化的视频（mp4/mkv/webm/mov）");
                return 1;
            }
            console.log(`共 ${files.length} 个视频，档位: ${preset === "strong" ? "强优化" : "轻优化"}`);
            let failCount = 0;
            for (let i = 0; i < files.length; i++) {
                const label = path.basename(files[i]);
                process.stdout.write(`[${i + 1}/${files.length}] ${label} ... `);
                try {
                    const r = await mediaEnhance(files[i], {
                        preset,
                        onLine: (l) => {
                            if (/^frame=/.test(l)) {
                                process.stdout.write(`\r[${i + 1}/${files.length}] ${l.slice(0, 110).padEnd(110)}`);
                            }
                        },
                    });
                    process.stdout.write("\n");
                    console.log(`   ✔ ${(r.sizeBytes / 1048576).toFixed(1)} MB → ${path.basename(r.file)}`);
                }
                catch (e) {
                    process.stdout.write("\n");
                    console.log(`   ✖ ${e instanceof Error ? e.message : String(e)}`);
                    failCount++;
                }
            }
            console.log(failCount ? `\n完成（${failCount} 个失败）` : "\n全部完成 ✔");
            return failCount ? 1 : 0;
        }
        case "remix": {
            const target = rest.find((a) => !a.startsWith("-"));
            if (!target) {
                console.error("用法: grabit remix <文件或目录> [--no-mirror] [--speed n] [--noise n] [--fps n] [--seed n] [--delete]");
                return 1;
            }
            if (!fs.existsSync(target)) {
                console.error(`✖ 路径不存在: ${target}`);
                return 1;
            }
            const speedRaw = get("--speed");
            let speed = "auto";
            if (speedRaw === "off")
                speed = "off";
            else if (speedRaw !== undefined) {
                const v = parseFloat(speedRaw);
                if (!Number.isFinite(v) || v <= 0) {
                    console.error(`✖ 无效的 --speed: ${speedRaw}（示例: 1.05 / off）`);
                    return 1;
                }
                speed = v;
            }
            const fpsRaw = get("--fps");
            let fps = "auto";
            if (fpsRaw === "off")
                fps = "off";
            else if (fpsRaw !== undefined) {
                const v = parseFloat(fpsRaw);
                if (!Number.isFinite(v) || v < 5 || v > 120) {
                    console.error(`✖ 无效的 --fps: ${fpsRaw}（5~120 / off）`);
                    return 1;
                }
                fps = Math.round(v);
            }
            const numOf = (name, def, lo, hi) => {
                const raw = get(name);
                if (raw === undefined)
                    return def;
                const v = parseFloat(raw);
                if (!Number.isFinite(v)) {
                    console.error(`✖ 无效的 ${name}: ${raw}`);
                    process.exit(1);
                }
                return Math.min(hi, Math.max(lo, v));
            };
            const st = fs.statSync(target);
            const files = st.isDirectory()
                ? fs
                    .readdirSync(target)
                    .filter((n) => /\.(mp4|mkv|webm|mov|ts)$/i.test(n) && !isRemixOutput(n))
                    .map((n) => path.join(target, n))
                : [target];
            if (!files.length) {
                console.error("✖ 目录里没有可混剪的视频（mp4/mkv/webm/mov/ts）");
                return 1;
            }
            const outDir = get("-o", "--output");
            const deleteSource = flag("--delete");
            const zoomMin = numOf("--zoom-min", 1.02, 1, 1.5);
            const zoomMax = numOf("--zoom-max", 1.08, 1, 1.5);
            const mirrorLabel = flag("--no-mirror") ? "镜像关" : flag("--no-ocr") ? "镜像" : `智能镜像(裁剪≤${zoomMax.toFixed(2)})`;
            const applied = [
                mirrorLabel,
                `变速${speed === "auto" ? "随机" : speed === "off" ? "关" : speed}`,
                `噪点${numOf("--noise", 6, 0, 60)}`,
                `抽帧${fps === "auto" ? "自动(>30→30)" : fps === "off" ? "关" : fps + "fps"}`,
                `每${numOf("--window", 10, 2, 60)}秒删${numOf("--min", 1, 0, 9)}~${numOf("--max", 3, 0, 9)}帧`,
            ];
            console.log(`共 ${files.length} 个视频｜${applied.join("｜")}${deleteSource ? "｜完成后删源" : ""}`);
            let failCount = 0;
            for (let i = 0; i < files.length; i++) {
                const label = path.basename(files[i]);
                process.stdout.write(`[${i + 1}/${files.length}] ${label} ... `);
                try {
                    const r = await mediaRemix(files[i], {
                        mirror: !flag("--no-mirror"),
                        textDetect: !flag("--no-ocr"),
                        zoomMin,
                        zoomMax,
                        speed,
                        fps,
                        noise: numOf("--noise", 6, 0, 60),
                        dropWindow: numOf("--window", 10, 2, 60),
                        dropMin: numOf("--min", 1, 0, 9),
                        dropMax: numOf("--max", 3, 0, 9),
                        seed: (() => {
                            const raw = get("--seed");
                            if (raw === undefined)
                                return undefined;
                            const v = parseInt(raw, 10);
                            if (!Number.isFinite(v)) {
                                console.error(`\n✖ 无效的 --seed: ${raw}`);
                                process.exit(1);
                            }
                            return v;
                        })(),
                        enhance: !flag("--no-enhance"),
                        deleteSource,
                        outputDir: outDir,
                        suffix: get("--suffix"),
                        onLine: (l) => {
                            if (/^frame=/.test(l)) {
                                process.stdout.write(`\r[${i + 1}/${files.length}] ${label} ${l.slice(0, 90).padEnd(90)}`);
                            }
                        },
                    });
                    const a = r.applied;
                    process.stdout.write("\n");
                    const mirrorNote = flag("--no-mirror")
                        ? ""
                        : flag("--no-ocr")
                            ? " · 已镜像(未检测)"
                            : a.textDetected
                                ? ` · 有字→裁剪x${(a.zoom ?? 1).toFixed(2)}未镜像`
                                : " · 无字→已镜像";
                    console.log(`   ✔ ${(r.sizeBytes / 1048576).toFixed(1)} MB → ${path.basename(r.file)}\n` +
                        `     删帧 ${a.droppedFrames}/${a.windows}窗 · 变速 ${a.speed}x${a.fps ? ` · ${a.fps}fps` : ""}${mirrorNote} · seed ${a.seed}${r.sourceDeleted ? " · 源已删除" : ""}`);
                }
                catch (e) {
                    process.stdout.write("\n");
                    console.log(`   ✖ ${e instanceof Error ? e.message : String(e)}`);
                    failCount++;
                }
            }
            console.log(failCount ? `\n完成（${failCount} 个失败）` : "\n全部完成 ✔");
            return failCount ? 1 : 0;
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
            let inRemix = false;
            const onLine = json
                ? undefined
                : (line) => {
                    if (/^\[download\]\s+\d|^\[Merger\]|^\[ExtractAudio\]|^\[info\]|^frame=/.test(line)) {
                        process.stdout.write(`\r${(inRemix ? "🎨 " : "") + line.slice(0, 118).padEnd(118)}`);
                    }
                };
            const onStage = json
                ? undefined
                : (stage) => {
                    if (stage === "remix-start") {
                        inRemix = true;
                        process.stdout.write("\n🎨 混剪优化中（智能镜像/抽帧/变速/噪点/随机删帧 + 画质优化，完成后删原片）...\n");
                    }
                    else if (stage === "remix-ocr") {
                        process.stdout.write("\n🔍 抽帧检测画面文字（有字→裁剪替代镜像，首次运行需下载 OCR 数据）...\n");
                    }
                    else if (stage === "remix-failed") {
                        inRemix = false;
                        process.stdout.write("\n⚠ 自动混剪失败（已保留原片）\n");
                    }
                };
            const r = await mediaDownload(url, {
                quality: get("-q", "--quality"),
                outputDir: get("-o", "--output"),
                playlist: flag("--playlist"),
                cookiesFromBrowser: get("--cookies-from-browser"),
                remix: flag("--no-remix") ? false : flag("--remix") ? true : undefined,
                onLine,
                onStage,
            });
            if (!json)
                process.stdout.write("\n");
            if (json) {
                console.log(JSON.stringify(r, null, 2));
            }
            else {
                const size = r.sizeBytes ? `（${(r.sizeBytes / 1048576).toFixed(1)} MB）` : "";
                const remixTag = r.remixed
                    ? "·混剪成品"
                    : r.remixError
                        ? `·混剪失败:${r.remixError.slice(0, 60)}`
                        : "";
                console.log(`✔ 完成 [${r.platformLabel}${r.engine === "douyin-api" ? "·无水印" : ""}${remixTag}] ${size}`);
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
