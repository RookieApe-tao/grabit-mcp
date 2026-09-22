import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { doctor as binDoctor, installBinaries, resolveFfmpeg, resolveYtDlp } from "./binaries.js";
import { configFile, loadConfig } from "./config.js";
import { douyinDownload } from "./douyin.js";
import { detectPlatform, PLATFORM_LABEL } from "./router.js";
import { normalizeQuality } from "./args.js";
import { isRemixOutput, mediaRemix } from "./remix.js";
import { newestFileSince, ytdlpDownload, ytdlpInfo } from "./ytdlp.js";
export { detectPlatform, PLATFORM_LABEL } from "./router.js";
export { doctor } from "./binaries.js";
export { mediaRemix, isRemixOutput } from "./remix.js";
export { configFile } from "./config.js";
/** 确保依赖就绪；缺失时自动下载安装（自引导），失败才抛错 */
async function requireBins(cfg, needFfmpeg) {
    let ytdlp = await resolveYtDlp(cfg);
    let ffmpeg = needFfmpeg ? await resolveFfmpeg(cfg) : null;
    if (!ytdlp || (needFfmpeg && !ffmpeg)) {
        await installBinaries(cfg); // 自动下载到 ~/.grabit/bin
        ytdlp = await resolveYtDlp(cfg);
        ffmpeg = needFfmpeg ? await resolveFfmpeg(cfg) : null;
    }
    if (!ytdlp)
        throw new Error("未找到 yt-dlp，请运行 `grabit doctor --fix`");
    if (needFfmpeg && !ffmpeg)
        throw new Error("未找到 ffmpeg，请运行 `grabit doctor --fix`");
    return { ytdlp, ffmpeg };
}
export async function mediaInfo(url) {
    const cfg = loadConfig();
    const { ytdlp } = await requireBins(cfg, false);
    const info = await ytdlpInfo(ytdlp, url, {
        cookiesFromBrowser: cfg.cookiesFromBrowser,
        cookiesFile: cfg.cookiesFile,
    });
    return { ...info, platformLabel: detectPlatform(url) };
}
/** 下载收尾：按开关对成品做「混剪+优化」一次编码，成功即删源，只留最终文件 */
async function finalizeDownload(base, file, o, cfg) {
    let sizeBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    // 已是混剪成品的文件不再二次混剪（避免成品套娃重编码，体积翻倍画质反降）
    const wantRemix = (o.remix ?? cfg.autoRemix ?? true) &&
        base.quality !== "audio" &&
        !!file &&
        fs.existsSync(file) &&
        !isRemixOutput(path.basename(file));
    if (!wantRemix)
        return { ...base, file, sizeBytes };
    o.onStage?.("remix-start", file);
    try {
        const r = await mediaRemix(file, {
            deleteSource: true,
            onLine: o.onLine,
            onStage: (s) => o.onStage?.(`remix-${s}`, file),
            ...o.remixOptions,
        });
        o.onStage?.("remix-done", r.file);
        return {
            ...base,
            file: r.file,
            sizeBytes: r.sizeBytes,
            remixed: true,
            sourceFile: path.basename(file),
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        o.onStage?.("remix-failed", file);
        // 混剪失败不吞掉下载成果：保留原片，把原因带回给调用方
        return { ...base, file, sizeBytes, remixed: false, remixError: msg };
    }
}
/** 把 yt-dlp 的原始报错翻译成可操作提示 */
function humanizeYtDlpError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fresh cookies/i.test(msg)) {
        return new Error("该平台需要浏览器登录态：先在 Edge 里打开一次目标站点（如 douyin.com），然后重试并加 --cookies-from-browser edge（重试前必须完全关闭 Edge）");
    }
    if (/could not copy .* cookie database/i.test(msg)) {
        return new Error("浏览器正在运行，cookie 库被锁定：请完全关闭 Edge/Chrome（所有窗口）后重试");
    }
    return err instanceof Error ? err : new Error(msg);
}
export async function mediaDownload(url, o = {}) {
    const cfg = loadConfig();
    const { ytdlp } = await requireBins(cfg, true);
    const quality = normalizeQuality(o.quality);
    const outputDir = o.outputDir || cfg.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
    const platform = detectPlatform(url);
    // 抖音：优先走无水印 API
    if (platform === "douyin" && cfg.douyinApi) {
        const file = await douyinDownload(cfg.douyinApi, url, outputDir, o.onLine);
        return finalizeDownload({ platform, platformLabel: PLATFORM_LABEL[platform], quality, engine: "douyin-api" }, file, o, cfg);
    }
    const startedAt = Date.now() - 3000;
    let result;
    try {
        result = await ytdlpDownload(ytdlp, url, {
            quality,
            outputDir,
            playlist: o.playlist ?? false,
            cookiesFromBrowser: o.cookiesFromBrowser ?? cfg.cookiesFromBrowser,
            cookiesFile: o.cookiesFile ?? cfg.cookiesFile,
        }, o.onLine);
    }
    catch (err) {
        throw humanizeYtDlpError(err);
    }
    // print 路径可能乱码（PyInstaller 编码问题）：有效就用，否则扫描输出目录取最新成品
    const printed = result.file;
    let file = printed && fs.existsSync(printed) ? printed : (newestFileSince(outputDir, startedAt) ?? "");
    if (!file && result.alreadyDownloaded) {
        // yt-dlp 报告「已下载过」：窗口内没有新文件，放宽到 7 天内最近成品
        // （含此前生成的混剪成品）——拿到现有文件总比空着退出 1 好
        const wide = newestFileSince(outputDir, Date.now() - 7 * 24 * 3600 * 1000);
        if (wide)
            file = wide;
    }
    return finalizeDownload({ platform, platformLabel: PLATFORM_LABEL[platform], quality, engine: "yt-dlp" }, file, o, cfg);
}
export async function mediaBatch(urls, o = {}, onItem) {
    const results = [];
    const list = urls.map((u) => u.trim()).filter((u) => u && !u.startsWith("#"));
    for (let i = 0; i < list.length; i++) {
        const url = list[i];
        try {
            const r = await mediaDownload(url, o);
            const item = { url, ok: true, file: r.file };
            results.push(item);
            onItem?.(item, i, list.length);
        }
        catch (err) {
            const item = {
                url,
                ok: false,
                error: err instanceof Error ? err.message.split("\n").slice(-2).join(" | ") : String(err),
            };
            results.push(item);
            onItem?.(item, i, list.length);
        }
    }
    return results;
}
/** 去压缩伪影 + 锐化的 ffmpeg 滤镜链（本地画质优化） */
const ENHANCE_VF = {
    light: "hqdn3d=1.5:1.2:6:6,cas=0.5",
    strong: "hqdn3d=3:2:9:9,cas=0.8,unsharp=5:5:0.4",
};
export async function mediaEnhance(file, o = {}) {
    const cfg = loadConfig();
    const ffmpeg = await resolveFfmpeg(cfg);
    if (!ffmpeg)
        throw new Error("未找到 ffmpeg，请运行 `grabit doctor --fix`");
    if (!fs.existsSync(file))
        throw new Error(`文件不存在: ${file}`);
    const preset = o.preset ?? "light";
    const suffix = preset === "strong" ? "_强优化" : "_优化";
    const out = file.replace(/\.(mp4|mkv|webm|mov|ts)$/i, "") + suffix + ".mp4";
    const args = [
        "-y",
        "-i",
        file,
        "-vf",
        ENHANCE_VF[preset],
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-preset",
        "fast",
        "-c:a",
        "copy",
        out,
    ];
    await new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, args, { windowsHide: true });
        let buf = "";
        const consume = (d) => {
            buf += d.toString();
            const parts = buf.split(/\r|\n/);
            buf = parts.pop() ?? "";
            for (const line of parts)
                if (line.trim())
                    o.onLine?.(line.trim());
        };
        child.stdout?.on("data", consume);
        child.stderr?.on("data", consume);
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}（参数不兼容或文件损坏）`)));
    });
    if (!fs.existsSync(out))
        throw new Error("优化输出未生成");
    return { file: out, sizeBytes: fs.statSync(out).size, preset };
}
export async function doctorText() {
    const cfg = loadConfig();
    const r = await binDoctor(cfg);
    const lines = [
        `node     : ${r.node}`,
        `yt-dlp   : ${r.ytDlpPath ?? "✖ 未找到"}${r.ytDlpVersion ? `  (v${r.ytDlpVersion})` : ""}`,
        `ffmpeg   : ${r.ffmpegPath ?? "✖ 未找到"}${r.ffmpegVersion ? `  (${r.ffmpegVersion.split(/\s+/)[1] ?? r.ffmpegVersion})` : ""}`,
        `输出目录 : ${r.outputDir}`,
        `配置文件 : ${configFile()}`,
    ];
    for (const h of r.hints)
        lines.push(`提示: ${h}`);
    lines.push(r.ok ? "✔ 环境就绪" : "✖ 环境不完整（运行 `grabit doctor --fix` 自动修复）");
    return lines.join("\n");
}
