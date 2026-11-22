---
name: fm27-assistant
description: Football Manager 27 实时游戏助教插件。通过游戏内 BepInEx 原生业务接口实现战术、训练、阵容、招募、俱乐部管理、经理中心操作及比赛只读分析，并提供一站式安装与诊断指引。
---

# FM27 Assistant

本插件通过游戏内 BepInEx HTTP 服务（默认 `http://127.0.0.1:27190`）与精简 MCP 网关连接 *Football Manager 27*，所有操作均基于游戏真实实时状态与原生业务指令，不修改底层存档文件或数值。本插件完全独立，不依赖任何外部 Skill 或第三方 MCP。

## 核心工作流（渐进式披露）

本 MCP 网关默认仅暴露 4 个元工具，避免海量工具定义污染上下文。请严格按以下四步工作：

1. **连接自检**：首次操作前调用 `plugin_health` 确认游戏已启动、插件在线且存档已加载。若连接失败，立即读取 [install.md](references/install.md) 协助用户完成安装、编译或诊断。
2. **按需加载领域手册**：根据当前任务领域，仅读取对应的参考文件（禁止一次性全量读取）：
   - 安装、编译、MCP 配置与排障 -> [install.md](references/install.md)
   - 战术、阵型、球队/个人/针对性指令、定位球 -> [tactics.md](references/tactics.md)
   - 球队/个人训练、日程、休息强度、导师小组 -> [training.md](references/training.md)
   - 阵容、球衣号码、队长、注册、医疗、国家队 -> [squad.md](references/squad.md)
   - 球探重点、短名单、试训、转会/租借/合同草稿 -> [recruitment.md](references/recruitment.md)
   - 俱乐部愿景、财政预算、设施、职员与附属 -> [club.md](references/club.md)
   - 收件箱、职员会议、新闻/采访、抽签与生涯 -> [manager.md](references/manager.md)
   - 比赛实时状态、历史战报与 xG 数据分析（只读） -> [match-readonly.md](references/match-readonly.md)
3. **按需发现工具**：调用 `fm_discover` 查询目标领域的工具列表：
   - 轻量浏览：`fm_discover({ domain: "tactics", detail: false })`
   - 获取参数 Schema：`fm_discover({ query: "mentality", detail: true })`
4. **精准调用执行**：使用 `fm_call({ action: "<工具名>", params: { ... } })` 执行读取或写入；高频日期推进可直接使用 `fm_continue_game`。

## 通用操作规范

- **先读后写**：写操作前先读取实时状态与合法候选列表，保存返回的 `choiceToken` / `expectedCurrent` 及唯一 `operationId` 再执行。
- **幂等与容错**：若执行返回超时或未知状态，保留原 `operationId` 重新查询对应状态接口，切勿更换新 ID 盲目重发。
- **验证闭环**：重要修改（如战术、阵容、预算）执行后，应再次读取对应状态确认游戏已接受变更。
- **边界约束**：
  - **比赛阶段只读**：不执行赛中临场写操作或替代玩家进行赛中换人提交。
  - **谈判与对话交接**：涉及报价/租借/合同草稿时，仅读取或填写原生草稿并交由玩家最终确认；发布会、面试、谈话等对话交互不代选答复。
  - **禁止外挂式改写**：不使用 UI 模拟点击，不篡改球员属性、资金等内存数值。
