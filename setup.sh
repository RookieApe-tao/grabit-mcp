#!/usr/bin/env bash
# grabit-mcp 一键安装/更新（macOS / Linux）
# 用法: curl -fsSL https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.sh | bash
set -e
APP="$HOME/.grabit/app"

echo "== grabit-mcp 安装器 =="

# ---- 获取代码（clone 或更新，重试 3 次）----
ok=false
for i in 1 2 3; do
  if [ -f "$APP/package.json" ]; then
    echo ">> 已存在，拉取最新代码..."
    git -C "$APP" pull --ff-only && ok=true || ok=false
  else
    rm -rf "$APP"
    echo ">> 克隆仓库到 $APP（第 $i 次）..."
    mkdir -p "$(dirname "$APP")"
    if git clone --depth 1 https://github.com/RookieApe-tao/grabit-mcp.git "$APP"; then ok=true; fi
  fi
  [ -f "$APP/package.json" ] && ok=true
  [ "$ok" = true ] && break
  sleep 2
done
if [ "$ok" != true ]; then
  echo "GitHub 克隆失败（网络波动或受限）。稍后重试；或先配置代理: git config --global http.proxy http://127.0.0.1:<代理端口>" >&2
  exit 1
fi

echo ">> 全局安装（npm i -g）..."
npm i -g --no-audit --no-fund "$APP"

echo ">> 环境自检..."
grabit doctor || true

echo
echo "✔ 安装完成！试试: grabit <视频链接>   或   grabit serve   （更新=重跑本命令）"
