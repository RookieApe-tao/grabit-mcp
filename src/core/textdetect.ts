import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { grabitHome } from "./config.js";

const runp = promisify(execFile);

/** 抽帧 OCR 检测的语言：简体中文 + 英文/数字（fast 变体足够判断"有没有字"） */
const OCR_LANGS = ["chi_sim", "eng"];

/** 训练数据目录：~/.grabit/ocr，与 yt-dlp/ffmpeg 同级的自管数据 */
export function ocrDataDir(): string {
  return path.join(grabitHome(), "ocr");
}

/** 训练数据下载源（按序回退；gz 与裸文件都能处理，按魔数判断） */
function trainedDataSources(lang: string): string[] {
  return [
    `https://tessdata.projectnaptha.com/4.0.0_fast/${lang}.traineddata.gz`,
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`,
    `https://unpkg.com/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`,
  ];
}

async function fetchBuffer(url: string, timeoutMs = 120_000): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
      if (!res.ok || !res.body) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 100_000 ? buf : null; // 训练数据至少几百 KB，防半截响应
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** 确保训练数据就位，返回 langPath（本地目录）；失败返回 null（调用方回退为不检测） */
async function ensureOcrData(onLine?: (l: string) => void): Promise<string | null> {
  const dir = ocrDataDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of OCR_LANGS) {
    const dest = path.join(dir, `${lang}.traineddata`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) continue;
    let ok = false;
    for (const url of trainedDataSources(lang)) {
      onLine?.(`↓ 下载 OCR 数据 ${lang}（${new URL(url).host}）...`);
      const buf = await fetchBuffer(url);
      if (!buf) continue;
      // gz 魔数 1f 8b
      const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
      if (raw.length <= 100_000) continue;
      fs.writeFileSync(dest, raw);
      ok = true;
      break;
    }
    if (!ok) return null;
  }
  return dir;
}

/** 在指定时刻抽一帧缩放到 ≤1280 宽的 PNG */
async function grabFrame(ffmpeg: string, file: string, t: number, out: string): Promise<boolean> {
  try {
    await runp(
      ffmpeg,
      ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-an", "-vf", "scale='min(1280,iw)':-2", out],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return fs.existsSync(out) && fs.statSync(out).size > 0;
  } catch {
    return false;
  }
}

/** 识别结果里是否有可读文字（偏向"有"：漏检的代价是被翻转的文字，误检只是少一次镜像） */
function looksLikeText(text: string): { found: boolean; sample: string } {
  const compact = text.replace(/\s+/g, "");
  const cjk = (compact.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latin = (compact.match(/[A-Za-z]/g) ?? []).length;
  const digit = (compact.match(/[0-9]/g) ?? []).length;
  const found = cjk >= 2 || latin >= 3 || digit >= 4 || (cjk >= 1 && latin >= 2);
  return { found, sample: compact.slice(0, 24) };
}

export type TextDetectResult = {
  /** 画面里检测到文字 */
  found: boolean;
  /** 实际检查的帧数 */
  framesChecked: number;
  /** 首个命中的识别片段（截断，用于日志） */
  sample: string;
};

/**
 * 抽帧 OCR 检测画面文字（内嵌字幕/水印/招牌字）。
 * 逐帧检查、命中即停（带水印的视频通常第 1 帧就命中）。
 * 任何失败（数据下载失败、OCR 崩溃）都返回 null，由调用方回退为直接镜像——绝不因检测失败阻塞混剪。
 */
export async function detectOnScreenText(
  ffmpeg: string,
  file: string,
  duration: number,
  o: { maxFrames?: number; onLine?: (l: string) => void } = {},
): Promise<TextDetectResult | null> {
  const maxFrames = Math.min(Math.max(o.maxFrames ?? 6, 1), 10);
  let langPath: string | null = null;
  try {
    langPath = await ensureOcrData(o.onLine);
  } catch {
    langPath = null;
  }
  if (!langPath) {
    o.onLine?.("⚠ OCR 数据不可用，跳过文字检测");
    return null;
  }

  // 均匀取点：5% ~ 95%，避开首尾黑场/转场
  const fr = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];
  const times: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const t = duration > 0.5 ? duration * fr[i % fr.length] : 0;
    if (!times.some((x) => Math.abs(x - t) < 0.2)) times.push(t);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grabit-ocr-"));
  let worker: import("tesseract.js").Worker | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker(OCR_LANGS, 1, { langPath, cacheMethod: "none", gzip: false });
    await worker.setParameters({ user_defined_dpi: "96" });

    let framesChecked = 0;
    for (const t of times) {
      const png = path.join(tmp, `f${framesChecked}.png`);
      if (!(await grabFrame(ffmpeg, file, t, png))) continue;
      framesChecked++;
      let text = "";
      try {
        const { data } = await worker.recognize(png, {}, { text: true, blocks: false });
        text = data.text ?? "";
      } catch {
        continue;
      }
      const { found, sample } = looksLikeText(text);
      if (found) return { found: true, framesChecked, sample };
    }
    return { found: false, framesChecked, sample: "" };
  } catch (e) {
    o.onLine?.(`⚠ 文字检测失败（${e instanceof Error ? e.message : String(e)}），回退为直接镜像`);
    return null;
  } finally {
    try {
      await worker?.terminate();
    } catch {
      /* 忽略 */
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}
