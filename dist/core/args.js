import path from "node:path";
export const QUALITIES = ["best", "2160", "1080", "720", "480", "audio"];
export function normalizeQuality(q) {
    if (!q)
        return "best";
    const v = q.toLowerCase().replace(/p$/, "");
    if (QUALITIES.includes(v))
        return v;
    throw new Error(`未知画质 "${q}"，可选：${QUALITIES.join(" / ")}`);
}
export function qualityArgs(q) {
    switch (q) {
        case "audio":
            return ["-x", "--audio-format", "mp3", "--audio-quality", "0"];
        case "best":
            return ["-f", "bestvideo+bestaudio/best"];
        default: {
            const h = parseInt(q, 10);
            return ["-f", `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`];
        }
    }
}
export function cookieArgs(o) {
    const args = [];
    if (o.cookiesFromBrowser)
        args.push("--cookies-from-browser", o.cookiesFromBrowser);
    else if (o.cookiesFile)
        args.push("--cookies", o.cookiesFile);
    return args;
}
export function outputTemplate(outputDir) {
    // %(title).100B 截断标题到 100 字节，避免 Windows 路径过长
    return path.join(outputDir, "%(title).100B [%(id)s].%(ext)s");
}
export function buildDownloadArgs(url, o) {
    const args = [
        url,
        ...qualityArgs(o.quality),
        "--merge-output-format",
        "mp4",
        "--newline",
        "-o",
        outputTemplate(o.outputDir),
        "--no-simulate",
        "--print",
        "after_move:filepath",
    ];
    if (!o.playlist)
        args.push("--no-playlist");
    if (process.platform === "win32")
        args.push("--windows-filenames");
    args.push(...cookieArgs(o));
    if (o.extra?.length)
        args.push(...o.extra);
    return args;
}
export function buildInfoArgs(url, o) {
    return [url, "--dump-single-json", "--no-playlist", ...cookieArgs(o)];
}
