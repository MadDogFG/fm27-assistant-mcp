# FM27 俱乐部标准化运营工作流（可执行 SOP）

本手册将日常执教拆解为 **4 条可反复执行的标准化工作流闭环**，避免 Agent 临时拼凑步骤、漏查前置条件或浪费 Token。

---

## SOP 1：赛前准备五步闭环（每场比赛前 1–2 天执行）

1. **一图摸底**（~500B）：调用 `get_pre_match_briefing` 掌握当前联赛名次、下场对手、本队心态、未读消息与体能/士气预警。
2. **情报与针对性部署**：
   - 调用 `get_opposition_scout_report` 看对手常用阵型与核心威胁点；
   - 按需调用 `get_opposition_instructions` + `set_opposition_instruction` 只对真正危险的 2–4 人下达精准针对性指令（切勿全队乱勾，原则见 [pro-manager-playbook.md](pro-manager-playbook.md)）。
3. **确定性排阵与体能轮换**：
   - 调用 `optimize_best_xi`（可传 `minCondition: 78` 或杯赛 `preferYouth: true`）用匈牙利算法秒出最优 11 人首发与 7 人替补席，杜绝一人两用或把体能 <75% 主力硬塞进首发；
   - 若需落地替换，再调用 `get_lineup_options` / 首发变更工具执行。
4. **战术与定位球微调**：
   - 需要整体风格切换时用 `set_tactical_style`；微调单条指令用 `set_team_instruction` / `set_mentality`；
   - 核对定位球主罚手（`get_set_piece_takers` 默认读取进攻定位球 `setPieceScenario=1`）。
5. **赛前恢复检查**：一周双赛时用 `get_team_training_schedules` 检查赛前一日是否为恢复/比赛准备课，防止赛前一天练伤主力。

---

## SOP 2：赛中诊断与赛后复盘四步闭环

1. **实时数据采集（严格只读）**：
   - 比赛中调用 `get_match_team_stats_and_xg`（约 1.7KB，含双方控球、射门/射正、xG、npxG、绝佳机会、PPDA 压迫强度、推进传球、角球、犯规、均分）与 `get_match_player_live_stats`（默认紧凑模式）。
   - 赛后调用 `get_past_match_report` 与 `get_datahub_analysis`。
2. **因果归因（绝不凭感觉）**：
   - 对比 `xG` 与 `比分`（区分“战术失效”还是“射门运气差”）；
   - 对比 `PPDA`、`传球成功率` 与 `推进传球`（诊断是否被高位逼抢锁死，或本方压迫脱节）；
   - 找出评分 <6.4 或体能 <70% 的单点短板。
3. **最小化迭代**：
   - 仅针对数据明确指向的 1–2 个环节微调对应战术原子（参考 [tactical-mastery.md](tactical-mastery.md)），不因单场运气球推翻已积累熟悉度的主框架。
4. **赛后次日恢复与士气维护**：
   - 密集赛程次日安排恢复课；检查 `get_squad_happiness_issues` 及时安抚低士气核心。

---

## SOP 3：转会窗清人、补强与青训培养闭环

1. **一键全队体检**：
   - 调用 `audit_squad_and_contracts` 秒出 6 大位置线缺口（`shortages`）、冗员位置（`bloated`）、30+ 高薪老将与 U21 青训名单；
   - 调用 `get_budget_allocation` 确认可用转会费与周薪空间。
2. **清理冗员与外租小妖**：
   - 对冗员老将/合同剩 1–2 年的非主力，用 `get_person_management_actions` + `execute_person_management_action`（`PersonSetPlayersTransferStatus`，`entry: [1, 0]`）列入转会名单；
   - 对 18–21 岁一线队踢不上主力的苗子，设为可租借（`entry: [2, 0]`）；
   - 推进后用 `get_transfer_activity` 查看来价，确认合理后用 `respond_transfer_activity_offer` 接受或谈判。
3. **精准搜人与发起报价**：
   - 已知目标姓名 → `search_players({ name })` 毫秒级全库直达；
   - 按缺口海选 → `search_players({ position, maxAge, freeAgentOnly, sortBy })` + 球探招募重点（`get_recruitment_focus_draft` / `complete_recruitment_focus_draft`）；
   - 发起报价：`get_transfer_offer_draft_start` → `open_transfer_offer_draft` → `stage_transfer_clause({ kind: "cash", amount })`（或采纳体育总监建议）→ `execute_negotiation_action` 开价；
   - 本队核心续约可通过 `squadIndex` 全程无 UI 提交；外来球员新签合同在完成 `promises` 阶段后，由玩家在游戏内合同页点最终确认。
4. **青训培养落地**：
   - 15–17 岁留队吃设施训练，18+ 保障一线队出场或合格外租；
   - 用 `get_individual_training` / `set_individual_training` 补齐身体短板；
   - 用 `get_mentoring_groups` / `manage_mentoring_group` 组建 3 人导师小组（1 名高职业素养领袖 + 2 名同线 U21 小妖）。

---

## SOP 4：推进游戏时间与收件箱事件路由闭环

每次向前推进日期时，严格遵循“**读状态 → 按阻挡原因路由 → 再推进**”循环：

1. 调用 `fm_continue_game({ action: "read" })` 读取当前推进状态：
   - **`canRequest: true`**：直接调 `fm_continue_game({ action: "continue" })`；
   - **`continueFlowName: "Messages"`（纯未读信息）**：先看 `get_inbox` 摘要，无待办则一键 `mark_all_messages_read({})` 再继续；
   - **`continueFlowName: "NeedAction"`（强制待办）**：按 `managerTask.messageIdentity` 匹配收件箱消息，调用 `get_news_response_actions` 读取合法业务选项；若为赛事注册/转会确认/报价回复，走对应专用业务工具处理；
   - **`continueFlowName: "PressConference"`（新闻发布会）**：调用 `get_press_conference_state`，若游戏提供委派助教且玩家同意可 `start_press_conference({ handoff: "delegate" })`，绝不代玩家乱答发布会问题；
   - **`processing_card_timer_active`**：游戏正在短暂过场动画中，等待 2 秒后重读即可，不要重复发送推进请求。
