import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GrabitConfig } from "./config.js";

const runp = promisify(execFile);

async function which(bin: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await runp(cmd, [bin]);
    const first = stdout.trim().split(/\r?\n/)[0];
    return first || null;
  } catch {
    return null;
  }
}

function localBin(cfg: GrabitConfig, name: string): string {
  return path.join(cfg.binDir, process.platform === "win32" ? `${name}.exe` : name);
}

export async function resolveYtDlp(cfg: GrabitConfig): Promise<string | null> {
  if (cfg.ytDlpPath && fs.existsSync(cfg.ytDlpPath)) return cfg.ytDlpPath;
  const local = localBin(cfg, "yt-dlp");
  if (fs.existsSync(local)) return local;
  return which("yt-dlp");
}

export async function resolveFfmpeg(cfg: GrabitConfig): Promise<string | null> {
  if (cfg.ffmpegPath && fs.existsSync(cfg.ffmpegPath)) return cfg.ffmpegPath;
  const local = localBin(cfg, "ffmpeg");
  if (fs.existsSync(local)) return local;
  return which("ffmpeg");
}

export async function resolveFfprobe(cfg: GrabitConfig): Promise<string | null> {
  if (cfg.ffprobePath && fs.existsSync(cfg.ffprobePath)) return cfg.ffprobePath;
  const local = localBin(cfg, "ffprobe");
  if (fs.existsSync(local)) return local;
  // ffprobe 通常和 ffmpeg 装在同一目录
  const ffmpeg = await resolveFfmpeg(cfg);
  if (ffmpeg) {
    const sibling = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (fs.existsSync(sibling)) return sibling;
  }
  return which("ffprobe");
}

export async function versionOf(bin: string, args: string[] = ["--version"]): Promise<string> {
  try {
    const { stdout } = await runp(bin, args, { timeout: 20_000 });
    return stdout.trim().split(/\r?\n/)[0];
  } catch {
    return "unknown";
  }
}

export type DoctorReport = {
  node: string;
  ytDlpPath: string | null;
  ytDlpVersion: string;
  ffmpegPath: string | null;
  ffmpegVersion: string;
  outputDir: string;
  ok: boolean;
  hints: string[];
};

export async function doctor(cfg: GrabitConfig): Promise<DoctorReport> {
  const ytDlp = await resolveYtDlp(cfg);
  const ffmpeg = await resolveFfmpeg(cfg);
  const report: DoctorReport = {
    node: process.version,
    ytDlpPath: ytDlp,
    ytDlpVersion: ytDlp ? await versionOf(ytDlp) : "",
    ffmpegPath: ffmpeg,
    ffmpegVersion: ffmpeg ? await versionOf(ffmpeg, ["-version"]) : "",
    outputDir: cfg.outputDir,
    ok: Boolean(ytDlp && ffmpeg),
    hints: [],
  };
  if (!ytDlp) report.hints.push("缺少 yt-dlp：运行 `grabit doctor --fix` 自动下载，或 winget install yt-dlp.yt-dlp");
  if (!ffmpeg) report.hints.push("缺少 ffmpeg：运行 `grabit doctor --fix` 自动下载，或 winget install Gyan.FFmpeg");
  return report;
}

async function downloadTo(url: string, dest: string, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`文件过小 (${buf.length}B)，疑似下载失败`);
      fs.writeFileSync(dest, buf);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function findFile(dir: string, name: string): Promise<string | null> {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

/** Windows 下自动安装 yt-dlp + ffmpeg 到 ~/.grabit/bin（不需要管理员权限，不改 PATH） */
export async function installBinaries(cfg: GrabitConfig): Promise<void> {
  fs.mkdirSync(cfg.binDir, { recursive: true });

  const ytDlp = await resolveYtDlp(cfg);
  if (!ytDlp) {
    if (process.platform !== "win32") {
      throw new Error("请手动安装 yt-dlp：pip install -U yt-dlp 或 brew install yt-dlp");
    }
    console.log("↓ 下载 yt-dlp.exe ...");
    await downloadTo(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
      localBin(cfg, "yt-dlp"),
    );
    console.log("✔ yt-dlp 安装完成");
  }

  const ffmpeg = await resolveFfmpeg(cfg);
  if (!ffmpeg) {
    if (process.platform !== "win32") {
      throw new Error("请手动安装 ffmpeg：brew install ffmpeg 或 apt install ffmpeg");
    }
    const zip = path.join(cfg.binDir, "ffmpeg.zip");
    const urls = [
      "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
      "https://github.com/GyanD/codexffmpeg/releases/latest/download/ffmpeg-release-essentials.zip",
    ];
    let ok = false;
    for (const u of urls) {
      try {
        console.log(`↓ 下载 ffmpeg (${u}) ...`);
        await downloadTo(u, zip, 2);
        ok = true;
        break;
      } catch (err) {
        console.log(`  失败：${err instanceof Error ? err.message : err}`);
      }
    }
    if (!ok) throw new Error("ffmpeg 下载失败，请手动下载后放入 " + cfg.binDir);

    console.log("… 解压 ffmpeg ...");
    const exDir = path.join(cfg.binDir, "ffmpeg-extract");
    fs.rmSync(exDir, { recursive: true, force: true });
    try {
      await runp("tar", ["-xf", zip, "-C", exDir], { timeout: 300_000 });
    } catch {
      await runp(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${exDir}' -Force`],
        { timeout: 300_000 },
      );
    }
    for (const exe of ["ffmpeg.exe", "ffprobe.exe"]) {
      const found = await findFile(exDir, exe);
      if (!found) throw new Error(`解压包中未找到 ${exe}`);
      fs.copyFileSync(found, path.join(cfg.binDir, exe));
    }
    fs.rmSync(exDir, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    console.log("✔ ffmpeg 安装完成");
  }
}
