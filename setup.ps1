# grabit-mcp 一键安装/更新（Windows）
# 用法: irm https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.ps1 | iex
$ErrorActionPreference = "Stop"
$app = "$env:USERPROFILE\.grabit\app"

Write-Host "== grabit-mcp 安装器 ==" -ForegroundColor Cyan

# ---- 获取代码（clone 或更新，重试 3 次）----
$ok = $false
for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    try {
        if (Test-Path "$app\package.json") {
            Write-Host ">> 已存在，拉取最新代码..."
            git -C $app pull --ff-only
        }
        else {
            if (Test-Path $app) { Remove-Item $app -Recurse -Force }
            Write-Host ">> 克隆仓库到 $app（第 $i 次）..."
            New-Item -ItemType Directory -Force -Path (Split-Path $app) | Out-Null
            git clone --depth 1 https://github.com/RookieApe-tao/grabit-mcp.git $app
        }
        if (Test-Path "$app\package.json") { $ok = $true }
    }
    catch {
        Write-Host "  失败: $($_.Exception.Message)"
        Start-Sleep -Seconds 2
    }
}
if (-not $ok) {
    throw "GitHub 克隆失败（网络波动或受限）。稍后重试；或先给 git 配置代理: git config --global http.proxy http://127.0.0.1:<代理端口>"
}

# ---- 全局安装 ----
Write-Host ">> 全局安装（npm i -g）..."
Push-Location
try {
    Set-Location $app
    npm i -g --no-audit --no-fund .
    if ($LASTEXITCODE -ne 0) { throw "npm 全局安装失败" }
} finally {
    Pop-Location
}

# ---- 环境自检 ----
Write-Host ">> 环境自检（缺 yt-dlp/ffmpeg 会自动下载）..."
& grabit doctor --fix

Write-Host ""
Write-Host "✔ 安装完成！试试: grabit `<视频链接`>   或   grabit serve   （更新=重跑本命令）" -ForegroundColor Green
