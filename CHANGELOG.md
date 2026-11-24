# Changelog

本项目遵循语义化版本规范（Semantic Versioning）。

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
