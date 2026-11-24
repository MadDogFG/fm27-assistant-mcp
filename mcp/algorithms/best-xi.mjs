/**
 * mcp/algorithms/best-xi.mjs — 基于精确匈牙利最大权二分图匹配的最优首发 11 人算法（纯 JS、零依赖）。
 * 彻底替代 LLM 心算排阵，数学保证绝不一人两用，综合考量位置熟练度、体能、伤停、锐度与青训倾斜。
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

// 将中英文混合位置字符串解析为标准化位置标签集合
export function parsePositionTags(posText) {
  const s = String(posText || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const low = s.toLowerCase();
  const tags = new Set();

  if (/门将|守门员|\bgk\b/.test(low)) {
    tags.add("GK");
    return tags;
  }

  // 中文位置精确解析（处理“后卫 (右中)”、“前腰 (左中)”、“中场 (中)”等 FM 中文格式）
  if (/后卫|中卫|边卫|翼卫/.test(s)) {
    const isWingback = /翼卫|边后卫/.test(s);
    const hasL = /左/.test(s);
    const hasR = /右/.test(s);
    const hasC = /中/.test(s) || /中卫/.test(s);
    if (hasC) tags.add("DC");
    if (hasL) { tags.add("DL"); tags.add("WBL"); }
    if (hasR) { tags.add("DR"); tags.add("WBR"); }
    if (!hasL && !hasR && !hasC) {
      tags.add(isWingback ? "WBR" : "DC");
      if (isWingback) tags.add("WBL");
    }
  }
  if (/后腰/.test(s)) tags.add("DM");
  if (/前腰|进攻型中场/.test(s)) {
    const hasL = /左/.test(s);
    const hasR = /右/.test(s);
    const hasC = /中/.test(s);
    if (hasC) tags.add("AMC");
    if (hasL) tags.add("AML");
    if (hasR) tags.add("AMR");
    if (!hasL && !hasR && !hasC) tags.add("AMC");
  }
  if (/边锋/.test(s)) {
    if (/左/.test(s)) tags.add("AML");
    if (/右/.test(s)) tags.add("AMR");
    if (!/左|右/.test(s)) { tags.add("AML"); tags.add("AMR"); }
  }
  if (/(^|[^进攻型])中场/.test(s) && !/前腰/.test(s)) {
    const hasL = /左/.test(s);
    const hasR = /右/.test(s);
    const hasC = /中/.test(s);
    if (hasC || (!hasL && !hasR)) tags.add("MC");
    if (hasL) tags.add("ML");
    if (hasR) tags.add("MR");
  }
  if (/前锋|中锋|射手/.test(s)) tags.add("ST");

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

// 解析周薪数值（单位：欧元/周，用于缺乏直接 CA 时的队内层级参考）
export function parseWageToNumber(wageStr) {
  const s = String(wageStr || "").replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*(万|k|m|百万)?/i);
  if (!m) return 0;
  let num = Number.parseFloat(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "万") num *= 10_000;
  else if (unit === "k") num *= 1_000;
  else if (unit === "m" || unit === "百万") num *= 1_000_000;
  return num;
}

function parsePercent(v, fallback = 85) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : fallback;
}

/**
 * 计算单名球员踢目标槽位的确定性得分
 */
export function scorePlayerForSlot(player, slot, { minCondition = 72, preferYouth = false, maxWageInSquad = 1 } = {}) {
  const tags = parsePositionTags(player.position);
  const isPlayerGk = tags.has("GK");
  const isSlotGk = slot === "GK";

  // 门将与外场球员严格隔离
  if (isPlayerGk !== isSlotGk) return -10_000;

  let posScore = 0;
  let fitLabel = "客串";
  if (tags.has(slot)) {
    posScore = 50;
    fitLabel = "天然位置";
  } else {
    const adj = ADJACENT_POSITIONS[slot] || [];
    if (adj.some(a => tags.has(a))) {
      posScore = 30;
      fitLabel = "相近兼职";
    } else {
      posScore = 5;
      fitLabel = "跨线客串";
    }
  }

  const cond = parsePercent(player.condition, 90);
  const sharp = parsePercent(player.sharpness, 80);
  const age = Number.parseInt(player.age, 10) || 25;

  // 体能与锐度权重（体能低于门槛强惩罚，避免把残血主力硬排首发）
  let fitnessScore = (cond / 100) * 24 + (sharp / 100) * 8;
  if (cond < minCondition) fitnessScore -= (minCondition - cond) * 1.5;

  // 综合战力权重：优先使用显式 rating / ability；缺失时用队内薪资对数归一化做平滑参考
  let qualityScore = 0;
  if (Number.isFinite(Number(player.ability))) {
    qualityScore = Math.min(25, Number(player.ability) / 8);
  } else if (Number.isFinite(Number(player.avgRating)) && Number(player.avgRating) > 0) {
    qualityScore = Math.max(0, (Number(player.avgRating) - 6.0) * 12);
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

/**
 * 精确匈牙利算法（Kuhn-Munkres）：求解 m 个槽位与 n 名球员的最大权匹配（m <= n）
 */
export function hungarianMaxWeight(scoreMatrix) {
  const m = scoreMatrix.length;
  if (m === 0) return [];
  const n = scoreMatrix[0].length;
  if (n < m) throw new Error(`可用球员数(${n})不足以填满 ${m} 个首发槽位。`);

  // 将最大化问题转化为最小化非负代价矩阵
  let maxVal = -Infinity;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (scoreMatrix[i][j] > maxVal) maxVal = scoreMatrix[i][j];
    }
  }
  const cost = Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => maxVal - scoreMatrix[i][j])
  );

  // 1-indexed 标准 O(m^2 * n) 匈牙利实现
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
 * 确定性最优首发 11 人与 7 人替补席求解器
 */
export function solveBestXi(players, { formation = "4-2-3-1", slots = null, minCondition = 72, preferYouth = false, excludeIndices = [] } = {}) {
  const excludeSet = new Set(excludeIndices);
  const targetSlots = Array.isArray(slots) && slots.length === 11
    ? slots.map(s => String(s).toUpperCase())
    : (FORMATION_TEMPLATES[formation] || FORMATION_TEMPLATES["4-2-3-1"]);

  const unavailable = [];
  const available = [];

  for (const p of players || []) {
    const injuredOrBanned = Boolean(p.injured || p.suspended) || /伤|停赛|不可用|injur|suspend/i.test(String(p.status || p.availability || ""));
    if (excludeSet.has(p.index) || injuredOrBanned) {
      unavailable.push({ index: p.index, name: p.name, reason: excludeSet.has(p.index) ? "手动轮休排除" : "伤停/不可用" });
    } else {
      available.push(p);
    }
  }

  if (available.length < targetSlots.length) {
    return {
      ok: false,
      error: `可用健康球员仅 ${available.length} 人，不足以排出 ${targetSlots.length} 人首发。`,
      unavailable
    };
  }

  const maxWageInSquad = Math.max(1, ...available.map(p => parseWageToNumber(p.wage)));
  const matrix = targetSlots.map(slot =>
    available.map(p => scorePlayerForSlot(p, slot, { minCondition, preferYouth, maxWageInSquad }))
  );

  const assignment = hungarianMaxWeight(matrix);
  const pickedSet = new Set();
  const startingXI = targetSlots.map((slot, slotIdx) => {
    const pIdx = assignment[slotIdx];
    const p = available[pIdx];
    pickedSet.add(p.index);
    const tags = parsePositionTags(p.position);
    const fit = tags.has(slot) ? "天然位置" : (ADJACENT_POSITIONS[slot] || []).some(a => tags.has(a)) ? "相近兼职" : "客串";
    return {
      slotIndex: slotIdx,
      slot,
      squadIndex: p.index,
      name: p.name,
      age: Number.parseInt(p.age, 10) || null,
      naturalPosition: p.position,
      condition: p.condition ?? null,
      fit,
      score: matrix[slotIdx][pIdx]
    };
  });

  // 替补席 7 人：优先保 1 名替补门将 + 按综合分挑选后/中/前均衡外场替补
  const remaining = available.filter(p => !pickedSet.has(p.index));
  const subGk = remaining
    .filter(p => parsePositionTags(p.position).has("GK"))
    .sort((a, b) => scorePlayerForSlot(b, "GK", { minCondition, preferYouth, maxWageInSquad }) - scorePlayerForSlot(a, "GK", { minCondition, preferYouth, maxWageInSquad }))[0];

  const bench = [];
  if (subGk) {
    bench.push({ squadIndex: subGk.index, name: subGk.name, position: subGk.position, condition: subGk.condition ?? null, role: "替补门将" });
  }
  const outfieldRem = remaining
    .filter(p => !subGk || p.index !== subGk.index)
    .filter(p => !parsePositionTags(p.position).has("GK"))
    .map(p => {
      const cond = parsePercent(p.condition, 85);
      const w = parseWageToNumber(p.wage);
      const q = maxWageInSquad > 0 ? (Math.log10(w + 100) / Math.log10(maxWageInSquad + 100)) * 20 : 10;
      const yBonus = preferYouth && (Number.parseInt(p.age, 10) || 25) <= 21 ? 10 : 0;
      return { p, rankScore: cond * 0.3 + q + yBonus };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  for (const item of outfieldRem) {
    if (bench.length >= 7) break;
    bench.push({
      squadIndex: item.p.index,
      name: item.p.name,
      position: item.p.position,
      condition: item.p.condition ?? null,
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
    totalScore,
    outOfPositionWarnings: outOfPosition,
    startingXI,
    bench,
    unavailableCount: unavailable.length,
    unavailable: unavailable.slice(0, 10)
  };
}

export function createBestXiTools(call) {
  const snapshot = createSquadSnapshotTools(call);
  const client = createLiveClient(call);

  async function optimizeBestXi({ formation, slots, minCondition = 72, preferYouth = false, excludeIndices = [] } = {}) {
    let resolvedFormation = formation;
    if (!resolvedFormation && !slots) {
      // 尝试自动读取当前球队持球阵型名匹配模板
      try {
        const currentName = await client.scope(async scope => {
          const { tactic } = await scope.tactic();
          const f = await scope.subscribeOptional(tactic.handle, "FormationName", {}, 600);
          return clean(scalar(f.read?.value) || "");
        });
        const matchedKey = Object.keys(FORMATION_TEMPLATES).find(k => currentName.includes(k));
        resolvedFormation = matchedKey || "4-2-3-1";
      } catch {
        resolvedFormation = "4-2-3-1";
      }
    }
    const sq = await snapshot.getSquadSnapshot({});
    const players = sq?.players || [];
    return solveBestXi(players, { formation: resolvedFormation || "4-2-3-1", slots, minCondition, preferYouth, excludeIndices });
  }

  return { optimizeBestXi };
}
