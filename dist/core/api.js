import fs from "node:fs";
import { doctor as binDoctor, installBinaries, resolveFfmpeg, resolveYtDlp } from "./binaries.js";
import { configFile, loadConfig } from "./config.js";
import { douyinDownload } from "./douyin.js";
import { detectPlatform, PLATFORM_LABEL } from "./router.js";
import { normalizeQuality } from "./args.js";
import { newestFileSince, ytdlpDownload, ytdlpInfo } from "./ytdlp.js";
export { detectPlatform, PLATFORM_LABEL } from "./router.js";
export { doctor } from "./binaries.js";
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
        return {
            platform,
            platformLabel: PLATFORM_LABEL[platform],
            quality,
            file,
            sizeBytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
            engine: "douyin-api",
        };
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
    const file = printed && fs.existsSync(printed) ? printed : (newestFileSince(outputDir, startedAt) ?? "");
    let sizeBytes = 0;
    if (file && fs.existsSync(file))
        sizeBytes = fs.statSync(file).size;
    return {
        platform,
        platformLabel: PLATFORM_LABEL[platform],
        quality,
        file,
        sizeBytes,
        engine: "yt-dlp",
    };
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
