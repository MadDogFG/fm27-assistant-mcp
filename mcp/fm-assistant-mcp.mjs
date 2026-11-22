#!/usr/bin/env node
/**
 * fm-assistant-mcp — MCP 桥：让 agent 通过本机 HTTP 控制 FM27 里的「FM 助教」BepInEx 插件。
 * 插件在游戏进程内运行，监听 http://127.0.0.1:27190。
 *
 * 环境变量：FM_ASSISTANT_URL 覆盖地址（默认 http://127.0.0.1:27190）
 */
import readline from "node:readline";
import { createTacticTools } from "./tactic-tools.mjs";
import { createInboxTools } from "./inbox-tools.mjs";
import { createExtendedTools } from "./extended-tools.mjs";
import { discoverTools, DOMAIN_META } from "./tool-catalog.mjs";

const BASE = (process.env.FM_ASSISTANT_URL || "http://127.0.0.1:27190").replace(/\/+$/, "");
const SERVER = { name: "fm27-assistant", version: "1.0.0" };
const exposeAllTools = process.env.FM_ASSISTANT_EXPOSE_ALL_TOOLS === "1";
const developmentTools = new Set([
  "log", "clear_log", "interop_events", "find_types", "find_methods", "nudge", "ui_panels", "ui_roots", "ui_scan", "ui_tree", "ui_find",
  "game_events", "replay", "block", "selftest", "patched_methods", "set_logging", "fm_assistant_bindings_get", "fm_assistant_bindings_makekey",
  "fm_assistant_save_game", "fm_assistant_load_last_save", "live_properties", "live_subscribe", "live_read", "live_unsubscribe",
  "set_live_property", "dispatch_native_event",
]);
const developmentMode = process.env.FM_ASSISTANT_DEVELOPMENT_TOOLS === "1";

async function call(path, { method = "GET", body = null, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      // 兼容已序列化的 JSON 字符串与原始对象，避免二次序列化导致原生字符串参数带外层双引号
      body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      if (response.status === 504) {
        try { error.timeoutReceipt = JSON.parse(text); }
        catch { /* A gateway timeout may have no plugin receipt. */ }
      }
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`FM 助教接口超时（${path}）`);
    if (String(error?.cause?.code) === "ECONNREFUSED" || /fetch failed/.test(String(error?.message))) {
      throw new Error(
        "连不上 FM 助教插件（127.0.0.1:27190）。请确认：1) FM27 正在运行；2) 插件已安装到 BepInEx\\plugins\\FMAssistant 并加载；3) 游戏已重启过一次。"
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const tools = [
  {
    name: "plugin_health",
    description: "FM 助教插件状态：是否加载、Harmony 补丁是否生效、是否捕获到游戏内部的 Interop/EventDispatcher 实例、日志数量。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "log",
    description: "读取插件内存日志（抓到的官方事件：interop 事件、UI 事件、捕获实例、错误）。category 可选：interop / ui-event / capture / system / error / nudge。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "条数，默认 200" },
        category: { type: "string", description: "按类别过滤" },
        since: { type: "number", description: "只取 seq 大于此值的记录" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "clear_log",
    description: "清空插件内存日志（用于新一轮抓取）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "interop_events",
    description: "列出游戏官方互操作事件 ID 全表（InteropEventIDs，如 EventFmxSetTacticSlot=78、EventFmxManageTeamSelection 等）。",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "按枚举名过滤，例如 Tactic/TeamSelection/Training" } },
      additionalProperties: false,
    },
  },
  {
    name: "find_types",
    description: "在游戏加载的程序集里按名称搜类型（如 Tactic/Role/Formation/TeamSelection/Training），用于定位官方类。",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "类型名关键字" },
        limit: { type: "number", description: "默认 300" },
      },
      required: ["filter"],
      additionalProperties: false,
    },
  },
  {
    name: "find_methods",
    description: "列出某个类型的公共/私有方法（名字、参数、返回类型），用于找可调用的官方函数。",
    inputSchema: {
      type: "object",
      properties: { type: { type: "string", description: "完整类型名，如 FM.UI.TacticFormationHandlerModule" } },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "nudge",
    description: "测试主线程调度：把一个空操作排进游戏主线程执行，确认插件能在游戏线程上跑代码（后续所有改游戏操作都走这条路）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ui_panels",
    description: "列出游戏运行中的 UI Toolkit 运行时面板（RuntimePanel）及根节点子数——界面树的入口。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ui_roots",
    description: "列出已捕获的 UI 根节点（游戏界面用的 UI Toolkit 视觉树）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ui_scan",
    description: "扫描场景里的 UIDocument，把界面根节点捕获进来（打开战术界面后调用一次）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ui_tree",
    description: "导出 UI 控件树：每个节点的类型、名称、文字、位置、可见性、子节点。用来找按钮/卡片/面板。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "number", description: "根节点序号，默认 0" },
        depth: { type: "number", description: "深度，默认 4" },
        limit: { type: "number", description: "节点上限，默认 800" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ui_find",
    description: "按控件上的文字查找元素（例如「战术」「换人」「角色」），返回路径。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },


  {
    name: "game_events",
    description: "最近捕获的游戏事件总线事件（战术/阵型/角色/换人相关），可用于看事件对象的结构。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "replay",
    description: "重放一条已捕获的游戏事件（seq 从 game_events 拿），在游戏主线程执行。",
    inputSchema: {
      type: "object",
      properties: { seq: { type: "number" } },
      required: ["seq"],
      additionalProperties: false,
    },
  },
  {
    name: "block",
    description: "阻塞等待 n 毫秒后再请求 nudge，用来验证主线程队列是否被游戏 Update 驱动执行。",
    inputSchema: { type: "object", properties: { ms: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "selftest",
    description: "主线程自检：把一个会调用 UnityEngine.Debug.Log 的动作排进游戏主线程，并检查补丁是否拦截到。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "patched_methods",
    description: "列出当前 Harmony 实际打上的补丁方法（诊断用）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fm_assistant_save_game",
    description: "【旧 build26385295 已验证写盘，当前 build 待验证】通过游戏内部 SaveGameEvent 排程保存。queued 仅表示已排程，需独立确认保存完成。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fm_assistant_load_last_save",
    description: "【旧 build26385295 已验证，当前 build 待验证】通过游戏内部最近存档业务链加载，不模拟输入。参数 waitMs 控制观察等待；排程或等待结束不代表已进存档。",
    inputSchema: { type: "object", properties: { waitMs: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "fm_assistant_continue_game",
    description: "【当前版本待真机验证】request_continue_game 的兼容名称，必须先读取 get_continue_game_state，携带原身份/token/游标和固定请求号；不会无条件切换等待状态或自动重发。回执不证明日期或比赛阶段推进。",
    inputSchema: { type: "object", properties: { expectedGameIdentity: { type: "string" }, expectedChoiceToken: { type: "string" }, mutationCursor: { type: "integer", minimum: 0 }, operationId: { type: "string" } }, required: ["expectedGameIdentity", "expectedChoiceToken", "mutationCursor", "operationId"], additionalProperties: false },
  },
  {
    name: "fm_assistant_bindings_get",
    description: "【官方数据层】按路径读取 SI.Bindable.Bindings 的值（如路径 game.IdleTime / Human.Team）。返回 TypedValue 与底层对象类型。",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "fm_assistant_bindings_makekey",
    description: "【官方数据层】把绑定路径转换成内部 Bindings.Key（ulong 哈希）。",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "set_logging",
    description: "打开/关闭抓取。logging=0/1 控制 interop 事件日志，allUi=0/1 控制是否记录所有 UI 事件（默认只记战术相关）。",
    inputSchema: {
      type: "object",
      properties: { logging: { type: "string" }, allUi: { type: "string" } },
      additionalProperties: false,
    },
  },
];

const tacticTools = createTacticTools(call);
const readInbox = createInboxTools(call);
const extended = createExtendedTools(call);
const excludedTools = new Set([
  "answer_press_conference_question", "get_communication_actions", "execute_communication_action",
  "get_conversation_replies", "reply_to_conversation",
  "get_negotiation_actions", "execute_negotiation_action", "respond_transfer_activity_offer",
  "get_agent_offer_discard_preview", "discard_agent_offer", "save_tactic_file",
  "submit_match_lineup", "continue_match_stage", "get_match_shout_recipients", "select_match_shout_recipients",
  "get_match_shouts", "execute_match_shout", "preview_match_team_talk_recipients", "select_match_team_talk_recipients",
  "get_match_team_talk_actions", "execute_match_team_talk_action", "preview_match_substitution", "execute_match_substitution",
  "resume_match_substitution", "set_match_playing", "begin_match_changes", "confirm_match_changes", "cancel_match_changes",
]);
tools.push(...extended.tools.filter(tool => !excludedTools.has(tool.name)));
tools.push(
  { name: "get_inbox", description: "实时读取收件箱，不打开页面或标为已读。支持未读、重要、待办、主题筛选。筛选时使用 nextScanFrom 续查下一段，skip 仅在本段匹配结果内分页。",
    inputSchema: { type: "object", properties: { unreadOnly: { type: "boolean", default: true }, limit: { type: "integer", minimum: 1, maximum: 20 }, skip: { type: "integer", minimum: 0 },
      importantOnly: { type: "boolean" }, pendingOnly: { type: "boolean" }, subject: { type: "string" }, scanFrom: { type: "integer", minimum: 0 } }, additionalProperties: false } },
  { name: "get_tactic_roles", description: "实时读取一个首发槽位的持球或无球角色及游戏提供的合法选项，不打开战术页面。索引 0..10。",
    inputSchema: { type: "object", properties: { selectionIndex: { type: "integer", minimum: 0, maximum: 10 }, inPossession: { type: "boolean", default: true } }, required: ["selectionIndex"], additionalProperties: false } },
  { name: "set_player_role", description: "通过游戏命令修改首发槽位角色，并等待原生数据读回确认。role 使用 get_tactic_roles 的中文名或 mask 字符串，勿把 64 位 mask 转为 JS 数值。",
    inputSchema: { type: "object", properties: { selectionIndex: { type: "integer", minimum: 0, maximum: 10 }, inPossession: { type: "boolean", default: true }, role: { type: "string" }, expectedRole: { type: "string" }, operationId: { type: "string" } }, required: ["selectionIndex", "role"], additionalProperties: false } },
  { name: "operation_status", description: "查询一次游戏命令的状态和修改前后值。结果未知时查询此工具，不要自动重发写命令。",
    inputSchema: { type: "object", properties: { operationId: { type: "string" } }, required: ["operationId"], additionalProperties: false } }
  ,{ name: "get_formation_options", description: "实时读取持球或无球阵型和游戏允许的阵型选项，不切换页面。",
    inputSchema: { type: "object", properties: { inPossession: { type: "boolean", default: true } }, additionalProperties: false } }
  ,{ name: "set_formation", description: "通过游戏自身的数据通道命令更换持球或无球阵型，并等待读回确认。阵型更改可能使游戏自动调整位置和角色。",
    inputSchema: { type: "object", properties: { inPossession: { type: "boolean", default: true }, formation: { type: "string" }, expectedFormation: { type: "string" }, operationId: { type: "string" } }, required: ["formation"], additionalProperties: false } }
);

const INSTRUCTIONS = `FM27 Assistant 通过游戏进程内原生命令与数据通道工作。禁止模拟键鼠或直接改写存档/内存数值。
本网关采用渐进式披露模式：
1. 先调用 plugin_health 确认游戏与存档状态。
2. 按需调用 fm_discover({ domain, query, detail }) 检索领域可用工具及参数 Schema。
3. 使用 fm_call({ action, params }) 执行具体业务操作，写操作须先读状态、保留 token/expectedCurrent 与唯一 operationId，并在执行后重读状态核验。
4. 常用日期推进可直接调用 fm_continue_game。`;

const liveSchema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const sourceFields = { source: { type: "string", description: "game、human、singleton:类型名或当前会话订阅 handle" }, path: { type: "string", description: "record 属性 ID / 列表下标路径" } };
tools.push(
  { name: "live_properties", description: "读取实时引用支持的属性、ID及必要上下文；不打开游戏页面。", inputSchema: liveSchema({ ...sourceFields, filter: { type: "string" } }) },
  { name: "live_subscribe", description: "订阅游戏实时数据，返回 handle；subscribed 不表示已经有数据。", inputSchema: liveSchema({ ...sourceFields, property: { type: "string", description: "properties 返回的十进制或 0x 属性 ID" }, contexts: { type: "object", description: "properties 列出的必要上下文，值为布尔/整数/字符串，引用写 {source,path}" } }, ["property"]) },
  { name: "live_read", description: "读取订阅的最新响应、revision、时间和结构化数据，支持深入 record/list。", inputSchema: liveSchema({ handle: { type: "string" }, path: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 6 } }, ["handle"]) },
  { name: "live_unsubscribe", description: "关闭实时数据订阅并释放游戏数据上下文。", inputSchema: liveSchema({ handle: { type: "string" } }, ["handle"]) },
  { name: "set_live_property", description: "高级通用写入：把 JSON 值通过游戏自己的 UpdateChannelData 通道写进一个实时属性 handle（用于设置/面板类绑定，例如关闭教程提示）。只写游戏暴露的可绑定属性，不替代玩家业务事务，派发后必须重新读取核对。", inputSchema: liveSchema({ handle: { type: "string", description: "live_subscribe 返回的属性通道 handle" }, payload: {} }, ["handle", "payload"]) },
  { name: "dispatch_native_event", description: "高级通用派发：按游戏自己的 InteropEventIDs 事件名，向实时引用发送一次原生事件；payload 可用游戏自身数据（$value:{source,path} / $reference:{source,path} / $plain 记录 / 标量 / 数组）。只派发，不证明生效；必须独立读回状态。用于六个模块里尚未有专用工具的原生操作（发布会、职位申请、规划器、TransferRoom、短名单管理等），不写死俱乐部/球员/存档内容。", inputSchema: liveSchema({ event: { type: "string", description: "InteropEventIDs 事件名，例如 EventFmxApplyForJob" }, source: { type: "string", description: "目标引用 source；无目标写 none" }, path: { type: "string" }, payload: {}, operationId: { type: "string" } }, ["event", "operationId"]) }
);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callTool(name, args) {
  if (developmentTools.has(name) && !developmentMode) throw new Error("此工具仅用于开发和测试。");
  if (excludedTools.has(name)) {
    throw new Error("该功能不在已确认的 MCP 范围内。比赛只读，对话和谈判决定由玩家处理。");
  }
  if (Object.hasOwn(extended.handlers, name)) return extended.handlers[name](args);
  switch (name) {
    case "get_inbox": return readInbox(args);
    case "get_tactic_roles": return tacticTools.getRoles(args);
    case "set_player_role": return tacticTools.setRole(args);
    case "operation_status": return tacticTools.operationStatus(args);
    case "get_formation_options": return tacticTools.getFormations(args);
    case "set_formation": return tacticTools.setFormation(args);
    case "live_properties":
    case "live_subscribe":
    case "live_read":
    case "live_unsubscribe": {
      const route = { live_properties: "properties", live_subscribe: "open", live_read: "read", live_unsubscribe: "close" }[name];
      const query = new URLSearchParams(Object.entries(args).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
      return call(`/api/v1/live/${route}?${query}`, { method: ["live_subscribe", "live_unsubscribe"].includes(name) ? "POST" : "GET" });
    }
    case "set_live_property": {
      // Generic bindable-channel write through the game's own InteropDataHandler.UpdateChannel
      // command. The caller must pass a live property handle; the payload is the game value.
      return call(`/api/v1/internal/update?handle=${encodeURIComponent(args.handle)}&apply=true`,
        { method: "POST", body: JSON.stringify(args.payload ?? null) });
    }
    case "dispatch_native_event": {
      // Generic native-event dispatch: event name must be a player command in the game enum
      // (plugin rejects Debug/Cheat); payload is built by the game's own value builder.
      // Scope boundary: the generic entry must not bypass the excluded families (save/load,
      // match writes, player dialogue/answers, negotiation actions). Dedicated tools cover the
      // allowed read/draft/handoff flows instead.
      const excluded = /(Save|Load|Match|KickOff|Playback|TeamTalk|Shout|Touchline|Substitution|Lineup|TeamSelection|PressConference|Interview|Answer|Dialogue|Conversation|Talk|Negotiation|Contract|Offer|Bid|Transfer)/i;
      if (excluded.test(args.event || ""))
        throw new Error("范围边界：通用事件派发不能用于存档/读档、比赛写入、玩家对话或谈判动作；请使用专用只读/草稿/交接工具。");
      const query = new URLSearchParams({ id: args.operationId, event: args.event, source: args.source || "none", path: args.path || "", apply: "true" });
      return call(`/api/v1/internal/event?${query}`, { method: "POST", body: JSON.stringify(args.payload ?? null) });
    }

    case "plugin_health":
      return call("/health");
    case "log": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.category) params.set("category", args.category);
      if (args.since) params.set("since", String(args.since));
      const qs = params.toString();
      return call("/log" + (qs ? `?${qs}` : ""));
    }
    case "clear_log":
      return call("/clear");
    case "interop_events": {
      const qs = args.name ? `?name=${encodeURIComponent(args.name)}` : "";
      return call("/enum" + qs);
    }
    case "find_types": {
      const qs = `?filter=${encodeURIComponent(args.filter || "")}&limit=${args.limit || 300}`;
      return call("/types" + qs);
    }
    case "find_methods":
      return call(`/methods?type=${encodeURIComponent(args.type)}`);
    case "nudge":
      return call("/nudge");
    case "ui_panels":
      return call("/ui/panels");
    case "ui_roots":
      return call("/ui/roots");
    case "ui_scan":
      return call("/ui/scan");
    case "ui_tree":
      return call(`/ui/tree?root=${args.root || 0}&depth=${args.depth || 4}&limit=${args.limit || 800}`);
    case "ui_find":
      return call(`/ui/find?text=${encodeURIComponent(args.text || "")}`);
    case "ui_click":
      throw new Error("UI 输入已禁用，请使用游戏命令。");
    case "ui_click_text":
      throw new Error("UI 输入已禁用，请使用游戏命令。");
    case "game_events":
      return call("/events");
    case "replay":
      return call(`/replay?seq=${args.seq}`);
    case "selftest":
      return call("/selftest");
    case "patched_methods":
      return call("/patches");
    case "block": {
      const ms = Math.max(200, Math.min(15000, args.ms || 1500));
      const first = await call("/nudge");
      await new Promise(resolve => setTimeout(resolve, ms));
      const second = await call("/health");
      return { queued: first, waitMs: ms, after: second };
    }
    case "set_logging": {
      const qs = [];
      if (args.logging !== undefined) qs.push(`logging=${encodeURIComponent(args.logging)}`);
      if (args.allUi !== undefined) qs.push(`allUi=${encodeURIComponent(args.allUi)}`);
      return call("/settings" + (qs.length ? `?${qs.join("&")}` : ""));
    }
    case "fm_assistant_save_game":
      return call(`/event/send?name=${encodeURIComponent("SaveGameEvent")}`);
    case "fm_assistant_load_last_save": {
      const waitMs = Math.max(5000, Math.min(180000, args.waitMs || 45000));
      const open = await call("/game/lastsave");
      await new Promise(resolve => setTimeout(resolve, 2500));
      const load = await call("/game/startload");
      await new Promise(resolve => setTimeout(resolve, waitMs));
      const health = await call("/health");
      return { openDialog: open, startLoading: load, waitMs, health };
    }
    case "fm_assistant_continue_game":
      return extended.handlers.request_continue_game(args);
    case "fm_assistant_bindings_get":
      return call(`/bindings/getpath?path=${encodeURIComponent(args.path || "")}`);
    case "fm_assistant_bindings_makekey":
      return call(`/bindings/makekey?path=${encodeURIComponent(args.path || "")}`);
    default:
      throw new Error(`未知工具：${name}`);
  }
}

const gatewayTools = [
  {
    name: "plugin_health",
    description: "检查 FM27 游戏内插件在线状态、版本、当前存档日期与主线程心跳。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fm_discover",
    description: "渐进式按领域或关键词检索 FM27 助教可用工具。支持 domain（tactics/training/squad/recruitment/club/manager/match/system/all）与 query 关键词筛选，detail=true 可获取完整参数 Schema。",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", enum: ["all", ...Object.keys(DOMAIN_META)], description: "按业务领域筛选" },
        query: { type: "string", description: "按名称或中文描述关键词搜索" },
        detail: { type: "boolean", description: "是否返回完整参数 Schema（默认 false，极省上下文）" },
        offset: { type: "integer", minimum: 0, description: "分页偏移（默认 0）" },
        limit: { type: "integer", minimum: 1, maximum: 120, description: "最多返回条数（默认 80）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fm_call",
    description: "执行由 fm_discover 查得的任意 FM27 业务工具。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "目标工具名称，例如 get_tactic_slots、set_mentality" },
        params: { type: "object", description: "传递给目标工具的参数对象", additionalProperties: true },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "fm_continue_game",
    description: "读取当前游戏继续流程状态，或请求在 CanContinue 状态下向前推进游戏时间。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "continue"], description: "read 仅读取状态，continue 请求继续游戏（默认 read）" },
        operationId: { type: "string", description: "唯一请求号" },
      },
      additionalProperties: false,
    },
  },
];

const HEX_FIELD_ALIASES = {
  "0x71764a36": "label",
  "0x7074766c": "value",
  "0x5374726e": "text",
  "0x69642020": "id",
  "0x6e616d65": "name",
  "0x7469746c": "title",
  "0x696e6478": "index",
  "0x34453354": "children",
  "0x526f7744": "rowData",
};

function sanitizePayload(value) {
  if (typeof value === "string") {
    return value
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\u0001[^\u0002]*\u0002/g, "")
      .replace(/\u0001/g, "");
  }
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value && typeof value === "object") {
    // 折叠 FM 原生 { kind: "scalar", type: "...", value: ... } 为纯标量，大幅压缩输出体积
    if (value.kind === "scalar" && Object.hasOwn(value, "value") && Object.keys(value).length <= 3) {
      return sanitizePayload(value.value);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const mappedKey = HEX_FIELD_ALIASES[k] || k;
      out[mappedKey] = sanitizePayload(v);
    }
    return out;
  }
  return value;
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions: INSTRUCTIONS,
    });
    return;
  }
  if (method === "notifications/initialized" || isNotification) return;
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    const publicTools = tools.filter(tool => developmentMode || !developmentTools.has(tool.name));
    reply(id, { tools: exposeAllTools ? publicTools : gatewayTools });
    return;
  }
  if (method === "tools/call") {
    try {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      let result;
      if (toolName === "fm_discover") {
        const publicTools = tools.filter(tool => developmentMode || !developmentTools.has(tool.name));
        result = discoverTools(publicTools, toolArgs);
      } else if (toolName === "fm_call") {
        if (!toolArgs.action) throw new Error("必须提供 action 参数（目标工具名）。");
        result = await callTool(toolArgs.action, toolArgs.params || {});
      } else if (toolName === "fm_continue_game") {
        result = await callTool("fm_assistant_continue_game", toolArgs);
      } else {
        result = await callTool(toolName, toolArgs);
      }
      const cleanResult = sanitizePayload(result);
      reply(id, { content: [{ type: "text", text: JSON.stringify(cleanResult, null, 2) }], structuredContent: cleanResult, ...(cleanResult?.ok === false ? { isError: true } : {}) });
    } catch (error) {
      reply(id, { content: [{ type: "text", text: `调用 ${params?.name} 失败：${error?.message || error}` }], isError: true });
    }
    return;
  }
  replyError(id, -32601, `不支持的方法：${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  chain = chain.then(() => handleMessage(message)).catch((error) => {
    process.stderr.write(`fm-assistant-mcp error: ${error?.stack || error}\n`);
  });
});
rl.on("close", () => {
  chain.finally(() => process.exit(0));
});
