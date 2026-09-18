import fs from "node:fs";
import path from "node:path";

/**
 * 抖音无水印解析：依赖自托管的 Evil0ctal/Douyin_TikTok_Download_API 服务。
 * 配置方式：grabit config douyinApi http://127.0.0.1:8000
 *（未配置时走 yt-dlp 兜底，可能需要 cookies 且有水印）
 */
export type DouyinMeta = {
  title: string;
  videoUrl: string;
};

type Evil0ctalResponse = {
  data?: {
    item_list?: Array<{
      desc?: string;
      video?: {
        play_addr?: { url_list?: string[] };
      };
    }>;
  };
};

export async function douyinResolve(apiBase: string, shareUrl: string): Promise<DouyinMeta> {
  const base = apiBase.replace(/\/+$/, "");
  const endpoint = `${base}/api/hybrid/video_data?url=${encodeURIComponent(shareUrl)}&minimal=true`;
  const res = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`抖音解析 API 返回 ${res.status}（检查 douyinApi 配置与服务状态）`);
  const j = (await res.json()) as Evil0ctalResponse;
  const item = j.data?.item_list?.[0];
  const videoUrl = item?.video?.play_addr?.url_list?.[0];
  if (!videoUrl) throw new Error("抖音解析 API 未返回视频地址");
  const title = (item?.desc ?? "douyin").replace(/[\\/:*?"<>|\r\n]/g, " ").slice(0, 80).trim();
  return { title: title || "douyin", videoUrl };
}

export async function douyinDownload(
  apiBase: string,
  shareUrl: string,
  outputDir: string,
  onLine?: (line: string) => void,
): Promise<string> {
  const meta = await douyinResolve(apiBase, shareUrl);
  onLine?.(`[douyin] 无水印地址解析成功：${meta.title}`);
  const res = await fetch(meta.videoUrl, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`无水印视频下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(outputDir, `${meta.title} [douyin].mp4`);
  fs.writeFileSync(file, buf);
  onLine?.(`[douyin] 已保存：${file}`);
  return file;
}
