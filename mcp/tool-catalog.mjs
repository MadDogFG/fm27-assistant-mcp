/**
 * tool-catalog.mjs — 显式工具元数据引擎与渐进式发现（fm_discover）。
 * 不再仅靠工具名前缀正则盲猜读写属性或领域，而是结合显式元数据覆盖表给出
 * { domain, readOnly, exclusiveState, riskLevel, requiresOutOfMatch }。
 */

export const DOMAIN_META = {
  tactics: "战术与定位球：阵型、预设风格、心态、球队/个人/针对性指令、助教建议、定位球与点球主罚",
  training: "训练与导师：训练日程、单元分配、休假/强度、个人训练焦点与导师小组",
  squad: "阵容与医疗：一线队/梯队名单、最优首发算法、阵容深度审计、球衣号码、队长、赛事注册、伤病治疗",
  recruitment: "招募与转会：全库球员搜索、球探重点、候选名单、试训、转会/租借/合同草稿与谈判、工作许可",
  club: "俱乐部管理：俱乐部愿景、财政与预算调整、设施升级、员工聘用与附属俱乐部",
  manager: "经理中心：收件箱处理、职员会议、新闻/承诺、工作申请、杯赛抽签、度假与生涯",
  match: "比赛数据（只读）：实时比赛状态、赛中 39 项实时统计、xG、传球网络与历史战报",
  system: "系统与基础：插件健康检查、游戏推进（Continue）、实时通道查询与通用自检"
};

// 显式元数据声明表：消除容易歧义的领域、读写语义、共享状态锁与高危操作分级
export const EXPLICIT_TOOL_METADATA = {
  // 元工具与系统工具
  plugin_health: { domain: "system", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  fm_discover: { domain: "system", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  fm_call: { domain: "system", readOnly: false, exclusiveState: false, riskLevel: "medium", requiresOutOfMatch: false },
  fm_continue_game: { domain: "system", readOnly: false, exclusiveState: true, riskLevel: "medium", requiresOutOfMatch: false },
  operation_status: { domain: "system", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  live_describe: { domain: "system", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  live_query: { domain: "system", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },

  // 容易误判读写或领域的重点工具（显式声明）
  search_players: { domain: "recruitment", readOnly: true, exclusiveState: true, riskLevel: "low", requiresOutOfMatch: false },
  set_tactical_style: { domain: "tactics", readOnly: false, exclusiveState: true, riskLevel: "medium", requiresOutOfMatch: true },
  optimize_best_xi: { domain: "squad", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  audit_squad_and_contracts: { domain: "squad", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  compare_players: { domain: "squad", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_pre_match_briefing: { domain: "tactics", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_league_table_and_fixtures: { domain: "club", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_match_team_stats_and_xg: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_match_player_live_stats: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_match_momentum_and_dugout: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_match_passing_network: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_match_live_report: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_past_match_report: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },
  get_datahub_analysis: { domain: "match", readOnly: true, exclusiveState: false, riskLevel: "low", requiresOutOfMatch: false },

  // 高危或不可逆业务操作（显式标注 riskLevel: "high"）
  execute_person_management_action: { domain: "squad", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  execute_negotiation_action: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  respond_transfer_activity_offer: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  delete_shortlist: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: false },
  get_shortlist_players: { domain: "recruitment", readOnly: true, exclusiveState: true, riskLevel: "low", requiresOutOfMatch: false },
  add_player_to_shortlist: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "medium", requiresOutOfMatch: false },
  remove_player_from_shortlist: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "medium", requiresOutOfMatch: false },
  manage_tactic_slot: { domain: "tactics", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  change_recruitment_focus_lifecycle: { domain: "recruitment", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  manage_manager_career: { domain: "manager", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true },
  manage_club_affiliate: { domain: "club", readOnly: false, exclusiveState: true, riskLevel: "high", requiresOutOfMatch: true }
};

/**
 * 推导单个工具的标准化元数据：显式声明优先，未在覆盖表中的按确定性规则兜底补全。
 */
export function resolveToolMetadata(toolOrName) {
  const name = typeof toolOrName === "string" ? toolOrName : (toolOrName?.name || "");
  const inline = typeof toolOrName === "object" && toolOrName?.meta ? toolOrName.meta : null;
  const override = EXPLICIT_TOOL_METADATA[name] || null;

  const domain = inline?.domain || override?.domain || classifyToolDomain(name);
  const readOnly = inline?.readOnly ?? override?.readOnly ?? isDefaultReadOnlyName(name);
  const exclusiveState = inline?.exclusiveState ?? override?.exclusiveState ?? !readOnly;
  const riskLevel = inline?.riskLevel || override?.riskLevel || inferRiskLevel(name, readOnly);
  const requiresOutOfMatch = inline?.requiresOutOfMatch ?? override?.requiresOutOfMatch ?? !readOnly;

  return { domain, readOnly, exclusiveState, riskLevel, requiresOutOfMatch };
}

function isDefaultReadOnlyName(name) {
  return /^(get_|list_|read_|preview_|compare_|audit_|optimize_|live_describe|live_query|live_properties|live_read|plugin_health|fm_discover|operation_status|fm_assistant_bindings_)/i.test(name || "");
}

function inferRiskLevel(name, readOnly) {
  if (readOnly) return "low";
  if (/delete|remove|terminate|release|resign|cancel|discard|withdraw/i.test(name || "")) return "high";
  return "medium";
}

/**
 * 根据工具名称判定所属业务领域（优先返回显式声明）
 */
export function classifyToolDomain(name) {
  if (EXPLICIT_TOOL_METADATA[name]?.domain) return EXPLICIT_TOOL_METADATA[name].domain;
  if (/^(get_|set_|create_|copy_|delete_|rename_|select_|list_|edit_|change_|manage_|stage_)?.*(tactic|mentality|formation|role|instruction|opposition|set_piece|setpiece|penalty|corner|free_kick|throw_in)/i.test(name)) {
    return "tactics";
  }
  if (/training|mentoring|schedule|rest|intensity|match_prep|session|unit/i.test(name)) {
    return "training";
  }
  if (/squad|lineup|captain|number|registration|injury|medical|physio|youth|callup|intl|international|playing_time|reserves|discipline|team_talk|availability|holiday.*player|comparison|player_attributes|best_xi/i.test(name)) {
    return "squad";
  }
  if (/scout|recruitment|shortlist|transfer|loan|contract|offer|clause|negotiation|trial|work_permit|precontract|trade|mls|draft|search_filter|search_players|agent|dof/i.test(name)) {
    return "recruitment";
  }
  if (/club|board|budget|finance|vision|affiliate|staff(?!_meeting|_advice)|conduct|facility|facilities|league_table|fixture/i.test(name)) {
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

// 中英文常见检索同义词表
const QUERY_SYNONYMS = [
  ["积分榜", "排名", "联赛", "table", "standings", "league", "league_table"],
  ["赛程", "比赛", "fixture", "fixtures", "schedule", "match", "past_match"],
  ["属性", "能力", "ca", "pa", "attribute", "attributes", "player_attributes"],
  ["对手", "球探报告", "opponent", "opposition", "scout_report"],
  ["续约", "合同", "谈判", "contract", "renew", "negotiation"],
  ["定位球", "角球", "任意球", "点球", "set_piece", "setpiece", "corner", "penalty"],
  ["首发", "最佳阵容", "排阵", "名单", "lineup", "squad", "snapshot", "optimize_best_xi", "best_xi"],
  ["深度", "缺口", "体检", "冗余", "audit", "audit_squad_and_contracts", "depth"],
  ["预算", "财政", "转会费", "工资", "budget", "finance", "wage"],
  ["训练", "休息", "体能", "training", "rest", "intensity", "condition"],
  ["搜索", "筛选", "候选", "买人", "小妖", "自由球员", "search", "search_players", "filter", "shortlist", "recruitment"],
  ["战术风格", "预设风格", "高位压迫", "防反", "传控", "tactical_style", "set_tactical_style"],
  ["招聘", "广告", "空缺", "求职", "职位", "职员", "job", "advert", "post_job_advert", "staff", "apply_for_job"]
];

function expandQueryTokens(rawQuery) {
  const tokens = rawQuery.split(/[\s,，、/|]+/).map(s => s.trim()).filter(Boolean);
  const expanded = new Set(tokens);
  for (const t of tokens) {
    for (const group of QUERY_SYNONYMS) {
      if (group.some(word => t.includes(word) || word.includes(t))) {
        for (const w of group) expanded.add(w);
      }
    }
  }
  return [...expanded];
}

/**
 * 执行按领域与关键词的渐进式发现，附带显式 readOnly / riskLevel 元数据
 */
export function discoverTools(allTools, { domain = "all", query = "", detail = false, offset = 0, limit = 80 } = {}) {
  const normalizedDomain = String(domain || "all").toLowerCase();
  const q = String(query || "").trim().toLowerCase();
  const start = Math.max(0, Number(offset) || 0);
  const maxItems = Math.max(1, Math.min(120, Number(limit) || 80));

  const tokens = q ? expandQueryTokens(q) : [];

  const scored = [];
  for (const tool of allTools) {
    const meta = resolveToolMetadata(tool);
    if (normalizedDomain !== "all" && meta.domain !== normalizedDomain) continue;
    if (!q) {
      scored.push({ tool, meta, score: 1 });
      continue;
    }
    const nameL = tool.name.toLowerCase();
    const descL = (tool.description || "").toLowerCase();
    if (nameL.includes(q) || descL.includes(q)) {
      scored.push({ tool, meta, score: nameL.includes(q) ? 100 : 80 });
      continue;
    }
    let hits = 0;
    for (const tok of tokens) {
      if (nameL.includes(tok)) hits += 3;
      else if (descL.includes(tok)) hits += 1;
    }
    if (hits > 0) scored.push({ tool, meta, score: hits });
  }

  scored.sort((a, b) => b.score - a.score);
  const sliced = scored.slice(start, start + maxItems).map(({ tool, meta }) => {
    const item = {
      name: tool.name,
      domain: meta.domain,
      readOnly: meta.readOnly,
      riskLevel: meta.riskLevel,
      description: tool.description
    };
    if (detail) {
      item.inputSchema = tool.inputSchema;
    }
    return item;
  });

  return {
    ok: true,
    totalMatched: scored.length,
    offset: start,
    returned: sliced.length,
    truncated: start + sliced.length < scored.length,
    domains: normalizedDomain === "all" && !q ? DOMAIN_META : undefined,
    tools: sliced,
    tip: detail
      ? "请使用 fm_call({ action: '<tool_name>', params: { ... } }) 调用所需工具。"
      : "如需查看参数 Schema，请对指定关键词或领域传 detail: true；直接调用请使用 fm_call。"
  };
}
