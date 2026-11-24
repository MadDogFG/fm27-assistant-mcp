/**
 * mcp/algorithms/squad-audit.mjs — 确定性一线队深度、年龄结构、体能锐度与薪资冗余体检算法（纯 JS、零依赖）。
 */
import { createSquadSnapshotTools } from "../squad-snapshot-tools.mjs";
import { parsePositionTags, parseWageToNumber } from "./best-xi.mjs";

const BUCKET_TARGETS = {
  GK: { label: "门将", min: 2, max: 3 },
  DC: { label: "中后卫", min: 4, max: 5 },
  FB: { label: "边后卫/翼卫", min: 4, max: 5 },
  MID: { label: "后腰/中前卫", min: 5, max: 7 },
  WIDE_AM: { label: "边锋/前腰", min: 4, max: 6 },
  ST: { label: "中锋/前锋", min: 2, max: 4 }
};

function classifyBucket(tags) {
  if (tags.has("GK")) return "GK";
  if (tags.has("DC")) return "DC";
  if (tags.has("DL") || tags.has("DR") || tags.has("WBL") || tags.has("WBR")) return "FB";
  if (tags.has("DM") || tags.has("MC")) return "MID";
  if (tags.has("AMC") || tags.has("AML") || tags.has("AMR") || tags.has("ML") || tags.has("MR")) return "WIDE_AM";
  if (tags.has("ST")) return "ST";
  return "MID";
}

function parsePct(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : null;
}

/**
 * 纯函数：对球员快照执行确定性深度、年龄、体能与薪资结构体检
 */
export function analyzeSquadAndContracts(players, { lowConditionThreshold = 80, lowSharpnessThreshold = 65 } = {}) {
  const list = Array.isArray(players) ? players : [];
  const depth = {};
  for (const [k, meta] of Object.entries(BUCKET_TARGETS)) {
    depth[k] = { label: meta.label, count: 0, recommended: `${meta.min}-${meta.max}`, status: "ok", players: [] };
  }

  const ageBands = { u21: 0, prime22_28: 0, mature29_31: 0, veteran32Plus: 0 };
  const fatigueRisks = [];
  const lowSharpness = [];
  const highWageVeterans = [];
  const youthProspects = [];
  let totalWeeklyWage = 0;

  const enriched = list.map(p => {
    const tags = parsePositionTags(p.position);
    const bucket = classifyBucket(tags);
    const age = Number.parseInt(p.age, 10) || null;
    const wageNum = parseWageToNumber(p.wage);
    const cond = parsePct(p.condition);
    const sharp = parsePct(p.sharpness);
    totalWeeklyWage += wageNum;
    return { p, bucket, age, wageNum, cond, sharp };
  });

  const avgWage = list.length > 0 ? totalWeeklyWage / list.length : 0;

  for (const item of enriched) {
    const { p, bucket, age, wageNum, cond, sharp } = item;
    depth[bucket].count++;
    depth[bucket].players.push({ index: p.index, name: p.name, age, pos: p.position });

    if (age !== null) {
      if (age <= 21) {
        ageBands.u21++;
        youthProspects.push({ index: p.index, name: p.name, age, pos: p.position, wage: p.wage || null });
      } else if (age <= 28) ageBands.prime22_28++;
      else if (age <= 31) ageBands.mature29_31++;
      else ageBands.veteran32Plus++;
    }

    if (cond !== null && cond < lowConditionThreshold) {
      fatigueRisks.push({ index: p.index, name: p.name, condition: cond, pos: p.position });
    }
    if (sharp !== null && sharp < lowSharpnessThreshold) {
      lowSharpness.push({ index: p.index, name: p.name, sharpness: sharp, pos: p.position });
    }
    if (age !== null && age >= 30 && wageNum > avgWage * 0.8) {
      highWageVeterans.push({ index: p.index, name: p.name, age, pos: p.position, wage: p.wage, weeklyWageNum: Math.round(wageNum) });
    }
  }

  const shortages = [];
  const bloated = [];
  for (const [k, meta] of Object.entries(BUCKET_TARGETS)) {
    const d = depth[k];
    if (d.count < meta.min) {
      d.status = "shortage";
      shortages.push({ positionGroup: meta.label, count: d.count, recommendedMin: meta.min });
    } else if (d.count > meta.max) {
      d.status = "bloated";
      bloated.push({ positionGroup: meta.label, count: d.count, recommendedMax: meta.max });
    }
  }

  highWageVeterans.sort((a, b) => b.weeklyWageNum - a.weeklyWageNum);
  fatigueRisks.sort((a, b) => a.condition - b.condition);

  const recommendations = [];
  for (const s of shortages) {
    recommendations.push(`【补强缺口】${s.positionGroup} 仅 ${s.count} 人（建议至少 ${s.recommendedMin} 人），优先引援或提拔青训。`);
  }
  for (const b of bloated) {
    recommendations.push(`【冗员清理】${b.positionGroup} 高达 ${b.count} 人（建议不超过 ${b.recommendedMax} 人），考虑挂牌套现或外租小将释放薪资。`);
  }
  if (fatigueRisks.length >= 3) {
    recommendations.push(`【轮换预警】当前有 ${fatigueRisks.length} 名球员体能低于 ${lowConditionThreshold}%，下场建议轮换并调轻训练负荷。`);
  }
  if (highWageVeterans.length > 0) {
    recommendations.push(`【薪资优化】30+ 高薪老将共 ${highWageVeterans.length} 人（最高：${highWageVeterans[0].name} ${highWageVeterans[0].wage}），建议审视合同剩余年限择机套现。`);
  }

  return {
    ok: true,
    readOnly: true,
    squadSize: list.length,
    estimatedTotalWeeklyWage: Math.round(totalWeeklyWage),
    averageWeeklyWage: Math.round(avgWage),
    ageStructure: ageBands,
    shortages,
    bloated,
    positionDepth: Object.fromEntries(Object.entries(depth).map(([k, v]) => [k, { label: v.label, count: v.count, recommended: v.recommended, status: v.status }])),
    fatigueRisks: fatigueRisks.slice(0, 10),
    lowSharpness: lowSharpness.slice(0, 10),
    highWageVeterans: highWageVeterans.slice(0, 8),
    youthProspectsCount: youthProspects.length,
    youthProspects: youthProspects.slice(0, 10),
    recommendations
  };
}

export function createSquadAuditTools(call) {
  const snapshot = createSquadSnapshotTools(call);

  async function auditSquadAndContracts({ lowConditionThreshold = 80, lowSharpnessThreshold = 65 } = {}) {
    const sq = await snapshot.getSquadSnapshot({});
    return analyzeSquadAndContracts(sq?.players || [], { lowConditionThreshold, lowSharpnessThreshold });
  }

  return { auditSquadAndContracts };
}
