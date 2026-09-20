import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { doctorText, mediaDownload, mediaInfo } from "../core/api.js";
import { ensureOutputDir, loadConfig } from "../core/config.js";
import { QUALITIES } from "../core/args.js";
const jobs = new Map();
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="#0b1220"/><path d="M96 34v70M62 76l34 34 34-34" stroke="#4ade80" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M46 150h100" stroke="#4ade80" stroke-width="14" stroke-linecap="round"/></svg>`;
const MANIFEST = JSON.stringify({
    name: "grabit 下载器",
    short_name: "grabit",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
});
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1220">
<title>grabit 下载器</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#0b1220;color:#e5eaf3;min-height:100vh;padding:16px;max-width:640px;margin:0 auto}
h1{font-size:20px;display:flex;align-items:center;gap:8px;margin-bottom:14px}
h1 img{width:26px;height:26px}
.card{background:#121a2b;border:1px solid #1f2c47;border-radius:14px;padding:14px;margin-bottom:12px}
textarea{width:100%;height:70px;background:#0b1220;color:#e5eaf3;border:1px solid #2a3a5f;border-radius:10px;padding:10px;font-size:14px;resize:vertical}
.row{display:flex;gap:8px;margin-top:10px}
select,button{font-size:14px;border-radius:10px;border:1px solid #2a3a5f;background:#0b1220;color:#e5eaf3;padding:10px 12px}
select{flex:0 0 auto}
button{flex:1;background:#16a34a;border:none;color:#fff;font-weight:600}
button.ghost{background:#1c2a44;flex:0 0 auto;font-weight:400}
button:disabled{opacity:.5}
.meta{font-size:13px;color:#9fb0cc;margin-top:8px;line-height:1.6}
.meta img{max-width:100%;border-radius:8px;margin-bottom:8px}
#log{font-size:12px;color:#8fa3c8;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto;margin-top:8px}
.file{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #1f2c47;font-size:14px}
.file a{color:#7dd3fc;text-decoration:none;word-break:break-all}
.size{color:#9fb0cc;flex:0 0 auto}
.err{color:#f87171;font-size:13px;margin-top:8px;white-space:pre-wrap}
footer{font-size:12px;color:#5b6b8c;text-align:center;margin-top:18px;line-height:1.8}
</style>
</head>
<body>
<h1><img src="/icon.svg" alt="">grabit 下载器</h1>
<div class="card">
  <textarea id="url" placeholder="粘贴视频链接（YouTube / X / B站 / 抖音 / Telegram ...）"></textarea>
  <div class="row">
    <select id="q"><option value="best">最高画质</option><option value="2160">4K</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="audio">仅音频 mp3</option></select>
    <button id="infoBtn" class="ghost" onclick="loadInfo()">查信息</button>
    <button id="dlBtn" onclick="startDl()">下载</button>
  </div>
  <div id="meta" class="meta"></div>
  <div id="err" class="err"></div>
  <div id="log" hidden></div>
  <div class="meta" style="margin-top:10px"><label><input type="checkbox" id="remix" checked style="vertical-align:-2px"> 下载后自动混剪优化（镜像/抽帧/变速/噪点/每10秒随机删帧，只留成品）</label></div>
</div>
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <b>已下载文件</b><button class="ghost" onclick="loadFiles()">刷新</button>
  </div>
  <div id="files" class="meta">加载中…</div>
</div>
<footer>grabit-mcp · 仅限个人备份与授权内容<br>电脑关机时此页面不可用</footer>
<script>
function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]))}
function fmtSize(n){if(!n)return "";return "（"+(n/1048576).toFixed(1)+" MB）"}
async function loadInfo(){
  const url=document.getElementById("url").value.trim();if(!url)return;
  const meta=document.getElementById("meta"),err=document.getElementById("err");
  meta.textContent="查询中…";err.textContent="";
  try{const r=await fetch("/api/info?url="+encodeURIComponent(url));const j=await r.json();
    if(j.error){meta.textContent="";err.textContent=j.error;return}
    meta.innerHTML=(j.thumbnail?"<img loading=\\"lazy\\" src=\\""+esc(j.thumbnail)+"\\">":"")
      +"<b>"+esc(j.title)+"</b><br>"+esc(j.platform)+" · "+(j.uploader||"-")+" · "
      +(j.duration?Math.round(j.duration)+"s":"-")+"<br>可选画质: "+esc((j.availableHeights||[]).map(h=>h+"p").join(" / ")||"-");
  }catch(e){meta.textContent="";err.textContent=String(e)}
}
let pollTimer=null;
async function startDl(){
  const url=document.getElementById("url").value.trim();if(!url)return;
  const btn=document.getElementById("dlBtn");btn.disabled=true;
  const log=document.getElementById("log");log.hidden=false;log.textContent="提交任务…";
  document.getElementById("err").textContent="";
  try{
    const q=document.getElementById("q").value;
    const rm=document.getElementById("remix").checked?"1":"0";
    const r=await fetch("/api/download?url="+encodeURIComponent(url)+"&quality="+q+"&remix="+rm);
    const j=await r.json();
    if(j.error){log.hidden=true;document.getElementById("err").textContent=j.error;btn.disabled=false;return}
    pollTimer=setInterval(()=>poll(j.jobId,btn),1000);
  }catch(e){log.textContent=String(e);btn.disabled=false}
}
async function poll(id,btn){
  const r=await fetch("/api/job?id="+id);const j=await r.json();
  const tail=(j.lines||[]).slice(-4).join("\\n");
  document.getElementById("log").textContent=(j.status==="running"?"⏳ 下载中…\\n":"")+tail;
  if(j.status!=="running"){
    clearInterval(pollTimer);pollTimer=null;btn.disabled=false;
    if(j.status==="error"){document.getElementById("err").textContent=j.error}
    else{document.getElementById("log").textContent="✔ 完成\\n"+j.file;loadFiles()}
  }
}
async function loadFiles(){
  const box=document.getElementById("files");
  try{
    const r=await fetch("/api/files");const j=await r.json();
    if(!j.files||!j.files.length){box.textContent="暂无文件";return}
    box.innerHTML=j.files.map(f=>"<div class=\\"file\\"><a href=\\"/api/file?name="+encodeURIComponent(f.name)+"\\">"+esc(f.name)+"</a><span class=\\"size\\">"+(f.size/1048576).toFixed(1)+" MB</span></div>").join("");
  }catch(e){box.textContent=String(e)}
}
loadFiles();
</script>
</body>
</html>`;
function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
}
const MIME = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".jpg": "image/jpeg",
    ".png": "image/png",
};
function startJob(url, quality, remix) {
    const id = Math.random().toString(36).slice(2, 10);
    const job = { id, status: "running", lines: [] };
    jobs.set(id, job);
    mediaDownload(url, {
        quality: quality && QUALITIES.includes(quality) ? quality : undefined,
        remix: remix === "1" ? true : remix === "0" ? false : undefined,
        onStage: (stage) => {
            if (stage === "remix-start")
                job.lines.push("🎨 混剪优化中（镜像/抽帧/变速/噪点/随机删帧）…");
            else if (stage === "remix-done")
                job.lines.push("✔ 混剪完成，原片已删除，只留成品");
            else if (stage === "remix-failed")
                job.lines.push("⚠ 混剪失败，已保留原片");
        },
        onLine: (line) => {
            if (/^frame=/.test(line)) {
                job.lines.push(line);
                if (job.lines.length > 300)
                    job.lines.shift();
            }
        },
    })
        .then((r) => {
        job.status = "done";
        job.file = r.file || undefined;
        if (r.remixError)
            job.lines.push("⚠ " + r.remixError);
    })
        .catch((e) => {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
    });
    return id;
}
async function route(req, res) {
    const cfg = loadConfig();
    const outDir = ensureOutputDir(cfg);
    const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const p = u.pathname;
    if (p === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(INDEX_HTML);
        return;
    }
    if (p === "/manifest.webmanifest") {
        res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" });
        res.end(MANIFEST);
        return;
    }
    if (p === "/icon.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(ICON_SVG);
        return;
    }
    if (p === "/api/info") {
        const url = u.searchParams.get("url");
        if (!url)
            return send(res, 400, { error: "缺少 url 参数" });
        try {
            return send(res, 200, await mediaInfo(url));
        }
        catch (e) {
            return send(res, 502, { error: e instanceof Error ? e.message : String(e) });
        }
    }
    if (p === "/api/download") {
        const url = u.searchParams.get("url");
        if (!url)
            return send(res, 400, { error: "缺少 url 参数" });
        return send(res, 200, {
            jobId: startJob(url, u.searchParams.get("quality") ?? undefined, u.searchParams.get("remix")),
        });
    }
    if (p === "/api/job") {
        const job = jobs.get(u.searchParams.get("id") ?? "");
        if (!job)
            return send(res, 404, { error: "任务不存在" });
        return send(res, 200, {
            status: job.status,
            lines: job.lines.slice(-8),
            file: job.file,
            error: job.error,
        });
    }
    if (p === "/api/files") {
        const files = fs
            .readdirSync(outDir)
            .map((name) => {
            const full = path.join(outDir, name);
            const st = fs.statSync(full);
            return { name, size: st.size, mtime: st.mtimeMs };
        })
            .filter((f) => f.size > 0)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 100);
        return send(res, 200, { files });
    }
    if (p === "/api/file") {
        const name = path.basename(u.searchParams.get("name") ?? "");
        const full = path.join(outDir, name);
        if (!name || name.startsWith(".") || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
            return send(res, 404, { error: "文件不存在" });
        }
        const ext = path.extname(full).toLowerCase();
        res.writeHead(200, {
            "Content-Type": MIME[ext] ?? "application/octet-stream",
            "Content-Length": fs.statSync(full).size,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        });
        fs.createReadStream(full).pipe(res);
        return;
    }
    if (p === "/api/doctor") {
        return send(res, 200, { text: await doctorText() });
    }
    send(res, 404, { error: "not found" });
}
export async function serve(host, port) {
    const cfg = loadConfig();
    ensureOutputDir(cfg);
    const server = http.createServer((req, res) => {
        route(req, res).catch((e) => {
            send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
    });
    server.listen(port, host, () => {
        console.log(`grabit serve 已启动（输出目录: ${cfg.outputDir}）`);
        console.log(`  本机访问   : http://localhost:${port}`);
        const nets = os.networkInterfaces();
        for (const list of Object.values(nets)) {
            for (const n of list ?? []) {
                if (n.family === "IPv4" && !n.internal) {
                    console.log(`  局域网访问 : http://${n.address}:${port}   ← 手机连同一 Wi-Fi 用这个`);
                }
            }
        }
        console.log("  Ctrl+C 停止");
    });
}
