# FM27 Assistant 架构设计（Architecture）

FM27 Assistant 采用 **进程内 BepInEx C# 插件（原生游戏业务桥） + 零依赖 Node.js MCP 网关** 的双层架构，完全通过 *Football Manager 27* 自身的数据绑定与原生事件通道工作。

```text
┌─────────────────────────────┐
│   AI Agent / MCP Client     │  (4 个初始元工具 + 按需加载 Skills)
└──────────────┬──────────────┘
               │ JSON-RPC 2.0 over stdio
┌──────────────▼──────────────────────────────────────────────┐
│  Node.js MCP Gateway (mcp/) — 零第三方 npm 依赖              │
│  ├── fm-assistant-mcp.mjs   协议协商 / 渐进式披露 / 模式门控  │
│  ├── core/                                                  │
│  │   ├── auth.mjs           读取并热刷新本地 256-bit Token    │
│  │   ├── schema-validator   前置 JSON Schema 参数校验         │
│  │   ├── execution-queue    读写分离并发调度（写/共享态串行） │
│  │   └── response-limiter   UTF-8 硬字节上限截断保护          │
│  ├── algorithms/            确定性足球算法（匈牙利最佳首发等）│
│  ├── tool-catalog.mjs       显式元数据注册表 & 同义词检索     │
│  └── *-tools.mjs            领域工具适配层                    │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP over 127.0.0.1:27190
               │ Authorization: Bearer <256-bit session.token>
┌──────────────▼──────────────────────────────────────────────┐
│  BepInEx IL2CPP Plugin (bepinex-plugin/FMAssistant/)        │
│  ├── AuthGuard.cs           随机会话密钥 & 生产/开发模式隔离  │
│  ├── HttpApi.cs             TCP监听 / Header解析 / 鉴权分发   │
│  │   ├── HttpApi.Tactics.cs          战术/阵型/定位球路由     │
│  │   ├── HttpApi.SquadAndTraining.cs 阵容/医疗/训练/导师路由  │
│  │   ├── HttpApi.TransfersAndClub.cs 转会/合同/招募/财政路由  │
│  │   ├── HttpApi.MatchAndManager.cs  比赛/收件箱/推进/Live    │
│  │   └── HttpApi.Diagnostics.cs      开发诊断（生产默认 403） │
│  ├── InternalCommands.cs    生产显式事件/属性白名单           │
│  ├── MainThread.cs          Unity 主线程安全调度              │
│  ├── LiveTools.cs           原生属性订阅 / 引用追踪 / 快照    │
│  └── DispatchJournal.cs     操作意图持久化与防重回执          │
└──────────────┬──────────────────────────────────────────────┘
               │ SI.Interop / GameInteropSubsystem
┌──────────────▼──────────────┐
│     Football Manager 27     │
└─────────────────────────────┘
```

---

## 关键工程决策

### 1. 安全下沉到 C# HTTP 层
- **本机会话鉴权**：插件启动时使用加密随机数生成器产生 256-bit Bearer Token，原子写入 `%LOCALAPPDATA%\FMAssistant\session.token`。除 `GET /health` 外，所有路由缺失或错误 Token 一律返回 `401 Unauthorized`。
- **生产 / 开发严格隔离**：默认生产模式下，`HttpApi.Diagnostics.cs` 中的全部历史调试路由一律返回 `403 Forbidden`；`InternalCommands.cs` 对 `/api/v1/internal/event` 与 `/api/v1/internal/update` 执行**显式合法业务白名单**（拒绝一切未知事件与未授权属性写入）。仅显式设置 `FM_ASSISTANT_DEV_MODE=1` 时开放本地开发诊断。

### 2. 渐进式工具披露与显式元数据
- 初始仅向 Agent 暴露 4 个元工具（`plugin_health`、`fm_discover`、`fm_call`、`fm_continue_game`），显著降低初始工具 Schema 上下文占用。
- 每个工具通过 `tool-catalog.mjs` 获得显式元数据 `{ domain, readOnly, exclusiveState, riskLevel, requiresOutOfMatch }`，使并发调度、权限护栏与检索分类不再依赖脆弱的名称前缀正则。

### 3. 读写分离并发与操作可信度
- MCP 入口不再用单一全局 Promise 链串死所有消息：`ping`、`plugin_health`、`fm_discover` 与纯只读查询立即并发响应；写操作及共享可变状态操作（如修改全局搜索框的 `search_players`）由 `ExecutionQueue` 严格串行保序。
- 所有写命令通过 `DispatchJournal` 区分 `dispatched_unverified`、`verified` 与 `session_changed`，杜绝超时误重发。

### 4. 确定性算法 + LLM 协同
- 把纯数学/组合优化问题（如 `optimize_best_xi` 匈牙利最大权匹配、`audit_squad_and_contracts` 深度与薪资体检）下沉为本地零依赖确定性算法，把战术权衡、引援思路与更衣室沟通留给 LLM，实现更低 Token 消耗与更高决策稳定性。
