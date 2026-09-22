import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildDownloadArgs, buildInfoArgs } from "./args.js";
export function runYtDlp(bin, args, onLine) {
    return new Promise((resolve, reject) => {
        const useShell = bin.endsWith(".bat") || bin.endsWith(".cmd");
        // PYTHONUTF8: yt-dlp.exe(Python) 在管道下默认用系统 ANSI 代码页输出，中文路径会乱码
        const child = spawn(bin, args, {
            windowsHide: true,
            shell: useShell,
            env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        });
        const stdoutLines = [];
        const stderrLines = [];
        const consume = (buf, sink) => {
            for (const raw of buf.split(/\r?\n|\r/)) {
                const line = raw.trimEnd();
                if (!line.trim())
                    continue;
                sink.push(line);
                if (sink.length > 800)
                    sink.shift();
                onLine?.(line);
            }
        };
        child.stdout?.on("data", (d) => consume(d.toString(), stdoutLines));
        child.stderr?.on("data", (d) => consume(d.toString(), stderrLines));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, stdoutLines, stderrLines }));
    });
}
export async function ytdlpInfo(bin, url, opts) {
    const { code, stdoutLines, stderrLines } = await runYtDlp(bin, buildInfoArgs(url, opts));
    if (code !== 0) {
        throw new Error(stderrLines.slice(-6).join("\n") || `yt-dlp 退出码 ${code}`);
    }
    const jsonLine = [...stdoutLines].reverse().find((l) => l.trimStart().startsWith("{"));
    if (!jsonLine)
        throw new Error("yt-dlp 未返回 JSON 信息");
    const j = JSON.parse(jsonLine);
    const heights = Array.from(new Set((j.formats ?? []).map((f) => f.height ?? 0).filter((h) => h > 0))).sort((a, b) => b - a);
    return {
        url,
        platform: j._extractor ?? j.extractor_key ?? "unknown",
        extractor: j.extractor_key ?? j._extractor ?? "unknown",
        id: j.id ?? "",
        title: j.title ?? "(未知标题)",
        uploader: j.uploader ?? j.channel,
        duration: j.duration,
        thumbnail: j.thumbnail,
        availableHeights: heights.slice(0, 8),
        isLive: Boolean(j.is_live),
    };
}
/** 从输出行里提取 --print after_move:filepath 打印的最终文件路径 */
export function extractFinalPath(lines) {
    const candidates = lines.filter((l) => !l.trim().startsWith("[") && /\.[a-z0-9]{2,5}\s*$/i.test(l.trim()));
    const last = candidates[candidates.length - 1];
    return last ? last.trim() : null;
}
/**
 * 扫描输出目录返回 sinceMs 之后修改的最新成品文件。
 * PyInstaller 版 yt-dlp 在管道下输出的路径可能乱码（编码不受 PYTHONUTF8 控制），
 * 所以以目录扫描为准、print 输出仅作参考。
 */
export function newestFileSince(dir, sinceMs) {
    let best = null;
    let entries;
    try {
        entries = fs.readdirSync(dir);
    }
    catch {
        return null;
    }
    for (const name of entries) {
        if (/\.(part|ytdl|temp|json|txt)$/i.test(name))
            continue;
        const full = path.join(dir, name);
        let st;
        try {
            st = fs.statSync(full);
        }
        catch {
            continue;
        }
        if (!st.isFile() || st.mtimeMs < sinceMs)
            continue;
        if (!best || st.mtimeMs > best.mtime)
            best = { file: full, mtime: st.mtimeMs };
    }
    return best?.file ?? null;
}
export async function ytdlpDownload(bin, url, opts, onLine) {
    const { code, stdoutLines, stderrLines } = await runYtDlp(bin, buildDownloadArgs(url, opts), onLine);
    const tail = [...stdoutLines, ...stderrLines].slice(-10);
    if (code !== 0) {
        const err = stderrLines.filter((l) => l.includes("ERROR")).slice(-3).join("\n");
        throw new Error(err || tail.join("\n") || `yt-dlp 退出码 ${code}`);
    }
    const alreadyDownloaded = stdoutLines.some((l) => /has already been downloaded/i.test(l));
    return { file: extractFinalPath(stdoutLines), code, tail, alreadyDownloaded };
}
