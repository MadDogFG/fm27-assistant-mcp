# Changelog

本项目遵循语义化版本规范（Semantic Versioning）。

## [Unreleased] - 2026-11-26

### Token 优化、聚合工作流与响应提速
- **4 个高密度 1-Call 业务聚合包（`mcp/workflow-bundles-tools.mjs`）**：
  - `get_daily_hub_briefing`：1 次并发汇总推进状态/阻塞原因、待回复邮件摘要、未读头条（启用 `includeBody: false` 省正文）、近期 3 场赛程与转会动态并生成确定性行动清单；
  - `get_matchday_prep_bundle`：围绕 FM27 **战术有效性 4 支柱**（理解度 50% / 认同度 25% / 下场信息 15% / 球员能力 10%），1 次并发汇总下场对手、战术槽、对手球探优缺点、停赛合规与全量匈牙利精确最佳首发；
  - `get_transfer_window_briefing`：1 次并发汇总转会窗截止日倒计时、生效转会/工资预算、6 大位置线缺口/冗员与合同到期优先队列（共享同日快照缓存）、短名单与转会中心活跃条目；
  - `get_match_diagnosis_bundle`：自动识别赛中/非赛中模式，赛中输出双方核心统计/xG、采样窗、高/低分与体能/黄牌预警及确定性战术诊断信号，非赛中输出严格绑定 `fixtureIdentity` 的历史战报与近 5 场数据中心趋势。
- **`batch_read` 安全并发只读（`mcp/fm-assistant-mcp.mjs`）**：保持 4 元工具网关不变，支持经由 `fm_call({ action: "batch_read" })` 单轮并发调用 1–6 个非独占只读工具，前置严格拒绝写操作、`exclusiveState` 工具（如 `search_players` / `get_shortlist_players`）与嵌套调用。
- **实时扫描并发提速与省流**：
  - `get_squad_snapshot` 升级为单人字段并发 + 受控 4 人微批并发（峰值句柄约 42，远低于 128 原生上限），`get_pre_match_briefing` 升级为 6 人微批并发；
  - `get_inbox` 新增 `includeBody`（默认 `true`）与 `bodyMaxChars` 截断参数，并对单封邮件字段采用即读即关并发拉取。
- **`fm_discover` 极致省 Token 优化（`mcp/tool-catalog.mjs`）**：`detail: false` 压缩超长中文描述至单句摘要（<=50 字）、默认泛查限 25 条并直接返回 `required`、`params` 参数名与 `recommendedBundles`，大幅节省工具发现 Token 并消除大量二次 `detail: true` 往返；同步更新网关 `INSTRUCTIONS` 与 `skills/fm27-assistant/`。

### 安全加固与清理
- **职员招聘写操作加固（`mcp/job-advert-tools.mjs`）**：`offer_staff_interview`、`make_staff_contract_decision` 与 `review_or_select_applicant(select)` 强制前置核验真实候选人名单与可选 `expectedCandidateIdentity`，空候选/越界零派发；`post_job_advert` 与 `promote_or_reassign_staff` 在缺少按部门/目标岗位绑定的原生协议前安全门控零派发。
- **属性字典缓存全仓统一**：将 `competitions-and-awards-tools.mjs`、`season-and-international-tools.mjs`、`tactic-analysis-tools.mjs` 全部切换至共享防空缓存模块 `createPropertyRegistryCache`。
- **单测扩充**：新增 `tests/unit/workflow-bundles.test.mjs`（8 项测试，全仓累计 44/44 通过）。

## [1.1.0] - 2026-11-24

### 安全与架构重构（去 AI Slop 工程加固）
- **HTTP 层本机随机会话鉴权（`AuthGuard.cs`）**：插件启动自动生成 256-bit Bearer Token 写入 `%LOCALAPPDATA%\FMAssistant\session.token`，除 `GET /health` 外所有接口强制校验，MCP 客户端支持 401 自动重载密钥重试。
- **生产/开发模式严格隔离与显式白名单**：`InternalCommands.cs` 由黑名单升级为显式生产事件白名单（80 个合法业务事件）与属性更新白名单（14 个合法属性）；所有历史开发诊断路由移入 `HttpApi.Diagnostics.cs`，生产模式默认返回 `403 Forbidden`。
- **C# 路由模块化拆分**：将 1758 行单体 `HttpApi.cs` 拆分为核心网关 + 5 个领域 `partial` 路由模块（`Tactics`、`SquadAndTraining`、`TransfersAndClub`、`MatchAndManager`、`Diagnostics`），补齐标准 HTTP 状态短语。
- **MCP 核心层模块化和协议加固（`mcp/core/`）**：
  - 严格协议版本协商（不再盲目回显未支持版本号）；
  - `fm_call` 统一前置零依赖 JSON Schema 参数校验（`schema-validator.mjs`）；
  - 真正的读写分离并发模型（`execution-queue.mjs` + 显式元数据 `tool-catalog.mjs`）；
  - 真正的 UTF-8 硬字节上限截断保护（`response-limiter.mjs`），默认去除重复 `structuredContent` 载荷节省上下文；
  - 支持 `FM_ASSISTANT_MODE=assistant|autonomous` 分级模式开关。

### 新增能力与修复
- **确定性足球决策算法（`mcp/algorithms/`）**：新增 `optimize_best_xi`（精确匈牙利最大权二分图匹配最优 11 人首发与 7 人替补）与 `audit_squad_and_contracts`（一键位置深度缺口、冗员、年龄与高薪老将体检）。
- **全库姓名搜索与预设风格切换**：新增 `search_players`（支持原生 `game.Search` 毫秒直达全库与球探库多条件筛选）及 `set_tactical_style`（11 种官方预设风格一键切换并同步指令）。
- **底层实机修复**：
  - 新增 `TacticalStyleDropdown` 空战术防死锁双层守卫（JS 入口 + C# `InternalCommands.Update` 底层同步拦截 `TacticalStyleDropdown == null` 写入，根治新开档无活跃战术槽位时直接写风格触发游戏原生后端阻塞的缺陷）；
  - 修复 `get_match_team_stats_and_xg` 在直播比赛中静态字段恒为 0/50% 问题，切换直连 `match.Stats(isHomeTeam)` 39 项真实实时统计（含控球、射门、xG、PPDA、推进传球等）；
  - 修复 `get_set_piece_takers` / `change_set_piece_takers` 默认读取进攻定位球（`SetPieceScenario=1`）及 `remove` 单行原生载荷格式，实现 `add-left`/`move`/`remove` 全链路校验；
  - 完善转会费手动改价（`stage_transfer_clause` 支持 `kind="cash"` 及 `fee`/`amount` 别名），放行签约前承诺过渡事件 `Event 140`。

### 测试、CI 与知识体系
- 新增零依赖 `node:test` 单元测试套件（`tests/unit/`，共 17 项自动化断言全通）、一键真机冒烟回归脚本（`tests/live/smoke-regression.mjs`，11/11 真机实测全通并输出 `docs/live-verification-report.json`）及 `.github/workflows/ci.yml`。
- 新增 `ROADMAP.md`、`ARCHITECTURE.md`、`docs/CAPABILITIES.md` 及 Skills 专业四联手册（`pro-manager-playbook.md`、`tactical-mastery.md`、`game-mechanics.md`、`workflows.md`）。
- 清理误提交的运行日志 `logs/mcp.log`。
