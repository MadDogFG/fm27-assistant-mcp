/**
 * tool-catalog.mjs — 将全量底层能力按业务领域归类，支撑渐进式披露检索（fm_discover）。
 */

export const DOMAIN_META = {
  tactics: "战术与定位球：阵型、心态、球队/个人/针对性指令、助教建议、定位球与点球主罚",
  training: "训练与导师：训练日程、单元分配、休假/强度、个人训练焦点与导师小组",
  squad: "阵容与医疗：一线队/梯队名单、球衣号码、队长、赛事注册、伤病治疗与国家队征召",
  recruitment: "招募与转会：球探重点、候选名单、试训、转会/租借/合同草稿、工作许可与搜索筛选",
  club: "俱乐部管理：俱乐部愿景、财政与预算调整、设施升级、员工聘用与附属俱乐部",
  manager: "经理中心：收件箱处理、职员会议、新闻/承诺、工作申请、杯赛抽签与生涯",
  match: "比赛数据（只读）：实时比赛状态、赛中/历史比赛统计、xG 与传球分析",
  system: "系统与基础：插件健康检查、游戏推进（Continue）与通用能力自检"
};

/**
 * 根据工具名称自动判定所属领域
 * @param {string} name 工具名称
 * @returns {string} 领域标识
 */
export function classifyToolDomain(name) {
  if (/^(get_|set_|create_|copy_|delete_|rename_|select_|list_|edit_|change_|manage_|stage_)?.*(tactic|mentality|formation|role|instruction|opposition|set_piece|setpiece|penalty|corner|free_kick|throw_in)/i.test(name)) {
    return "tactics";
  }
  if (/training|mentoring|schedule|rest|intensity|match_prep|session|unit/i.test(name)) {
    return "training";
  }
  if (/squad|lineup|captain|number|registration|injury|medical|physio|youth|callup|intl|international|playing_time|reserves|discipline|team_talk|availability|holiday.*player|comparison/i.test(name)) {
    return "squad";
  }
  if (/scout|recruitment|shortlist|transfer|loan|contract|offer|clause|negotiation|trial|work_permit|precontract|trade|mls|draft|search_filter|agent|dof/i.test(name)) {
    return "recruitment";
  }
  if (/club|board|budget|finance|vision|affiliate|staff(?!_meeting|_advice)|conduct|facility|facilities/i.test(name)) {
    return "club";
  }
  if (/inbox|news|mail|message|meeting|press|interview|conversation|promise|career|job|advert|cup_draw|manager|holiday|follow|advice|induction/i.test(name)) {
    return "manager";
  }
  if (/match|analytics|past_match|datahub/i.test(name)) {
    return "match";
  }
  return "system";
}

/**
 * 执行按领域与关键词的渐进式发现
 */
export function discoverTools(allTools, { domain = "all", query = "", detail = false, limit = 40 } = {}) {
  const normalizedDomain = String(domain || "all").toLowerCase();
  const q = String(query || "").trim().toLowerCase();
  const maxItems = Math.max(1, Math.min(100, Number(limit) || 40));

  const matched = allTools.filter(tool => {
    const toolDomain = classifyToolDomain(tool.name);
    if (normalizedDomain !== "all" && toolDomain !== normalizedDomain) return false;
    if (!q) return true;
    return tool.name.toLowerCase().includes(q) || (tool.description || "").toLowerCase().includes(q);
  });

  const sliced = matched.slice(0, maxItems).map(tool => {
    const item = {
      name: tool.name,
      domain: classifyToolDomain(tool.name),
      description: tool.description
    };
    if (detail) {
      item.inputSchema = tool.inputSchema;
    }
    return item;
  });

  return {
    ok: true,
    totalMatched: matched.length,
    returned: sliced.length,
    truncated: matched.length > sliced.length,
    domains: normalizedDomain === "all" && !q ? DOMAIN_META : undefined,
    tools: sliced,
    tip: detail
      ? "请使用 fm_call({ action: '<tool_name>', params: { ... } }) 调用所需工具。"
      : "如需查看参数 Schema，请对指定关键词或领域传 detail: true；直接调用请使用 fm_call。"
  };
}
