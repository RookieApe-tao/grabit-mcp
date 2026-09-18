#!/usr/bin/env bash
# grabit-mcp 一键安装/更新（macOS / Linux）
# 用法: curl -fsSL https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.sh | bash
set -e
APP="$HOME/.grabit/app"

echo "== grabit-mcp 安装器 =="

if [ -d "$APP/.git" ]; then
  echo ">> 已存在，拉取最新代码..."
  git -C "$APP" pull --ff-only
else
  echo ">> 克隆仓库到 $APP ..."
  mkdir -p "$(dirname "$APP")"
  git clone --depth 1 https://github.com/RookieApe-tao/grabit-mcp.git "$APP"
fi

echo ">> 全局安装（npm i -g）..."
npm i -g --no-audit --no-fund "$APP"

echo ">> 环境自检（提示缺失依赖时按说明安装: brew install yt-dlp ffmpeg）..."
grabit doctor || true

echo
echo "✔ 安装完成！试试: grabit <视频链接>   或   grabit serve"
