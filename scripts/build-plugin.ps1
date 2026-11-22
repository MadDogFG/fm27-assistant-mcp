<#
.SYNOPSIS
    编译 FMAssistant BepInEx 插件并自动部署至 Football Manager 27 游戏目录。
.PARAMETER GameDir
    Football Manager 27 游戏根目录（亦可设置环境变量 FM_GAME_DIR）。
.PARAMETER SkipDeploy
    仅编译而不复制到游戏目录。
#>
param(
    [string]$GameDir = $env:FM_GAME_DIR,
    [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CsprojPath = Join-Path $RepoRoot "bepinex-plugin\FMAssistant\FMAssistant.csproj"

# 常见 Steam 默认路径探测
if (-not $GameDir) {
    $candidates = @(
        "C:\Program Files (x86)\Steam\steamapps\common\Football Manager 27",
        "D:\SteamLibrary\steamapps\common\Football Manager 27",
        "E:\SteamLibrary\steamapps\common\Football Manager 27",
        "E:\Steam\steamapps\common\Football Manager 27"
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "BepInEx\core\BepInEx.Core.dll")) {
            $GameDir = $c
            break
        }
    }
}

if (-not $GameDir -or -not (Test-Path $GameDir)) {
    Write-Error "未找到 Football Manager 27 游戏目录。请通过 -GameDir 参数或 FM_GAME_DIR 环境变量指定游戏路径。"
}

$BepInExCore = Join-Path $GameDir "BepInEx\core\BepInEx.Core.dll"
if (-not (Test-Path $BepInExCore)) {
    Write-Error "在游戏目录中未检测到 BepInEx ($BepInExCore)。请先安装 BepInEx 6 (Unity.IL2CPP) 并启动一次游戏以生成互操作程序集 (interop)。"
}

Write-Host "[1/2] 正在编译 FMAssistant 插件 (FMGameDir=$GameDir)..." -ForegroundColor Cyan
dotnet build $CsprojPath -c Release -p:FMGameDir="$GameDir"
if ($LASTEXITCODE -ne 0) {
    Write-Error "编译失败，请检查 .NET 6/8 SDK 与 BepInEx/interop 程序集是否完整。"
}

$DllSource = Join-Path $RepoRoot "bepinex-plugin\FMAssistant\bin\Release\FMAssistant.dll"
if (-not (Test-Path $DllSource)) {
    Write-Error "未找到编译产物：$DllSource"
}

if (-not $SkipDeploy) {
    $PluginTargetDir = Join-Path $GameDir "BepInEx\plugins\FMAssistant"
    New-Item -ItemType Directory -Force -Path $PluginTargetDir | Out-Null
    Copy-Item -Path $DllSource -Destination (Join-Path $PluginTargetDir "FMAssistant.dll") -Force
    Write-Host "[2/2] 部署完成：$PluginTargetDir\FMAssistant.dll" -ForegroundColor Green
} else {
    Write-Host "[2/2] 编译产物位于：$DllSource" -ForegroundColor Green
}
