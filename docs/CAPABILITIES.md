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
| **安全与健康** | `plugin_health`、本地 256-bit Bearer Token 鉴权、生产白名单 | Live-Verified + Unit-Tested | 开放 | 区分服务在线、鉴权成功、存档就绪与待业状态；日志自动脱敏；HTTP 504 结构化透传 `timeoutReceipt` 与 `operationId` |
| **高密度 1-Call 聚合包与批量只读** | `get_daily_hub_briefing`、`get_matchday_prep_bundle`、`get_transfer_window_briefing`、`get_match_diagnosis_bundle`、`batch_read` | Live-Verified + Unit-Tested | 开放（只读） | 已在 build `26797085` 无头实机 13/13 通过：4 个 1-Call 业务包并发拉取并支持单段容错降级（含 FM27 战术有效性 4 支柱、同日快照缓存复用 30x 提速、赛中/赛后自动分流与确定性诊断信号）；`batch_read` 严拒写操作、`exclusiveState` 工具与嵌套调用 |
| **通用数据通道** | `live_describe`、`live_query` | Live-Verified + Unit-Tested | 开放（只读） | 严格只读，支持 `scanFrom/scanLimit` 突破 64 内联与 50 行上限、自动补读隐藏筛选/排序字段；屏蔽发布会题目与对话回复节点 |
| **战术与预设风格** | `get/set_formation`、`get_tactic_roles`、`set_player_role`、`set_mentality`、`set_tactical_style`、`set_team_instruction`、`set_player_instruction` | Live-Verified + Unit-Tested | 开放 | 预设风格仅接受原生精确 ID/完整标签，模糊多匹配返回候选零写入，支持 `expectedSlotToken` 防切槽误写 |
| **针对性指令与对手情报** | `get_opposition_instructions`、`set_opposition_instruction`、`get_opposition_scout_report` | Live-Verified + Unit-Tested | 开放 | 自动解析对手球员姓名与球衣号；对手报告绑定 `NextFixture` 赛程、赛事、日期及报告新鲜度/知识状态 |
| **定位球主罚** | `get_set_piece_takers`、`change_set_piece_takers` | Live-Verified（部分分支） | 开放 | 默认 `setPieceScenario=1`（进攻定位球）；已实机验证 `add-left / move / remove` 分支读回校验，其余分支（`add-right / add-both / penalty-*`）为协议已接待补定向实测 |
| **阵容、伤病与确定性算法** | `get_squad_snapshot`、`get_player_attributes`、`compare_players`、`optimize_best_xi`、`audit_squad_and_contracts`、`manage_injury_treatment` | Live-Verified + Unit-Tested | 开放（只读/门控） | 排阵与体检全量分页覆盖 >30 人并同日复用快照；支持伤停/外租/资格三态、严格轮休、门将硬可行性、合同到期队列与内外混合对比；伤病治疗分列治疗/康复/脑震荡复出状态并拒绝硬编码数值写入 |
| **全库搜人与短名单** | `search_players`、`list_shortlists`、`get_shortlist_players`、`create/rename/delete_shortlist`、`add/remove_player_from_shortlist` | Live-Verified + Unit-Tested | 开放 | `search_players` 自动还原玩家搜索框并防旧结果冒充、支持 `offset` 续查；失业经理亦可查看短名单；`Club` 未就绪返回 `freeAgent: null` 绝不误报自由球员 |
| **招募重点与球探** | `get_recruitment_focuses`、`get_recruitment_focus_draft`、`complete_recruitment_focus_draft`、`manage_scouting_centre_report`、`manage_scouting_assignment` | Live-Verified + Unit-Tested | 开放 | 球探报告按身份与独立动作通道执行；短名单更新周期仅接受原生合法选项列表精确匹配，绝不回退第 0 项 |
| **转会报价与卖人** | `open_transfer_offer_draft`、`stage_transfer_clause(kind="cash")`、`execute_negotiation_action`、`respond_transfer_activity_offer`、`PersonSetPlayersTransferStatus`、`get_work_permit_status` | Live-Verified + Unit-Tested | 开放 | 工作许可读取支持外部目标 `{ source, path }` 与本队 `squadIndex`；TransferRoom 确认拒绝空对象 `{}` 并绑定广告/会话身份 |
| **合同谈判** | `open_contract_draft`、`stage_contract_term`、`get_negotiation_actions`、`execute_negotiation_action` | Live-Verified（有边界） | 开放 | **本队续约**可全程无 UI 提交；**外来球员新签合同**在完成 `promises` 阶段后，最终确认需在游戏内合同页点击 |
| **训练与青训培养** | `get/set_team_training_intensity`、`get/set_individual_training`、`assign_individual_training_by_assistant`、`get/manage_mentoring_group`、`copy/paste_training_week`、`get_training_unit_summaries` | Live-Verified（有版本约束） | 开放 | 导师小组分列 `MaxValue` 选人上限与当前构建 `Count == 3` 确认规则；FM27 训练 Units 手动调组入口已门控零派发（保留只读摘要）；教练分工返回实测类别与 `CanEdit` |
| **俱乐部与财政** | `get_club_history_and_overview`、`get_club_budget_balances`、`get_budget_allocation`、`stage_budget_allocation`、`confirm_budget_allocation`、`get/confirm_club_budget_adjustment`、`cancel_club_affiliate_link`、`manage_mls_and_draft`、`list_job_adverts`、`remove_job_advert` | Live-Verified + Unit-Tested | 开放 | 财政读数附带 `readCoverage` 并区分生效余额与滑杆草稿；两套预算确认与附属解除均强绑定令牌/身份；MLS/选秀默认只读并在普通联赛零派发；职员面试/任用强制先验候选列表，缺部门/目标岗位协议的 `post_job_advert` 与 `promote_or_reassign_staff` 安全门控零派发 |
| **战术槽与改名** | `get/select_tactic_slot`、`create_tactic`、`manage_tactic_slot`、`rename_tactic` | Dispatched / Unit-Tested | 开放 | 已移除磁盘战术文件导出/列表入口（`list_tactic_files`、`save_tactic_file`）；`rename_tactic` 严格区分 `unchanged / verified / unverified` 三态，不同名称 A→B 改名待定向实机验收 |
| **收件箱、休假与推进** | `get_inbox`、`set_news_read_state`、`manage_inbox_message_flags`、`mark_all_messages_read`、`fm_continue_game`、`manage_holiday` | Live-Verified + Unit-Tested | 开放 | `get_inbox` 完整支持筛选与 `nextScanFrom` 续页；标重要按 `expectedNewsIdentity` 定位；休假条件须逐项读回证实才启动，状态未知保留 `null`；无原生区分协议的分支门控零派发 |
| **实时比赛与历史战报** | `get_match_team_stats_and_xg`、`get_match_player_live_stats`、`get_match_momentum_and_dugout`、`get_match_passing_network`、`get_past_match_report` | Live-Verified + Unit-Tested | 开放（只读） | 附带 `matchIdentity` 与 `samplingWindow` 采样跨度；禁用恒为 0/50% 的静态回退；历史战报仅认 `FM.UI.FixtureReference`，查无此场不混入最近一场分析；属性字典首次失败自动重试恢复 |
| **比赛临场指挥** | 换人、暂停、临场战术提交、更衣室训话、场边喊话、赛前提交阵容及赛中公用战术写入 | Dispatched / Gated | **默认关闭** | 默认 `FM_ASSISTANT_MODE=assistant` 同时阻断专用比赛写工具与赛中公用战术/阵容写入口；仅显式设置 `FM_ASSISTANT_MODE=autonomous` 时开放 |
| **发布会与谈话代答** | `answer_press_conference_question`、`reply_to_conversation`、`execute_communication_action` | Gated | **始终关闭** | 保留玩家个人表达与角色扮演空间 |

---

## 自动化验证证据

- **离线单元测试**：运行 `npm test`（同时接入 `.github/workflows/ci.yml`），覆盖全仓语法、300+ 工具注册表、显式元数据、Token 鉴权、JSON Schema 参数校验、别名映射前置、`compact:false` 全量树放行、UTF-8 硬字节截断、读写并发队列、预算草稿令牌防错提、候选名单防串读与恢复核验、俱乐部三态判定、战术改名状态机、异目录绝对路径 MCP 启动、确定性决策算法及 Skills 完整性审计。
- **一键真机冒烟回归**：游戏运行并载入存档后执行 `npm run test:live`（**默认严格只读**，不会改动玩家存档；仅在显式附加 `--allow-writes --disposable-save` 参数时才执行带 `finally` 恢复保护的可逆写用例），输出结构化报告 `docs/live-verification-report.json`。
