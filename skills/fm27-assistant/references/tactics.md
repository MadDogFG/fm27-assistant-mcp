# 战术与定位球操作指南

使用 `fm_discover({ domain: "tactics", detail: false })` 发现本领域全部工具，需要参数详情时传 `detail: true`。

## 核心能力范围
- **战术槽管理**：读取/切换战术槽（`get_tactic_slots`, `select_tactic_slot`）、新建战术（`get_tactic_creation`, `create_tactic`）、复制/重命名/删除及加载预设战术文件（`list_tactic_files`, `manage_tactic_slot`）。
- **阵型与位置角色**：持球/无球阵型调整、位置角色与职责切换、查看助教战术建议与熟悉度/复杂度评估（`get_tactic_analysis`, `get_tactic_suggestions`, `apply_tactic_suggestion`）。
- **球队与个人指令**：心态（`set_mentality`）、球队战术指令、个人针对性指令（`set_tactic_instruction`, `set_player_instruction`）。
- **针对性指令（Opposition Instructions）**：按对手球员或按对手位置设置紧逼、铲断、压迫与弱势脚（`get_opposition_instructions`, `set_opposition_instruction`）。
- **定位球与点球**：角球/任意球/界外球套路查看与创建编辑（`get_set_piece_routine_state`, `set_set_piece_routine_option`, `edit_set_piece_routine_details`），以及点球/定位球主罚手顺位安排（`get_set_piece_takers`, `change_set_piece_takers`）。

## 标准工作流
1. 先用 `get_tactic_slots` 确认当前激活的战术槽与状态。
2. 修改前先调用对应的 `get_*` 工具获取当前值、合法候选与 `choiceToken`。
3. 调用 `fm_call` 执行变更后，再次读取确认变更已生效。
4. 定位球编辑会话（`set_set_piece_edit_session`）完成后记得确认保存或退出，避免锁定草稿。
