# FM27 Assistant 工程路线图（Roadmap）

本项目致力于打造 **Football Manager 27** 生态中架构优雅、安全可控、可复现验证的非官方 **Agent 原生操作底座（Agent SDK）**——全链路走游戏原生合法业务接口，不修改内存数值、不模拟鼠标键盘。

---

## 核心工程原则

1. **工程质量优先于工具数量**：先立安全护栏、模块化架构与自动化测试，再扩展能力。
2. **单一事实来源（Single Source of Truth）**：每个工具的领域、读写属性、风险等级、验证状态与 Schema 显式声明，消除正则猜测与文档漂移。
3. **诚实且可复现的验证标准**：明确区分 `Implemented`、`Unit-Tested`、`Live-Verified`、`Read-Only` 与 `Gated`，所有能力声明均有可复跑证据支撑。
4. **专注生态底座定位**：深耕原生业务执行层、轻量化确定性决策辅助与专业足球 Skills，与第三方比赛空间分析（如 FMMatchLens）或离线引擎模拟器互补协作。

---

## 阶段一：安全底座、仓库卫生与自动化测试（v1.1，已完成）

- [x] **HTTP 层安全下沉**：插件启动生成本机随机会话 Bearer Token（`AuthGuard.cs`，写入当前用户 `%LOCALAPPDATA%\FMAssistant\session.token`），除 `/health` 外所有接口强制鉴权；默认生产模式以**显式白名单**（80 业务事件 / 14 属性）收紧通用底层写入入口，历史诊断路由移入 `HttpApi.Diagnostics.cs` 默认 `403`。
- [x] **清理仓库卫生**：移除误入库的运行日志（`logs/mcp.log`），完善 `.gitignore`，通过自动化隐私扫描单测杜绝个人本地路径泄漏。
- [x] **零依赖自动化测试与 CI**：基于 Node.js 内置 `node:test` 建立 `tests/unit/`（17 项断言覆盖语法、注册表、Schema 校验、Token 热刷新、并发队列、MCP stdio 端到端协议、决策算法、空战术防死锁守卫与 Skills 引用完整性）与 `tests/live/smoke-regression.mjs`（11/11 真机冒烟回归），配置 `.github/workflows/ci.yml`。
- [x] **诚实能力矩阵与严谨文档**：创建 `docs/CAPABILITIES.md`，同步 `RuntimeCapabilities.cs`（`schemaVersion: 2`），修正 `README.md` 中关于初始 Schema 体积对比与能力边界的精确表述。

---

## 阶段二：架构解耦与 MCP 协议工业级精修（v1.1，已完成）

- [x] **C# 插件路由按领域拆分**：将 1758 行的单体 `HttpApi.cs` 拆分为核心网关/鉴权分发器 + 5 个领域 `partial` 模块（`Tactics`、`SquadAndTraining`、`TransfersAndClub`、`MatchAndManager`、`Diagnostics`），补全标准 HTTP 状态短语。
- [x] **MCP 核心层模块化与显式元数据**：提取 `mcp/core/`（`auth`、`schema-validator`、`response-limiter`、`execution-queue`），通过 `mcp/tool-catalog.mjs` 为全部工具赋予显式 `{ domain, readOnly, exclusiveState, riskLevel, requiresOutOfMatch }` 元数据，告别正则前缀猜读写与领域。
- [x] **MCP 协议健壮性加固**：
  - 严格协商受支持的 MCP 协议版本（`2025-06-18` / `2025-03-26` / `2024-11-05`）；
  - `fm_call` 入口统一前置 JSON Schema 参数校验；
  - 真正的读写分离并发模型（`plugin_health` 与只读查询不被写队列阻塞，写操作与共享搜索状态严格串行）；
  - UTF-8 硬字节截断保护，默认去除重复 `structuredContent` 载荷节省长会话 Token；
  - 支持 `FM_ASSISTANT_MODE=assistant|autonomous` 分级模式开关。

---

## 阶段三：确定性足球决策算法与运营 SOP（v1.1，已完成）

- [x] **纯 JS 确定性辅助算法（`mcp/algorithms/`）**：
  - `optimize_best_xi`：基于位置熟练度、体能、伤停与属性权重的最优首发 11 人匹配算法（精确匈牙利最大权匹配）与 7 人替补推荐，彻底杜绝 LLM 心算排重与漏看伤停；
  - `audit_squad_and_contracts`：一键阵容深度缺口、冗余位置、年龄结构与高薪老将体检。
- [x] **Skills 升级为闭环运营 SOP**：在三联足球知识册（`pro-manager-playbook`、`tactical-mastery`、`game-mechanics`）基础上新增 `workflows.md`，沉淀赛前准备、比赛诊断复盘、转会窗清人买人、时间推进事件处理 4 条标准化工作流。

---

## 阶段四：产品化发布与生态互联（v2.0 展望）

- [ ] **自动化发布流水线**：GitHub Actions 自动打包带版本与 SHA256 校验的 Release 压缩包，提供一键安装/升级/回滚脚本与 FM27 版本兼容性矩阵。
- [ ] **多语言开发者文档**：已在 v1.1 补齐中文 `ARCHITECTURE.md` 与 `CHANGELOG.md`，后续进一步完善英文双语文档与外部贡献指南。
- [ ] **生态协同**：保持标准 MCP 协议与清晰边界，支持玩家将本项目（操作执行层）与专业比赛数据采集/离线模拟器组合使用，形成完整自主运营闭环。
