import { createLiveClient, clean } from "./live-client.mjs";

// 历史比赛事件、报告与评分只读工具组（MAT-R17）
export function createPastMatchReportTools(call) {
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

  async function getPastMatchReport({ fixtureIndex = 0 } = {}) {
    if (!Number.isInteger(fixtureIndex) || fixtureIndex < 0) {
      throw new Error("fixtureIndex 必须为非负整数。");
    }
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const baseCtx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        TeamRequestingReport: { source: team.handle },
        ID: fixtureIndex,
      };

      const fixturesSub = await scope.subscribeOptional({ source: team.handle }, "DataHubLastMatchFixtureDropdown", baseCtx, 1200);
      const fixturesList = fixturesSub.handle ? decodeValue(fixturesSub.read?.value, idMap) : null;

      // 尝试从赛果下拉中定位类型为 FM.UI.FixtureReference 的历史比赛引用
      let matchRef = null;
      let matchCtx = { ...baseCtx };
      if (fixturesSub.handle && Array.isArray(fixturesSub.read?.value?.items) && fixturesSub.read.value.items.length > fixtureIndex) {
        const row = fixturesSub.read.value.items[fixtureIndex];
        const fields = row?.fields || {};
        const fixEntry = Object.entries(fields).find(([, v]) => v?.type === "FM.UI.FixtureReference" || v?.kind === "reference");
        if (fixEntry && fixEntry[1]?.identity) {
          matchRef = { source: fixturesSub.handle, path: `${fixtureIndex}/${fixEntry[0]}` };
          matchCtx = { ...baseCtx, fixture: matchRef, Fixture: matchRef, match: matchRef, Match: matchRef, InPossession: true };
        }
      }

      const teamReports = {};
      for (const prop of ["LastMatchAnalysis", "IsFixtureResults"]) {
        const sub = await scope.subscribeOptional({ source: team.handle }, prop, matchCtx, 1200);
        teamReports[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      }

      const matchDetails = {};
      if (matchRef) {
        for (const prop of ["MatchReportData", "IsViewablePastMatch", "PastMatchHighlightsDropdown", "PastMatchPlayerTacticData", "PastMatchOOPPlayerDataAvailable"]) {
          const sub = await scope.subscribeOptional(matchRef, prop, matchCtx, 1200);
          matchDetails[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
        }
      }

      return {
        ok: true,
        readOnly: true,
        fixtureIndex,
        availableFixturesCount: fixturesList?.count ?? 0,
        fixtures: fixturesList,
        teamReports,
        matchDetails,
      };
    });
  }

  return { getPastMatchReport };
}
