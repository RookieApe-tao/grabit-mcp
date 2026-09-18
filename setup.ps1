# grabit-mcp 一键安装/更新（Windows）
# 用法: irm https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.ps1 | iex
$ErrorActionPreference = "Stop"
$app = "$env:USERPROFILE\.grabit\app"

Write-Host "== grabit-mcp 安装器 ==" -ForegroundColor Cyan

if (Test-Path "$app\.git") {
    Write-Host ">> 已存在，拉取最新代码..."
    git -C $app pull --ff-only
} else {
    Write-Host ">> 克隆仓库到 $app ..."
    New-Item -ItemType Directory -Force -Path (Split-Path $app) | Out-Null
    git clone --depth 1 https://github.com/RookieApe-tao/grabit-mcp.git $app
}

Write-Host ">> 全局安装（npm i -g）..."
npm i -g --no-audit --no-fund $app
if ($LASTEXITCODE -ne 0) { throw "npm 全局安装失败" }

Write-Host ">> 环境自检（缺 yt-dlp/ffmpeg 会自动下载）..."
& grabit doctor --fix

Write-Host ""
Write-Host "✔ 安装完成！试试: grabit `<视频链接`>   或   grabit serve" -ForegroundColor Green
