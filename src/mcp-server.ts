#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  doctorText,
  mediaBatch,
  mediaDownload,
  mediaInfo,
} from "./core/api.js";
import { loadConfig, saveConfig } from "./core/config.js";

const VERSION = "0.1.0";

function fail(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `✖ ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

const server = new McpServer({ name: "grabit-mcp", version: VERSION });

server.tool(
  "media_info",
  "查询视频信息：标题/时长/UP主/可用画质/平台。支持 YouTube、X(Twitter)、Telegram、B站、抖音、TikTok、小红书等",
  { url: z.string().describe("视频页面链接") },
  async ({ url }) => {
    try {
      const info = await mediaInfo(url);
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "media_download",
  "下载视频/音频到本机（默认最高画质、ffmpeg 合并、无转码）。换电脑首次使用会自动下载 yt-dlp/ffmpeg",
  {
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
  },
  async ({ url, quality, outputDir, playlist, cookiesFromBrowser }) => {
    try {
      const r = await mediaDownload(url, { quality, outputDir, playlist, cookiesFromBrowser });
      const size = r.sizeBytes ? `（${(r.sizeBytes / 1048576).toFixed(1)} MB）` : "";
      const tag = r.engine === "douyin-api" ? "·无水印" : "";
      return {
        content: [
          {
            type: "text",
            text: `✔ 下载完成 [${r.platformLabel}${tag} ${r.quality}]${size}\n${r.file || "(未获取到路径)"}`,
          },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "media_batch",
  "批量下载：传入 URL 数组逐条执行并汇总成功/失败",
  {
    urls: z.array(z.string()).min(1).describe("视频链接列表"),
    quality: z
      .enum(["best", "2160", "1080", "720", "480", "audio"])
      .default("best")
      .describe("画质"),
    outputDir: z.string().optional().describe("输出目录"),
  },
  async ({ urls, quality, outputDir }) => {
    try {
      const results = await mediaBatch(urls, { quality, outputDir });
      const text = results
        .map((r) => `${r.ok ? "✔" : "✖"} ${r.url}${r.file ? `\n   → ${r.file}` : `\n   ✖ ${r.error}`}`)
        .join("\n");
      const ok = results.filter((r) => r.ok).length;
      return { content: [{ type: "text", text: `完成 ${ok}/${results.length}\n${text}` }] };
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "media_cookies",
  "配置浏览器登录态（用于大会员画质/登录可见内容），留空 browser 则清除",
  { browser: z.string().optional().describe("edge / chrome / firefox / brave ...；不传=清除") },
  async ({ browser }) => {
    try {
      const cfg = loadConfig();
      if (browser) cfg.cookiesFromBrowser = browser.toLowerCase();
      else delete cfg.cookiesFromBrowser;
      saveConfig(cfg);
      return {
        content: [
          { type: "text", text: browser ? `✔ cookiesFromBrowser=${cfg.cookiesFromBrowser}` : "✔ 已清除登录态配置" },
        ],
      };
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool("media_doctor", "环境自检：node/yt-dlp/ffmpeg/输出目录/配置文件", {},
  async () => {
    try {
      return { content: [{ type: "text", text: await doctorText() }] };
    } catch (e) {
      return fail(e);
    }
  },
);

await server.connect(new StdioServerTransport());
