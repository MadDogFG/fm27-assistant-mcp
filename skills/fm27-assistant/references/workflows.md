# FM27 俱乐部标准化运营工作流（可执行 SOP）

本手册将日常执教拆解为 **4 条可反复执行的标准化工作流闭环**，避免 Agent 临时拼凑步骤、漏查前置条件或浪费 Token。

---

## SOP 1：赛前准备五步闭环（每场比赛前 1–2 天执行）

1. **一图摸底**（~500B）：调用 `get_pre_match_briefing` 掌握当前联赛名次、下场对手、本队心态、未读消息与体能/士气预警。
2. **情报与针对性部署**：
   - 调用 `get_opposition_scout_report` 看对手常用阵型与核心威胁点；
   - 按需调用 `get_opposition_instructions` + `set_opposition_instruction` 只对真正危险的 2–4 人下达精准针对性指令（切勿全队乱勾，原则见 [pro-manager-playbook.md](pro-manager-playbook.md)）。
3. **确定性排阵与体能轮换**：
   - 调用 `optimize_best_xi`（支持 `minCondition: 78`、`strictMinCondition: true` 严格轮休排除低体能主力、`benchSize` 按赛事规则配置，或杯赛 `preferYouth: true`）基于全量分页名单求解最优 11 人首发与替补席；留意返回的 `availabilitySummary` 与 `lowConfidenceNotes`（算法本身计算极快，首次全队实时订阅读取通常需 20–30 秒，同日连续调体检+排阵自动复用快照）；
   - 若需落地替换，再逐槽位调用 `get_lineup_options({ selectionIndex })` + `pick_lineup_player` 执行。
4. **战术与定位球微调**：
   - 需要整体风格切换时先 `set_tactical_style({ previewOnly: true })` 核对精确 ID 与 `slotToken` 再执行（注意会重设球队指令）；微调单条指令用 `set_team_instruction` / `set_mentality`；
   - 核对定位球主罚手（`get_set_piece_takers` 默认读取进攻定位球 `setPieceScenario=1`）。
5. **赛前恢复检查**：一周双赛时用 `get_team_training_schedules` 检查赛前一日是否为恢复/比赛准备课，防止赛前一天练伤主力。

---

## SOP 2：赛中诊断与赛后复盘四步闭环

1. **实时数据采集（严格只读）**：
   - 比赛中调用 `get_match_team_stats_and_xg` 与 `get_match_player_live_stats`（默认紧凑模式），合并解读前先核对 `matchIdentity`、`samplingWindow`（是否跨越进球/中场）及 `sideAvailability`（区分真实 0 与通道未就绪）。
   - 赛后调用 `get_past_match_report`（核对 `fixtureIdentity` 与 `fixtureMetadata` 确认对应目标场次）与 `get_datahub_analysis`。
2. **因果归因（绝不凭感觉）**：
   - 对比 `xG` 与 `比分`（区分单场波动样本与长期趋势，单场 xG 差不能独立证明战术失败或心态问题）；
   - 对比 `PPDA`、`传球成功率` 与 `推进传球`（诊断是否被高位逼抢锁死，或本方压迫脱节）；
   - 找出评分 <6.4 或体能 <70% 的单点短板。
3. **最小化迭代**：
   - 仅针对数据明确指向的 1–2 个环节微调对应战术原子（参考 [tactical-mastery.md](tactical-mastery.md)），不因单场运气球推翻已积累熟悉度的主框架。
4. **赛后次日恢复与士气维护**：
   - 密集赛程次日安排恢复课；检查 `get_squad_happiness_issues` 及时安抚低士气核心。

---

## SOP 3：转会窗清人、补强与青训培养闭环

1. **全队体检与预算核查**：
   - 调用 `audit_squad_and_contracts` 统计全量名单（覆盖 >30 人）的 6 大位置线缺口（`shortages`）、冗员位置（`bloated`）、合同到期优先队列（`expiringContractsQueue`）、30+ 高薪老将与 U21 青训名单；
   - 调用 `get_club_budget_balances` + `get_club_finances_projection` 核对当前已生效的转会预算、工资预算额度与债务预测（切勿把 `get_budget_allocation` 滑杆草稿或总工资额度直接当成剩余工资空间；需调整比例时再用 `get_budget_allocation` / `stage_budget_allocation` / `confirm_budget_allocation`）。
2. **清理冗员与外租小妖**：
   - 对冗员老将/合同即将到期且不续约的非主力，用 `get_person_management_actions` + `execute_person_management_action`（`PersonSetPlayersTransferStatus`，`entry: [1, 0]`）列入转会名单；
   - 对 18–21 岁一线队踢不上主力的苗子，设为可租借（`entry: [2, 0]`）；
   - 推进后用 `get_transfer_activity` 查看来价，确认合理后用 `respond_transfer_activity_offer` 接受或谈判。
3. **精准搜人、对比与发起报价**：
   - 已知目标姓名 → `search_players({ name })`（自动保护并还原玩家原搜索框关键词）；
   - 按缺口海选 → `search_players({ position, maxAge, freeAgentOnly, sortBy, offset })` + 球探招募重点（`get_recruitment_focus_draft` / `complete_recruitment_focus_draft`）；可用 `compare_players({ targets })` 把外部目标与队内替补直接横向对比；
   - 发起报价：`get_transfer_offer_draft_start` → `open_transfer_offer_draft` → `stage_transfer_clause({ kind: "cash", amount })`（或采纳体育总监建议）→ `execute_negotiation_action` 开价；
   - 本队核心续约可通过 `squadIndex` 全程无 UI 提交；外来球员新签合同在完成 `promises` 阶段后，由玩家在游戏内合同页点最终确认。
4. **青训培养落地**：
   - 15–17 岁留队吃设施训练，18+ 保障一线队出场或合格外租；
   - 用 `get_individual_training` / `set_individual_training` 补齐身体短板；
   - 用 `get_mentoring_groups` / `manage_mentoring_group` 组建导师小组（1 名高职业素养领袖 + 2 名同线 U21 小妖；候选人数遵循游戏实时 `MaxValue`，当前 FM27 构建确认按钮规则为 `Count == 3`）。

---

## SOP 4：推进游戏时间与收件箱事件路由闭环

每次向前推进日期时，严格遵循“**读状态 → 按阻挡原因路由 → 再推进**”循环：

1. 调用 `fm_continue_game({ action: "read" })` 读取当前推进状态：
   - **`canRequest: true`**：直接调 `fm_continue_game({ action: "continue" })`；
   - **`continueFlowName: "Messages"`（未读信息流程）**：用 `get_inbox({ unreadOnly: true, pendingOnly: true })` 及 `nextScanFrom` 翻完所有页确认是否存在后页待办；**绝不可仅扫首页就调用 `mark_all_messages_read({})`**！普通推进仅对已逐封查看并获准的纯通知调用 `set_news_read_state`；`mark_all_messages_read` 仅在玩家明确要求全箱标读或已遍历全部未读页确认零待办时调用；
   - **`continueFlowName: "NeedAction"`（强制待办）**：按 `managerTask.messageIdentity` 通过 `get_inbox({ unreadOnly: false, pendingOnly: true })`（配合 `nextScanFrom` 翻页）精确定位该封信，调用 `get_news_response_actions` 读取合法业务选项；若为赛事注册/转会确认/报价回复/需玩家决定的事务，走对应专用工具或交回玩家；
   - **`continueFlowName: "PressConference"`（新闻发布会）**：调用 `get_press_conference_state` 查看 `handoffStage`，若游戏提供委派助教且玩家同意可 `start_press_conference({ handoff: "delegate" })`，或用 `open_press_conference_for_player` 移交玩家，绝不代玩家读取或回答发布会问题；
   - **`processing_card_timer_active`**：游戏正在短暂过场动画中，等待 2 秒后重读即可，不要重复发送推进请求。
