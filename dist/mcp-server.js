#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { doctorText, mediaBatch, mediaDownload, mediaEnhance, mediaInfo, mediaRemix, } from "./core/api.js";
import { loadConfig, saveConfig } from "./core/config.js";
const VERSION = "0.3.0";
function fail(e) {
    return {
        content: [{ type: "text", text: `✖ ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
    };
}
const server = new McpServer({ name: "grabit-mcp", version: VERSION });
server.tool("media_info", "查询视频信息：标题/时长/UP主/可用画质/平台。支持 YouTube、X(Twitter)、Telegram、B站、抖音、TikTok、小红书等", { url: z.string().describe("视频页面链接") }, async ({ url }) => {
    try {
        const info = await mediaInfo(url);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_download", "下载视频/音频到本机（默认最高画质、ffmpeg 合并）。视频默认下载后自动「混剪+画质优化」并删除原片只留成品（智能镜像：检测到画面文字自动改用裁剪；另有抽帧/变速/噪点/每10秒随机删帧），remix=false 可关闭", {
    url: z.string().describe("视频页面链接"),
    quality: z
        .enum(["best", "2160", "1080", "720", "480", "audio"])
        .default("best")
        .describe("画质；audio=仅提取音频 mp3"),
    outputDir: z.string().optional().describe("输出目录，默认配置中的 outputDir"),
    playlist: z.boolean().default(false).describe("允许下载列表/合集"),
    cookiesFromBrowser: z
        .string()
        .optional()
        .describe("浏览器登录态 edge/chrome/firefox，用于大会员画质或登录内容"),
    remix: z
        .boolean()
        .default(true)
        .describe("下载后自动混剪+优化（删原片只留成品）；audio 画质不适用"),
}, async ({ url, quality, outputDir, playlist, cookiesFromBrowser, remix }) => {
    try {
        const r = await mediaDownload(url, { quality, outputDir, playlist, cookiesFromBrowser, remix });
        const size = r.sizeBytes ? `（${(r.sizeBytes / 1048576).toFixed(1)} MB）` : "";
        const tag = r.engine === "douyin-api" ? "·无水印" : "";
        const remixNote = r.remixed
            ? "\n🎨 已自动混剪+优化（智能镜像/抽帧/变速/噪点/随机删帧），原片已删除"
            : r.remixError
                ? `\n⚠ 自动混剪失败（保留原片）: ${r.remixError}`
                : "";
        return {
            content: [
                {
                    type: "text",
                    text: `✔ 下载完成 [${r.platformLabel}${tag} ${r.quality}]${size}${remixNote}\n${r.file || "(未获取到路径)"}`,
                },
            ],
        };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_batch", "批量下载：传入 URL 数组逐条执行并汇总成功/失败", {
    urls: z.array(z.string()).min(1).describe("视频链接列表"),
    quality: z
        .enum(["best", "2160", "1080", "720", "480", "audio"])
        .default("best")
        .describe("画质"),
    outputDir: z.string().optional().describe("输出目录"),
}, async ({ urls, quality, outputDir }) => {
    try {
        const results = await mediaBatch(urls, { quality, outputDir });
        const text = results
            .map((r) => `${r.ok ? "✔" : "✖"} ${r.url}${r.file ? `\n   → ${r.file}` : `\n   ✖ ${r.error}`}`)
            .join("\n");
        const ok = results.filter((r) => r.ok).length;
        return { content: [{ type: "text", text: `完成 ${ok}/${results.length}\n${text}` }] };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_cookies", "配置浏览器登录态（用于大会员画质/登录可见内容），留空 browser 则清除", { browser: z.string().optional().describe("edge / chrome / firefox / brave ...；不传=清除") }, async ({ browser }) => {
    try {
        const cfg = loadConfig();
        if (browser)
            cfg.cookiesFromBrowser = browser.toLowerCase();
        else
            delete cfg.cookiesFromBrowser;
        saveConfig(cfg);
        return {
            content: [
                { type: "text", text: browser ? `✔ cookiesFromBrowser=${cfg.cookiesFromBrowser}` : "✔ 已清除登录态配置" },
            ],
        };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_enhance", "本地画质优化：去压缩伪影+锐化后重编码（改善平台重压缩导致的模糊/色块，不会凭空增加细节）", {
    file: z.string().describe("视频文件完整路径"),
    preset: z.enum(["light", "strong"]).default("light").describe("light=轻优化（默认），strong=强优化"),
}, async ({ file, preset }) => {
    try {
        const r = await mediaEnhance(file, { preset });
        return {
            content: [
                {
                    type: "text",
                    text: `✔ ${preset === "strong" ? "强" : "轻"}优化完成（${(r.sizeBytes / 1048576).toFixed(1)} MB）\n${r.file}`,
                },
            ],
        };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_remix", "本地混剪去重：对已有视频做智能镜像（OCR 检测到画面文字自动改随机裁剪放大）/抽帧/变速/加噪点/每10秒随机删1~3帧，并顺带轻画质优化，一次编码输出 _混剪优化.mp4（默认保留源文件）", {
    file: z.string().describe("视频文件完整路径"),
    mirror: z.boolean().default(true).describe("水平镜像（开启时默认先做文字检测，见 textDetect）"),
    textDetect: z
        .boolean()
        .default(true)
        .describe("智能镜像：OCR 抽帧检测画面文字（内嵌字幕/水印），有字则跳过镜像、改随机裁剪放大"),
    zoomMin: z.number().min(1).max(1.5).default(1.02).describe("检测到文字时随机裁剪放大下限"),
    zoomMax: z.number().min(1).max(1.5).default(1.08).describe("检测到文字时随机裁剪放大上限"),
    speed: z
        .union([z.number(), z.literal("auto"), z.literal("off")])
        .default("auto")
        .describe("变速倍率；auto=随机0.97~1.06；off=不变速"),
    noise: z.number().min(0).max(60).default(6).describe("噪点强度，0=关闭"),
    fps: z
        .union([z.number(), z.literal("auto"), z.literal("off")])
        .default("auto")
        .describe("抽帧到目标帧率；auto=源>30时降到30；off=保持"),
    dropWindow: z.number().min(2).max(60).default(10).describe("删帧窗口秒数"),
    dropMin: z.number().min(0).max(9).default(1).describe("每窗口最少删帧数"),
    dropMax: z.number().min(0).max(9).default(3).describe("每窗口最多删帧数"),
    seed: z.number().optional().describe("随机种子（可复现）"),
    enhance: z.boolean().default(true).describe("顺带轻画质优化（去伪影+锐化）"),
    deleteSource: z.boolean().default(false).describe("成功后删除源文件"),
}, async ({ file, mirror, textDetect, zoomMin, zoomMax, speed, noise, fps, dropWindow, dropMin, dropMax, seed, enhance, deleteSource }) => {
    try {
        const o = { mirror, textDetect, zoomMin, zoomMax, speed, noise, fps, dropWindow, dropMin, dropMax, seed, enhance, deleteSource };
        const r = await mediaRemix(file, o);
        const a = r.applied;
        return {
            content: [
                {
                    type: "text",
                    text: `✔ 混剪完成（${(r.sizeBytes / 1048576).toFixed(1)} MB）\n${r.file}\n` +
                        `镜像:${a.mirror ? "开" : a.textDetected ? `关(有字→裁剪x${(a.zoom ?? 1).toFixed(2)})` : "关"} · 变速:${a.speed}x · 噪点:${a.noise} · ` +
                        `删帧:${a.droppedFrames}帧/${a.windows}窗${a.fps ? ` · ${a.fps}fps` : ""} · ` +
                        `优化:${a.enhance ? "开" : "关"} · seed:${a.seed}${r.sourceDeleted ? "\n源文件已删除" : ""}`,
                },
            ],
        };
    }
    catch (e) {
        return fail(e);
    }
});
server.tool("media_doctor", "环境自检：node/yt-dlp/ffmpeg/输出目录/配置文件", {}, async () => {
    try {
        return { content: [{ type: "text", text: await doctorText() }] };
    }
    catch (e) {
        return fail(e);
    }
});
await server.connect(new StdioServerTransport());
