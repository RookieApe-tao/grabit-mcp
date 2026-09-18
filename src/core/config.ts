import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type GrabitConfig = {
  /** yt-dlp / ffmpeg 等二进制所在目录 */
  binDir: string;
  /** 默认下载输出目录 */
  outputDir: string;
  /** 显式指定 yt-dlp 可执行文件路径（可选） */
  ytDlpPath?: string;
  /** 显式指定 ffmpeg 可执行文件路径（可选） */
  ffmpegPath?: string;
  /** 从浏览器读取登录态：edge / chrome / firefox / brave ...（可选） */
  cookiesFromBrowser?: string;
  /** Netscape cookie 文件路径（可选，优先级低于 cookiesFromBrowser） */
  cookiesFile?: string;
  /** 抖音无水印解析 API（自托管 Evil0ctal/Douyin_TikTok_Download_API 地址，可选） */
  douyinApi?: string;
};

export function grabitHome(): string {
  return process.env.GRABIT_HOME || path.join(os.homedir(), ".grabit");
}

export function configFile(): string {
  return path.join(grabitHome(), "config.json");
}

export function defaultConfig(): GrabitConfig {
  return {
    binDir: path.join(grabitHome(), "bin"),
    outputDir: path.join(os.homedir(), "Downloads", "grabit"),
  };
}

export function loadConfig(): GrabitConfig {
  const def = defaultConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8")) as Partial<GrabitConfig>;
    return { ...def, ...raw };
  } catch {
    return def;
  }
}

export function saveConfig(cfg: GrabitConfig): void {
  fs.mkdirSync(grabitHome(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), "utf8");
}

export function ensureOutputDir(cfg: GrabitConfig): string {
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  return cfg.outputDir;
}
