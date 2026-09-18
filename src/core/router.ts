export type Platform =
  | "youtube"
  | "twitter"
  | "telegram"
  | "bilibili"
  | "douyin"
  | "tiktok"
  | "xiaohongshu"
  | "instagram"
  | "other";

const HOST_RULES: Array<[Platform, string[]]> = [
  ["youtube", ["youtube.com", "youtu.be", "youtube-nocookie.com"]],
  ["twitter", ["twitter.com", "x.com"]],
  ["telegram", ["t.me", "telegram.me"]],
  ["bilibili", ["bilibili.com", "b23.tv"]],
  ["douyin", ["douyin.com", "iesdouyin.com", "douyinpic.com"]],
  ["tiktok", ["tiktok.com"]],
  ["xiaohongshu", ["xiaohongshu.com", "xhslink.com"]],
  ["instagram", ["instagram.com", "instagr.am"]],
];

export function detectPlatform(rawUrl: string): Platform {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "other";
  }
  for (const [platform, hosts] of HOST_RULES) {
    for (const h of hosts) {
      if (host === h || host.endsWith("." + h)) return platform;
    }
  }
  return "other";
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  twitter: "X (Twitter)",
  telegram: "Telegram",
  bilibili: "哔哩哔哩",
  douyin: "抖音",
  tiktok: "TikTok",
  xiaohongshu: "小红书",
  instagram: "Instagram",
  other: "其他站点",
};
