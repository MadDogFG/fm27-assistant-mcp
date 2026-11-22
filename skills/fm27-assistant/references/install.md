# FM27 Assistant 安装与排障指南

本指南用于协助用户或 Agent 从零完成 FM27 Assistant 的安装、配置、启动与连接验证。

## 前置环境要求

1. **游戏**：PC 版 *Football Manager 27*（Steam / Epic 均可）
2. **运行时**：
   - [BepInEx 6 (Unity.IL2CPP win-x64)](https://builds.bepinex.dev/projects/bepinex_be)（建议 6.0.0-be 最新稳定版）
   - [Node.js 18+](https://nodejs.org/)（用于运行 MCP 网关，无需 `npm install`，零第三方依赖）
   - [.NET 6 / 8 SDK](https://dotnet.microsoft.com/download)（仅源码编译时需要；若直接下载 Release 的 `FMAssistant.dll` 则无需安装）

## 第一步：安装 BepInEx 6 并生成互操作程序集

1. 将下载的 `BepInEx-Unity.IL2CPP-win-x64-*.zip` 解压到 *Football Manager 27* 游戏根目录（包含游戏主程序 `.exe` 的文件夹）。
2. **首次启动游戏一次**并进入主菜单后退出。
   - 此步骤会自动生成 `<游戏目录>\BepInEx\interop\` 下的托管互操作 DLL（后续编译和插件加载必需）。

## 第二步：部署 FMAssistant 插件

### 方式 A：直接使用仓库预编译 DLL（推荐，无需 .NET SDK）
直接将仓库内的 `dist/FMAssistant.dll` 复制到：
```text
<游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll
```

### 方式 B：从源码一键编译并自动部署
在插件仓库根目录运行 PowerShell 脚本（自动探测常见 Steam 路径，或通过 `-GameDir` 指定）：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-plugin.ps1 -GameDir "你的FM27游戏目录"
```
或设置环境变量 `FM_GAME_DIR` 后直接编译：
```powershell
$env:FM_GAME_DIR = "你的FM27游戏目录"
dotnet build bepinex-plugin/FMAssistant/FMAssistant.csproj -c Release
```
编译产物位于 `bepinex-plugin/FMAssistant/bin/Release/FMAssistant.dll`，将其复制到 `<游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll`。

## 第三步：配置 AI 客户端 / MCP 连接

插件内置的 MCP 网关位于 `mcp/fm-assistant-mcp.mjs`。在支持 MCP 的客户端中配置如下：

- **Antigravity / IDE 插件安装**：直接将本仓库目录作为插件加载，系统会自动读取 `plugin.json` 与 `mcp_config.json`。
- **通用 MCP 客户端（Claude Desktop / Cursor / Windsurf 等）**：在 MCP 配置文件中添加：
```json
{
  "mcpServers": {
    "fm27-assistant": {
      "command": "node",
      "args": ["<插件绝对路径>/mcp/fm-assistant-mcp.mjs"],
      "env": {
        "FM_ASSISTANT_URL": "http://127.0.0.1:27190"
      }
    }
  }
}
```
> **提示**：
> - 默认采用精简网关模式（仅暴露 4 个元工具，极省上下文）。
> - 如需兼容不识别元工具的旧客户端，可在 `env` 中追加 `"FM_ASSISTANT_EXPOSE_ALL_TOOLS": "1"`。
> - 如需修改游戏插件监听端口，可设置环境变量 `FM_ASSISTANT_PORT`（游戏侧）与 `FM_ASSISTANT_URL`（MCP 侧）。

## 第四步：启动自检

1. 启动 *Football Manager 27* 并加载任意存档（在主菜单未进档时仅健康检查可用，进档后全部业务功能激活）。
2. 让 Agent 调用 `plugin_health`。
   - 返回 `ok: true` 且包含游戏内版本及心跳信息，即表示安装与连接完全成功。

## 常见故障排查

| 现象 | 原因 | 解决方法 |
| :--- | :--- | :--- |
| `连不上 FM 助教插件（127.0.0.1:27190）` | 游戏未启动、BepInEx 未生效或 DLL 路径不对 | 确认游戏已启动；检查 `<游戏目录>\BepInEx\LogOutput.log` 是否有 `FM Assistant loading` 字样；确认 `FMAssistant.dll` 位于 `BepInEx\plugins\FMAssistant\` |
| 编译报找不到 `Il2Cppmscorlib` / `FM.GamePlugin` | 未先运行一次带 BepInEx 的游戏生成 `interop` 目录 | 先按第一步带 BepInEx 启动一次游戏进入主菜单再退出，确认 `BepInEx\interop\` 已生成文件后再编译 |
| 返回“尚未加载存档”或 `Human` 引用不可用 | 游戏停留在开始菜单，尚未进入经理存档 | 在游戏内新建或读取任意存档后再调用业务工具 |
| 请求返回 `HTTP 400` 提示状态已变化或 `choiceToken` 过期 | 游戏内日期推进或手动修改了界面导致草稿过期 | 重新调用对应的读取工具刷新状态与 `choiceToken` 后重试 |
