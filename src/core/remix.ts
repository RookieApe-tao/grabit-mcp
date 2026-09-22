import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveFfmpeg, resolveFfprobe } from "./binaries.js";
import { loadConfig } from "./config.js";
import { detectOnScreenText } from "./textdetect.js";

const runp = promisify(execFile);

/** 混剪选项：全部可调，默认覆盖计划里的全部动作（镜像/抽帧/变速/加噪点/每10秒随机删1~3帧）+ 轻画质优化 */
export type RemixOptions = {
  /** 水平镜像，默认 true（开启时先做文字检测，见 textDetect） */
  mirror?: boolean;
  /** 智能镜像：OCR 抽帧检测画面文字（内嵌字幕/水印），有字则自动跳过镜像、改用随机裁剪放大补偿（默认 true；仅 mirror=true 时生效） */
  textDetect?: boolean;
  /** 检测到文字时随机裁剪放大的下限，默认 1.02 */
  zoomMin?: number;
  /** 检测到文字时随机裁剪放大的上限，默认 1.08（硬上限 1.5，避免画面被裁得面目全非） */
  zoomMax?: number;
  /** 变速倍率；"auto"=随机 0.97~1.06（默认）；1 或 "off"=不变速 */
  speed?: number | "auto" | "off";
  /** 噪点强度 0~60，默认 6（可感知但轻）；0=关闭 */
  noise?: number;
  /** 输出帧率（抽帧）；"auto"=源高于 30 时降到 30（默认）；数字=目标帧率；"off"=保持源帧率 */
  fps?: number | "auto" | "off";
  /** 删帧窗口（秒），默认 10 */
  dropWindow?: number;
  /** 每窗口最少删几帧，默认 1 */
  dropMin?: number;
  /** 每窗口最多删几帧，默认 3 */
  dropMax?: number;
  /** 随机种子（不传 = 每次随机） */
  seed?: number;
  /** 顺带做轻画质优化（去压缩伪影+锐化），与混剪合并为一次编码，默认 true */
  enhance?: boolean;
  /** 输出文件后缀，默认 "_混剪优化" */
  suffix?: string;
  /** 输出目录（缺省与源文件同目录） */
  outputDir?: string;
  /** 成功后删除源文件（自动流水线用），默认 false */
  deleteSource?: boolean;
  onLine?: (line: string) => void;
  onStage?: (stage: "probe" | "ocr" | "encode") => void;
};

export type RemixApplied = {
  /** 最终是否执行了镜像（检测到文字时为 false） */
  mirror: boolean;
  /** 是否检测到画面文字（触发了「跳过镜像改裁剪」） */
  textDetected: boolean;
  /** 裁剪放大倍率；null=未裁剪 */
  zoom: number | null;
  speed: number;
  noise: number;
  /** 输出帧率；null=保持源帧率 */
  fps: number | null;
  droppedFrames: number;
  windows: number;
  enhance: boolean;
  seed: number;
};

export type RemixResult = {
  /** 混剪成品路径 */
  file: string;
  sizeBytes: number;
  sourceFile: string;
  sourceDeleted: boolean;
  applied: RemixApplied;
};

// ---------- 随机数（可复现） ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed(): number {
  return (Date.now() ^ (process.pid << 16) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

// ---------- 探测 ----------

type Probe = { duration: number; fps: number; width: number; height: number; hasAudio: boolean; nbFrames: number };

function evalRational(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const m = s.match(/^(-?[\d.]+)\/(-?[\d.]+)$/);
  if (m) {
    const d = parseFloat(m[2]);
    return d !== 0 ? parseFloat(m[1]) / d : fallback;
  }
  const v = parseFloat(s);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function probeVideo(ffprobe: string, file: string): Promise<Probe> {
  const { stdout } = await runp(
    ffprobe,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate,width,height,nb_frames:format=duration",
      "-of", "json",
      file,
    ],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout) as {
    streams?: { r_frame_rate?: string; width?: number; height?: number; nb_frames?: string }[];
    format?: { duration?: string };
  };
  const vs = j.streams?.[0];
  if (!vs) throw new Error("探测失败：文件里没有视频流");
  const hasAudio = await runp(
    ffprobe,
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "json", file],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  )
    .then(({ stdout }) => ((JSON.parse(stdout) as { streams?: unknown[] }).streams?.length ?? 0) > 0)
    .catch(() => false);
  return {
    duration: evalRational(j.format?.duration, 0),
    fps: evalRational(vs.r_frame_rate, 30),
    width: vs.width ?? 0,
    height: vs.height ?? 0,
    nbFrames: parseInt(vs.nb_frames ?? "0", 10) || 0,
    hasAudio,
  };
}

// ---------- 随机删帧计划 ----------

/** select 表达式条数上限：Windows 命令行 32K 限制，留足余量（超长视频自动封顶并如实统计） */
const MAX_DROP_TERMS = 900;

function buildDropPlan(
  duration: number,
  fps: number,
  window: number,
  min: number,
  max: number,
  rng: () => number,
): { times: number[]; windows: number } {
  const times: number[] = [];
  let windows = 0;
  for (let wStart = 0; wStart + 0.2 < duration && times.length < MAX_DROP_TERMS; wStart += window) {
    windows++;
    const wEnd = Math.min(wStart + window, duration);
    // 跳过开头 2 帧：首帧 pts 常有 edit-list 抖动，select 按 t 匹配不可靠
    const firstFrame = Math.max(2, Math.ceil(wStart * fps));
    const lastFrame = Math.floor(wEnd * fps) - 1;
    if (lastFrame <= firstFrame) continue;
    const span = lastFrame - firstFrame + 1;
    const want = Math.min(span - 1, min + Math.floor(rng() * (max - min + 1)));
    const picked = new Set<number>();
    for (let i = 0; i < want; i++) picked.add(firstFrame + Math.floor(rng() * span));
    for (const f of picked) times.push(f / fps);
  }
  return { times, windows };
}

/** 视频：以目标帧时刻为中心 ±0.3/fps 的窗口，只可能命中该帧（相邻帧距 1/fps），并容忍 pts 抖动 */
function dropExpressionVideo(times: number[], fps: number): string {
  const eps = 0.3 / fps;
  return times
    .map((t) => `between(t,${(t - eps).toFixed(6)},${(t + eps).toFixed(6)})`)
    .join("+");
}

/** 音频：按整帧槽位 [t, t+1/fps) 切除，与视频删帧严格等时，避免长视频音画漂移 */
function dropExpressionAudio(times: number[], fps: number): string {
  const slot = 1 / fps;
  return times
    .map((t) => `between(t,${t.toFixed(6)},${(t + slot).toFixed(6)})`)
    .join("+");
}

/** 有字时的镜像替代：随机位置裁剪放大 zoom 倍再放回原尺寸（偶数对齐，兼容 yuv420） */
function cropZoomExpr(zoom: number, w: number, h: number, rng: () => number): string | null {
  if (!w || !h) return null;
  const cw = Math.max(16, (Math.floor(w / zoom) & ~1));
  const ch = Math.max(16, (Math.floor(h / zoom) & ~1));
  const x = Math.floor(rng() * (w - cw)) & ~1;
  const y = Math.floor(rng() * (h - ch)) & ~1;
  return `crop=${cw}:${ch}:${x}:${y},scale=${w}:${h}:flags=lanczos`;
}

// ---------- 主流程 ----------

export async function mediaRemix(file: string, o: RemixOptions = {}): Promise<RemixResult> {
  const cfg = loadConfig();
  const ffmpeg = await resolveFfmpeg(cfg);
  const ffprobe = await resolveFfprobe(cfg);
  if (!ffmpeg || !ffprobe) {
    throw new Error("未找到 ffmpeg/ffprobe，请运行 `grabit doctor --fix`");
  }
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  o.onStage?.("probe");

  const probe = await probeVideo(ffprobe, file);
  const seed = o.seed ?? randomSeed();
  const rng = mulberry32(seed);

  // 归一化参数
  const mirrorWanted = o.mirror ?? true;
  let speed: number;
  if (o.speed === "off") speed = 1;
  else if (o.speed === "auto" || o.speed === undefined) speed = Math.round((0.97 + rng() * 0.09) * 1000) / 1000;
  else speed = Math.min(4, Math.max(0.25, o.speed));
  const noise = Math.min(60, Math.max(0, Math.round(o.noise ?? 6)));
  const windowSec = Math.max(2, o.dropWindow ?? 10);
  const dropMin = Math.max(0, Math.min(9, o.dropMin ?? 1));
  const dropMaxRaw = o.dropMax ?? 3;
  const dropMax = Math.max(dropMin, Math.min(9, dropMaxRaw));
  let targetFps: number | null = null;
  if (o.fps === "auto" || o.fps === undefined) targetFps = probe.fps > 30.5 ? 30 : null;
  else if (o.fps !== "off") targetFps = Math.min(120, Math.max(5, Math.round(o.fps)));
  const enhance = o.enhance ?? true;

  // 智能镜像：画面里有文字就不镜像（翻了字就没法看），改用随机裁剪放大补偿去重效果
  let mirror = mirrorWanted;
  let textDetected = false;
  let zoom: number | null = null;
  if (mirrorWanted && (o.textDetect ?? true)) {
    o.onStage?.("ocr");
    const det = await detectOnScreenText(ffmpeg, file, probe.duration, { onLine: o.onLine });
    if (det?.found) {
      textDetected = true;
      mirror = false;
      const zmin = Math.min(Math.max(o.zoomMin ?? 1.02, 1), 1.5);
      const zmax = Math.min(Math.max(o.zoomMax ?? 1.08, zmin), 1.5);
      zoom = Math.round((zmin + rng() * (zmax - zmin)) * 1000) / 1000;
      o.onLine?.(`🔍 检测到画面文字「${det.sample}」→ 跳过镜像，改裁剪放大 x${zoom.toFixed(2)}`);
    }
  }

  // 滤镜链（视频）：优化 → 镜像/裁剪放大 → 随机删帧 → 重建时间戳(含变速) → 抽帧降率 → 加噪点
  const vf: string[] = [];
  if (enhance) vf.push("hqdn3d=1.5:1.2:6:6", "cas=0.5");
  if (mirror) vf.push("hflip");
  else if (zoom !== null && zoom > 1.0005) {
    const expr = cropZoomExpr(zoom, probe.width, probe.height, rng);
    if (expr) vf.push(expr);
    else mirror = true; // 拿不到画面尺寸时回退为直接镜像
  }

  const plan = buildDropPlan(probe.duration, probe.fps, windowSec, dropMin, dropMax, rng);
  const hasSelect = plan.times.length > 0;
  const needSetpts = hasSelect || speed !== 1;
  // 变速后的有效帧率；setpts 压缩时间轴后必须用 fps 滤镜把它声明出去，
  // 否则封装层按源帧率做 CFR 会碾平变速并把被删的帧「补」回来
  const outRate = probe.fps * speed;
  if (hasSelect) vf.push(`select='not(${dropExpressionVideo(plan.times, probe.fps)})'`);
  if (needSetpts) vf.push(`setpts=N/${outRate.toFixed(6)}/TB`);
  if (targetFps && Math.abs(targetFps - outRate) > 0.5) vf.push(`fps=${targetFps}`);
  else if (needSetpts) vf.push(`fps=${outRate.toFixed(6)}`);
  if (noise > 0) vf.push(`noise=alls=${noise}:allf=t+u`);

  // 滤镜链（音频）：同一批时间点删片段（保持音画同步）→ 变速
  const af: string[] = [];
  if (probe.hasAudio) {
    if (hasSelect) af.push(`aselect='not(${dropExpressionAudio(plan.times, probe.fps)})'`, "asetpts=N/SR/TB");
    if (speed !== 1) af.push(`atempo=${speed}`);
  }

  const suffix = o.suffix ?? "_混剪优化";
  const baseOut = file.replace(/\.(mp4|mkv|webm|mov|ts)$/i, "") + suffix + ".mp4";
  const out = o.outputDir ? path.join(o.outputDir, path.basename(baseOut)) : baseOut;
  if (o.outputDir) fs.mkdirSync(o.outputDir, { recursive: true });

  const baseArgs = ["-y", "-i", file];
  if (vf.length) baseArgs.push("-vf", vf.join(","));
  if (af.length) baseArgs.push("-af", af.join(","));
  baseArgs.push(
    "-c:v", "libx264",
    "-crf", "17",
    "-preset", "fast",
    ...(probe.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-movflags", "+faststart",
  );

  const runFfmpeg = (extra: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [...baseArgs, ...extra, out], { windowsHide: true });
      let buf = "";
      let errTail = "";
      const consume = (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r|\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) {
          const t = line.trim();
          if (!t) continue;
          errTail = (errTail + "\n" + t).slice(-400);
          o.onLine?.(t);
        }
      };
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg 退出码 ${code}（参数不兼容或文件损坏）${errTail ? `: ${errTail}` : ""}`)),
      );
    });

  o.onStage?.("encode");
  // VFR 直通：保住删帧与变速的时间轴；老版本 ffmpeg 不认识 -fps_mode 时退回 -vsync 0
  try {
    await runFfmpeg(["-fps_mode", "vfr"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fps_mode|unrecognized option|unknown option/i.test(msg)) await runFfmpeg(["-vsync", "0"]);
    else throw e;
  }
  if (!fs.existsSync(out)) throw new Error("混剪输出未生成");

  // 诚实上报：无 fps 重采样时按「源帧数 - 成品帧数」实测删帧数（select 按 t 匹配可能偶发脱靶）
  let droppedFrames = plan.times.length;
  if (!targetFps && probe.nbFrames > 0) {
    const outFrames = await runp(
      ffprobe,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames", "-of", "csv=p=0", out],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    )
      .then(({ stdout }) => parseInt(stdout.trim(), 10) || 0)
      .catch(() => 0);
    if (outFrames > 0) droppedFrames = Math.max(0, probe.nbFrames - outFrames);
  }

  let sourceDeleted = false;
  if (o.deleteSource) {
    // 用 unlinkSync 而不是 rmSync({force:true})：后者在 node v24 + Windows 上
    // 对部分 Unicode 路径会原生 fail-fast（0xC0000409，不可捕获），进程静默暴毙
    // ——表现为成品已生成但无完成提示、原片残留、退出码异常。
    try {
      fs.unlinkSync(file);
      sourceDeleted = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        sourceDeleted = true; // 已不在 = 目标达成
      } else if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
        // 被杀软扫描/残留句柄短暂占用：小退避重试两次，仍失败则如实保留原片
        for (let i = 0; i < 2; i++) {
          await new Promise((r) => setTimeout(r, 300));
          try {
            fs.unlinkSync(file);
            sourceDeleted = true;
            break;
          } catch (e2) {
            const c2 = (e2 as NodeJS.ErrnoException)?.code;
            if (c2 === "ENOENT") {
              sourceDeleted = true;
              break;
            }
            if (c2 !== "EBUSY" && c2 !== "EPERM" && c2 !== "EACCES") break;
          }
        }
      }
    }
  }

  return {
    file: out,
    sizeBytes: fs.statSync(out).size,
    sourceFile: file,
    sourceDeleted,
    applied: {
      mirror,
      textDetected,
      zoom,
      speed,
      noise,
      fps: targetFps,
      droppedFrames,
      windows: plan.windows,
      enhance,
      seed,
    },
  };
}

/** 目录批量时跳过已是混剪成品的文件 */
export function isRemixOutput(name: string): boolean {
  return /_混剪优化\.mp4$/i.test(name) || /_优化\.mp4$/i.test(name) || /_强优化\.mp4$/i.test(name);
}
