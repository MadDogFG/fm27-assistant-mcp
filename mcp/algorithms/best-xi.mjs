/**
 * mcp/algorithms/best-xi.mjs — 基于精确匈牙利最大权二分图匹配的最优首发 11 人算法（纯 JS、零依赖）。
 * 修复 Review #27/#28/#29/#30/#52：
 * - 消费全量分页阵容快照（覆盖 >30 人一线队，并支持与体检复用同日快照）
 * - 严格解析中文左右/中路修饰词（杜绝把“中场 (左)”误标为 MC）及多周期/小数逗号薪资
 * - 引入伤停/外租/资格三态、严格轮休模式（strictMinCondition）与门将硬可行性校验
 * - 优先采用教练星级评估战力、支持自定义替补席人数（benchSize）、不再对未识别阵型静默回退 4-2-3-1
 */
import { createSquadSnapshotTools } from "../squad-snapshot-tools.mjs";
import { createLiveClient, clean, scalar } from "../live-client.mjs";

// 常见标准阵型 11 槽位模板
export const FORMATION_TEMPLATES = {
  "4-2-3-1": ["GK", "DR", "DC", "DC", "DL", "DM", "DM", "AMR", "AMC", "AML", "ST"],
  "4-3-3": ["GK", "DR", "DC", "DC", "DL", "DM", "MC", "MC", "AMR", "AML", "ST"],
  "4-4-2": ["GK", "DR", "DC", "DC", "DL", "MR", "MC", "MC", "ML", "ST", "ST"],
  "3-5-2": ["GK", "DC", "DC", "DC", "WBR", "DM", "MC", "MC", "WBL", "ST", "ST"],
  "3-4-2-1": ["GK", "DC", "DC", "DC", "WBR", "MC", "MC", "WBL", "AMC", "AMC", "ST"],
  "4-1-4-1": ["GK", "DR", "DC", "DC", "DL", "DM", "MR", "MC", "MC", "ML", "ST"],
  "5-3-2": ["GK", "WBR", "DC", "DC", "DC", "WBL", "MC", "MC", "MC", "ST", "ST"],
  "4-4-2-diamond": ["GK", "DR", "DC", "DC", "DL", "DM", "MC", "MC", "AMC", "ST", "ST"]
};

// 从单个中文位置片段中提取括号内方向修饰词（如“中场 (左)”->只提取“(左)”，避免把“中场”里的“中”字误判为中路！）
function extractSideFlags(segment, baseWordsRe) {
  const parenMatch = segment.match(/[（(]([^)）]+)[)）]/);
  const qualifier = parenMatch ? parenMatch[1] : segment.replace(baseWordsRe, "");
  return {
    hasL: /左/.test(qualifier),
    hasR: /右/.test(qualifier),
    hasC: /中/.test(qualifier),
    hasQualifier: Boolean(parenMatch || /[左右中]/.test(qualifier))
  };
}

// 将中英文混合位置字符串解析为标准化位置标签集合（Review #30）
export function parsePositionTags(posText) {
  const s = String(posText || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const low = s.toLowerCase();
  const tags = new Set();

  if (/门将|守门员|\bgk\b/.test(low)) {
    tags.add("GK");
    return tags;
  }

  // 按中文/英文分隔符分段解析（如 "后卫 (右)，中场 (左)"），防止前一段的“右”串到后一段
  const segments = s.split(/[,，、;/|]+/).map(x => x.trim()).filter(Boolean);
  for (const seg of segments) {
    if (/后卫|中卫|边卫|翼卫/.test(seg)) {
      const isWingback = /翼卫|边后卫/.test(seg);
      const isCentreDef = /中卫|中后卫/.test(seg);
      const { hasL, hasR, hasC } = extractSideFlags(seg, /中后卫|边后卫|后卫|中卫|边卫|翼卫/g);
      if (hasC || isCentreDef) tags.add("DC");
      if (hasL) { tags.add("DL"); tags.add("WBL"); }
      if (hasR) { tags.add("DR"); tags.add("WBR"); }
      if (!hasL && !hasR && !hasC && !isCentreDef) {
        tags.add(isWingback ? "WBR" : "DC");
        if (isWingback) tags.add("WBL");
      }
    }
    if (/后腰|防守型中场/.test(seg)) tags.add("DM");
    if (/前腰|进攻型中场/.test(seg)) {
      const { hasL, hasR, hasC } = extractSideFlags(seg, /进攻型中场|前腰/g);
      if (hasC) tags.add("AMC");
      if (hasL) tags.add("AML");
      if (hasR) tags.add("AMR");
      if (!hasL && !hasR && !hasC) tags.add("AMC");
    }
    if (/边锋/.test(seg)) {
      const { hasL, hasR } = extractSideFlags(seg, /边锋/g);
      if (hasL) tags.add("AML");
      if (hasR) tags.add("AMR");
      if (!hasL && !hasR) { tags.add("AML"); tags.add("AMR"); }
    }
    if (/(^|[^进攻型防守型])中场/.test(seg) && !/前腰|后腰|进攻型中场|防守型中场/.test(seg)) {
      // 关键修复：先剥离“中场”二字再查“中”，因此“中场 (左)”绝不会误加 MC
      const { hasL, hasR, hasC } = extractSideFlags(seg, /中场/g);
      if (hasC || (!hasL && !hasR)) tags.add("MC");
      if (hasL) tags.add("ML");
      if (hasR) tags.add("MR");
    }
    if (/前锋|中锋|射手/.test(seg)) tags.add("ST");
  }

  // 英文代码兜底解析
  for (const code of ["DC", "CB", "DL", "LB", "DR", "RB", "WBL", "WBR", "DM", "CDM", "MC", "CM", "ML", "MR", "AMC", "CAM", "AML", "LW", "AMR", "RW", "ST", "CF"]) {
    const re = new RegExp(`\\b${code}\\b`, "i");
    if (re.test(low)) {
      const map = { CB: "DC", LB: "DL", RB: "DR", CDM: "DM", CM: "MC", CAM: "AMC", LW: "AML", RW: "AMR", CF: "ST" };
      tags.add(map[code] || code);
    }
  }
  return tags;
}

// 相近位置兼容表（天然位置 1.0，相近兼职 0.65，次相近 0.35）
const ADJACENT_POSITIONS = {
  GK: [],
  DC: ["DM", "DR", "DL"],
  DR: ["WBR", "DC", "MR"],
  DL: ["WBL", "DC", "ML"],
  WBR: ["DR", "MR", "AMR"],
  WBL: ["DL", "ML", "AML"],
  DM: ["MC", "DC"],
  MC: ["DM", "AMC", "MR", "ML"],
  MR: ["AMR", "WBR", "DR", "MC"],
  ML: ["AML", "WBL", "DL", "MC"],
  AMC: ["MC", "ST", "AML", "AMR"],
  AMR: ["MR", "AMC", "ST", "WBR"],
  AML: ["ML", "AMC", "ST", "WBL"],
  ST: ["AMC", "AMR", "AML"]
};

// 结构化解析薪资文本（Review #30）：区分小数逗号与千位逗号，识别周薪/月薪/年薪周期并折算为周薪
export function parseWageDetails(wageStr) {
  const raw = String(wageStr ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!raw) return { parsed: false, amount: null, weeklyEquivalent: null, period: "unknown" };

  // 识别薪资周期
  let period = "unknown";
  let periodDivisor = 1;
  if (/\/周|每周|p\/w|per\s*week|pw\b/i.test(raw)) {
    period = "weekly";
    periodDivisor = 1;
  } else if (/\/月|每月|p\/m|per\s*month|pm\b/i.test(raw)) {
    period = "monthly";
    periodDivisor = 4.3333;
  } else if (/\/年|每年|p\/a|per\s*year|pa\b|yr\b/i.test(raw)) {
    period = "yearly";
    periodDivisor = 52;
  }

  const m = raw.match(/(\d[\d.,]*)\s*(万|k|m|百万)?/i);
  if (!m) return { parsed: false, amount: null, weeklyEquivalent: null, period };

  let numStr = m[1];
  const unit = (m[2] || "").toLowerCase();
  // 处理欧洲小数逗号（如 "12,5k" 或 "1,5万"）与千位逗号（如 "12,500"）
  if (numStr.includes(",") && !numStr.includes(".")) {
    const parts = numStr.split(",");
    if (parts.length === 2 && parts[1].length !== 3) {
      numStr = `${parts[0]}.${parts[1]}`;
    } else {
      numStr = numStr.replace(/,/g, "");
    }
  } else {
    numStr = numStr.replace(/,/g, "");
  }

  let amount = Number.parseFloat(numStr);
  if (!Number.isFinite(amount)) return { parsed: false, amount: null, weeklyEquivalent: null, period };
  if (unit === "万") amount *= 10_000;
  else if (unit === "k") amount *= 1_000;
  else if (unit === "m" || unit === "百万") amount *= 1_000_000;

  return {
    parsed: true,
    amount,
    weeklyEquivalent: period === "unknown" ? null : amount / periodDivisor,
    period
  };
}

// 解析周薪数值（保持向后兼容，周薪/月薪/年薪自动折算；未知周期时返回解析金额，不可解析返回 0）
export function parseWageToNumber(wageStr) {
  const d = parseWageDetails(wageStr);
  if (!d.parsed) return 0;
  return d.weeklyEquivalent !== null ? d.weeklyEquivalent : d.amount;
}

// 从教练报告星级文本（如 "主力(14/20)" / "14-16/20" / "3.5星"）解析 0..20 能力分
function parseCoachStarsScore(caStars) {
  if (caStars === null || caStars === undefined) return null;
  const s = String(caStars);
  const ratio = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*\/\s*20/);
  if (ratio) {
    const a = Number.parseFloat(ratio[1]);
    const b = ratio[2] ? Number.parseFloat(ratio[2]) : a;
    return (a + b) / 2;
  }
  const star = s.match(/(\d+(?:\.\d+)?)\s*星/);
  if (star) return Number.parseFloat(star[1]) * 4;
  return null;
}

function parsePercent(v, fallback = 85) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : fallback;
}

/**
 * 评估单名球员的可用性三态（Review #28）：eligible / unavailable / unknown
 */
export function evaluatePlayerEligibility(player, { excludeSet = new Set(), minCondition = 72, strictMinCondition = false } = {}) {
  if (excludeSet.has(player.index)) {
    return { state: "unavailable", reason: "手动轮休排除" };
  }
  if (player.loanClub) {
    return { state: "unavailable", reason: `外租在外（${player.loanClub}）` };
  }
  if (player.injured === true) {
    return { state: "unavailable", reason: "伤病缺阵" };
  }
  if (player.suspended === true) {
    return { state: "unavailable", reason: "停赛缺阵" };
  }
  if (player.eligibleForNextMatch === false) {
    return { state: "unavailable", reason: "不具备本场比赛参赛资格" };
  }
  const statusText = String(player.status || player.availability || "");
  if (/伤|停赛|不可用|未注册|无资格|外租|脑震荡|injur|suspend|ineligible|unregistered|concussion|unavailable/i.test(statusText)) {
    return { state: "unavailable", reason: `状态不可用（${statusText}）` };
  }
  if (strictMinCondition) {
    const cond = parsePercent(player.condition, null);
    if (cond !== null && cond < minCondition) {
      return { state: "unavailable", reason: `严格轮休排除（体能 ${cond}% < ${minCondition}%）` };
    }
  }
  const hasExplicitFlags =
    player.injured === false ||
    player.suspended === false ||
    player.eligibleForNextMatch === true ||
    /可用|正常|健康|available|fit|eligible/i.test(statusText);
  return { state: hasExplicitFlags ? "eligible" : "unknown", reason: hasExplicitFlags ? null : "快照未提供完整伤停/注册资格标志" };
}

/**
 * 计算单名球员踢目标槽位的确定性得分（含能力来源标记）
 */
export function scorePlayerForSlot(player, slot, { minCondition = 72, preferYouth = false, maxWageInSquad = 1 } = {}) {
  const tags = parsePositionTags(player.position);
  const isPlayerGk = tags.has("GK");
  const isSlotGk = slot === "GK";

  // 门将与外场球员严格隔离
  if (isPlayerGk !== isSlotGk) return -10_000;

  let posScore = 0;
  if (tags.has(slot)) {
    posScore = 50;
  } else {
    const adj = ADJACENT_POSITIONS[slot] || [];
    posScore = adj.some(a => tags.has(a)) ? 30 : 5;
  }

  const cond = parsePercent(player.condition, 90);
  const sharp = parsePercent(player.sharpness, 80);
  const age = Number.parseInt(player.age, 10) || 25;

  // 体能与锐度权重（体能低于门槛强惩罚，避免把残血主力硬排首发）
  let fitnessScore = (cond / 100) * 24 + (sharp / 100) * 8;
  if (cond < minCondition) fitnessScore -= (minCondition - cond) * 1.5;

  // 综合战力权重：显式 ability > avgRating > 教练星级(caStars) > 薪资对数代理（Review #29）
  let qualityScore = 0;
  const coachScore = parseCoachStarsScore(player.caStars);
  if (Number.isFinite(Number(player.ability))) {
    qualityScore = Math.min(25, Number(player.ability) / 8);
  } else if (Number.isFinite(Number(player.avgRating)) && Number(player.avgRating) > 0) {
    qualityScore = Math.max(0, (Number(player.avgRating) - 6.0) * 12);
  } else if (coachScore !== null) {
    qualityScore = Math.min(24, (coachScore / 20) * 24);
  } else {
    const w = parseWageToNumber(player.wage);
    qualityScore = maxWageInSquad > 0 ? (Math.log10(w + 100) / Math.log10(maxWageInSquad + 100)) * 18 : 8;
  }

  // 青训倾斜模式（杯赛/热身赛练兵）
  let youthBonus = 0;
  if (preferYouth && age <= 21) youthBonus = 14;
  else if (preferYouth && age <= 23) youthBonus = 6;

  return Number((posScore + fitnessScore + qualityScore + youthBonus).toFixed(2));
}

function detectQualitySource(player) {
  if (Number.isFinite(Number(player.ability))) return "ability";
  if (Number.isFinite(Number(player.avgRating)) && Number(player.avgRating) > 0) return "avgRating";
  if (parseCoachStarsScore(player.caStars) !== null) return "coachStars";
  if (parseWageToNumber(player.wage) > 0) return "wageProxy";
  return "fallbackDefault";
}

/**
 * 精确匈牙利算法（Kuhn-Munkres）：求解 m 个槽位与 n 名球员的最大权匹配（m <= n）
 */
export function hungarianMaxWeight(scoreMatrix) {
  const m = scoreMatrix.length;
  if (m === 0) return [];
  const n = scoreMatrix[0].length;
  if (n < m) throw new Error(`可用球员数(${n})不足以填满 ${m} 个首发槽位。`);

  let maxVal = -Infinity;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (scoreMatrix[i][j] > maxVal) maxVal = scoreMatrix[i][j];
    }
  }
  const cost = Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => maxVal - scoreMatrix[i][j])
  );

  const u = new Float64Array(m + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= m; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(m).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

/**
 * 确定性最优首发 11 人与可配置替补席求解器（Review #28/#29）
 */
export function solveBestXi(
  players,
  {
    formation = "4-2-3-1",
    slots = null,
    minCondition = 72,
    strictMinCondition = false,
    preferYouth = false,
    excludeIndices = [],
    benchSize = 7,
    oopFormationName = null
  } = {}
) {
  const excludeSet = new Set(excludeIndices);
  const safeBenchSize = Math.max(0, Math.min(15, Number.isInteger(benchSize) ? benchSize : 7));
  if (!Array.isArray(slots) && formation && !FORMATION_TEMPLATES[formation]) {
    return {
      ok: false,
      infeasible: true,
      unrecognizedFormation: formation,
      supportedTemplates: Object.keys(FORMATION_TEMPLATES),
      error: `未识别的阵型模板 "${formation}"（不再静默回退为 4-2-3-1），请传入受支持的 formation 或自定义 11 槽位 slots 数组。`
    };
  }
  const targetSlots = Array.isArray(slots) && slots.length === 11
    ? slots.map(s => String(s).toUpperCase())
    : FORMATION_TEMPLATES[formation || "4-2-3-1"];

  const unavailable = [];
  const available = [];
  let explicitEligibleCount = 0;
  let unknownEligibilityCount = 0;

  for (const p of players || []) {
    const elig = evaluatePlayerEligibility(p, { excludeSet, minCondition, strictMinCondition });
    if (elig.state === "unavailable") {
      unavailable.push({ index: p.index, name: p.name, eligibilityState: "unavailable", reason: elig.reason });
    } else {
      if (elig.state === "eligible") explicitEligibleCount++;
      else unknownEligibilityCount++;
      available.push({ ...p, _eligibilityState: elig.state });
    }
  }

  // 硬可行性检查：门将槽位与外场槽位分别检查，杜绝“无健康门将却把外场球员硬塞进门将位”（Review #28）
  const neededGk = targetSlots.filter(s => s === "GK").length;
  const neededOutfield = targetSlots.length - neededGk;
  const availGks = available.filter(p => parsePositionTags(p.position).has("GK"));
  const availOutfield = available.filter(p => !parsePositionTags(p.position).has("GK"));

  const missingPositions = [];
  if (availGks.length < neededGk) missingPositions.push(`GK(需要${neededGk}, 可用${availGks.length})`);
  if (availOutfield.length < neededOutfield) missingPositions.push(`外场球员(需要${neededOutfield}, 可用${availOutfield.length})`);

  if (missingPositions.length > 0 || available.length < targetSlots.length) {
    return {
      ok: false,
      infeasible: true,
      missingPositions,
      availabilitySummary: {
        totalConsidered: (players || []).length,
        eligibleCount: explicitEligibleCount,
        unknownEligibilityCount,
        unavailableCount: unavailable.length
      },
      error: `当前可用阵容无法满足合法首发要求，位置缺口：${missingPositions.join("；") || `总可用人数 ${available.length} < ${targetSlots.length}`}。`,
      unavailable
    };
  }

  const maxWageInSquad = Math.max(1, ...available.map(p => parseWageToNumber(p.wage)));
  const matrix = targetSlots.map(slot =>
    available.map(p => scorePlayerForSlot(p, slot, { minCondition, preferYouth, maxWageInSquad }))
  );

  const assignment = hungarianMaxWeight(matrix);
  const pickedSet = new Set();
  const qualitySources = new Set();
  const lowConfidenceNotes = [];

  const startingXI = targetSlots.map((slot, slotIdx) => {
    const pIdx = assignment[slotIdx];
    const p = available[pIdx];
    pickedSet.add(p.index);
    const tags = parsePositionTags(p.position);
    const fit = tags.has(slot) ? "天然位置" : (ADJACENT_POSITIONS[slot] || []).some(a => tags.has(a)) ? "相近兼职" : "客串";
    const qSrc = detectQualitySource(p);
    qualitySources.add(qSrc);
    return {
      slotIndex: slotIdx,
      slot,
      squadIndex: p.index,
      name: p.name,
      age: Number.parseInt(p.age, 10) || null,
      naturalPosition: p.position,
      condition: p.condition ?? null,
      eligibilityState: p._eligibilityState,
      qualitySource: qSrc,
      fit,
      score: matrix[slotIdx][pIdx]
    };
  });

  if (qualitySources.has("wageProxy") || qualitySources.has("fallbackDefault")) {
    lowConfidenceNotes.push("部分球员缺少直接能力/评分/教练星级，战力权重使用了薪资代理或默认值。");
  }
  if (unknownEligibilityCount > 0) {
    lowConfidenceNotes.push(`共有 ${unknownEligibilityCount} 名候选球员未读到完整伤停/注册资格标志（标为 unknown），落地前请核对比赛报名规则。`);
  }
  if (!oopFormationName) {
    lowConfidenceNotes.push("本次排阵仅基于持球阵型槽位求解，未单独对无球阵型（OOP）做二次双阶段优化。");
  }

  // 替补席（按 benchSize 配置）：优先保 1 名替补门将 + 按综合分挑选均衡外场替补
  const remaining = available.filter(p => !pickedSet.has(p.index));
  const subGk = safeBenchSize > 0
    ? remaining
        .filter(p => parsePositionTags(p.position).has("GK"))
        .sort((a, b) => scorePlayerForSlot(b, "GK", { minCondition, preferYouth, maxWageInSquad }) - scorePlayerForSlot(a, "GK", { minCondition, preferYouth, maxWageInSquad }))[0]
    : null;

  const bench = [];
  if (subGk && bench.length < safeBenchSize) {
    bench.push({ squadIndex: subGk.index, name: subGk.name, position: subGk.position, condition: subGk.condition ?? null, eligibilityState: subGk._eligibilityState, role: "替补门将" });
  }
  const outfieldRem = remaining
    .filter(p => !subGk || p.index !== subGk.index)
    .filter(p => !parsePositionTags(p.position).has("GK"))
    .map(p => {
      const cond = parsePercent(p.condition, 85);
      const cs = parseCoachStarsScore(p.caStars);
      const w = parseWageToNumber(p.wage);
      const q = cs !== null ? cs : (maxWageInSquad > 0 ? (Math.log10(w + 100) / Math.log10(maxWageInSquad + 100)) * 20 : 10);
      const yBonus = preferYouth && (Number.parseInt(p.age, 10) || 25) <= 21 ? 10 : 0;
      return { p, rankScore: cond * 0.3 + q + yBonus };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  for (const item of outfieldRem) {
    if (bench.length >= safeBenchSize) break;
    bench.push({
      squadIndex: item.p.index,
      name: item.p.name,
      position: item.p.position,
      condition: item.p.condition ?? null,
      eligibilityState: item.p._eligibilityState,
      role: "轮换替补"
    });
  }

  const totalScore = Number(startingXI.reduce((sum, x) => sum + x.score, 0).toFixed(2));
  const outOfPosition = startingXI.filter(x => x.fit !== "天然位置").map(x => `${x.name}(${x.slot}:${x.fit})`);

  return {
    ok: true,
    readOnly: true,
    algorithm: "hungarian_max_weight_bipartite",
    formation: Array.isArray(slots) ? "custom" : formation,
    oopFormationName: oopFormationName || null,
    benchSizeRequested: safeBenchSize,
    qualitySourcesUsed: [...qualitySources],
    lowConfidenceNotes,
    availabilitySummary: {
      totalConsidered: (players || []).length,
      eligibleCount: explicitEligibleCount,
      unknownEligibilityCount,
      unavailableCount: unavailable.length
    },
    totalScore,
    outOfPositionWarnings: outOfPosition,
    startingXI,
    bench,
    unavailableCount: unavailable.length,
    unavailable: unavailable.slice(0, 15)
  };
}

export function createBestXiTools(call, sharedSnapshotTools = null) {
  const snapshot = sharedSnapshotTools || createSquadSnapshotTools(call);
  const client = createLiveClient(call);

  async function optimizeBestXi({
    formation,
    slots,
    minCondition = 72,
    strictMinCondition = false,
    preferYouth = false,
    excludeIndices = [],
    benchSize
  } = {}) {
    let resolvedFormation = formation;
    let detectedFormationName = null;
    let oopFormationName = null;
    let detectedBenchSize = benchSize;

    if (!resolvedFormation && !slots) {
      try {
        const tacticInfo = await client.scope(async scope => {
          const { tactic } = await scope.tactic();
          const [fIp, fOop, subsSub] = await Promise.all([
            scope.subscribeOptional(tactic.handle, "FormationName", { InPossession: true }, 600),
            scope.subscribeOptional(tactic.handle, "FormationName", { InPossession: false }, 600),
            scope.subscribeOptional(tactic.handle, "NumberOfSubstitutes", {}, 500)
          ]);
          return {
            ipName: clean(scalar(fIp.read?.value) || ""),
            oopName: clean(scalar(fOop.read?.value) || "") || null,
            subsCount: Number.parseInt(scalar(subsSub.read?.value), 10)
          };
        });
        detectedFormationName = tacticInfo.ipName || null;
        oopFormationName = tacticInfo.oopName || null;
        if (detectedBenchSize === undefined && Number.isInteger(tacticInfo.subsCount) && tacticInfo.subsCount >= 0 && tacticInfo.subsCount <= 15) {
          detectedBenchSize = tacticInfo.subsCount;
        }
        if (detectedFormationName) {
          const matchedKey = Object.keys(FORMATION_TEMPLATES).find(k => detectedFormationName.includes(k));
          if (!matchedKey) {
            return {
              ok: false,
              unrecognizedFormation: detectedFormationName,
              oopFormationName,
              supportedTemplates: Object.keys(FORMATION_TEMPLATES),
              error: `当前球队阵型 "${detectedFormationName}" 未命中标准模板（可能是非对称或定制阵型），已拒绝静默套用 4-2-3-1；请显式传入 11 槽位 slots 数组或指定 formation 模板。`
            };
          }
          resolvedFormation = matchedKey;
        }
      } catch {
        // 无法读取战术通道时在结果中明确标注
      }
    }

    // 使用全量分页快照，确保 >30 人阵容的末页门将/轮换球员全部纳入求解（Review #27/#52）
    const sq = await snapshot.getFullSquadSnapshot({ includeContractAndStars: true, includeAvailability: true, useCache: true });
    const players = sq?.players || [];
    const solved = solveBestXi(players, {
      formation: resolvedFormation || "4-2-3-1",
      slots,
      minCondition,
      strictMinCondition,
      preferYouth,
      excludeIndices,
      benchSize: detectedBenchSize ?? 7,
      oopFormationName
    });
    return {
      ...solved,
      snapshotCoverage: {
        totalInSquad: sq.total,
        evaluatedCount: players.length,
        partial: Boolean(sq.partial),
        degraded: Boolean(sq.degraded),
        reusedSnapshotCache: Boolean(sq.fromCache),
        gameDate: sq.gameDate || null
      },
      ...(detectedFormationName ? { detectedFormationName } : {})
    };
  }

  return { optimizeBestXi };
}
