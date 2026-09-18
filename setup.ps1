# grabit-mcp 一键安装/更新（Windows）
# 用法: irm https://raw.githubusercontent.com/RookieApe-tao/grabit-mcp/main/setup.ps1 | iex
# 国内网络可先设镜像: $env:GRABIT_GIT_MIRROR="https://mirror.ghproxy.com/https://github.com"
$ErrorActionPreference = "Stop"
$app = "$env:USERPROFILE\.grabit\app"

Write-Host "== grabit-mcp 安装器 ==" -ForegroundColor Cyan

# ---- 获取代码：更新 或 多通道克隆（镜像/https/ssh）----
if (Test-Path "$app\package.json") {
    Write-Host ">> 已存在，拉取最新代码..."
    try { git -C $app pull --ff-only } catch { Write-Host "  更新失败（不影响已装版本，继续安装现有代码）" }
}
else {
    $candidates = @()
    if ($env:GRABIT_GIT_MIRROR) { $candidates += ($env:GRABIT_GIT_MIRROR.TrimEnd('/') + '/RookieApe-tao/grabit-mcp.git') }
    $candidates += 'https://github.com/RookieApe-tao/grabit-mcp.git'
    $candidates += 'git@github.com:RookieApe-tao/grabit-mcp.git'

    $cloned = $false
    foreach ($u in $candidates) {
        Write-Host ">> 克隆: $u"
        New-Item -ItemType Directory -Force -Path (Split-Path $app) | Out-Null
        if (Test-Path $app) { Remove-Item $app -Recurse -Force }
        git clone --depth 1 $u $app 2>$null
        if (Test-Path "$app\package.json") { $cloned = $true; break }
        Write-Host "  此通道失败，尝试下一个..."
    }
    if (-not $cloned) {
        throw "所有通道克隆失败（网络受限）。稍后重试，或设镜像后重跑: `$env:GRABIT_GIT_MIRROR='<镜像地址>'；或给 git 配代理: git config --global http.proxy http://127.0.0.1:<端口>"
    }
}

# ---- 全局安装 ----
Write-Host ">> 全局安装（npm i -g）..."
Push-Location
try {
    Set-Location $app
    npm i -g --no-audit --no-fund .
    if ($LASTEXITCODE -ne 0) { throw "npm 全局安装失败" }
}
finally {
    Pop-Location
}

# ---- 环境自检 ----
Write-Host ">> 环境自检（缺 yt-dlp/ffmpeg 会自动下载）..."
& grabit doctor --fix

Write-Host ""
Write-Host "✔ 安装完成！试试: grabit `<视频链接`>   或   grabit serve   （更新=重跑本命令）" -ForegroundColor Green
