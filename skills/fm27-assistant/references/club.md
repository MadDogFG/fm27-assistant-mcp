# 俱乐部管理操作指南

使用 `fm_discover({ domain: "club", detail: false })` 发现本领域全部工具，需要参数详情时传 `detail: true`。

## 核心能力范围
- **俱乐部概览与愿景**：读取俱乐部声望、设施等级、球场及财务概况；读取董事会愿景、五年计划与支持者期待，并对新赛季愿景进行讨论与确认（`get_club_vision`, `manage_club_vision`）。
- **财政与预算调整**：读取工资总额、转会预算、FPP/PSR 合规情况，预览并确认转会预算与工资预算的滑块分配（`get_budget_adjustment`, `confirm_budget_adjustment`）。
- **董事会请求与设施**：发起或查看董事会请求（扩建训练/青训设施、增加转会分成、增加球探/教练名额、新建附属俱乐部、新球场等）。
- **职员与管理职责**：读取俱乐部员工名单、招聘广告、解约或互解职员、管理队内人员职责分工（Responsibilities，含一线队、梯队、球探与转会职责委派）。
- **行为准则（Code of Conduct）**：读取、编辑、确认与重置球队纪律罚款及禁赛准则。
- **附属俱乐部（Affiliates）**：查看现有附属关系，提议寻找新附属俱乐部或取消现有关联。

## 注意事项
- 查询俱乐部综合信息、文化期待、财政预算或团队层级时，**优先使用开箱即用的聚合工具**（如 `get_club_overview`、`get_club_confidence_and_culture`、`get_club_vision`、`get_budget_adjustment`），避免使用底层泛用面板工具（`get_club_panel_state`）手动猜测属性名。
- 预算调整受限于当前转会窗口锁定状态与董事会限制，执行前请先读取 `preview-budget-confirm` 确认可调区间。
- 解约职员或发起大型设施请求前，注意评估俱乐部当前资金余额与违约金提示。
