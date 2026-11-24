# FM27 Assistant 能力与验证状态矩阵（Capabilities & Verification）

本文档如实记录 FM27 Assistant 各业务模块的**实现状态、验证级别、运行模式限制与已知边界**。我们遵循“**有源码 ≠ 已真机验证，派发成功 ≠ 游戏接受**”的工程准则，不夸大任何未验证能力。

## 验证分级说明

- **Live-Verified（已真机验证）**：已在当前 FM27 Build（Steam AppID `4530370`）完成端到端读回验证或状态变化确认。
- **Unit-Tested（已离线单测）**：算法、协议、Schema、鉴权与队列通过 `npm test` 零依赖自动化测试。
- **Dispatched / Beta**：已实现游戏原生通道与预览/派发回执，待覆盖更多极端存档与赛季边界。
- **Gated（安全门控）**：底层已有原生协议实现，但在默认 `assistant` 安全模式下主动禁用（避免 AI 在比赛中或发布会里越权代操）。

---

## 分领域能力矩阵

| 业务领域 | 核心工具 / 能力 | 验证级别 | 默认模式开放 | 已知边界与说明 |
|---|---|---|---|---|
| **安全与健康** | `plugin_health`、本地 256-bit Bearer Token 鉴权、生产白名单 | Live-Verified + Unit-Tested | 开放 | 除 `GET /health` 外全路由强制鉴权；诊断路由生产模式返回 `403` |
| **通用数据通道** | `live_describe`、`live_query` | Live-Verified | 开放（只读） | 严格只读，支持 hex 键解码、自动分批与瞬态重试 |
| **战术与预设风格** | `get/set_formation`、`get_tactic_roles`、`set_player_role`、`set_mentality`、`set_tactical_style`、`set_team_instruction`、`set_player_instruction` | Live-Verified | 开放 | 免切游戏页面；预设风格支持 11 种官方风格与 TOP3 推荐 |
| **针对性指令** | `get_opposition_instructions`、`set_opposition_instruction` | Live-Verified | 开放 | 自动解析对手球员姓名与球衣号 |
| **定位球主罚** | `get_set_piece_takers`、`change_set_piece_takers` | Live-Verified | 开放 | 默认 `setPieceScenario=1`（进攻定位球），`add-left/move/remove` 全链路读回校验 |
| **阵容与确定性算法** | `get_squad_snapshot`、`get_player_attributes`、`compare_players`、`optimize_best_xi`、`audit_squad_and_contracts` | Live-Verified + Unit-Tested | 开放（只读） | `optimize_best_xi` 采用精确匈牙利算法，零心算误差 |
| **全库搜人与短名单** | `search_players`、`list_shortlists`、`create_shortlist`、`rename/delete_shortlist` | Live-Verified | 开放 | 传 `name` 走原生 `game.Search` 毫秒直达全库；不传则并发筛选球探库 |
| **招募重点与球探** | `get_recruitment_focuses`、`get_recruitment_focus_draft`、`complete_recruitment_focus_draft` | Live-Verified | 开放 | 已实机验证新建提交（重点数 +1）并收到后续球探反馈 |
| **转会报价与卖人** | `open_transfer_offer_draft`、`stage_transfer_clause(kind="cash")`、`execute_negotiation_action`、`respond_transfer_activity_offer`、`PersonSetPlayersTransferStatus` | Live-Verified | 开放 | 报价、手动改价、采纳总监建议、挂牌出售/外租与接受来价均实机跑通 |
| **合同谈判** | `open_contract_draft`、`stage_contract_term`、`get_negotiation_actions`、`execute_negotiation_action` | Live-Verified（有边界） | 开放 | **本队续约**可全程无 UI 提交；**外来球员新签合同**在完成 `promises` 阶段后，最终确认需在游戏内合同页点击 |
| **训练与青训培养** | `get/set_team_training_intensity`、`get/set_individual_training`、`assign_individual_training_by_assistant`、`get/manage_mentoring_group` | Live-Verified | 开放 | 导师小组每组上限 3 人，已实机验证建组与 3 人选人预览 |
| **俱乐部与财政** | `get_club_history_and_overview`、`get_budget_allocation`、`get_league_table_and_fixtures`、`get_pre_match_briefing` | Live-Verified | 开放 | 支持预算草稿查看与聚合简报 |
| **收件箱与推进** | `get_inbox`、`mark_all_messages_read`、`fm_continue_game`、`manage_holiday` | Live-Verified | 开放 | 推进遇到强制待办或发布会会诚实返回阻塞原因，不强行跳过 |
| **实时比赛分析** | `get_match_team_stats_and_xg`、`get_match_player_live_stats`、`get_match_momentum_and_dugout`、`get_match_passing_network`、`get_past_match_report` | Live-Verified | 开放（只读） | 直连 `match.Stats(isHomeTeam)` 39 项真实实时统计（含控球、射门、xG、PPDA 等） |
| **比赛临场指挥** | 换人、暂停、临场战术提交、更衣室训话、场边喊话、赛前提交阵容 | Dispatched / Gated | **默认关闭** | 默认 `FM_ASSISTANT_MODE=assistant` 禁止；仅显式设置 `FM_ASSISTANT_MODE=autonomous` 时开放 |
| **发布会与谈话代答** | `answer_press_conference_question`、`reply_to_conversation`、`execute_communication_action` | Gated | **始终关闭** | 保留玩家个人表达与角色扮演空间 |

---

## 自动化验证证据

- **离线单元测试**：运行 `npm test`（同时接入 `.github/workflows/ci.yml`），覆盖全仓语法、309+ 工具注册表、显式元数据、Token 鉴权、JSON Schema 参数校验、UTF-8 硬字节截断、读写并发队列、MCP stdio 端到端协议、确定性决策算法及 Skills 完整性审计。
- **一键真机冒烟回归**：游戏运行并载入任意存档后执行 `npm run test:live`，自动生成结构化证据文件 `docs/live-verification-report.json`。
