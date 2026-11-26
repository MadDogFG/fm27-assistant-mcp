import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 比赛实时数据分析与事件、xG、动量、传球网络、球员统计只读工具组（Review #44/#46/#53）
export function createMatchAnalyticsTools(call) {
  const client = createLiveClient(call);
  const { getPropertyMap } = createPropertyRegistryCache(call);

  // 清理 FM 原生富文本超链接标记（\u0001...\u0002文本\u0001）
  const stripFmTags = text => clean(text).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();

  // 递归解码 SI.Bindable.DynamicReference 的 0x... 字段名为可读属性名（保留无法解码的原始键）
  function decodeValue(val, idMap) {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val;
    if (val.kind === "scalar") return val.type === "System.String" ? stripFmTags(val.value) : val.value;
    if (val.kind === "list" && Array.isArray(val.items)) {
      return { count: val.count, truncated: Boolean(val.truncated), items: val.items.map(x => decodeValue(x, idMap)) };
    }
    if (val.kind === "record" && val.fields) {
      const out = {};
      for (const [key, fieldVal] of Object.entries(val.fields)) {
        let name = key;
        if (key.startsWith("0x")) {
          const parsed = Number.parseInt(key, 16);
          if (idMap.has(parsed)) name = idMap.get(parsed);
        }
        out[name] = decodeValue(fieldVal, idMap);
      }
      return out;
    }
    return val;
  }

  async function readMatchProps(scope, names, contexts, idMap) {
    const out = {};
    for (const name of names) {
      const sub = await scope.subscribeOptional("match", name, contexts, 1500);
      out[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      if (sub.handle) await scope.release(sub.handle);
    }
    return out;
  }

  async function requireInMatch() {
    const state = await call("/api/v1/match/state");
    if (!state?.inMatch) {
      throw new Error("当前不在比赛中，无法读取实时比赛分析数据。");
    }
    return state;
  }

  // 构建采样时间窗元数据（Review #53），明确比赛身份、开始/结束分钟与阶段跨度
  async function buildSamplingWindow(startState, startedAtMs) {
    const endState = await call("/api/v1/match/state").catch(() => null);
    const startMinute = startState?.minute ?? null;
    const endMinute = endState?.minute ?? startMinute;
    const startPhase = startState?.continueState ?? null;
    const endPhase = endState?.continueState ?? startPhase;
    const matchIdentity = startState?.matchIdentity ?? startState?.fixtureIdentity ?? endState?.matchIdentity ?? null;
    const spannedBoundary =
      (startMinute !== null && endMinute !== null && startMinute !== endMinute) ||
      (startPhase !== null && endPhase !== null && startPhase !== endPhase) ||
      (startState?.matchIdentity && endState?.matchIdentity && startState.matchIdentity !== endState.matchIdentity);
    return {
      matchIdentity,
      samplingWindow: {
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date().toISOString(),
        startMinute,
        endMinute,
        startContinueState: startPhase,
        endContinueState: endPhase,
        spannedBoundary: Boolean(spannedBoundary)
      }
    };
  }

  // MAT-R10 / MAT-R11 / MAT-R28 (Review #44/#53): 球队实时统计与 xG；
  // 严禁在实时 Stats 未就绪时回退读取已知恒为 0/50% 的静态 HomeShots/HomePossession 伪装为实时统计
  async function teamStatsAndXg({ includeShotMap = false, compact = true } = {}) {
    const startedAtMs = Date.now();
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team", undefined, 1200);
      const contexts = { human: { source: "human" }, Human: { source: "human" }, match: { source: "match" }, Match: { source: "match" } };
      if (team.handle) {
        const comps = await scope.subscribeOptional({ source: team.handle }, "CurrentComps", { human: { source: "human" }, team: { source: team.handle } }, 1000);
        if (comps.read?.value?.items?.length) contexts.Competition = { source: comps.handle, path: "0" };
      }

      const [homeLiveSub, awayLiveSub] = await Promise.all([
        scope.subscribeOptional("match", "Stats", { ...contexts, isHomeTeam: true }, 1500),
        scope.subscribeOptional("match", "Stats", { ...contexts, isHomeTeam: false }, 1500)
      ]);
      const homeLive = homeLiveSub.handle ? decodeValue(homeLiveSub.read?.value ?? null, idMap) : null;
      const awayLive = awayLiveSub.handle ? decodeValue(awayLiveSub.read?.value ?? null, idMap) : null;
      const homeStatus = homeLive && typeof homeLive === "object"
        ? { available: true, source: "live_match_stats", unavailable: null }
        : { available: false, source: "live_match_stats", unavailable: homeLiveSub.unavailable || "stats_unavailable" };
      const awayStatus = awayLive && typeof awayLive === "object"
        ? { available: true, source: "live_match_stats", unavailable: null }
        : { available: false, source: "live_match_stats", unavailable: awayLiveSub.unavailable || "stats_unavailable" };
      if (homeLiveSub.handle) await scope.release(homeLiveSub.handle).catch(() => {});
      if (awayLiveSub.handle) await scope.release(awayLiveSub.handle).catch(() => {});

      const fields = [
        "MatchScore", "GoalscorersString",
        "MatchLastFiveMinutesPossession",
        "Attendance", "AnnouncedAttendance", "XgValue"
      ];
      if (includeShotMap) fields.push("HomeShotMap", "AwayShotMap");
      const data = await readMatchProps(scope, fields, { ...contexts, isHomeTeam: state.isHomeTeam }, idMap);

      // 按各自通道真实可用状态填充兼容字段，绝不拿恒为 0/50% 的静态字段冒充缺失侧数据
      if (homeStatus.available) {
        data.HomePossession = homeLive.BallShare ?? homeLive.TotalPossession ?? null;
        data.HomeShots = homeLive.TotalShots ?? null;
        data.HomeShotsOnTarget = homeLive.ShotsOnTarget ?? null;
        data.HomeCorners = homeLive.Corners ?? null;
        data.HomeFouls = homeLive.FoulsMade ?? null;
      }
      if (awayStatus.available) {
        data.AwayPossession = awayLive.BallShare ?? awayLive.TotalPossession ?? null;
        data.AwayShots = awayLive.TotalShots ?? null;
        data.AwayShotsOnTarget = awayLive.ShotsOnTarget ?? null;
        data.AwayCorners = awayLive.Corners ?? null;
        data.AwayFouls = awayLive.FoulsMade ?? null;
      }

      // 紧凑模式下保留 { unavailable } 诊断，绝不把 unavailable 转成一堆 null 误导为“0 xG”（Review #44）
      if (compact && data.XgValue && typeof data.XgValue === "object" && !data.XgValue.unavailable) {
        data.XgValue = {
          xg: data.XgValue.XgValue ?? null,
          score: data.XgValue.MatchScore ?? null,
          fixture: data.XgValue.Fixture ?? null,
          summary: data.XgValue.PerformanceSummary ?? null
        };
      }

      const pickSummary = s => {
        if (!s || typeof s !== "object") return null;
        return {
          possession: s.BallShare ?? s.TotalPossession ?? null,
          shots: s.TotalShots ?? null,
          shotsOnTarget: s.ShotsOnTarget ?? null,
          xg: s.ExpectedGoals != null ? Number(Number(s.ExpectedGoals).toFixed(2)) : null,
          npxg: s.NonPenaltyExpectedGoals != null ? Number(Number(s.NonPenaltyExpectedGoals).toFixed(2)) : null,
          chancesCreated: s.ChancesCreated ?? null,
          corners: s.Corners ?? null,
          fouls: s.FoulsMade ?? null,
          passAttempts: s.PassAttempts ?? null,
          passCompleted: s.PassCompleted ?? null,
          passPct: s.PassCompletionPercentage ?? null,
          progressivePasses: s.ProgressivePasses ?? null,
          finalThirdPasses: s.FinalThirdPasses ?? null,
          ppda: s.OppositionPassesPerDefensiveAction != null ? Number(Number(s.OppositionPassesPerDefensiveAction).toFixed(1)) : null,
          tacklesCompleted: s.TackleCompleted ?? null,
          yellowCards: s.YellowCards ?? null,
          redCards: s.RedCards ?? null,
          avgRating: s.AverageRatingFloat != null ? Number(Number(s.AverageRatingFloat).toFixed(2)) : null
        };
      };

      const refSub = await scope.subscribeOptional("match", "MatchReferee", contexts, 1000);
      let refereeName = null;
      if (refSub.handle) {
        const nameSub = await scope.subscribeOptional({ source: refSub.handle }, "Name", {}, 800);
        refereeName = stripFmTags(scalar(nameSub.read?.value)) || null;
      }
      const timing = await buildSamplingWindow(state, startedAtMs);
      const degraded = !homeStatus.available || !awayStatus.available;
      return {
        ok: true,
        readOnly: true,
        degraded,
        minute: state.minute,
        continueState: state.continueState,
        isHomeTeam: state.isHomeTeam,
        ...timing,
        refereeName,
        sideAvailability: { home: homeStatus, away: awayStatus },
        homeTeamLiveStats: homeStatus.available ? (compact ? pickSummary(homeLive) : homeLive) : { unavailable: homeStatus.unavailable },
        awayTeamLiveStats: awayStatus.available ? (compact ? pickSummary(awayLive) : awayLive) : { unavailable: awayStatus.unavailable },
        stats: data
      };
    });
  }

  // MAT-R12 / MAT-R29 / MAT-R09: 比赛动量趋势与教练席实时事件时间线
  async function momentumAndDugout() {
    const startedAtMs = Date.now();
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team", {}, 800);
      const teamCtx = team.handle ? { source: team.handle } : { source: "human", path: "Team" };
      const contexts = {
        human: { source: "human" }, Human: { source: "human" },
        match: { source: "match" }, Match: { source: "match" },
        team: teamCtx, Team: teamCtx,
      };
      const data = await readMatchProps(scope, [
        "MatchMomentum", "MatchDugoutEventCount", "MatchDugoutTimelineEvents", "GoalscorersString"
      ], contexts, idMap);
      const timing = await buildSamplingWindow(state, startedAtMs);
      return { ok: true, readOnly: true, minute: state.minute, continueState: state.continueState, ...timing, data };
    });
  }

  // MAT-R19 / MAT-R20 / MAT-R21: 双方传球分布图、传球网络起止坐标及攻防区域分布
  async function passingNetwork() {
    const startedAtMs = Date.now();
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const contexts = { human: { source: "human" }, Human: { source: "human" }, match: { source: "match" } };
      const data = await readMatchProps(scope, ["HomePassMap", "AwayPassMap", "ActionZonesVisualisation"], contexts, idMap);
      const timing = await buildSamplingWindow(state, startedAtMs);
      return { ok: true, readOnly: true, minute: state.minute, continueState: state.continueState, ...timing, passing: data };
    });
  }

  // MAT-R13 / MAT-R14 / MAT-R19 / MAT-R25 / MAT-R26 (Review #44/#53): 球员实时统计，未就绪侧显式标记 available:false（不再误报 0 名球员）
  async function playerLiveStats({ side = "both", limit = 15, compact = true } = {}) {
    const startedAtMs = Date.now();
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    const sides = side === "both" ? ["home", "away"] : [side === "away" ? "away" : "home"];
    const compactStatFields = [
      "SquadNumber", "Position", "TotalRating", "Goals", "Assists",
      "YellowCardedInMatch", "RedCardedInMatch", "MatchTime",
      "ShotAttempts", "ShotsOnTarget", "ExpectedGoals", "ExpectedAssists",
      "PassAttempts", "PassCompletionPercentage", "KeyPasses",
      "TackleCompleted", "Interceptions", "DistanceRan", "TotalSaves"
    ];
    const fullStatFields = [
      ...compactStatFields,
      "IncidentType", "NonPenaltyExpectedGoals", "PassCompleted",
      "ShortPassesAttempted", "ShortPassesCompleted", "ShortPassCompletionPercentage",
      "MediumPassesAttempted", "MediumPassesCompleted", "MediumPassCompletionPercentage",
      "LongPassesAttempted", "LongPassesCompleted", "LongPassCompletionPercentage",
      "OpenPlayKeyPasses", "ChancesCreated", "ClearCutChances",
      "DribblesMade", "ProgressivePasses", "PressuresCompleted",
      "DefensiveActions", "TackleAttempts", "Clearances",
      "Sprints", "FoulsMade", "FoulsAgainst"
    ];
    const statFields = compact ? compactStatFields : fullStatFields;

    const result = {};
    let degraded = false;
    for (const s of sides) {
      const isHome = s === "home";
      result[s] = await client.scope(async scope => {
        const team = await scope.subscribeOptional("human", "Team", {}, 800);
        const teamCtx = team.handle ? { source: team.handle } : { source: "human", path: "Team" };
        const listSub = await scope.subscribeOptional("match", "PlayerMatchStats", { isHomeTeam: isHome, IsHomeTeam: isHome }, 1500);
        if (!listSub.handle || listSub.read?.value?.kind !== "list") {
          degraded = true;
          return {
            available: false,
            unavailable: listSub.unavailable || "player_match_stats_not_ready",
            count: null,
            players: []
          };
        }
        const items = listSub.read.value.items || [];
        const totalCount = listSub.read.value.count ?? items.length;
        const count = Math.min(items.length, Math.max(1, Number(limit) || 15));
        const players = [];

        for (let i = 0; i < count; i++) {
          const pRef = { source: listSub.handle, path: String(i) };
          const playerRow = { index: i, identity: items[i]?.identity || null };
          const playerSub = await scope.subscribeOptional(pRef, "Player", {}, 700);
          if (playerSub.handle) {
            const pCtx = { human: { source: "human" }, team: teamCtx, Team: teamCtx };
            const nameR = await scope.readAndRelease({ source: playerSub.handle }, "Name", {}, 700);
            playerRow.name = nameR.scalar || null;
            for (const pf of ["Condition", "IsInjured", "Sharpness", "Morale"]) {
              const pfR = await scope.readAndRelease({ source: playerSub.handle }, pf, pCtx, 500);
              if (pfR.ok && pfR.value !== null) playerRow[pf] = decodeValue(pfR.value, idMap);
            }
            await scope.release(playerSub.handle);
          }
          for (const f of statFields) {
            const fR = await scope.readAndRelease(pRef, f, {}, 500);
            if (fR.ok && fR.value !== null) {
              const decoded = decodeValue(fR.value, idMap);
              if (!compact || (decoded !== "0" && decoded !== 0 && decoded !== "False" && decoded !== false && decoded !== "")) {
                playerRow[f] = decoded;
              }
            }
          }
          players.push(playerRow);
        }
        return { available: true, count: totalCount, returnedCount: players.length, players };
      });
    }
    const timing = await buildSamplingWindow(state, startedAtMs);
    return {
      ok: true,
      readOnly: true,
      degraded,
      compact: Boolean(compact),
      minute: state.minute,
      continueState: state.continueState,
      ...timing,
      sides: result
    };
  }

  // MAT-R22: 指定球员热区图数据
  async function playerHeatMap({ side = "home", playerIndex = 0 } = {}) {
    const startedAtMs = Date.now();
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    const isHome = side !== "away";
    return client.scope(async scope => {
      const listSub = await scope.subscribeOptional("match", "PlayerMatchStats", { isHomeTeam: isHome }, 1500);
      if (!listSub.handle || listSub.read?.value?.kind !== "list") {
        throw new Error(`PlayerMatchStats（${isHome ? "home" : "away"}）通道暂未就绪：${listSub.unavailable || "no_handle"}`);
      }
      const items = listSub.read?.value?.items || [];
      if (playerIndex < 0 || playerIndex >= items.length) {
        throw new Error(`球员索引越界: ${playerIndex} (共有 ${items.length} 名球员)`);
      }
      const pRef = { source: listSub.handle, path: String(playerIndex) };
      const playerSub = await scope.subscribeOptional(pRef, "Player", {}, 800);
      if (!playerSub.handle) throw new Error("无法读取目标球员 Person 引用。");
      const nameSub = await scope.subscribeOptional({ source: playerSub.handle }, "Name", {}, 800);
      const propName = isHome ? "HomeHeatMap" : "AwayHeatMap";
      const hmSub = await scope.subscribeOptional("match", propName, {
        Person: { source: playerSub.handle },
        PossessionMode: 0,
        human: { source: "human" },
      }, 1200);
      const timing = await buildSamplingWindow(state, startedAtMs);
      return {
        ok: true,
        readOnly: true,
        minute: state.minute,
        ...timing,
        side: isHome ? "home" : "away",
        playerIndex,
        playerName: stripFmTags(scalar(nameSub.read?.value)) || null,
        heatMap: hmSub.handle ? decodeValue(hmSub.read?.value, idMap) : { unavailable: hmSub.unavailable || "no_handle" },
      };
    });
  }

  return { teamStatsAndXg, momentumAndDugout, passingNetwork, playerLiveStats, playerHeatMap };
}
