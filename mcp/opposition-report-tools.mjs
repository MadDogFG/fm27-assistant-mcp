import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 对手报告正文与元数据只读工具组（TAC-R20 / TAC-R21）
export function createOppositionReportTools(call) {
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

  async function readOppositionReport({ maxTeams = 3 } = {}) {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        TeamRequestingReport: { source: team.handle },
      };

      const threatSub = await scope.subscribeOptional({ source: team.handle }, "NextOppositionThreatLevelAssessment", ctx, 1500);
      const strengthsSub = await scope.subscribeOptional({ source: team.handle }, "ScoutReportStrengths", ctx, 1500);
      const weaknessesSub = await scope.subscribeOptional({ source: team.handle }, "ScoutReportWeaknesses", ctx, 1500);
      const reportsSub = await scope.subscribeOptional({ source: team.handle }, "ScoutedTeamReports", ctx, 1500);
      const analystSub = await scope.subscribeOptional({ source: team.handle }, "AnalystPerson", ctx, 1200);
      let analystName = null;
      if (analystSub.handle) {
        const an = await scope.subscribeOptional({ source: analystSub.handle }, "Name", ctx, 800);
        analystName = stripTags(scalar(an.read?.value)) || null;
      }
      const analystLevelSub = await scope.subscribeOptional({ source: team.handle }, "DataAnalystLevelInfo", ctx, 1000);
      const clubSub = await scope.subscribe("human", "Club");
      const clubAnalysts = await scope.subscribeOptional({ source: clubSub.handle }, "Analysts", ctx, 1000);

      const items = reportsSub.read?.value?.items || [];
      const count = Math.min(items.length, Math.max(1, Number(maxTeams) || 3));
      const scoutedTeams = [];
      let nextOpponentRef = null;
      for (let i = 0; i < count; i++) {
        const oppRef = { source: reportsSub.handle, path: String(i) };
        const nameSub = await scope.subscribeOptional(oppRef, "Name", ctx, 1000);
        const visSub = await scope.subscribeOptional(oppRef, "OppositionReportVisuals", ctx, 1200);
        const formSub = await scope.subscribeOptional(oppRef, "PreferredFormationString", ctx, 1000);
        const isNextSub = await scope.subscribeOptional(oppRef, "IsContextTeamNextOpponent", ctx, 800);
        const isNext = scalar(isNextSub.read?.value);
        if (String(isNext).toLowerCase() === "true" && !nextOpponentRef) nextOpponentRef = oppRef;
        scoutedTeams.push({
          index: i,
          identity: items[i]?.identity || null,
          name: stripTags(scalar(nameSub.read?.value)) || null,
          isNextOpponent: isNext,
          preferredFormation: stripTags(scalar(formSub.read?.value)) || null,
          visuals: visSub.handle ? decodeValue(visSub.read?.value, idMap) : { unavailable: visSub.unavailable || "no_handle" },
        });
      }

      // 若已侦察列表里未直接标出下一对手，回退从当前战术的 NextOppositionInstructionsTeam 获取下一对手引用
      if (!nextOpponentRef) {
        const tacticSub = await scope.subscribeOptional(team.handle, "Tactic", { ...ctx, Boolean: true }, 1000);
        if (tacticSub.handle) {
          const nextTeamSub = await scope.subscribeOptional(tacticSub.handle, "NextOppositionInstructionsTeam", ctx, 1000);
          if (nextTeamSub.handle && nextTeamSub.read?.value?.kind === "reference") {
            nextOpponentRef = { source: nextTeamSub.handle };
          }
        }
      }

      // 读取真正“下一对手”自身的优缺点与偏好阵型（避免把己方球队的 ScoutReportStrengths 当成对手）
      let nextOpponentAnalysis = null;
      if (nextOpponentRef) {
        const oppName = await scope.readAndRelease(nextOpponentRef, "Name", ctx, 700);
        const oppForm = await scope.readAndRelease(nextOpponentRef, "PreferredFormationString", ctx, 700);
        const oppStr = await scope.subscribeOptional(nextOpponentRef, "ScoutReportStrengths", ctx, 1000);
        const oppWeak = await scope.subscribeOptional(nextOpponentRef, "ScoutReportWeaknesses", ctx, 1000);
        nextOpponentAnalysis = {
          name: stripTags(oppName.scalar || "") || null,
          preferredFormation: stripTags(oppForm.scalar || "") || null,
          strengths: oppStr.handle ? decodeValue(oppStr.read?.value, idMap) : null,
          weaknesses: oppWeak.handle ? decodeValue(oppWeak.read?.value, idMap) : null,
        };
      }

      return {
        ok: true,
        readOnly: true,
        metadata: {
          source: "team_native_scouting_reports",
          scoutedTeamsCount: items.length,
          hasNextOppositionThreatAssessment: Boolean(threatSub.handle),
          strengthsCount: strengthsSub.read?.value?.count ?? 0,
          weaknessesCount: weaknessesSub.read?.value?.count ?? 0,
          analystPersonName: analystName,
          clubAnalystsCount: clubAnalysts.read?.value?.count ?? null,
          dataAnalystLevelInfo: analystLevelSub.handle ? decodeValue(analystLevelSub.read?.value, idMap) : null,
        },
        report: {
          nextOppositionThreatAssessment: stripTags(scalar(threatSub.read?.value)) || null,
          nextOpponentAnalysis,
          ownTeamStrengths: strengthsSub.handle ? decodeValue(strengthsSub.read?.value, idMap) : { unavailable: strengthsSub.unavailable },
          ownTeamWeaknesses: weaknessesSub.handle ? decodeValue(weaknessesSub.read?.value, idMap) : { unavailable: weaknessesSub.unavailable },
          scoutedTeams,
        },
      };
    });
  }

  return { readOppositionReport };
}
