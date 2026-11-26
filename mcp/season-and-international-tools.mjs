import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 转会窗口/截止日、教练资格与国家队集训、赛事抽签与媒体预测只读工具组
export function createSeasonAndInternationalTools(call) {
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

  async function readProps(scope, source, names, contexts, idMap) {
    const out = {};
    for (const name of names) {
      const sub = await scope.subscribeOptional(source, name, contexts, 1400);
      out[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
    }
    return out;
  }

  // REC-R15: 读取转会窗口、截止日倒计时、是否参与截止日及转会窗头条新闻
  async function transferWindowAndDeadline() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const ctx = { human: { source: "human" }, Human: { source: "human" } };
      const humanData = await readProps(scope, "human", [
        "HumanOptedInToTransferDeadlineDay",
        "HumanTransferDeadlineDayCountdown",
        "HumanTransferWindowActivityHeadlineStories",
      ], ctx, idMap);
      const twRef = await scope.subscribeOptional("human", "TransferWindowData", ctx, 1400);
      let windowDetails = {};
      if (twRef.handle) {
        windowDetails = await readProps(scope, { source: twRef.handle }, [
          "TransferWindowTimelineStartDate",
          "TransferWindowTimelineEndDate",
          "TransferWindowTimelineMaxDays",
        ], ctx, idMap);
      }
      return {
        ok: true,
        readOnly: true,
        windowIdentity: twRef.read?.value?.identity || null,
        windowDetails,
        ...humanData,
      };
    });
  }

  // TRN-R16 / TRN-R21 / MGR-R18: 教练资格课程状态、国脚集训日历/状态及国际报告
  async function coachingAndInternationalStatus() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: club.handle }, Club: { source: club.handle },
        team: { source: team.handle }, Team: { source: team.handle },
      };
      const humanData = await readProps(scope, "human", [
        "CoachingQualificationDisplayValue",
        "IsManagingNationalTeam",
      ], ctx, idMap);
      const clubData = await readProps(scope, { source: club.handle }, [
        "CanViewInternationalsReport",
        "InternationalPlayersCount",
        "PlayersInActiveInternationalEvents",
        "PlayersInUpcomingInternationalEvents",
        "MediaPredictionText",
      ], ctx, idMap);
      const teamData = await readProps(scope, { source: team.handle }, [
        "IsInInternationalCamp",
        "MediaExpectedPosition",
        "DataHubLastMatchFixtureDropdown",
      ], ctx, idMap);

      // SQU-R13: 读取国家队选人/可征召池与规则合规状态
      let nationalSquadPool = null;
      const nss = await scope.subscribeOptional({ source: team.handle }, "NationalSquadSelection", ctx, 1200);
      if (nss.handle) {
        const poolCtx = { ...ctx, SquadSelectionRule: 0, Index: 0, FilterListID: 0, HideUnselectedPlayers: false };
        nationalSquadPool = await readProps(scope, { source: nss.handle }, [
          "TeamSquadCount",
          "CanConfirmChanges",
          "RuleWarningStrings",
          "SquadSelectionRules",
          "Players",
        ], poolCtx, idMap);
      }

      return { ok: true, readOnly: true, human: humanData, club: clubData, team: teamData, nationalSquadPool };
    });
  }

  return { transferWindowAndDeadline, coachingAndInternationalStatus };
}
