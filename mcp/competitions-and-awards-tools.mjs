import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 赛事最佳阵容/奖项/统计榜/抽签及国家页只读工具组（MGR-R10 / MGR-R17 / MGR-R18）
export function createCompetitionsAndAwardsTools(call) {
  const client = createLiveClient(call);
  let cachedIdMap = null;

  async function getPropertyMap() {
    if (cachedIdMap) return cachedIdMap;
    try {
      const reg = await call("/api/v1/internal/registry?kind=properties");
      cachedIdMap = new Map((reg?.items || []).map(x => [x.id, x.name]));
    } catch {
      cachedIdMap = new Map();
    }
    return cachedIdMap;
  }

  const stripTags = text => clean(text).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();

  function decodeValue(val, idMap) {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val;
    if (val.kind === "scalar") return val.type === "System.String" ? stripTags(val.value) : val.value;
    if (val.kind === "list" && Array.isArray(val.items)) {
      return { count: val.count, items: val.items.map(x => decodeValue(x, idMap)) };
    }
    if (val.kind === "record" && val.fields) {
      const out = {};
      for (const [k, v] of Object.entries(val.fields)) {
        const name = k.startsWith("0x") ? (idMap.get(Number.parseInt(k, 16)) || k) : k;
        out[name] = decodeValue(v, idMap);
      }
      return out;
    }
    return val;
  }

  async function readProps(scope, source, names, contexts, idMap) {
    const out = {};
    for (const name of names) {
      const sub = await scope.subscribeOptional(source, name, contexts, 1200);
      out[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
    }
    return out;
  }

  // MGR-R17 / MGR-R10: 本队参赛赛事的最佳阵容、奖项、球员/球队统计榜与抽签
  async function competitionAwardsAndStats({ compIndex = 0 } = {}) {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const baseCtx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const comps = await scope.subscribeOptional({ source: team.handle }, "CurrentComps", baseCtx, 1500);
      const items = comps.read?.value?.items || [];
      if (compIndex < 0 || compIndex >= items.length) {
        throw new Error(`赛事索引越界: ${compIndex} (共 ${items.length} 项赛事)`);
      }
      const cRef = { source: comps.handle, path: String(compIndex) };
      const ctx = { ...baseCtx, Competition: cRef, competition: cRef, Type: 0 };
      const data = await readProps(scope, cRef, [
        "Name",
        "MediaDreamTeam",
        "CanViewAwards",
        "CurrentAwardList",
        "AwardList",
        "LatestTeamOfTheWeekAwardData",
        "LatestPlayerOfTheMonthAwardData",
        "LatestManagerOfTheMonthAwardData",
        "PlayerTopStats",
        "TopTeamStat",
        "XGStats",
      ], ctx, idMap);
      const draws = await scope.subscribeOptional({ source: team.handle }, "CompetitionDraws", ctx, 1000);
      return {
        ok: true,
        readOnly: true,
        compIndex,
        totalComps: items.length,
        competitionIdentity: items[compIndex]?.identity || null,
        competition: data,
        draws: draws.handle ? decodeValue(draws.read?.value ?? null, idMap) : { unavailable: draws.unavailable || "no_handle" },
      };
    });
  }

  // MGR-R18 / MGR-R19: 国家页（国家队容器、可玩联赛、赛事层级与世界排名）与生涯载入国家/联赛/数据库信息
  async function nationsAndInternationalOverview() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const ctx = { human: { source: "human" }, Human: { source: "human" }, Gender: 0, activenations: true, onepergender: true };
      const gameData = await readProps(scope, "game", [
        "PlayableNationalTeams",
        "PlayableNations",
        "ActiveNationsCount",
        "ActiveLeaguesCount",
        "ActiveDomesticLeaguesCount",
        "NationalRuleGroups",
        "InternationalRuleGroups",
        "NationDivisionLevelsString",
        "EstimatedPlayerCount",
        "CurrentVersion",
      ], ctx, idMap);
      const humanData = await readProps(scope, "human", [
        "IsManagingNationalTeam",
        "HighestWorldRanking",
        "NationalTeam",
      ], ctx, idMap);
      let nationData = null;
      const club = await scope.subscribeOptional("human", "Club", ctx, 800);
      if (club.handle) {
        const nat = await scope.subscribeOptional(club.handle, "Nation", { ...ctx, club: { source: club.handle }, Club: { source: club.handle } }, 800);
        if (nat.handle) {
          nationData = await readProps(scope, nat.handle, [
            "Name",
            "ThreeLetterName",
            "TeamContainer",
            "PlayableLeagues",
            "DivisionList",
            "CompetitionTierList",
          ], { ...ctx, nation: { source: nat.handle }, Nation: { source: nat.handle } }, idMap);
        }
      }
      return { ok: true, readOnly: true, game: gameData, human: humanData, nationPage: nationData };
    });
  }

  return { competitionAwardsAndStats, nationsAndInternationalOverview };
}
