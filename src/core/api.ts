import fs from "node:fs";
import { spawn } from "node:child_process";
import { doctor as binDoctor, installBinaries, resolveFfmpeg, resolveYtDlp } from "./binaries.js";
import { configFile, loadConfig, type GrabitConfig } from "./config.js";
import { douyinDownload } from "./douyin.js";
import { detectPlatform, PLATFORM_LABEL } from "./router.js";
import { normalizeQuality, type Quality } from "./args.js";
import { extractFinalPath, newestFileSince, ytdlpDownload, ytdlpInfo, type DownloadOutcome, type MediaInfo } from "./ytdlp.js";

export { detectPlatform, PLATFORM_LABEL } from "./router.js";
export type { Platform } from "./router.js";
export { doctor } from "./binaries.js";
export type { DoctorReport } from "./binaries.js";
export type { MediaInfo } from "./ytdlp.js";
export { configFile } from "./config.js";

export type DownloadOptions = {
  quality?: string;
  outputDir?: string;
  playlist?: boolean;
  cookiesFromBrowser?: string;
  cookiesFile?: string;
  onLine?: (line: string) => void;
};

export type DownloadResult = {
  platform: string;
  platformLabel: string;
  quality: Quality;
  file: string;
  sizeBytes: number;
  engine: "yt-dlp" | "douyin-api";
};

/** 确保依赖就绪；缺失时自动下载安装（自引导），失败才抛错 */
async function requireBins(
  cfg: GrabitConfig,
  needFfmpeg: boolean,
): Promise<{ ytdlp: string; ffmpeg: string | null }> {
  let ytdlp = await resolveYtDlp(cfg);
  let ffmpeg = needFfmpeg ? await resolveFfmpeg(cfg) : null;
  if (!ytdlp || (needFfmpeg && !ffmpeg)) {
    await installBinaries(cfg); // 自动下载到 ~/.grabit/bin
    ytdlp = await resolveYtDlp(cfg);
    ffmpeg = needFfmpeg ? await resolveFfmpeg(cfg) : null;
  }
  if (!ytdlp) throw new Error("未找到 yt-dlp，请运行 `grabit doctor --fix`");
  if (needFfmpeg && !ffmpeg) throw new Error("未找到 ffmpeg，请运行 `grabit doctor --fix`");
  return { ytdlp, ffmpeg };
}

export async function mediaInfo(url: string): Promise<MediaInfo & { platformLabel: string }> {
  const cfg = loadConfig();
  const { ytdlp } = await requireBins(cfg, false);
  const info = await ytdlpInfo(ytdlp, url, {
    cookiesFromBrowser: cfg.cookiesFromBrowser,
    cookiesFile: cfg.cookiesFile,
  });
  return { ...info, platformLabel: detectPlatform(url) };
}

/** 把 yt-dlp 的原始报错翻译成可操作提示 */
function humanizeYtDlpError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fresh cookies/i.test(msg)) {
    return new Error(
      "该平台需要浏览器登录态：先在 Edge 里打开一次目标站点（如 douyin.com），然后重试并加 --cookies-from-browser edge（重试前必须完全关闭 Edge）",
    );
  }
  if (/could not copy .* cookie database/i.test(msg)) {
    return new Error("浏览器正在运行，cookie 库被锁定：请完全关闭 Edge/Chrome（所有窗口）后重试");
  }
  return err instanceof Error ? err : new Error(msg);
}

export async function mediaDownload(url: string, o: DownloadOptions = {}): Promise<DownloadResult> {
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
  let result: DownloadOutcome;
  try {
    result = await ytdlpDownload(
      ytdlp,
      url,
      {
        quality,
        outputDir,
        playlist: o.playlist ?? false,
        cookiesFromBrowser: o.cookiesFromBrowser ?? cfg.cookiesFromBrowser,
        cookiesFile: o.cookiesFile ?? cfg.cookiesFile,
      },
      o.onLine,
    );
  } catch (err) {
    throw humanizeYtDlpError(err);
  }
  // print 路径可能乱码（PyInstaller 编码问题）：有效就用，否则扫描输出目录取最新成品
  const printed = result.file;
  const file =
    printed && fs.existsSync(printed) ? printed : (newestFileSince(outputDir, startedAt) ?? "");
  let sizeBytes = 0;
  if (file && fs.existsSync(file)) sizeBytes = fs.statSync(file).size;
  return {
    platform,
    platformLabel: PLATFORM_LABEL[platform],
    quality,
    file,
    sizeBytes,
    engine: "yt-dlp",
  };
}

export type BatchItem = { url: string; ok: boolean; file?: string; error?: string };

export async function mediaBatch(
  urls: string[],
  o: DownloadOptions = {},
  onItem?: (item: BatchItem, index: number, total: number) => void,
): Promise<BatchItem[]> {
  const results: BatchItem[] = [];
  const list = urls.map((u) => u.trim()).filter((u) => u && !u.startsWith("#"));
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    try {
      const r = await mediaDownload(url, o);
      const item: BatchItem = { url, ok: true, file: r.file };
      results.push(item);
      onItem?.(item, i, list.length);
    } catch (err) {
      const item: BatchItem = {
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

export type EnhancePreset = "light" | "strong";

/** 去压缩伪影 + 锐化的 ffmpeg 滤镜链（本地画质优化） */
const ENHANCE_VF: Record<EnhancePreset, string> = {
  light: "hqdn3d=1.5:1.2:6:6,cas=0.5",
  strong: "hqdn3d=3:2:9:9,cas=0.8,unsharp=5:5:0.4",
};

export type EnhanceOptions = {
  preset?: EnhancePreset;
  onLine?: (line: string) => void;
};

export type EnhanceResult = {
  file: string;
  sizeBytes: number;
  preset: EnhancePreset;
};

export async function mediaEnhance(file: string, o: EnhanceOptions = {}): Promise<EnhanceResult> {
  const cfg = loadConfig();
  const ffmpeg = await resolveFfmpeg(cfg);
  if (!ffmpeg) throw new Error("未找到 ffmpeg，请运行 `grabit doctor --fix`");
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  const preset: EnhancePreset = o.preset ?? "light";
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
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let buf = "";
    const consume = (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split(/\r|\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) o.onLine?.(line.trim());
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}（参数不兼容或文件损坏）`)),
    );
  });
  if (!fs.existsSync(out)) throw new Error("优化输出未生成");
  return { file: out, sizeBytes: fs.statSync(out).size, preset };
}

export async function doctorText(): Promise<string> {
  const cfg = loadConfig();
  const r = await binDoctor(cfg);
  const lines = [
    `node     : ${r.node}`,
    `yt-dlp   : ${r.ytDlpPath ?? "✖ 未找到"}${r.ytDlpVersion ? `  (v${r.ytDlpVersion})` : ""}`,
    `ffmpeg   : ${r.ffmpegPath ?? "✖ 未找到"}${r.ffmpegVersion ? `  (${r.ffmpegVersion.split(/\s+/)[1] ?? r.ffmpegVersion})` : ""}`,
    `输出目录 : ${r.outputDir}`,
    `配置文件 : ${configFile()}`,
  ];
  for (const h of r.hints) lines.push(`提示: ${h}`);
  lines.push(r.ok ? "✔ 环境就绪" : "✖ 环境不完整（运行 `grabit doctor --fix` 自动修复）");
  return lines.join("\n");
}
