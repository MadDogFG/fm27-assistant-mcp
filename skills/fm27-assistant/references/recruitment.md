# 招募、球探与转会合同草稿指南

使用 `fm_discover({ domain: "recruitment", detail: false })` 发现本领域全部工具，需要参数详情时传 `detail: true`。

## 核心能力范围
- **球探与招募重点（Recruitment Focus）**：读取/创建/配置/提交/结束/重启/删除招募重点，调整考察赛事/地区树、指派球探与分析师、处理球探中心报告与请求更新。
- **球员搜索与候选名单**：按条件检索数据库球员、保存/载入/删除搜索过滤条件（`manage_player_search_filter`），管理多个短名单（创建/重命名/删除/移入/移出）。
- **转会、租借与合同草稿**：
  - 发起或预览转会/租借报价草稿，编辑转会费、分期、附加条款、出场/位置要求及工资分担比例（`open_transfer_offer_draft`, `stage_transfer_clause`, `change_transfer_structure`）。
  - 发起续约或自由球员签约谈判草稿，配置年限、薪资、奖金、解约金条款与签约前承诺（`open_contract_draft`, `stage_contract_term`, `change_contract_structure`）。本队球员可直接传 `squadIndex`（无需手传 `source` 句柄）：`get_player_actions` → `get_player_action_menu`（`action: "PersonOfferContract"`）→ `get_contract_draft_start` → `open_contract_draft` → `get_contract_term` / `stage_contract_term` / `input_contract_amount`。
- **试训、体检与特殊联赛**：邀请/延长/结束试训、工作许可状态读取与上诉/体检处理、外租球员召回/终止租借，以及 MLS 工资帽/选秀流程辅助。

## 重要边界约束
1. **草稿止步原则**：转会报价、租借条款、自由球员接触与合同谈判仅允许**打开、读取与填写游戏原生草稿**，严禁代玩家点击最终提交签约或接受/拒绝成交。
2. **避免误触发草稿**：不要将 `get_contract_term` 用作任意球员的普通资料查询，部分属性读取会初始化谈判会话；普通资料查询请用球员基础读取工具。
3. **64 位整数与金额**：报价金额及大整数 ID 保持十进制字符串传递，沿用游戏显示单位。
4. **高危操作二次确认**：结束/重启招募重点等可逆动作默认直接确认；但**永久删除招募重点（`action="delete"`）、撤回合同报价**等不可逆操作会被安全锁拦截并要求显式传入 `acceptConfirmation: true`，向玩家确认后再传入即可（并非插件异常）。
