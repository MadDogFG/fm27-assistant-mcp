# FM27 Assistant

*Football Manager 27* 的实时 AI 助教插件。

装好之后，你可以直接用 Claude Code、Cursor、Windsurf、Antigravity 等 AI 客户端连接正在运行的 FM27 存档——让 AI 看懂你现在的球队情况，帮你出主意，也可以直接替你排首发、调战术、改训练、搜球员、谈转会、做复盘。

本插件只调用游戏自身合法的业务操作，**不修改存档文件、不篡改球员属性或资金、不模拟鼠标键盘点击**。

---

## 快速安装

### 方式一：直接交给你的 AI Agent 自动安装（推荐）

如果你正在使用支持本地命令与文件操作的 AI 客户端（如 **Antigravity、Claude Code、Cursor、Windsurf**），不需要自己折腾配置，直接把下面这段话复制发给你的 Agent 即可：

```text
请帮我安装并配置 FM27 Assistant（https://github.com/MadDogFG/fm27-assistant-mcp）：
1. 把仓库克隆到本地，并自动定位我电脑里的 Football Manager 27 游戏目录；
2. 检查游戏目录是否已安装 BepInEx 6 (Unity.IL2CPP win-x64)，如果没有就帮我装好，并提醒我启动一次游戏到主菜单后退出以生成 interop 目录；
3. 把仓库里的 dist/FMAssistant.dll 部署到 <FM27游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll；
4. 为我当前使用的 AI 客户端配置好 fm27-assistant MCP 服务，并加载 skills/fm27-assistant；
5. 等我启动游戏并载入存档后，调用 plugin_health 帮我验证连接是否正常。
```

### 方式二：手动安装

更详细的图文与排障步骤见 [完整安装指南](docs/install-guide.md)。

1. **准备环境**：Windows 版 *Football Manager 27*、[BepInEx 6 (Unity.IL2CPP win-x64)](https://builds.bepinex.dev/projects/bepinex_be)、[Node.js 20+](https://nodejs.org/)（零 npm 依赖，无需 `npm install`）。
2. **部署游戏插件**：
   - 将 BepInEx 6 解压到 FM27 游戏根目录，**启动一次游戏到主菜单后退出**（自动生成 `BepInEx\interop` 目录）。
   - 将本仓库中的 `dist/FMAssistant.dll` 复制到 `<FM27游戏目录>\BepInEx\plugins\FMAssistant\FMAssistant.dll`。
3. **接入 AI 客户端**：
   - **Antigravity 等支持插件目录的客户端**：直接加载本仓库文件夹即可自动启用。
   - **通用 MCP 客户端（Claude Desktop / Cursor / Windsurf 等）**：在仓库根目录运行 `node scripts/generate-mcp-config.mjs` 可直接生成带本机绝对路径的完整配置并粘贴到客户端（避免客户端从其它目录启动时找不到相对路径），格式如下：
     ```json
     {
       "mcpServers": {
         "fm27-assistant": {
           "command": "node",
           "args": ["<本仓库绝对路径>/mcp/fm-assistant-mcp.mjs"],
           "env": {
             "FM_ASSISTANT_URL": "http://127.0.0.1:27190"
           }
         }
       }
     }
     ```
4. **开始使用**：启动 FM27 并载入存档，在对话里让 AI “检查一下 FM27 插件连接”（会调用 `plugin_health`），连上之后就能直接开始聊战术、管球队。

---

## 它能做什么（8 大功能模块，310+ 游戏工具 + 1-Call 高密度聚合包）

项目按足球经理的日常运营划分为 8 个模块，内置 310+ 个游戏业务工具 + 4 个核心入口工具。除了单点原子工具外，还内置了 **4 个 1-Call 高密度业务聚合包**（`get_daily_hub_briefing` 日常过一天晨报、`get_matchday_prep_bundle` 赛前备战与 FM27 战术有效性 4 支柱情报包、`get_transfer_window_briefing` 转会窗引援简报、`get_match_diagnosis_bundle` 赛中/赛后复盘诊断包）与 **`batch_read` 批量并发只读**，大幅减少 AI 思考轮次与 Token 消耗。你不需要记住任何工具名，直接用自然语言提需求，AI 会自己按需查找并调用。

| 模块 | 工具数 | 主要能帮你干什么 | 代表性工具 |
| :--- | :---: | :--- | :--- |
| **1. 球探、招募与转会谈判** | 67 | 全库/球探库多条件搜小妖、看球探报告与候选名单、建招募重点、草拟/修改/提交转会与租借报价、处理收到报价、续约谈判与合同前承诺、试训邀请 | `search_players`、`list_shortlists`、`open_transfer_offer_draft`、`stage_transfer_clause`、`respond_transfer_activity_offer`、`get_precontract_promises` |
| **2. 阵容、排兵布阵与医疗注册** | 51 | 一键算全局最强首发 11 人与 7 人替补席、全队位置深度/年龄/高薪老将体检、直接选人排首发、查伤病与医疗建议、设队长、球衣号码、赛事注册、查更衣室情绪 | `optimize_best_xi`、`audit_squad_and_contracts`、`get_squad_snapshot`、`pick_lineup_player`、`submit_match_lineup`、`set_registration_player`、`get_squad_happiness_issues`、`request_medical_report` |
| **3. 战术、针对性指令与定位球** | 36 | 一键切预设战术风格、改持球/无球阵型与心态、调团队/球员角色与指令、新建/复制/重命名/切换 3 个战术槽位、设对手针对性盯防/压迫、查改定位球主罚人 | `set_tactical_style`、`get_tactic_slots`、`create_tactic`、`set_mentality`、`get_opposition_instructions`、`set_opposition_instruction`、`get_set_piece_takers`、`change_set_piece_takers` |
| **4. 训练、青训培养与导师小组** | 35 | 看改每周球队训练日程、复制粘贴训练模板、设赛前专项准备、给单个球员改位置/特长/强度训练、建改导师小组带小妖、按体能安排休息 | `get_training_week_edit`、`change_training_week_edit`、`copy_training_week`、`assign_individual_training_by_assistant`、`manage_mentoring_group`、`confirm_match_preparation_session` |
| **5. 比赛数据与赛后复盘** | 25 | 读取直播或赛后详细数据（控球、射门、xG、传球、压迫统计、逐人评分）、查看比赛简报与事件流，辅助定位进攻哑火或防守漏洞 | `get_match_state`、`get_match_team_stats_and_xg`、`get_match_live_report`、`get_pre_match_briefing` |
| **6. 主教练日常、收件箱与职员建议** | 38 | 读收件箱并批量清理已读、标记重点消息、查看并一键采纳职员会议与助教建议、跟踪经理承诺与合同目标 | `get_news_read_state`、`set_news_read_state`、`manage_inbox_message_flags`、`apply_staff_meeting_advice_all`、`get_manager_promises` |
| **7. 俱乐部财政、董事会与职员职责** | 19 | 查看转会/工资预算余额、滑动调整预算分配并确认、向董事会申请涨预算/扩青训/建球场、调整职员分工、制定队规罚款、管理卫星俱乐部 | `get_club_budget_balances`、`confirm_club_budget_adjustment`、`submit_board_request`、`change_staff_responsibility`、`change_code_of_conduct_fine` |
| **8. 赛程推进、阵容预设与通用查询** | 36 | 查看联赛积分榜与赛程、安排/取消友谊赛、管理教练训练分工、保存/套用常用阵容预设、查询任意球员属性对比、控制游戏日期推进 | `fm_continue_game`、`get_league_table_and_fixtures`、`compare_players`、`manage_team_selection_preset`、`set_coach_category_assignment`、`get_friendly_dates` |

> 此外，插件还内置了面向 AI 的足球经理知识库（战术体系原理、青训与训练机制、日常运营流程），AI 在做决策时会结合这些足球常识一起思考，而不是机械调接口。

---

## 日常对话示例

连上游戏后，你可以直接这么跟 AI 说话：

- **赛前备战**：“看看下一场对手和我们队里的伤病体能，用最佳 11 人算法给我排一套首发，顺便把对手头号射手的针对性盯防设好。”
- **阵容体检**：“帮我做一次全队阵容和合同体检，列出缺人的位置、冗余位置和值得清洗的高薪老将。”
- **转会引援**：“全库搜一下 20 岁以下有潜力的中场，看看身价和合同，挑 3 个合适的给我做个对比。”
- **训练管理**：“看看下周的训练日程，把赛前一天加上定位球和团队凝聚力，把体能低于 75% 的主力安排休息，顺便帮年轻前锋配个好性格的导师小组。”
- **赛后复盘**：“读取上一场比赛的 xG、射门和传球数据，分析一下为什么我们控球率高但机会不多，给我两套调整方案。”
- **省心托管**：“清理一下收件箱里的普通通知，看看职员会议有什么值得采纳的建议，没重要事项就帮我继续推进到下一场比赛前。”

---

## 安全与默认边界

默认以“助教模式”运行，防止 AI 替你做不可逆的决定：

- **比赛期间只看不改**：可以实时看数据、问建议，默认不自动临场换人或改战术。
- **不代答发布会与谈话**：新闻发布会、更衣室谈话与球员互动留给你自己掌控。
- **外部新援最终签约留给你**：本队续约和转会报价确认后可直接提交，外部球员新签合同的最后确认保留在游戏内完成。
- **仅限本机访问**：插件只在本地 `127.0.0.1` 运行并自动启用随机密钥校验，不上传任何存档数据。

各项功能的详细支持与实测状态可查看 [功能支持清单](docs/CAPABILITIES.md)。

---

## 遇到问题怎么反馈

如果使用中报错或卡住，可以把下面两份本地日志附在 GitHub Issue 里，方便快速定位：

- **MCP 侧日志**：`<本仓库目录>/logs/mcp.log`
- **游戏侧日志**：`<FM27游戏根目录>/BepInEx/plugins/FMAssistant/state/live.log` 与 `BepInEx/LogOutput.log`

---

## 给开发者的文档

如果你想了解底层架构、安全设计、自行编译插件或运行自动化测试，请查阅：

- [架构与安全设计](ARCHITECTURE.md)
- [功能支持与验证清单](docs/CAPABILITIES.md)
- [工程路线图](ROADMAP.md)
- [版本变更记录](CHANGELOG.md)

常用开发命令：

```bash
# 运行离线单元测试（无需启动游戏）
npm test

# 启动游戏并载入存档后，运行真机冒烟回归
npm run test:live

# 从源码重新编译并部署 C# 插件（需要 .NET 6 或 8 SDK）
powershell -ExecutionPolicy Bypass -File scripts/build-plugin.ps1 -GameDir "<FM27游戏根目录>"
```

## License

[MIT](LICENSE)。请遵守游戏用户协议，建议在单人离线存档中使用。
