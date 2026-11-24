# FM27 Assistant — *Football Manager 27* 实时 AI 助教插件

**FM27 Assistant** 是一个专为 *Football Manager 27* 打造的独立、完整、开箱即用的游戏内 AI 助教插件。通过注入游戏进程的 **BepInEx 6 (IL2CPP)** 插件与零依赖 **MCP (Model Context Protocol)** 网关，让 AI Agent 能够安全、合法地读取游戏真实状态并通过原生业务指令辅助你管理俱乐部。

---

## 它是怎么工作的？

- **不改存档、不是外挂**：我们在游戏里放了一个小插件（基于 BepInEx），它就像你的“助理教练”，只能看你当前在游戏里能看到的数据，并通过游戏自带的合法按钮帮你点选战术、安排训练或草拟报价；绝不篡改球员属性和资金，也绝不碰你的存档文件。
- **为什么 Agent 默认只看到 4 个工具，不会弄晕 AI？**：如果一次性把近 300 个工具的说明书全塞给 AI，AI 脑子会直接被撑爆（浪费大量 Token 且容易选错）。所以本插件采用了**按需翻手册**的模式：AI 平时只带 4 个通用小工具上场，你让他管战术，他才去翻战术小抄并按需查对应的工具参数，既省钱又聪明。

---

## 核心特性

- **渐进式工具披露（低初始上下文占用）**：
  MCP 网关默认仅向 Agent 暴露 **4 个精简元工具**（`plugin_health`、`fm_discover`、`fm_call`、`fm_continue_game`），初始工具 Schema 体积仅 **~1.4 KB**（相比一次性暴露 300+ 工具的初始 Schema 体积减少约 98.8%；实际长会话总 Token 消耗取决于任务调用频次，并由响应硬字节限流器与紧凑模式协同控制）。
- **纵深安全与工程规范**：
  - **本机随机 Bearer Token 鉴权**：插件启动自动生成 256-bit 会话密钥写入当前用户目录（`%LOCALAPPDATA%\FMAssistant\session.token`），除 `GET /health` 外所有接口强制校验，MCP 客户端自动加载并支持 401 热刷新重试。
  - **生产 / 开发隔离与显式白名单**：生产模式默认关闭所有历史诊断路由（返回 `403`），底层通用事件与属性写入采用显式业务白名单校验。
  - **读写分离并发与前置校验**：`fm_call` 统一前置 JSON Schema 参数校验；只读查询可并发响应，写操作与共享可变状态操作严格串行保序，配合 `DispatchJournal` 持久化意图日志与操作回执防重发。
- **确定性足球算法 + 专业 Skills 知识库**：
  - 内置纯 JS 零依赖确定性决策算法：`optimize_best_xi`（精确匈牙利最大权匹配最优首发 11 人与替补席）与 `audit_squad_and_contracts`（一键位置深度缺口、冗员、年龄与高薪老将体检）。
  - 内置按需加载的四联专业手册：主教练经营指南、三层战术原子/套路/哲学全书、游戏底层机制大全与标准化运营 SOP（`skills/fm27-assistant/references/`）。
- **完全独立，零第三方 npm 依赖**：
  - MCP 服务与单元测试套件均基于 Node.js 20+ 原生模块实现，**无需 `npm install`**；支持 `npm test` 一键运行自动化测试并接入 GitHub Actions CI。
- **透明的能力与验证边界**：
  - 全程通过游戏原生业务事件与数据绑定运行，不模拟键鼠点击，不修改存档文件或篡改数值。
  - 默认 `FM_ASSISTANT_MODE=assistant` 模式下，比赛保持只读、发布会与谈话不代答；本队续约与转会/租借报价经确认后可直接提交，外来球员新签合同的最终确认保留在游戏内合同页完成。完整逐项验证清单请参阅 [能力与验证矩阵](docs/CAPABILITIES.md)、[架构设计](ARCHITECTURE.md) 与 [工程路线图](ROADMAP.md)。

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
2. **部署插件（免编译，无需 .NET SDK）**：将仓库内预编译好的 `dist/FMAssistant.dll` 直接复制到 `<游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll`；若需自行从源码编译，可运行：
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
fm27-assistant-mcp/
├── plugin.json                        # 插件清单（声明 Skill 与 MCP 配置）
├── package.json                       # 零依赖脚本入口（npm test / npm run test:live）
├── mcp_config.json                    # MCP 网关服务启动配置
├── README.md                          # 产品说明与快速开始
├── ARCHITECTURE.md                    # 双层架构、安全模型与并发设计
├── ROADMAP.md                         # 分阶段工程路线图与演进规划
├── CHANGELOG.md                       # 语义化版本变更日志
├── .github/workflows/ci.yml           # GitHub Actions 自动化测试流水线
├── docs/
│   ├── CAPABILITIES.md                # 诚实分级的能力与验证状态矩阵
│   └── install-guide.md               # 详细安装、环境变量与排障指南
├── scripts/
│   └── build-plugin.ps1               # 一键编译并部署 BepInEx 插件脚本
├── skills/
│   └── fm27-assistant/
│       ├── SKILL.md                   # 主入口 Skill（渐进式披露路由）
│       └── references/                # 领域手册、战术原子全书、游戏机制与运营 SOP
├── mcp/
│   ├── fm-assistant-mcp.mjs           # 精简 MCP 网关（默认仅暴露 4 个元工具）
│   ├── core/                          # Token 鉴权、Schema 校验、读写队列、硬字节限流
│   ├── algorithms/                    # 纯 JS 确定性足球算法（最优首发、阵容审计）
│   ├── tool-catalog.mjs               # 显式元数据引擎与同义词检索
│   └── *-tools.mjs                    # 各业务领域原生接口实现（零外部依赖）
├── tests/
│   ├── unit/                          # 零依赖离线单元测试套件（node:test）
│   └── live/                          # 一键真机冒烟回归测试脚本
└── bepinex-plugin/
    └── FMAssistant/                   # C# BepInEx 6 插件（AuthGuard + 分领域 HttpApi 路由）
```

## 测试与验证

```bash
# 1. 运行离线单元测试与文档完整性审计（无需启动游戏，零 npm 依赖）
npm test

# 2. 游戏运行并载入存档后，运行真机冒烟回归（自动生成 docs/live-verification-report.json）
npm run test:live
```

---

## 遇到问题如何查看日志与复现？

插件两端都自带**持久化磁盘日志**（自动记录每次调用与错误堆栈，且限制大小防止撑爆硬盘）。如果使用中遇到报错或卡住，只需把下面两份文件打包发在 GitHub Issues 里即可精准定位：

1. **AI 网关侧日志**（记录 Agent 传了什么参数、耗时和 JS 错误）：
   `<本插件根目录>/logs/mcp.log`（超过 2MB 自动轮转为 `mcp.log.old`）
2. **游戏插件侧日志**（记录游戏内接口响应与 C# 异常）：
   `<FM27游戏目录>/BepInEx/plugins/FMAssistant/state/live.log` 与 `<FM27游戏目录>/BepInEx/LogOutput.log`

---

## 许可协议

本项目采用 [MIT License](LICENSE) 开源。使用本插件请遵守游戏用户协议，建议在单人离线模式中使用。
