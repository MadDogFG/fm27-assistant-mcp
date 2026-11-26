import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorkflowBundleTools } from "../../mcp/workflow-bundles-tools.mjs";
import { createJobAdvertTools } from "../../mcp/job-advert-tools.mjs";
import { createSquadSnapshotTools } from "../../mcp/squad-snapshot-tools.mjs";
import { createExtendedTools } from "../../mcp/extended-tools.mjs";
import { discoverTools, resolveToolMetadata } from "../../mcp/tool-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function createStubDeps(overrides = {}) {
  return {
    readInbox: async ({ pendingOnly, includeBody } = {}) => ({
      ok: true,
      unreadCount: 6,
      returnedCount: pendingOnly ? 1 : 3,
      hasMore: false,
      nextScanFrom: null,
      items: pendingOnly
        ? [{ index: 0, targetIdentity: "news:1", title: "必须回复：赛前发布", important: true, canRespond: true, body: includeBody === false ? undefined : "请在今天确认。" }]
        : [
          { index: 0, targetIdentity: "news:1", title: "必须回复：赛前发布", isRead: false, important: true, canRespond: true, hasResponded: false },
          { index: 1, targetIdentity: "news:2", title: "球探报告", isRead: false, important: false, canRespond: false, hasResponded: false }
        ]
    }),
    continuation: { get: async () => ({ ok: true, canContinue: false, canRequest: false, blockingReason: "NeedAction", gameDate: "2026-09-12", gameIdentity: "g:1", mutationCursor: 5, choiceToken: "tok" }) },
    worldAndSquad: {
      worldAndCompetitions: async () => ({ ok: true, next5Fixtures: { items: [{ inDays: "2天", opponentName: "皇马" }] } }),
      complianceAndContracts: async () => ({ ok: true, suspensions: [], availablePlayersCount: 24, registrationCompliance: "ok" })
    },
    activity: { get: async () => ({ ok: true, incoming: { count: 2, items: [{}, {}] }, outgoing: { count: 1, items: [{}] } }) },
    playerAttrs: {
      getPreMatchBriefing: async () => ({
        ok: true,
        degraded: false,
        teamName: "测试俱乐部",
        league: { name: "甲级联赛", position: "2" },
        nextMatch: { opponentName: "皇马", inDays: "2天" },
        currentMentality: "积极进取",
        unreadMessages: "6",
        squadScanSummary: { available: true, totalPlayers: 26, checkedPlayers: 26 },
        squadAlertsCount: 2,
        squadAlerts: [{ squadIndex: 3, name: "老将A", reasons: ["体能偏低(72)"] }]
      })
    },
    tacticSlots: { get: async () => ({ ok: true, slots: [{ slotIndex: 0, name: "4-3-3 高压", valid: true, isCurrent: true, isPrimaryTraining: true }] }) },
    tacticAnalysis: {
      get: async () => ({
        ok: true,
        effectiveness: {
          OverallEffectiveness: "82",
          TacticalUnderstanding: "42/50",
          PlayerBuyIn: "20/25",
          NextMatchInformation: "12/15",
          PlayerAbility: "8/10"
        },
        complexity: { OverallComplexity: "Medium" }
      })
    },
    oppositionReport: {
      readOppositionReport: async () => ({
        ok: true,
        metadata: { analystPersonName: "首席分析师", nextFixtureBinding: { fixtureIdentity: "fix:99", matchDate: "2026-09-14" } },
        nextOpponentAnalysis: {
          name: "皇马",
          opponentIdentity: "team:rm",
          preferredFormation: "4-3-3",
          reportFreshness: { reportDateStatus: "known", reportDate: "2026-09-11" },
          strengths: { count: 2, items: [{ label: "反击速度" }] },
          weaknesses: { count: 1, items: [{ label: "高空球防守" }] }
        },
        threatAssessment: "高威胁"
      })
    },
    bestXi: {
      optimizeBestXi: async () => ({
        ok: true,
        formation: "4-3-3",
        totalScore: 880.5,
        snapshotCoverage: { reusedSnapshotCache: true },
        startingXI: [{ slot: "GK", name: "门将1" }],
        bench: [{ name: "替补1" }],
        unavailablePlayers: [{ name: "伤员A", reason: "伤病缺阵" }],
        unknownEligibilityCount: 0,
        warnings: []
      })
    },
    seasonIntl: {
      transferWindowAndDeadline: async () => ({
        ok: true,
        windowDetails: { TransferWindowTimelineEndDate: "2026-09-01" },
        HumanTransferDeadlineDayCountdown: "5天",
        HumanOptedInToTransferDeadlineDay: "False"
      })
    },
    manager: {
      getClubBudgetBalances: async () => ({ ok: true, transferBudget: "€15M", wageBudget: "€1.2M/周" }),
      getBudgetAllocation: async () => ({ ok: true, editable: true, currentIndex: 4, levels: [1, 2, 3, 4, 5], confirmationToken: "btok" })
    },
    squadAudit: {
      auditSquadAndContracts: async () => ({
        ok: true,
        squadSize: 28,
        referenceDate: "2026-09-12",
        snapshotCoverage: { reusedSnapshotCache: true },
        estimatedTotalWeeklyWage: 950000,
        wageAuditMeta: { complete: true },
        ageStructure: { u21: 5, prime22_28: 16, mature29_31: 5, veteran32Plus: 2 },
        shortages: [{ positionGroup: "边后卫/翼卫", count: 3, recommendedMin: 4 }],
        bloated: [{ positionGroup: "中锋/前锋", count: 5, recommendedMax: 4 }],
        expiringContractsQueue: {
          expiringCount: 2,
          expiringSoon: [{ index: 1, name: "核心中场", daysLeft: 140 }],
          extensionOptionsCount: 1,
          unknownExpiryCount: 0
        },
        highWageVeterans: [{ index: 8, name: "老将B", age: 33, wage: "€120K/周" }],
        recommendations: ["补强边后卫"]
      })
    },
    shortlists: {
      listShortlists: async () => ({ ok: true, count: 1, activeShortlist: "默认", shortlists: [{ index: 0, name: "默认", playerCount: 5, isActive: true }] })
    },
    playerScouting: {
      scoutingKnowledgeAndReports: async () => ({ ok: true, scoutedPlayersCount: 120, scoutingVacancies: 1 })
    },
    match: {
      state: async () => ({ ok: true, inMatch: false, pastMatch: false })
    },
    matchAnalytics: {
      teamStatsAndXg: async () => ({
        ok: true,
        degraded: false,
        matchIdentity: "m:1",
        samplingWindow: { startMinute: 62, endMinute: 62, spannedBoundary: false },
        sideAvailability: { home: { available: true }, away: { available: true } },
        homeTeamLiveStats: { possession: 64, shots: 11, shotsOnTarget: 2, xg: 1.45 },
        awayTeamLiveStats: { possession: 36, shots: 4, shotsOnTarget: 1, xg: 0.42 },
        stats: { MatchScore: "0-0", GoalscorersString: "" }
      }),
      playerLiveStats: async () => ({
        ok: true,
        degraded: false,
        samplingWindow: { startMinute: 62, endMinute: 62, spannedBoundary: false },
        sides: {
          home: {
            available: true,
            players: [
              { index: 0, name: "核心A", Position: "MC", TotalRating: "7.8", Condition: "82", YellowCardedInMatch: "False" },
              { index: 1, name: "后卫B", Position: "DC", TotalRating: "6.2", Condition: "64", YellowCardedInMatch: "True" }
            ]
          },
          away: { available: true, players: [] }
        }
      }),
      momentumAndDugout: async () => ({ ok: true, data: { MatchDugoutEventCount: 5 } })
    },
    pastMatchReport: {
      getPastMatchReport: async ({ fixtureIndex }) => ({
        ok: true,
        found: true,
        fixtureIndex,
        fixtureIdentity: "fix:past-0",
        fixtureMetadata: { homeTeam: "测试俱乐部", awayTeam: "对手X", date: "2026-09-05" },
        availableFixturesCount: 5,
        matchDetails: { IsViewablePastMatch: true, MatchReportData: { score: "2-1" } },
        teamReports: { note: "球队最近一场" }
      })
    },
    datahubTr: {
      getDatahubAnalysis: async () => ({ ok: true, strengths: ["传控稳定"], weaknesses: ["定位球失球"] })
    },
    ...overrides
  };
}

test("workflow-bundles：get_daily_hub_briefing 支持单段降级容错、头条省正文与行动清单", async () => {
  let sawIncludeBodyFalse = false;
  const deps = createStubDeps({
    readInbox: async args => {
      if (args.includeBody === false) sawIncludeBodyFalse = true;
      return createStubDeps().readInbox(args);
    },
    activity: { get: async () => { throw new Error("失业经理无转会活动"); } }
  });
  const bundles = createWorkflowBundleTools(async () => ({}), deps);
  const res = await bundles.getDailyHubBriefing({ inboxLimit: 5 });

  assert.equal(res.ok, true);
  assert.equal(res.readOnly, true);
  assert.equal(sawIncludeBodyFalse, true, "日常晨报扫描头条列表应启用 includeBody:false 省 Token");
  assert.equal(res.degraded, true);
  assert.equal(res.degradedSections[0].section, "transferActivity");
  assert.equal(res.continueFlow.canContinue, false);
  assert.equal(res.inbox.pendingCount, 1);
  assert.ok(res.actionChecklist.some(x => x.includes("必须处理")));
  assert.ok(res.actionChecklist.some(x => x.includes("推进受阻")));
});

test("workflow-bundles：get_matchday_prep_bundle 聚合 FM27 战术有效性 4 支柱、对手情报与最佳首发", async () => {
  const bundles = createWorkflowBundleTools(async () => ({}), createStubDeps());
  const res = await bundles.getMatchdayPrepBundle({ formation: "4-3-3" });

  assert.equal(res.ok, true);
  assert.equal(res.degraded, false);
  assert.equal(res.tactics.tacticalEffectiveness4Pillars.available, true);
  assert.equal(res.tactics.tacticalEffectiveness4Pillars.pillars.tacticalUnderstanding_50pct, "42/50");
  assert.equal(res.tactics.tacticalEffectiveness4Pillars.pillars.playerBuyIn_25pct, "20/25");
  assert.equal(res.opposition.nextOpponent.name, "皇马");
  assert.equal(res.bestXi.reusedSnapshotCache, true);
  assert.ok(res.prepHighlights.length >= 3);
});

test("workflow-bundles：get_transfer_window_briefing 汇总预算、缺口、合同到期队列与短名单", async () => {
  const bundles = createWorkflowBundleTools(async () => ({}), createStubDeps());
  const res = await bundles.getTransferWindowBriefing();

  assert.equal(res.ok, true);
  assert.equal(res.budgets.effectiveBalances.transferBudget, "€15M");
  assert.equal(res.budgets.allocationSession.hasConfirmationToken, true);
  assert.equal(res.squadAuditSummary.expiringContractsQueue.expiringCount, 2);
  assert.equal(res.shortlists.count, 1);
  assert.ok(res.recruitmentPriorities.some(x => x.includes("核心中场")));
  assert.ok(res.recruitmentPriorities.some(x => x.includes("边后卫/翼卫")));
});

test("workflow-bundles：get_match_diagnosis_bundle 自动区分赛中实时诊断与赛后复盘", async () => {
  // 1. 非赛中 -> post_match_review
  const offMatch = createWorkflowBundleTools(async () => ({}), createStubDeps());
  const postRes = await offMatch.getMatchDiagnosisBundle({ fixtureIndex: 0 });
  assert.equal(postRes.ok, true);
  assert.equal(postRes.mode, "post_match_review");
  assert.equal(postRes.fixtureIdentity, "fix:past-0");

  // 2. 赛中 -> live_in_match + 确定性诊断信号（无效控球 + xG 优势 + 低体能 + 黄牌）
  const liveDeps = createStubDeps({
    match: { state: async () => ({ ok: true, inMatch: true, pastMatch: false, minute: 62, continueState: "Playing", isHomeTeam: true }) }
  });
  const inMatch = createWorkflowBundleTools(async () => ({}), liveDeps);
  const liveRes = await inMatch.getMatchDiagnosisBundle();
  assert.equal(liveRes.ok, true);
  assert.equal(liveRes.mode, "live_in_match");
  assert.equal(liveRes.myPlayersSummary.standouts[0].name, "核心A");
  assert.equal(liveRes.myPlayersSummary.yellowCarded.length, 1);
  assert.equal(liveRes.myPlayersSummary.fatigueOrInjuryAlerts.length, 1);
  assert.ok(liveRes.diagnosticSignals.some(s => s.includes("无效控球预警")));
  assert.ok(liveRes.diagnosticSignals.some(s => s.includes("机会质量占优")));
  assert.ok(liveRes.diagnosticSignals.some(s => s.includes("换人建议关注")));
  assert.ok(liveRes.diagnosticSignals.some(s => s.includes("染红风险")));
});

test("fm_discover Token 优化：detail=false 压缩超长描述并直接返回 required、params 与 recommendedBundles", () => {
  const ext = createExtendedTools(async () => ({}));
  const compact = discoverTools(ext.tools, { domain: "all", query: "", detail: false, limit: 80 });
  const verbose = discoverTools(ext.tools, { domain: "all", query: "", detail: true, limit: 80 });

  assert.ok(Array.isArray(compact.recommendedBundles) && compact.recommendedBundles.length === 5);
  const compactBytes = Buffer.byteLength(JSON.stringify(compact), "utf8");
  const verboseBytes = Buffer.byteLength(JSON.stringify(verbose), "utf8");
  assert.ok(compactBytes < verboseBytes * 0.55,
    `detail=false(${compactBytes}B) 体积应显著小于 detail=true(${verboseBytes}B)（至少节省 45%+ Token）`);

  const withReq = discoverTools(ext.tools, { query: "set_mentality", detail: false, limit: 5 });
  const ment = withReq.tools.find(t => t.name === "set_mentality");
  assert.ok(ment, "应匹配到 set_mentality");
  assert.deepEqual(ment.required, ["mentality"]);
  assert.ok(Array.isArray(ment.params) && ment.params.includes("mentality"));

  // 新工具显式元数据检查
  for (const name of ["get_daily_hub_briefing", "get_matchday_prep_bundle", "get_transfer_window_briefing", "get_match_diagnosis_bundle", "batch_read"]) {
    const meta = resolveToolMetadata(name);
    assert.equal(meta.readOnly, true, `${name} 必须标记为只读`);
    assert.equal(meta.exclusiveState, false, `${name} 必须为非独占状态`);
  }
});

test("job-advert-tools 加固：空候选人/身份失配/缺部门协议/调岗协议均安全门控零派发", async () => {
  let eventDispatched = 0;
  let seq = 0;
  const values = new Map();
  const mockCall = async route => {
    if (route.startsWith("/api/v1/internal/event")) {
      eventDispatched++;
      throw new Error("未核验的职员写操作严禁派发事件");
    }
    if (route.startsWith("/api/v1/internal/registry")) return { ok: true, items: [] };
    if (route.startsWith("/api/v1/live/properties")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      return { ok: true, properties: [{ id: ++seq, name: `${q.get("filter")}:m`, contexts: [] }] };
    }
    if (route.startsWith("/api/v1/live/open")) {
      const handle = `h_${++seq}`;
      values.set(handle, { kind: "list", count: 0, items: [] });
      return { ok: true, handle };
    }
    if (route.startsWith("/api/v1/live/read")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      return { ok: true, status: "ready", value: values.get(q.get("handle")) ?? null };
    }
    if (route.startsWith("/api/v1/live/close")) return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const jobTools = createJobAdvertTools(mockCall);

  const r1 = await jobTools.offerStaffInterview({ candidateIndex: 0 });
  assert.equal(r1.ok, false);
  assert.equal(r1.blockedReason, "no_verified_staff_candidates");

  const r2 = await jobTools.makeStaffContractDecision({ decisionIndex: 0 });
  assert.equal(r2.ok, false);
  assert.equal(r2.blockedReason, "no_verified_staff_candidates");

  const r3 = await jobTools.reviewOrSelectApplicant({ action: "select", candidateIndex: 0 });
  assert.equal(r3.ok, false);
  assert.equal(r3.blockedReason, "no_verified_staff_candidates");

  const r4 = await jobTools.postJobAdvert({ department: "scouting", roleId: 0 });
  assert.equal(r4.ok, false);
  assert.equal(r4.dispatched, false);

  const r5 = await jobTools.promoteOrReassignStaff({ action: "reassign", staffIndex: 1, targetRoleId: 3 });
  assert.equal(r5.ok, false);
  assert.equal(r5.blockedReason, "staff_role_change_protocol_not_verified");

  assert.equal(eventDispatched, 0, "全部未绑定/空候选的职员写调用均应保持 0 次事件派发");
});

test("get_squad_snapshot 并发微批保持精确下标顺序且零句柄泄漏", async () => {
  let seq = 0;
  const openHandles = new Set();
  const handleMeta = new Map();

  const mockCall = async route => {
    if (route.startsWith("/api/v1/live/properties")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      const filter = q.get("filter") || "";
      return { ok: true, properties: [{ id: ++seq, name: `${filter}:mock`, contexts: [] }] };
    }
    if (route.startsWith("/api/v1/live/open")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      const handle = `h_${++seq}`;
      openHandles.add(handle);
      handleMeta.set(handle, { source: q.get("source"), path: q.get("path") || "", prop: Number(q.get("property")) });
      return { ok: true, handle };
    }
    if (route.startsWith("/api/v1/live/read")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      const h = q.get("handle");
      const meta = handleMeta.get(h) || {};
      if (meta.source === "human" && meta.path === "") {
        return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference", identity: "team:1" } };
      }
      if (meta.source === "game") {
        return { ok: true, status: "ready", value: { kind: "scalar", type: "System.String", value: "2026-09-12" } };
      }
      if (meta.path === "" && meta.source?.startsWith("h_")) {
        // Players 列表返回 10 人（跨 3 个 4 人微批）
        const items = Array.from({ length: 10 }, (_, idx) => ({ kind: "reference", identity: `p:${idx}` }));
        return { ok: true, status: "ready", value: { kind: "list", count: 10, items } };
      }
      // 每个球员标量按 path 返回对应值，随机微延迟检验乱序下最终 rows 顺序稳定性
      await new Promise(r => setTimeout(r, (10 - Number(meta.path || 0)) * 2));
      return { ok: true, status: "ready", value: { kind: "scalar", type: "System.String", value: `val_${meta.path}` } };
    }
    if (route.startsWith("/api/v1/live/close")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      openHandles.delete(q.get("handle"));
      return { ok: true };
    }
    throw new Error(`未预期路由: ${route}`);
  };

  const snapTools = createSquadSnapshotTools(mockCall);
  const res = await snapTools.getSquadSnapshot({ offset: 0, limit: 10, includeContractAndStars: false, includeAvailability: false });
  assert.equal(res.ok, true);
  assert.equal(res.returned, 10);
  assert.deepEqual(res.players.map(p => p.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "微批并发后仍须严格按 index 升序返回");
  assert.deepEqual(res.players.map(p => p.personIdentity), Array.from({ length: 10 }, (_, i) => `p:${i}`));
  assert.equal(openHandles.size, 0, `快照结束后应关闭全部临时句柄，当前残留: ${openHandles.size}`);
});

test("MCP stdio 端到端：batch_read 支持并发只读，严格拒绝写操作、exclusiveState 与嵌套调用", async () => {
  let httpHits = 0;
  const mockServer = http.createServer((req, res) => {
    httpHits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/health") {
      res.end(JSON.stringify({ ok: true, version: "1.1.0", authRequired: false }));
    } else if (req.url === "/api/v1/capabilities") {
      res.end(JSON.stringify({ ok: true, version: "1.1.0", capabilities: ["live"] }));
    } else if (req.url.startsWith("/api/v1/live/properties")) {
      res.end(JSON.stringify({ ok: true, properties: [{ id: 1, name: "Team:mock", contexts: [] }] }));
    } else {
      res.end(JSON.stringify({ ok: true, route: req.url }));
    }
  });
  await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
  const { port } = mockServer.address();

  const child = spawn(process.execPath, [path.join(ROOT, "mcp", "fm-assistant-mcp.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FM_ASSISTANT_URL: `http://127.0.0.1:${port}`,
      FM_ASSISTANT_TOKEN: "mock-token",
      FM_ASSISTANT_LOG_FILE: path.join(os.tmpdir(), `fm-batch-test-${Date.now()}.log`)
    }
  });

  const responses = new Map();
  let buf = "";
  child.stdout.on("data", chunk => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    }
  });

  const sendReq = (id, method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const timer = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(timer);
          resolve(responses.get(id));
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`timeout id=${id}`));
        }
      }, 20);
    });
  };

  try {
    // 1. 拒绝写操作混入（0 HTTP 请求）
    const hitsBefore = httpHits;
    const rejectWrite = await sendReq(1, "tools/call", {
      name: "fm_call",
      arguments: { action: "batch_read", params: { calls: [{ action: "set_mentality", params: { mentality: "进攻" } }] } }
    });
    assert.equal(rejectWrite.result.isError, true);
    assert.match(rejectWrite.result.content[0].text, /仅允许只读工具/);
    assert.equal(httpHits, hitsBefore, "拦截写工具时应零 HTTP 请求");

    // 2. 拒绝 exclusiveState 工具（如 search_players / get_shortlist_players）
    const rejectExcl = await sendReq(2, "tools/call", {
      name: "fm_call",
      arguments: { action: "batch_read", params: { calls: [{ action: "search_players", params: { maxAge: 21 } }] } }
    });
    assert.equal(rejectExcl.result.isError, true);
    assert.match(rejectExcl.result.content[0].text, /独占共享状态工具/);

    // 3. 拒绝嵌套 batch_read
    const rejectNested = await sendReq(3, "tools/call", {
      name: "fm_call",
      arguments: { action: "batch_read", params: { calls: [{ action: "batch_read", params: { calls: [] } }] } }
    });
    assert.equal(rejectNested.result.isError, true);
    assert.match(rejectNested.result.content[0].text, /禁止嵌套/);

    // 4. 合法多只读并发成功返回
    const okBatch = await sendReq(4, "tools/call", {
      name: "fm_call",
      arguments: {
        action: "batch_read",
        params: {
          calls: [
            { action: "plugin_health", alias: "health" },
            { action: "get_plugin_capabilities", alias: "caps" }
          ]
        }
      }
    });
    assert.equal(okBatch.result.isError, undefined);
    const parsed = JSON.parse(okBatch.result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.succeeded, 2);
    assert.equal(parsed.results[0].alias, "health");
    assert.equal(parsed.results[1].alias, "caps");
  } finally {
    child.stdin.end();
    child.kill();
    mockServer.close();
  }
});
