/**
 * mcp/workflow-bundles-tools.mjs — 高密度 1-Call 业务聚合工具组（Token 与思考延迟优化）。
 * 围绕 FM27 核心玩法循环设计 4 个单次调用聚合入口：
 * 1. get_daily_hub_briefing      — 日常推进/过一天一键晨报（推进状态 + 待办/头条邮件 + 近期赛程 + 活跃报价）
 * 2. get_matchday_prep_bundle    — 赛前备战一键情报包（战术有效性 4 支柱 + 对手情报 + 全量最佳首发 + 停赛/体能预警）
 * 3. get_transfer_window_briefing — 转会窗/引援规划一键简报（窗口倒计时 + 生效预算 + 阵容缺口/冗员/合同到期队列 + 短名单 + 来价）
 * 4. get_match_diagnosis_bundle  — 赛中/赛后一键战术诊断包（自动判定赛中/赛后，输出核心指标、TOP/FLOP 球员与确定性诊断信号）
 *
 * 原则：100% 只读、并发拉取且单段容错降级（永不因单个可选子通道失败拖垮整包），严禁编造缺失数值。
 */
import { createInboxTools } from "./inbox-tools.mjs";

function settledValue(settled, sectionName, degradedSections) {
  if (settled.status === "fulfilled") return settled.value;
  degradedSections.push({
    section: sectionName,
    error: String(settled.reason?.message || settled.reason || "unknown_error")
  });
  return null;
}

function parseFiniteNum(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const m = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// 递归剪枝 FM 原始嵌套对象/巨型数组，确保聚合包体积严格控制在 ~4-8KB 防爆上下文
function pruneBundleValue(val, depth = 0, maxDepth = 2, maxItems = 6, maxKeys = 10) {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") {
    if (typeof val === "string" && val.length > 160) return `${val.slice(0, 160)}…`;
    return val;
  }
  if (Array.isArray(val)) {
    if (depth >= maxDepth) return `[array length=${val.length}]`;
    return val.slice(0, maxItems).map(item => pruneBundleValue(item, depth + 1, maxDepth, maxItems, maxKeys));
  }
  if (val.kind === "scalar") return val.value ?? null;
  if (val.kind === "game_date") return val.display ?? val.packedValue ?? null;
  if (val.kind === "list" && Array.isArray(val.items)) {
    return {
      count: val.count ?? val.items.length,
      items: depth >= maxDepth
        ? `[list count=${val.count ?? val.items.length}]`
        : val.items.slice(0, maxItems).map(item => pruneBundleValue(item, depth + 1, maxDepth, maxItems, maxKeys))
    };
  }
  if (depth >= maxDepth) {
    if (val.identity) return { type: val.type || "ref", identity: val.identity };
    return `[object keys=${Object.keys(val).length}]`;
  }
  const out = {};
  let added = 0;
  for (const [k, v] of Object.entries(val)) {
    if (v === null || v === undefined || v === "") continue;
    if (added >= maxKeys) break;
    out[k] = pruneBundleValue(v, depth + 1, maxDepth, maxItems, maxKeys);
    added++;
  }
  return out;
}

// 从原生 TacticalEffectiveness 记录提取 FM27 战术有效性 4 支柱，未知字段保留 null 绝不猜测，严防整棵球员明细树膨胀
function extractTacticalEffectivenessPillars(eff) {
  if (!eff || typeof eff !== "object") {
    return { available: false, pillars: null, overall: null };
  }
  const pickByKey = (...patterns) => {
    for (const [k, v] of Object.entries(eff)) {
      if (!patterns.some(re => re.test(k))) continue;
      // 跳过动辄几十 KB 的全队球员列表节点
      if (Array.isArray(v) || v?.kind === "list") continue;
      if (v && typeof v === "object") {
        const compact = {};
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || sv === undefined || sv === "" || typeof sv === "object") continue;
          compact[sk] = sv;
          if (Object.keys(compact).length >= 6) break;
        }
        return Object.keys(compact).length ? compact : pruneBundleValue(v, 0, 1, 3, 6);
      }
      return v;
    }
    return null;
  };

  return {
    available: true,
    overall: pickByKey(/^overall|total.*effectiveness|effectivenessScore/i),
    pillars: {
      tacticalUnderstanding_50pct: pickByKey(/understanding|familiarity/i),
      playerBuyIn_25pct: pickByKey(/buyin|buy_in|support/i),
      nextMatchInfo_15pct: pickByKey(/nextmatch|opposition|preparation/i),
      playerAbility_10pct: pickByKey(/player.*ability|ability|suitability/i)
    },
    rawKeys: Object.keys(eff).slice(0, 16)
  };
}

// 精简对手报告中的强弱项列表，控制单包字节体积
function compactScoutList(listObj, maxItems = 5) {
  if (!listObj || typeof listObj !== "object") return null;
  if (listObj.unavailable) return { unavailable: listObj.unavailable };
  const items = Array.isArray(listObj.items) ? listObj.items : (Array.isArray(listObj) ? listObj : []);
  return {
    count: listObj.count ?? items.length,
    items: items.slice(0, maxItems).map(it => {
      if (typeof it !== "object" || it === null) return it;
      const out = {};
      for (const [k, v] of Object.entries(it)) {
        if (v === null || v === undefined || v === "" || typeof v === "object") continue;
        out[k] = typeof v === "string" && v.length > 100 ? `${v.slice(0, 100)}…` : v;
        if (Object.keys(out).length >= 4) break;
      }
      return Object.keys(out).length ? out : pruneBundleValue(it, 0, 1, 3, 4);
    })
  };
}

export function createWorkflowBundleTools(call, deps) {
  const readInbox = deps.readInbox || createInboxTools(call);

  /**
   * 1. 日常推进/过一天一键晨报（get_daily_hub_briefing）
   * 1 次调用替代 get_continue_game_state + get_inbox(pending) + get_inbox(headlines) + get_world_and_competitions + get_transfer_activity
   */
  async function getDailyHubBriefing({
    inboxLimit = 8,
    scanUnreadOnly = true,
    includeSquadAlerts = false
  } = {}) {
    const t0 = Date.now();
    const safeInboxLimit = Math.max(1, Math.min(15, Number(inboxLimit) || 8));
    const degradedSections = [];

    const readContinueState = typeof deps.continuation?.state === "function"
      ? () => deps.continuation.state({})
      : () => deps.continuation.get({});
    const tasks = [
      readContinueState(),
      readInbox({ unreadOnly: scanUnreadOnly, pendingOnly: true, limit: Math.min(safeInboxLimit, 8), includeBody: true, bodyMaxChars: 240 }),
      readInbox({ unreadOnly: scanUnreadOnly, limit: safeInboxLimit, includeBody: false }),
      deps.worldAndSquad.worldAndCompetitions({ compact: true, transferNewsLimit: 3 }),
      deps.activity.get({ kind: "players", direction: "all" })
    ];
    if (includeSquadAlerts) {
      tasks.push(deps.playerAttrs.getPreMatchBriefing());
    }

    const settled = await Promise.allSettled(tasks);
    const cont = settledValue(settled[0], "continueState", degradedSections);
    const pendingInbox = settledValue(settled[1], "pendingInbox", degradedSections);
    const headlinesInbox = settledValue(settled[2], "headlinesInbox", degradedSections);
    const world = settledValue(settled[3], "worldAndCompetitions", degradedSections);
    const transfers = settledValue(settled[4], "transferActivity", degradedSections);
    const squadBrief = includeSquadAlerts ? settledValue(settled[5], "squadBrief", degradedSections) : null;

    // 提炼近期赛程（最多 3 场，兼容数组与 { items } 两种结构）
    const nextFixtures = Array.isArray(world?.next5Fixtures)
      ? world.next5Fixtures.slice(0, 3)
      : (Array.isArray(world?.next5Fixtures?.items)
        ? world.next5Fixtures.items.slice(0, 3)
        : (Array.isArray(world?.upcomingFixtures?.items) ? world.upcomingFixtures.items.slice(0, 3) : []));

    // 统计活跃转会/报价条目
    const incomingList = Array.isArray(transfers?.incoming?.items) ? transfers.incoming.items : (Array.isArray(transfers?.in) ? transfers.in : []);
    const outgoingList = Array.isArray(transfers?.outgoing?.items) ? transfers.outgoing.items : (Array.isArray(transfers?.out) ? transfers.out : []);
    const transferSummary = transfers ? {
      available: true,
      incomingCount: transfers.incoming?.count ?? incomingList.length,
      outgoingCount: transfers.outgoing?.count ?? outgoingList.length,
      totalCount: (transfers.incoming?.count ?? incomingList.length) + (transfers.outgoing?.count ?? outgoingList.length)
    } : { available: false };

    // 确定性行动清单（无需 Agent 从头拼装优先级）
    const actionChecklist = [];
    const pendingCount = pendingInbox?.returnedCount ?? 0;
    const canContinue = cont?.canRequest === true || cont?.canContinue === true;
    if (pendingCount > 0) {
      actionChecklist.push(`【必须处理】收件箱当前页发现 ${pendingCount} 封待回复邮件${pendingInbox?.hasMore ? "（仍有后续页，请按 nextScanFrom 续扫）" : ""}，请先阅读后交由玩家或按意图回应。`);
    }
    if (cont && !canContinue) {
      const reason = cont.blockingReason || cont.status || cont.state || "游戏存在未处理阻塞项";
      actionChecklist.push(`【推进受阻】当前不可直接推进时间（${reason}），请先处理待办或赛前确认。`);
    } else if (cont && canContinue) {
      actionChecklist.push("【可推进】当前游戏处于可推进状态（CanContinue），确认无待办后可调用 fm_continue_game({ action: 'continue' })。");
    }
    if (transferSummary.available && transferSummary.totalCount > 0) {
      actionChecklist.push(`【转会动态】转会中心存在 ${transferSummary.totalCount} 条活跃转会条目（进 ${transferSummary.incomingCount} / 出 ${transferSummary.outgoingCount}），如需查看报价详情请调 get_transfer_activity。`);
    }
    if (squadBrief && typeof squadBrief.squadAlertsCount === "number" && squadBrief.squadAlertsCount > 0) {
      actionChecklist.push(`【阵容状态】当前有 ${squadBrief.squadAlertsCount} 名球员触发体能/锐度/士气预警。`);
    }

    return {
      ok: true,
      readOnly: true,
      bundle: "daily_hub_briefing",
      elapsedMs: Date.now() - t0,
      degraded: degradedSections.length > 0,
      degradedSections,
      continueFlow: cont ? {
        canContinue,
        gameDate: cont.gameDate || cont.currentDate || null,
        gameIdentity: cont.gameIdentity || null,
        mutationCursor: cont.mutationCursor ?? null,
        hasChoiceToken: Boolean(cont.choiceToken),
        blockingReason: cont.blockingReason || cont.reason || null,
        state: cont.continueState || cont.state || null
      } : null,
      inbox: {
        unreadCount: headlinesInbox?.unreadCount ?? pendingInbox?.unreadCount ?? null,
        pendingCount,
        pendingHasMore: Boolean(pendingInbox?.hasMore),
        pendingNextScanFrom: pendingInbox?.nextScanFrom ?? null,
        pendingMessages: (pendingInbox?.items || []).map(m => ({
          index: m.index,
          targetIdentity: m.targetIdentity,
          title: m.title,
          important: m.important,
          canRespond: m.canRespond,
          bodySnippet: m.body
        })),
        recentHeadlines: (headlinesInbox?.items || []).map(m => ({
          index: m.index,
          targetIdentity: m.targetIdentity,
          title: m.title,
          isRead: m.isRead,
          important: m.important,
          canRespond: m.canRespond,
          hasResponded: m.hasResponded
        })),
        headlinesHasMore: Boolean(headlinesInbox?.hasMore),
        headlinesNextScanFrom: headlinesInbox?.nextScanFrom ?? null
      },
      upcomingFixtures: nextFixtures,
      transferActivity: transferSummary,
      ...(squadBrief ? {
        squadAlertsSummary: {
          nextMatch: squadBrief.nextMatch,
          alertsCount: squadBrief.squadAlertsCount,
          topAlerts: (squadBrief.squadAlerts || []).slice(0, 6)
        }
      } : {}),
      actionChecklist
    };
  }

  /**
   * 2. 赛前备战一键情报包（get_matchday_prep_bundle）
   * 围绕 FM27 战术有效性 4 支柱 + 下场对手球探情报 + 停赛合规 + 全量最佳首发，1 次调用完成赛前筹备。
   */
  async function getMatchdayPrepBundle({
    formation,
    slots,
    minCondition = 75,
    strictMinCondition = false,
    preferYouth = false,
    benchSize,
    excludeIndices,
    includeBestXi = true,
    includeOpposition = true
  } = {}) {
    const t0 = Date.now();
    const degradedSections = [];

    const [preMatchRes, slotsRes, tacticAnalysisRes, complianceRes, oppRes, bestXiRes] = await Promise.allSettled([
      deps.playerAttrs.getPreMatchBriefing(),
      deps.tacticSlots.get({ scope: "team" }),
      deps.tacticAnalysis.get({}),
      deps.worldAndSquad.complianceAndContracts(),
      includeOpposition ? deps.oppositionReport.readOppositionReport({ maxTeams: 1 }) : Promise.resolve(null),
      includeBestXi ? deps.bestXi.optimizeBestXi({ formation, slots, minCondition, strictMinCondition, preferYouth, benchSize, excludeIndices }) : Promise.resolve(null)
    ]);

    const preMatch = settledValue(preMatchRes, "preMatchBriefing", degradedSections);
    const tacticSlots = settledValue(slotsRes, "tacticSlots", degradedSections);
    const tacticAnalysis = settledValue(tacticAnalysisRes, "tacticAnalysis", degradedSections);
    const compliance = settledValue(complianceRes, "squadCompliance", degradedSections);
    const opp = includeOpposition ? settledValue(oppRes, "oppositionReport", degradedSections) : null;
    const bestXi = includeBestXi ? settledValue(bestXiRes, "bestXi", degradedSections) : null;

    const effectivenessSummary = extractTacticalEffectivenessPillars(tacticAnalysis?.effectiveness);

    // 提炼战术槽摘要（兼容原生 label / current / primaryTraining 与 name / isCurrent 字段）
    const activeSlots = Array.isArray(tacticSlots?.slots)
      ? tacticSlots.slots.map(s => ({
        slotIndex: s.slotIndex ?? s.index,
        name: s.label || s.name || null,
        valid: s.valid ?? s.isValid ?? null,
        isCurrent: s.current ?? s.isCurrent ?? s.selected ?? (tacticSlots.currentSlotIndex !== undefined ? s.slotIndex === tacticSlots.currentSlotIndex : null),
        isPrimaryTraining: s.primaryTraining ?? s.isPrimaryTraining ?? s.isTraining ?? (tacticSlots.primaryTrainingSlotIndex !== undefined ? s.slotIndex === tacticSlots.primaryTrainingSlotIndex : null)
      }))
      : [];

    // 提炼对手情报摘要（严格剪枝原始视觉树，防止单包膨胀）
    const oppSummary = opp ? {
      nextFixtureBinding: opp.metadata?.nextFixtureBinding || null,
      analystAssigned: opp.metadata?.analystPersonName || null,
      nextOpponent: opp.nextOpponentAnalysis ? {
        name: opp.nextOpponentAnalysis.name,
        opponentIdentity: opp.nextOpponentAnalysis.opponentIdentity,
        preferredFormation: opp.nextOpponentAnalysis.preferredFormation,
        reportFreshness: opp.nextOpponentAnalysis.reportFreshness,
        strengths: compactScoutList(opp.nextOpponentAnalysis.strengths, 5),
        weaknesses: compactScoutList(opp.nextOpponentAnalysis.weaknesses, 5)
      } : null,
      threatAssessment: pruneBundleValue(opp.threatAssessment ?? null, 0, 2, 5, 8)
    } : null;

    // 提炼确定性备战亮点与建议
    const prepHighlights = [];
    if (preMatch?.nextMatch?.opponentName) {
      prepHighlights.push(`下场对手：${preMatch.nextMatch.opponentName}${preMatch.nextMatch.inDays ? `（${preMatch.nextMatch.inDays}）` : ""}；当前联赛第 ${preMatch.league?.position ?? "未知"}，心态：${preMatch.currentMentality ?? "未知"}。`);
    }
    if (typeof preMatch?.squadAlertsCount === "number" && preMatch.squadAlertsCount > 0) {
      prepHighlights.push(`全队扫描（${preMatch.squadScanSummary?.checkedPlayers ?? "?"}/${preMatch.squadScanSummary?.totalPlayers ?? "?"} 人）发现 ${preMatch.squadAlertsCount} 名体能/锐度/士气预警球员。`);
    }
    if (bestXi?.ok === true) {
      prepHighlights.push(`最佳首发已按 ${bestXi.formation || "自定义阵型"} 完成匈牙利精确匹配（总分 ${bestXi.totalScore}，不可用 ${bestXi.unavailablePlayers?.length ?? 0} 人，资格待核 ${bestXi.unknownEligibilityCount ?? 0} 人）。`);
    } else if (bestXi?.ok === false) {
      prepHighlights.push(`最佳首发未自动套用：${bestXi.error || "请传入显式 formation 或 11 槽位 slots"}。`);
    }
    if (!effectivenessSummary.available) {
      prepHighlights.push("战术有效性 4 支柱当前通道未就绪（如需查看详细理解度/认同度，请在战术可用时重查 get_tactic_analysis）。");
    }

    return {
      ok: true,
      readOnly: true,
      bundle: "matchday_prep_bundle",
      elapsedMs: Date.now() - t0,
      degraded: degradedSections.length > 0 || Boolean(preMatch?.degraded),
      degradedSections,
      matchOverview: preMatch ? {
        teamName: preMatch.teamName,
        league: preMatch.league,
        nextMatch: preMatch.nextMatch,
        currentMentality: preMatch.currentMentality,
        unreadMessages: preMatch.unreadMessages,
        squadScanSummary: preMatch.squadScanSummary,
        squadAlertsCount: preMatch.squadAlertsCount,
        squadAlerts: (preMatch.squadAlerts || []).slice(0, 10)
      } : null,
      tactics: {
        slots: activeSlots,
        tacticalEffectiveness4Pillars: effectivenessSummary,
        complexityKeys: tacticAnalysis?.complexity ? Object.keys(tacticAnalysis.complexity).slice(0, 12) : []
      },
      opposition: oppSummary,
      compliance: compliance ? {
        activeBansCount: compliance.bans?.activeBansCount ?? null,
        potentialBansCount: compliance.bans?.potentialBansCount ?? null,
        availableFirstTeamCount: compliance.availability?.availableFirstTeamCount ?? compliance.availablePlayersCount ?? null,
        squadTotalCount: compliance.availability?.squadTotalCount ?? null,
        nextMatchEligibilityRule: compliance.availability?.nextMatchEligibilityRule ?? null,
        registrationStatus: pruneBundleValue(compliance.availability?.registrationCompliance ?? compliance.registrationCompliance ?? null, 0, 1, 4, 6)
      } : null,
      bestXi: bestXi ? (bestXi.ok === true ? {
        ok: true,
        formation: bestXi.formation,
        totalScore: bestXi.totalScore,
        reusedSnapshotCache: bestXi.snapshotCoverage?.reusedSnapshotCache ?? false,
        startingXI: bestXi.startingXI,
        bench: bestXi.bench,
        unavailableCount: bestXi.unavailablePlayers?.length ?? 0,
        unavailablePlayers: (bestXi.unavailablePlayers || []).slice(0, 10),
        unknownEligibilityCount: bestXi.unknownEligibilityCount ?? 0,
        warnings: bestXi.warnings || []
      } : { ok: false, error: bestXi.error, detectedFormation: bestXi.detectedFormation || null }) : null,
      prepHighlights,
      nextStepsHint: "如需调整针对性指令请调 get_opposition_instructions；确认首发后可通过 pick_lineup_player 排阵，切勿在默认 assistant 模式下赛中写入。"
    };
  }

  /**
   * 3. 转会窗/引援规划一键简报（get_transfer_window_briefing）
   * 1 次调用输出转会窗倒计时 + 生效预算与可调滑杆状态 + 全队缺口/冗员/合同到期队列 + 短名单概览 + 转会中心来价。
   */
  async function getTransferWindowBriefing({
    expiringWithinDays = 365,
    includeShortlists = true,
    includeTransferActivity = true
  } = {}) {
    const t0 = Date.now();
    const degradedSections = [];

    const [windowRes, balancesRes, allocRes, auditRes, shortlistsRes, activityRes, scoutingRes] = await Promise.allSettled([
      deps.seasonIntl.transferWindowAndDeadline(),
      deps.manager.getClubBudgetBalances(),
      deps.manager.getBudgetAllocation(),
      deps.squadAudit.auditSquadAndContracts({ expiringWithinDays }),
      includeShortlists ? deps.shortlists.listShortlists() : Promise.resolve(null),
      includeTransferActivity ? deps.activity.get({ kind: "players", direction: "all" }) : Promise.resolve(null),
      deps.playerScouting.scoutingKnowledgeAndReports()
    ]);

    const tw = settledValue(windowRes, "transferWindow", degradedSections);
    const balances = settledValue(balancesRes, "budgetBalances", degradedSections);
    const alloc = settledValue(allocRes, "budgetAllocation", degradedSections);
    const audit = settledValue(auditRes, "squadAudit", degradedSections);
    const sl = includeShortlists ? settledValue(shortlistsRes, "shortlists", degradedSections) : null;
    const act = includeTransferActivity ? settledValue(activityRes, "transferActivity", degradedSections) : null;
    const scouting = settledValue(scoutingRes, "scoutingSummary", degradedSections);

    // 确定性引援与续约优先事项
    const recruitmentPriorities = [];
    if (audit?.expiringContractsQueue?.expiringCount > 0) {
      const top = audit.expiringContractsQueue.expiringSoon[0];
      recruitmentPriorities.push(`【优先续约/套现】${audit.expiringContractsQueue.expiringCount} 人合同将在 ${expiringWithinDays} 天内到期（最紧迫：${top.name}，剩余 ${top.daysLeft} 天）。`);
    }
    if (Array.isArray(audit?.shortages) && audit.shortages.length > 0) {
      recruitmentPriorities.push(`【补强缺口】${audit.shortages.map(s => `${s.positionGroup}(${s.count}/${s.recommendedMin})`).join("、")}。`);
    }
    if (Array.isArray(audit?.bloated) && audit.bloated.length > 0) {
      recruitmentPriorities.push(`【精简冗员】${audit.bloated.map(b => `${b.positionGroup}(${b.count}>${b.recommendedMax})`).join("、")}，可先挂牌或外租腾挪薪资。`);
    }

    return {
      ok: true,
      readOnly: true,
      bundle: "transfer_window_briefing",
      elapsedMs: Date.now() - t0,
      degraded: degradedSections.length > 0,
      degradedSections,
      transferWindow: tw ? {
        windowDetails: tw.windowDetails || null,
        deadlineCountdown: tw.HumanTransferDeadlineDayCountdown ?? null,
        optedInToDeadlineDay: tw.HumanOptedInToTransferDeadlineDay ?? null
      } : null,
      budgets: {
        effectiveBalances: balances ? {
          transferBudget: balances.transferBudget ?? balances.balances?.transferBudget ?? null,
          wageBudget: balances.wageBudget ?? balances.balances?.wageBudget ?? null,
          payroll: balances.payroll ?? balances.balances?.payroll ?? null,
          raw: balances.balances || undefined
        } : null,
        allocationSession: alloc ? {
          editable: alloc.editable ?? alloc.canEdit ?? null,
          currentIndex: alloc.currentIndex ?? null,
          levelsCount: Array.isArray(alloc.levels) ? alloc.levels.length : (Array.isArray(alloc.options) ? alloc.options.length : null),
          hasConfirmationToken: Boolean(alloc.confirmationToken)
        } : null
      },
      squadAuditSummary: audit ? {
        squadSize: audit.squadSize,
        referenceDate: audit.referenceDate,
        reusedSnapshotCache: audit.snapshotCoverage?.reusedSnapshotCache ?? false,
        estimatedTotalWeeklyWage: audit.estimatedTotalWeeklyWage,
        wageAuditMeta: audit.wageAuditMeta,
        ageStructure: audit.ageStructure,
        shortages: audit.shortages,
        bloated: audit.bloated,
        expiringContractsQueue: {
          expiringCount: audit.expiringContractsQueue.expiringCount,
          topExpiring: (audit.expiringContractsQueue.expiringSoon || []).slice(0, 8),
          extensionOptionsCount: audit.expiringContractsQueue.extensionOptionsCount,
          unknownExpiryCount: audit.expiringContractsQueue.unknownExpiryCount
        },
        highWageVeterans: (audit.highWageVeterans || []).slice(0, 5),
        recommendations: audit.recommendations
      } : null,
      shortlists: sl ? {
        count: sl.count ?? (Array.isArray(sl.shortlists) ? sl.shortlists.length : 0),
        activeShortlist: sl.activeShortlist || null,
        items: (sl.shortlists || sl.items || []).slice(0, 15).map(x => ({
          index: x.index,
          name: x.name,
          playerCount: x.playerCount ?? x.count ?? null,
          isActive: x.isActive ?? null
        }))
      } : null,
      transferActivity: act ? {
        incomingCount: act.incoming?.count ?? (Array.isArray(act.in) ? act.in.length : 0),
        outgoingCount: act.outgoing?.count ?? (Array.isArray(act.out) ? act.out.length : 0)
      } : null,
      scoutingSnapshot: scouting ? {
        scoutedPlayersCount: scouting.scoutedPlayersCount ?? scouting.knowledge?.scoutedPlayersCount ?? null,
        scoutingVacancies: scouting.scoutingVacancies ?? null
      } : null,
      recruitmentPriorities
    };
  }

  /**
   * 4. 赛中/赛后一键战术诊断包（get_match_diagnosis_bundle）
   * 自动检测当前是否处于比赛中：
   * - 赛中：并发拉取双方实时统计/xG + 球员实时评分/体能/黄牌 + 动量时间线，生成确定性临场诊断信号（全只读）。
   * - 非赛中：并发拉取指定历史场次战报（严格绑定 FixtureReference） + 数据中心近 5 场优缺点趋势。
   */
  async function getMatchDiagnosisBundle({ fixtureIndex = 0, topPlayersLimit = 5 } = {}) {
    const t0 = Date.now();
    const safeTop = Math.max(1, Math.min(11, Number(topPlayersLimit) || 5));
    const degradedSections = [];

    const matchState = await deps.match.state({ includeScore: true }).catch(err => {
      degradedSections.push({ section: "matchState", error: String(err?.message || err) });
      return null;
    });

    const isLiveMatch = Boolean(matchState?.inMatch && !matchState.pastMatch);
    if (isLiveMatch) {
      const [statsRes, playersRes, momRes] = await Promise.allSettled([
        deps.matchAnalytics.teamStatsAndXg({ includeShotMap: false, compact: true }),
        deps.matchAnalytics.playerLiveStats({ side: "both", limit: 15, compact: true }),
        deps.matchAnalytics.momentumAndDugout()
      ]);

      const teamStats = settledValue(statsRes, "teamStatsAndXg", degradedSections);
      const playerStats = settledValue(playersRes, "playerLiveStats", degradedSections);
      const momentum = settledValue(momRes, "momentumAndDugout", degradedSections);

      const mySideKey = matchState.isHomeTeam === false ? "away" : "home";
      const oppSideKey = mySideKey === "home" ? "away" : "home";
      const myTeamStats = mySideKey === "home" ? teamStats?.homeTeamLiveStats : teamStats?.awayTeamLiveStats;
      const oppTeamStats = oppSideKey === "home" ? teamStats?.homeTeamLiveStats : teamStats?.awayTeamLiveStats;
      const myPlayersBlock = playerStats?.sides?.[mySideKey] || null;
      const myPlayers = Array.isArray(myPlayersBlock?.players) ? myPlayersBlock.players : [];

      const rated = myPlayers
        .map(p => ({
          index: p.index,
          name: p.name || `#${p.index}`,
          position: p.Position || null,
          rating: parseFiniteNum(p.TotalRating),
          condition: parseFiniteNum(p.Condition),
          injured: p.IsInjured === "True" || p.IsInjured === true,
          yellowCard: p.YellowCardedInMatch === "True" || p.YellowCardedInMatch === true || Number(p.YellowCardedInMatch) > 0,
          goals: parseFiniteNum(p.Goals) || 0,
          assists: parseFiniteNum(p.Assists) || 0,
          xg: parseFiniteNum(p.ExpectedGoals)
        }))
        .filter(p => p.rating !== null);

      const standouts = [...rated].sort((a, b) => b.rating - a.rating).slice(0, safeTop);
      const underperformers = [...rated].sort((a, b) => a.rating - b.rating).slice(0, safeTop);
      const fatigueSubCandidates = myPlayers
        .map(p => ({ index: p.index, name: p.name || `#${p.index}`, condition: parseFiniteNum(p.Condition), rating: parseFiniteNum(p.TotalRating), injured: p.IsInjured === "True" || p.IsInjured === true }))
        .filter(p => (p.condition !== null && p.condition < 70) || p.injured)
        .sort((a, b) => (a.condition ?? 0) - (b.condition ?? 0));
      const yellowCarded = rated.filter(p => p.yellowCard);

      // 基于真实统计生成确定性战术诊断信号（仅在通道真实可用时触发）
      const diagnosticSignals = [];
      if (myTeamStats && !myTeamStats.unavailable && oppTeamStats && !oppTeamStats.unavailable) {
        const myPoss = parseFiniteNum(myTeamStats.possession);
        const myShots = parseFiniteNum(myTeamStats.shots);
        const mySot = parseFiniteNum(myTeamStats.shotsOnTarget);
        const myXg = parseFiniteNum(myTeamStats.xg);
        const oppXg = parseFiniteNum(oppTeamStats.xg);
        if (myPoss !== null && myPoss >= 58 && mySot !== null && mySot <= 2 && (matchState.minute ?? 0) >= 25) {
          diagnosticSignals.push(`【无效控球预警】本队控球 ${myPoss}% 但仅 ${mySot} 次射正（总射门 ${myShots ?? "?"}），建议检查前场穿插/节奏与传中策略。`);
        }
        if (myXg !== null && oppXg !== null) {
          const diff = Number((myXg - oppXg).toFixed(2));
          if (diff >= 0.7) {
            diagnosticSignals.push(`【机会质量占优】本队 xG 领先对手 +${diff}（${myXg} vs ${oppXg}），整体战术创造力在线。`);
          } else if (diff <= -0.7) {
            diagnosticSignals.push(`【防守承压预警】对手 xG 领先本队 +${Math.abs(diff)}（${oppXg} vs ${myXg}），需警惕防线身后空间或中场失控。`);
          }
        }
      }
      if (fatigueSubCandidates.length > 0) {
        diagnosticSignals.push(`【换人建议关注】${fatigueSubCandidates.length} 名本队球员体能低于 70% 或出现伤情：${fatigueSubCandidates.slice(0, 4).map(p => `${p.name}(${p.injured ? "伤" : `${p.condition}%`})`).join("、")}。`);
      }
      if (yellowCarded.length > 0) {
        diagnosticSignals.push(`【染红风险】${yellowCarded.length} 名本队球员身背黄牌：${yellowCarded.map(p => p.name).join("、")}，可考虑叮嘱降低铲抢强度或对位换人。`);
      }
      if (teamStats?.samplingWindow?.spannedBoundary || playerStats?.samplingWindow?.spannedBoundary) {
        diagnosticSignals.push("【采样窗提示】本次读取跨越了比赛分钟或阶段边界，请结合 samplingWindow 核对时点。");
      }

      return {
        ok: true,
        readOnly: true,
        mode: "live_in_match",
        bundle: "match_diagnosis_bundle",
        elapsedMs: Date.now() - t0,
        degraded: degradedSections.length > 0 || Boolean(teamStats?.degraded) || Boolean(playerStats?.degraded),
        degradedSections,
        matchContext: {
          matchIdentity: teamStats?.matchIdentity || matchState.matchIdentity || null,
          minute: matchState.minute ?? null,
          continueState: matchState.continueState ?? null,
          isHomeTeam: matchState.isHomeTeam ?? null,
          score: teamStats?.stats?.MatchScore ?? matchState.score ?? null,
          goalscorers: teamStats?.stats?.GoalscorersString ?? null,
          samplingWindow: teamStats?.samplingWindow || playerStats?.samplingWindow || null
        },
        sideAvailability: teamStats?.sideAvailability || null,
        teamComparison: {
          mySide: mySideKey,
          myTeam: myTeamStats || null,
          opponent: oppTeamStats || null
        },
        myPlayersSummary: {
          available: Boolean(myPlayersBlock?.available),
          unavailable: myPlayersBlock?.unavailable || null,
          standouts,
          underperformers,
          fatigueOrInjuryAlerts: fatigueSubCandidates.slice(0, 6),
          yellowCarded: yellowCarded.map(p => ({ index: p.index, name: p.name, rating: p.rating }))
        },
        dugoutEventCount: momentum?.data?.MatchDugoutEventCount ?? null,
        diagnosticSignals
      };
    }

    // 非比赛状态：进入赛后/历史复盘模式
    const [pastRes, datahubRes] = await Promise.allSettled([
      deps.pastMatchReport.getPastMatchReport({ fixtureIndex }),
      deps.datahubTr.getDatahubAnalysis({ analysisId: 0, compact: true })
    ]);
    const pastReport = settledValue(pastRes, "pastMatchReport", degradedSections);
    const datahub = settledValue(datahubRes, "datahubAnalysis", degradedSections);

    return {
      ok: pastReport ? pastReport.ok !== false : false,
      readOnly: true,
      mode: "post_match_review",
      bundle: "match_diagnosis_bundle",
      elapsedMs: Date.now() - t0,
      degraded: degradedSections.length > 0 || pastReport?.ok === false,
      degradedSections,
      fixtureIndex,
      found: Boolean(pastReport?.found),
      ...(pastReport?.found ? {
        fixtureIdentity: pastReport.fixtureIdentity,
        fixtureMetadata: pastReport.fixtureMetadata,
        availableFixturesCount: pastReport.availableFixturesCount,
        isViewablePastMatch: pastReport.matchDetails?.IsViewablePastMatch ?? null,
        matchReportSummary: pastReport.matchDetails?.MatchReportData ?? null,
        teamLatestScopeNote: pastReport.teamReports?.note || null
      } : {
        error: pastReport?.error || "当前未在比赛中，且未能定位目标历史赛程报告。",
        availableFixturesCount: pastReport?.availableFixturesCount ?? 0
      }),
      recentFiveMatchesTrend: datahub ? {
        ok: datahub.ok !== false,
        strengths: datahub.strengths ?? datahub.teamStrengths ?? null,
        weaknesses: datahub.weaknesses ?? datahub.teamWeaknesses ?? null
      } : null,
      tip: "如需指定历史场次请传 fixtureIndex；如需全量原始树请单独调 get_past_match_report({ fixtureIndex, compact: false })。"
    };
  }

  return {
    getDailyHubBriefing,
    getMatchdayPrepBundle,
    getTransferWindowBriefing,
    getMatchDiagnosisBundle
  };
}
