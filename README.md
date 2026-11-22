# FM27 Assistant — *Football Manager 27* 实时 AI 助教插件

**FM27 Assistant** 是一个专为 *Football Manager 27* 打造的独立、完整、开箱即用的游戏内 AI 助教插件。通过注入游戏进程的 **BepInEx 6 (IL2CPP)** 插件与零依赖 **MCP (Model Context Protocol)** 网关，让 AI Agent 能够安全、合法地读取游戏真实状态并通过原生业务指令辅助你管理俱乐部。

---

## 核心特性

- **渐进式披露，告别上下文污染**：
  MCP 网关默认仅向 Agent 暴露 **4 个精简元工具**（`plugin_health`、`fm_discover`、`fm_call`、`fm_continue_game`），初始 Schema 体积仅 **~1.4 KB**（相比全量暴露 270+ 工具减少 **98.8%** 上下文占用）。Agent 按领域按需加载对应 Skill 手册与具体工具参数。
- **完全独立，零外部依赖**：
  - MCP 服务基于纯 Node.js 18+ 原生模块实现，**无需 `npm install`**，不依赖任何第三方库、外部 Skill 或其他 MCP。
  - C# BepInEx 插件独立运行于游戏进程内（默认监听本地 `127.0.0.1:27190`）。
- **全面覆盖七大核心业务领域**：
  1. **战术与定位球**：阵型、心态、球队/个人/针对性指令、助教建议、角球/任意球/点球布置。
  2. **训练与导师**：一线队/梯队周训练日程、赛前准备、强度休息阈值、个人焦点与导师小组。
  3. **阵容与医疗**：名单规划、球衣号码、队长任命、赛事注册、伤病治疗方案与国家队征召。
  4. **招募与转会**：球探重点、搜索筛选、短名单管理、试训以及转会/租借/续约原生草稿填写。
  5. **俱乐部管理**：董事会愿景、财政预算滑块分配、设施/球场请求、职员聘任、行为准则与附属俱乐部。
  6. **经理中心**：收件箱整理、职员会议、杯赛抽签、新闻/谈话邀请处理、假期规则与生涯管理。
  7. **比赛数据（只读）**：实时比分与阶段状态、xG/xA/射门/传球等高阶比赛分析与赛后事件战报。
- **安全与边界合规**：
  - 全程通过游戏原生业务事件与数据绑定运行，不模拟鼠标键盘点击，不修改存档文件或篡改属性资金。
  - 转会报价与合同谈判严格止步于游戏原生草稿填写，最终确认与对话回复交由玩家决定。

---

## 快速开始（5 分钟安装）

详细图文级配置与排障步骤请参阅 [完整安装与使用教程](docs/install-guide.md)。

### 1. 环境准备
- PC 版 *Football Manager 27*
- [BepInEx 6 (Unity.IL2CPP win-x64)](https://builds.bepinex.dev/projects/bepinex_be)
- [Node.js 18+](https://nodejs.org/)
- [.NET 6 或 8 SDK](https://dotnet.microsoft.com/download)（若从源码编译）

### 2. 安装 BepInEx 并部署插件
1. 将 BepInEx 6 解压至 *Football Manager 27* 游戏根目录，**启动游戏进入主菜单后退出**（自动生成 `BepInEx\interop` 目录）。
2. 运行一键编译部署脚本（或将预编译好的 `FMAssistant.dll` 放入 `<游戏目录>\BepInEx\plugins\FMAssistant\`）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/build-plugin.ps1 -GameDir "你的FM27游戏根目录"
   ```

### 3. 在 AI 客户端加载插件
- **Antigravity / 支持插件清单的客户端**：直接将本仓库目录作为插件加载，系统会自动识别 `plugin.json`、`skills/fm27-assistant` 与 `mcp_config.json`。
- **通用 MCP 客户端（Claude Desktop / Cursor / Windsurf 等）**：在 MCP 配置中加入：
  ```json
  {
    "mcpServers": {
      "fm27-assistant": {
        "command": "node",
        "args": ["<仓库绝对路径>/mcp/fm-assistant-mcp.mjs"],
        "env": {
          "FM_ASSISTANT_URL": "http://127.0.0.1:27190"
        }
      }
    }
  }
  ```

### 4. 启动验证
1. 启动 *Football Manager 27* 并加载你的经理存档。
2. 在 AI 对话中让 Agent 检查插件连接（Agent 会调用 `plugin_health`），确认返回正常后即可开始使用！

---

## 使用示例

在游戏加载存档后，你可以直接用自然语言向 Agent 下达指令：
- **日常统筹**：“帮我看看收件箱有什么重要消息，把普通通知标为已读，并检查一下今天助教有什么建议。”
- **战术调整**：“帮我看看当前战术槽的心态和阵型，把心态调整为‘积极进取’，并设置对阵下一场对手的高位压迫针对性指令。”
- **训练规划**：“读取下周的球队训练日程，在赛前一天加上定位球和团队凝聚力训练，顺便检查哪些主力疲劳过高需要休息。”
- **球探招募**：“帮我创建一个新的球探招募重点，并读取目前短名单里所有球员的球探报告和工作许可状态。”
- **比赛复盘**：“读取上一场比赛的详细战报、xG 数据和传球分析，总结我方进攻端的问题。”

---

## 目录结构

```text
fm27-assistant-plugin/
├── plugin.json                        # 插件清单（声明 Skill 与 MCP 配置）
├── mcp_config.json                    # MCP 网关服务启动配置
├── README.md                          # 产品说明与快速开始
├── docs/
│   └── install-guide.md               # 详细安装、环境变量与排障指南
├── scripts/
│   └── build-plugin.ps1               # 一键编译并部署 BepInEx 插件脚本
├── skills/
│   └── fm27-assistant/
│       ├── SKILL.md                   # 主入口 Skill（渐进式披露路由）
│       └── references/                # 按需加载的领域手册（含一站式安装指南）
├── mcp/
│   ├── fm-assistant-mcp.mjs           # 精简 MCP 网关（默认仅暴露 4 个元工具）
│   ├── tool-catalog.mjs               # 领域目录与按需检索模块
│   └── *.mjs                          # 各业务领域原生接口实现（零外部依赖）
└── bepinex-plugin/
    └── FMAssistant/                   # C# BepInEx 6 (Unity.IL2CPP) 插件源码
```

---

## 许可协议

本项目采用 [MIT License](LICENSE) 开源。使用本插件请遵守游戏用户协议，建议在单人离线模式中使用。
