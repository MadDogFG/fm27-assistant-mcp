# 训练与导师小组操作指南

使用 `fm_discover({ domain: "training", detail: false })` 发现本领域全部工具，需要参数详情时传 `detail: true`。

## 核心能力范围
- **球队训练日程**：读取并编辑一线队、预备队及青年队的周训练日程、单节训练课目（`get_team_training_schedules`, `set_team_training_week`, `get_training_week_edit`, `change_training_week_edit`）、以及应用/保存预设训练计划。
- **下场准备（Match Preparation）**：读取赛前准备会话与助教建议，确认或取消赛前准备安排。
- **训练单元与强度**：调整球队训练强度、自动休息阈值、个人训练焦点/新位置适应、以及球员训练单元分组调配。
- **导师小组（Mentoring）**：查看、创建、重命名、自动分配成员及解散导师小组（`get_mentoring_groups`, `manage_mentoring_group`）。

## 标准工作流
1. 调整日程前先读取当前周训练表与可用课程目录（包含恢复、体能、战术、技术等合法节点）。
2. 编辑预备队或青年队训练时，显式传入对应的梯队上下文参数。
3. 更改个人训练焦点或休假休息时，优先读取球员当前疲劳度、伤病风险与教练建议。
