import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 比赛实时数据分析与事件、xG、动量、传球网络、球员统计只读工具组
export function createMatchAnalyticsTools(call) {
  const client = createLiveClient(call);
  let cachedIdMap = null;

  async function getPropertyMap() {
    if (cachedIdMap) return cachedIdMap;
    try {
      const reg = await call("/api/v1/internal/registry?kind=properties");
      cachedIdMap = new Map((reg?.items || []).map(item => [item.id, item.name]));
    } catch {
      cachedIdMap = new Map();
    }
    return cachedIdMap;
  }

  // 清理 FM 原生富文本超链接标记（\u0001...\u0002文本\u0001）
  const stripFmTags = text => clean(text).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();

  // 递归解码 SI.Bindable.DynamicReference 的 0x... 字段名为可读属性名
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

  // MAT-R10 / MAT-R11 / MAT-R28: 球队实时统计、xG 与射门图、比赛基础观众/比分/裁判
  async function teamStatsAndXg({ includeShotMap = false } = {}) {
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team", undefined, 1200);
      const contexts = { human: { source: "human" }, Human: { source: "human" }, match: { source: "match" }, Match: { source: "match" } };
      if (team.handle) {
        const comps = await scope.subscribeOptional({ source: team.handle }, "CurrentComps", { human: { source: "human" }, team: { source: team.handle } }, 1000);
        if (comps.read?.value?.items?.length) contexts.Competition = { source: comps.handle, path: "0" };
      }
      const fields = [
        "MatchScore", "GoalscorersString",
        "HomePossession", "AwayPossession", "MatchLastFiveMinutesPossession",
        "HomeShots", "AwayShots", "HomeShotsOnTarget", "AwayShotsOnTarget",
        "HomeCorners", "AwayCorners", "HomeFouls", "AwayFouls",
        "Attendance", "AnnouncedAttendance", "XgValue"
      ];
      if (includeShotMap) fields.push("HomeShotMap", "AwayShotMap");
      const data = await readMatchProps(scope, fields, { ...contexts, isHomeTeam: state.isHomeTeam }, idMap);
      const refSub = await scope.subscribeOptional("match", "MatchReferee", contexts, 1000);
      let refereeName = null;
      if (refSub.handle) {
        const nameSub = await scope.subscribeOptional({ source: refSub.handle }, "Name", {}, 800);
        refereeName = stripFmTags(scalar(nameSub.read?.value)) || null;
      }
      return {
        ok: true, readOnly: true, minute: state.minute, continueState: state.continueState,
        isHomeTeam: state.isHomeTeam, refereeName, stats: data
      };
    });
  }

  // MAT-R12 / MAT-R29 / MAT-R09: 比赛动量趋势与教练席实时事件时间线
  async function momentumAndDugout() {
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
      return { ok: true, readOnly: true, minute: state.minute, continueState: state.continueState, data };
    });
  }

  // MAT-R19 / MAT-R20 / MAT-R21: 双方传球分布图、传球网络起止坐标及攻防区域分布
  async function passingNetwork() {
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const contexts = { human: { source: "human" }, Human: { source: "human" }, match: { source: "match" } };
      const data = await readMatchProps(scope, ["HomePassMap", "AwayPassMap", "ActionZonesVisualisation"], contexts, idMap);
      return { ok: true, readOnly: true, minute: state.minute, continueState: state.continueState, passing: data };
    });
  }

  // MAT-R13 / MAT-R14 / MAT-R19 / MAT-R25 / MAT-R26: 双方球员比赛评分与完整个人实时统计（默认 both 同时返回主客队）
  async function playerLiveStats({ side = "both", limit = 15, compact = true } = {}) {
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
    for (const s of sides) {
      const isHome = s === "home";
      result[s] = await client.scope(async scope => {
        const team = await scope.subscribeOptional("human", "Team", {}, 800);
        const teamCtx = team.handle ? { source: team.handle } : { source: "human", path: "Team" };
        const listSub = await scope.subscribeOptional("match", "PlayerMatchStats", { isHomeTeam: isHome, IsHomeTeam: isHome }, 1500);
        const items = listSub.read?.value?.items || [];
        const totalCount = items.length;
        const count = Math.min(totalCount, Math.max(1, Number(limit) || 15));
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
        return { count: totalCount, players };
      });
    }
    return { ok: true, readOnly: true, compact: Boolean(compact), minute: state.minute, continueState: state.continueState, sides: result };
  }

  // MAT-R22: 指定球员热区图数据
  async function playerHeatMap({ side = "home", playerIndex = 0 } = {}) {
    const state = await requireInMatch();
    const idMap = await getPropertyMap();
    const isHome = side !== "away";
    return client.scope(async scope => {
      const listSub = await scope.subscribeOptional("match", "PlayerMatchStats", { isHomeTeam: isHome }, 1500);
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
      return {
        ok: true,
        readOnly: true,
        minute: state.minute,
        side: isHome ? "home" : "away",
        playerIndex,
        playerName: stripFmTags(scalar(nameSub.read?.value)) || null,
        heatMap: hmSub.handle ? decodeValue(hmSub.read?.value, idMap) : { unavailable: hmSub.unavailable || "no_handle" },
      };
    });
  }

  return { teamStatsAndXg, momentumAndDugout, passingNetwork, playerLiveStats, playerHeatMap };
}
