import { createLiveClient, clean } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 历史比赛事件、报告与评分只读工具组（MAT-R17，Review #45/#46）
export function createPastMatchReportTools(call) {
  const client = createLiveClient(call);
  const { getPropertyMap } = createPropertyRegistryCache(call);

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
      const rawItems = Array.isArray(fixturesSub.read?.value?.items) ? fixturesSub.read.value.items : [];
      const availableFixturesCount = fixturesList?.count ?? rawItems.length;

      if (!fixturesSub.handle || fixtureIndex >= rawItems.length) {
        return {
          ok: false,
          found: false,
          readOnly: true,
          fixtureIndex,
          availableFixturesCount,
          error: !fixturesSub.handle
            ? `未能获取历史赛果列表 DataHubLastMatchFixtureDropdown（${fixturesSub.unavailable || "no_handle"}）。`
            : `历史赛果列表中不存在 fixtureIndex=${fixtureIndex}（当前可用共 ${availableFixturesCount} 场），未混入球队最近一场分析。`,
          fixtures: fixturesList
        };
      }

      // Review #45: 严格只接受 FM.UI.FixtureReference，绝不接受行内排在前面的 TeamReference / CompReference 等任意引用
      const row = rawItems[fixtureIndex];
      const fields = row?.fields || {};
      const fixEntry = Object.entries(fields).find(([, v]) => v?.type === "FM.UI.FixtureReference" && Boolean(v?.identity));
      if (!fixEntry) {
        return {
          ok: false,
          found: false,
          readOnly: true,
          fixtureIndex,
          availableFixturesCount,
          error: `第 ${fixtureIndex} 行赛果记录中未找到类型为 FM.UI.FixtureReference 的有效赛程引用（已拒绝将 TeamReference 等其他引用误认为赛程）。`,
          observedRow: decodeValue(row, idMap),
          fixtures: fixturesList
        };
      }

      const fixtureIdentity = fixEntry[1].identity;
      const matchRef = { source: fixturesSub.handle, path: `${fixtureIndex}/${fixEntry[0]}` };
      const matchCtx = { ...baseCtx, fixture: matchRef, Fixture: matchRef, match: matchRef, Match: matchRef, InPossession: true };

      // 尽量从赛果行与赛程引用上提取赛事、日期、对手元信息以供核验身份
      const decodedRow = decodeValue(row, idMap);
      const [dateR, compSub, homeSub, awaySub] = await Promise.all([
        scope.readAndRelease(matchRef, "DateString", matchCtx, 500),
        scope.subscribeOptional(matchRef, "Competition", matchCtx, 500),
        scope.subscribeOptional(matchRef, "HomeTeam", matchCtx, 500),
        scope.subscribeOptional(matchRef, "AwayTeam", matchCtx, 500)
      ]);
      const fixtureMetadata = {
        fixtureIndex,
        fixtureIdentity,
        rowSummary: decodedRow,
        date: dateR.scalar || null,
        competition: compSub.handle ? await scope.resolveRefName(compSub.handle, matchCtx, 400).catch(() => null) : null,
        homeTeam: homeSub.handle ? await scope.resolveRefName(homeSub.handle, matchCtx, 400).catch(() => null) : null,
        awayTeam: awaySub.handle ? await scope.resolveRefName(awaySub.handle, matchCtx, 400).catch(() => null) : null
      };

      const matchDetails = {};
      for (const prop of ["MatchReportData", "IsViewablePastMatch", "PastMatchHighlightsDropdown", "PastMatchPlayerTacticData", "PastMatchOOPPlayerDataAvailable"]) {
        const sub = await scope.subscribeOptional(matchRef, prop, matchCtx, 1200);
        matchDetails[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
        if (sub.handle) await scope.release(sub.handle);
      }

      // 球队层 LastMatchAnalysis 单独标注作用域，避免与指定 fixtureIndex 混淆
      const teamLatestReports = {};
      for (const prop of ["LastMatchAnalysis", "IsFixtureResults"]) {
        const sub = await scope.subscribeOptional({ source: team.handle }, prop, matchCtx, 1200);
        teamLatestReports[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
        if (sub.handle) await scope.release(sub.handle);
      }

      return {
        ok: true,
        found: true,
        readOnly: true,
        fixtureIndex,
        fixtureIdentity,
        fixtureMetadata,
        availableFixturesCount,
        fixtures: fixturesList,
        matchDetails,
        teamReports: {
          scope: "team_latest_match_analysis",
          note: "teamReports.LastMatchAnalysis 属于球队最近一场概览，核对具体历史场次请以 fixtureIdentity 与 matchDetails 为准。",
          ...teamLatestReports
        }
      };
    });
  }

  return { getPastMatchReport };
}
