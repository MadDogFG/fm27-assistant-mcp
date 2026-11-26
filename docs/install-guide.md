# 完整安装、配置与排障手册

本文档提供 **FM27 Assistant** 的详细安装流程、进阶环境变量说明以及常见错误解决方案。

---

## 1. 下载与安装 BepInEx 6

1. 前往 [BepInEx Builds](https://builds.bepinex.dev/projects/bepinex_be) 下载适用于 Windows 64 位 IL2CPP 游戏的最新包：`BepInEx-Unity.IL2CPP-win-x64-*.zip`。
2. 打开 Steam，右键 *Football Manager 27* -> **管理** -> **浏览本地文件**，打开游戏根目录。
3. 将压缩包内的所有文件（`BepInEx/`、`winhttp.dll`、`doorstop_config.ini` 等）解压到游戏根目录。
4. **运行一次游戏**：正常启动 FM27，等待游戏加载到开始菜单界面后退出。
   - 此步骤会触发 BepInEx 自动生成 `<游戏目录>\BepInEx\interop\` 目录，内含游戏托管互操作程序集。

---

## 2. 编译与安装 FMAssistant.dll

### 自动脚本部署（推荐）
打开 PowerShell，进入插件根目录后运行：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-plugin.ps1 -GameDir "你的FM27游戏目录"
```
脚本会自动：
1. 校验游戏目录与 `BepInEx\core` 是否就绪；
2. 以 `Release` 模式编译 `bepinex-plugin/FMAssistant/FMAssistant.csproj`；
3. 将生成的 `FMAssistant.dll` 复制到 `<游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll`。

### 手动编译部署
```powershell
$env:FM_GAME_DIR = "你的FM27游戏目录"
dotnet build bepinex-plugin/FMAssistant/FMAssistant.csproj -c Release
```
然后将 `bepinex-plugin/FMAssistant/bin/Release/FMAssistant.dll` 手动复制到 `<游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll`。

---

## 3. 配置 AI 客户端

### 3.1 Antigravity 插件模式
将本项目作为插件目录导入即可。`plugin.json` 会自动挂载：
- Skill：`skills/fm27-assistant/SKILL.md`（及 `references/` 下的 8 份按需披露手册）
- MCP：`mcp_config.json`

### 3.2 其他 MCP 客户端（Cursor / Claude Desktop / Cline 等）
注意：部分宿主客户端不会把工作目录切换到本仓库，**必须使用绝对路径**而非相对路径 `mcp/fm-assistant-mcp.mjs`。在仓库根目录运行以下命令可直接生成包含当前实际绝对路径的 JSON 配置：

```bash
node scripts/generate-mcp-config.mjs
# 如需直接把绝对路径写回本机 mcp_config.json，可附加 --write：
node scripts/generate-mcp-config.mjs --write
```

生成的配置格式如下：
```json
{
  "mcpServers": {
    "fm27-assistant": {
      "command": "node",
      "args": ["D:/path/to/fm27-assistant-plugin/mcp/fm-assistant-mcp.mjs"],
      "env": {
        "FM_ASSISTANT_URL": "http://127.0.0.1:27190"
      }
    }
  }
}
```
同时，建议将 `skills/fm27-assistant/SKILL.md` 的路径配置为客户端的规则或 Skill 目录，以便 Agent 按渐进式披露模式工作。

---

## 4. 进阶环境变量说明

| 环境变量 | 生效端 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `FM_GAME_DIR` | 编译阶段 | 自动探测 | 指定 FM27 游戏根目录 |
| `FM_ASSISTANT_PORT` | 游戏插件 | `27190` | 修改游戏内 HTTP 服务监听端口 |
| `FM_ASSISTANT_URL` | MCP 网关 | `http://127.0.0.1:27190` | 指定 MCP 网关连接的游戏 HTTP 地址 |
| `FM_ASSISTANT_EXPOSE_ALL_TOOLS` | MCP 网关 | 未开启 (`0`) | 设为 `1` 时将全量展开所有独立 MCP 工具（默认关闭，仅暴露 4 个元工具以保护上下文） |

---

## 5. 验证安装是否成功

1. 启动游戏并进入一个已加载的经理存档。
2. 查看 `<游戏目录>\BepInEx\LogOutput.log`，应能看到：
   ```text
   [Info   :FM Assistant] [FM Assistant] loading v1.1.0
   ```
3. 在浏览器或终端访问 `http://127.0.0.1:27190/health`，或让 Agent 调用 `plugin_health`，应返回 `ok: true`。

---

## 6. 常见问题排查

1. **Q：调用 `plugin_health` 提示连不上 `127.0.0.1:27190`？**
   - 请确认游戏已启动；
   - 请检查 `LogOutput.log` 确认 BepInEx 已正确引导且没有杀毒软件拦截本地回环端口 `27190`；
   - 确认 `FMAssistant.dll` 位于 `BepInEx\plugins\FMAssistant\` 文件夹内。
2. **Q：编译时报找不到 `BepInEx.Core` 或 `Il2Cppmscorlib`？**
   - 确认 `-GameDir` 或 `FM_GAME_DIR` 指向包含游戏主程序的根目录；
   - 确认已安装 BepInEx 并先启动过一次游戏生成 `BepInEx\interop\` 目录。
3. **Q：为什么 Agent 只看到 4 个 MCP 工具？**
   - 这是刻意设计的**渐进式披露（Progressive Disclosure）**网关架构，避免数百个工具定义淹没 Agent 上下文。Agent 会通过 `fm_discover` 按需检索领域工具，再通过 `fm_call` 执行调用。如需兼容旧版客户端，可设置 `FM_ASSISTANT_EXPOSE_ALL_TOOLS=1`。

---

## 7. 持久化日志与问题上报

本插件两端均内置持久化日志，遇到问题时无需靠猜复现：

- **MCP 网关日志**（记录工具名、传入参数摘要、耗时与错误）：
  `<插件根目录>\logs\mcp.log`（满 2MB 自动轮转为 `mcp.log.old`，亦可通过环境变量 `FM_ASSISTANT_LOG_FILE` 自定义路径）。
- **游戏内插件日志**（记录游戏内接口执行与异常堆栈）：
  `<FM27游戏目录>\BepInEx\plugins\FMAssistant\state\live.log` 以及 `<FM27游戏目录>\BepInEx\LogOutput.log`。
