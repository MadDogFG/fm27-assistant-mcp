/**
 * mcp/algorithms/squad-audit.mjs — 确定性一线队深度、年龄结构、体能锐度、薪资周期与合同到期队列体检算法（纯 JS、零依赖）。
 * 修复 Review #27/#30/#52/#54：
 * - 消费全量分页快照覆盖 >30 人名单，并与 optimize_best_xi 共享同日快照缓存
 * - 薪资按周期（周/月/年）折算并单列未知周期/未知金额统计，不再静默计 0
 * - 新增真正的合同到期优先队列（expiringContractsQueue），按当前游戏日期识别即将到期、含续约选项与到期日未知的球员
 */
import { createSquadSnapshotTools } from "../squad-snapshot-tools.mjs";
import { parsePositionTags, parseWageDetails, parseWageToNumber } from "./best-xi.mjs";

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

// 解析 FM 中英文游戏日期/合同到期文本（支持 YYYY-MM-DD / YYYY年M月D日 / D/M/YYYY / DD Mon YYYY）
export function parseGameDateText(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m && Object.hasOwn(months, m[2].toLowerCase())) {
    return new Date(Date.UTC(Number(m[3]), months[m[2].toLowerCase()], Number(m[1])));
  }
  const iso = Date.parse(s);
  return Number.isFinite(iso) ? new Date(iso) : null;
}

function classifyPlayingTimeWeight(pt) {
  const s = String(pt || "").toLowerCase();
  if (/明星|核心|重要|star|important/i.test(s)) return 3;
  if (/常规|主力|首发|regular|first/i.test(s)) return 2;
  if (/轮换|替补|squad|impact|fringe/i.test(s)) return 1;
  return 0;
}

/**
 * 纯函数：对球员快照执行确定性深度、年龄、体能、薪资周期与合同到期队列体检
 */
export function analyzeSquadAndContracts(
  players,
  {
    lowConditionThreshold = 80,
    lowSharpnessThreshold = 65,
    referenceDate = null,
    expiringWithinDays = 365
  } = {}
) {
  const list = Array.isArray(players) ? players : [];
  const refDateObj = referenceDate instanceof Date ? referenceDate : parseGameDateText(referenceDate);
  const depth = {};
  for (const [k, meta] of Object.entries(BUCKET_TARGETS)) {
    depth[k] = { label: meta.label, count: 0, recommended: `${meta.min}-${meta.max}`, status: "ok", players: [] };
  }

  const ageBands = { u21: 0, prime22_28: 0, mature29_31: 0, veteran32Plus: 0 };
  const fatigueRisks = [];
  const lowSharpness = [];
  const highWageVeterans = [];
  const youthProspects = [];
  const expiringSoon = [];
  const contractExtensionOptions = [];
  const contractDateUnknown = [];

  let totalWeeklyWage = 0;
  let knownWeeklyWageCount = 0;
  let unknownPeriodWageCount = 0;
  let missingWageCount = 0;
  const wagePeriodsSeen = new Set();

  const enriched = list.map(p => {
    const tags = parsePositionTags(p.position);
    const bucket = classifyBucket(tags);
    const age = Number.parseInt(p.age, 10) || null;
    const wageDetails = parseWageDetails(p.wage);
    const wageNum = parseWageToNumber(p.wage);
    const cond = parsePct(p.condition);
    const sharp = parsePct(p.sharpness);
    if (!wageDetails.parsed) {
      missingWageCount++;
    } else if (wageDetails.period === "unknown") {
      unknownPeriodWageCount++;
      wagePeriodsSeen.add("unknown");
    } else {
      knownWeeklyWageCount++;
      wagePeriodsSeen.add(wageDetails.period);
      totalWeeklyWage += wageDetails.weeklyEquivalent;
    }
    return { p, bucket, age, wageDetails, wageNum, cond, sharp };
  });

  const wageEstimateComplete = missingWageCount === 0 && unknownPeriodWageCount === 0;
  const avgWage = knownWeeklyWageCount > 0 ? totalWeeklyWage / knownWeeklyWageCount : 0;

  for (const item of enriched) {
    const { p, bucket, age, wageDetails, wageNum, cond, sharp } = item;
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
    if (age !== null && age >= 30 && wageDetails.weeklyEquivalent !== null && avgWage > 0 && wageDetails.weeklyEquivalent > avgWage * 0.8) {
      highWageVeterans.push({ index: p.index, name: p.name, age, pos: p.position, wage: p.wage, weeklyWageNum: Math.round(wageDetails.weeklyEquivalent) });
    }

    // Review #54: 合同到期队列分析（结合当前游戏日期、到期文本、续约选项与约定出场时间重要性）
    const expText = String(p.contractExpires || "").trim();
    const hasExtensionOption = /选项|延长|续约权|option|ext/i.test(expText);
    const expDateObj = parseGameDateText(expText);
    if (!expText || !expDateObj) {
      contractDateUnknown.push({
        index: p.index,
        name: p.name,
        age,
        pos: p.position,
        contractExpires: expText || null,
        playingTime: p.playingTime || null
      });
    } else if (refDateObj) {
      const daysLeft = Math.round((expDateObj.getTime() - refDateObj.getTime()) / 86_400_000);
      if (hasExtensionOption) {
        contractExtensionOptions.push({
          index: p.index,
          name: p.name,
          age,
          pos: p.position,
          contractExpires: expText,
          daysLeft,
          playingTime: p.playingTime || null
        });
      }
      if (daysLeft <= expiringWithinDays) {
        const ptWeight = classifyPlayingTimeWeight(p.playingTime);
        const urgency = daysLeft <= 180 ? "critical_under_6m" : "upcoming_under_12m";
        expiringSoon.push({
          index: p.index,
          name: p.name,
          age,
          pos: p.position,
          wage: p.wage || null,
          contractExpires: expText,
          daysLeft,
          urgency,
          hasExtensionOption,
          playingTime: p.playingTime || null,
          priorityScore: (daysLeft <= 180 ? 100 : 50) + ptWeight * 20 + (age !== null && age <= 26 ? 15 : 0)
        });
      }
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
  expiringSoon.sort((a, b) => (b.priorityScore - a.priorityScore) || (a.daysLeft - b.daysLeft));

  const recommendations = [];
  if (expiringSoon.length > 0) {
    const top = expiringSoon[0];
    recommendations.push(`【合同到期预警】共 ${expiringSoon.length} 名球员合同将在 ${expiringWithinDays} 天内到期（最紧迫：${top.name}，剩余 ${top.daysLeft} 天${top.playingTime ? `，约定：${top.playingTime}` : ""}），请由玩家优先决定续约或套现。`);
  }
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
    referenceDate: refDateObj ? refDateObj.toISOString().slice(0, 10) : null,
    estimatedTotalWeeklyWage: wageEstimateComplete ? Math.round(totalWeeklyWage) : null,
    knownWeeklyWageSubtotal: Math.round(totalWeeklyWage),
    averageWeeklyWage: knownWeeklyWageCount > 0 ? Math.round(avgWage) : null,
    wageAuditMeta: {
      complete: wageEstimateComplete,
      knownWeeklyCount: knownWeeklyWageCount,
      unknownPeriodCount: unknownPeriodWageCount,
      missingWageCount,
      periodsObserved: [...wagePeriodsSeen],
      ...(wageEstimateComplete ? {} : { note: "存在未解析薪资或未知薪资周期的球员，未把未知项按 0 计入准确周薪总额。" })
    },
    ageStructure: ageBands,
    shortages,
    bloated,
    positionDepth: Object.fromEntries(Object.entries(depth).map(([k, v]) => [k, { label: v.label, count: v.count, recommended: v.recommended, status: v.status }])),
    expiringContractsQueue: {
      referenceDateKnown: Boolean(refDateObj),
      expiringWithinDays,
      expiringCount: expiringSoon.length,
      expiringSoon: expiringSoon.slice(0, 15),
      extensionOptionsCount: contractExtensionOptions.length,
      extensionOptions: contractExtensionOptions.slice(0, 10),
      unknownExpiryCount: contractDateUnknown.length,
      unknownExpiry: contractDateUnknown.slice(0, 10)
    },
    fatigueRisks: fatigueRisks.slice(0, 10),
    lowSharpness: lowSharpness.slice(0, 10),
    highWageVeterans: highWageVeterans.slice(0, 8),
    youthProspectsCount: youthProspects.length,
    youthProspects: youthProspects.slice(0, 10),
    recommendations
  };
}

export function createSquadAuditTools(call, sharedSnapshotTools = null) {
  const snapshot = sharedSnapshotTools || createSquadSnapshotTools(call);

  async function auditSquadAndContracts({ lowConditionThreshold = 80, lowSharpnessThreshold = 65, expiringWithinDays = 365 } = {}) {
    // 消费全量分页快照（覆盖 >30 人名单），并与 optimize_best_xi 共享同日只读缓存（Review #27/#52）
    const sq = await snapshot.getFullSquadSnapshot({ includeContractAndStars: true, includeAvailability: true, useCache: true });
    const report = analyzeSquadAndContracts(sq?.players || [], {
      lowConditionThreshold,
      lowSharpnessThreshold,
      referenceDate: sq?.gameDate || null,
      expiringWithinDays
    });
    return {
      ...report,
      snapshotCoverage: {
        totalInSquad: sq.total,
        evaluatedCount: (sq?.players || []).length,
        partial: Boolean(sq.partial),
        degraded: Boolean(sq.degraded),
        reusedSnapshotCache: Boolean(sq.fromCache),
        gameDate: sq.gameDate || null
      }
    };
  }

  return { auditSquadAndContracts };
}
