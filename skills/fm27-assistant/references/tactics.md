# 战术与定位球操作指南

使用 `fm_discover({ domain: "tactics", detail: false })` 发现本领域全部工具，需要参数详情时传 `detail: true`。如需查阅指令相互作用、局部套路聚合与现实足球流派自由拼装原理，请翻阅 [tactical-mastery.md](tactical-mastery.md)。

## 核心能力范围
- **战术槽与预设风格管理**：读取/切换战术槽（`get_tactic_slots`, `select_tactic_slot`）、一键切换官方预设战术风格并同步指令（`set_tactical_style`，不传参数可查看全部 11 种预设与本队推荐 TOP3）、新建战术（`get_tactic_creation`, `create_tactic`）、游戏内复制/重命名/删除战术槽（`get_tactic_management_options`, `manage_tactic_slot`, `rename_tactic`）。注：`get_tactic_slots` 仅返回槽位元数据，查看当前首发 11 人及场上站位请调用 `get_lineup_options`（或 `get_tactic_analysis`）。
- **阵型与位置角色**：持球/无球阵型调整（`get_formation_options`, `set_formation`）、位置角色与职责切换（`get_tactic_roles`, `set_player_role`）、查看助教战术建议与熟悉度/复杂度评估（`get_tactic_analysis`, `get_tactic_suggestion`, `request_tactic_suggestion`）。
- **球队与个人指令**：心态（`set_mentality`）、球队战术指令、个人针对性指令（`get_team_instructions`, `set_team_instruction`, `get_player_instructions`, `set_player_instruction`）。
- **针对性指令（Opposition Instructions）**：按对手球员或按对手位置设置紧逼、铲断、压迫与弱势脚（`get_opposition_instructions`, `set_opposition_instruction`）。
- **定位球与点球**：角球/任意球/界外球套路查看与创建编辑（`get_set_piece_routine_state`, `set_set_piece_routine_option`, `edit_set_piece_routine_details`），以及点球/定位球主罚手顺位安排（`get_set_piece_takers`, `change_set_piece_takers`）。

## 标准工作流
1. 先用 `get_tactic_slots` 确认当前激活的战术槽与状态。
2. 修改前先调用对应的 `get_*` 工具获取当前值、合法候选与 `choiceToken`。
3. 调用 `fm_call` 执行变更后，再次读取确认变更已生效。
4. 定位球编辑会话（`set_set_piece_edit_session`）完成后记得确认保存或退出，避免锁定草稿。

## 常见误区与避坑（必读）
- **不要误以为需要切到游戏页面**：`set_team_instruction`、`set_player_instruction`、`get_set_piece_takers` / `change_set_piece_takers` 全部走后台数据通道，**无需玩家打开战术或定位球界面**；个人指令若报“被当前角色锁定”，是游戏角色本身的设计限制（如边翼卫锁死向前插上），跳过该组即可。
- **定位球主罚必须传 `playerPaths`**：先不带 `action` 调 `get_set_piece_takers({ setPieceType })` 读取 `SetPieceTakerAddPlayerList` 候选下标；预览 `add-left` / `add-right` / `add-both` / `remove` / `move` 时**必须传 `playerPaths: ["0"]`**（不传会导致游戏因未选中任何球员而报 `CanAddToLeftFootTakers = False`），拿到 `choiceToken` 后再调 `change_set_piece_takers` 执行。
