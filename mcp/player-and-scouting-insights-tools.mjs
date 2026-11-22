import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 球员生涯履历/出场时间/预备队授权、球探知识与报告只读工具组
export function createPlayerAndScoutingInsightsTools(call) {
  const client = createLiveClient(call);

  async function readProps(scope, source, names, contexts) {
    const out = {};
    for (const name of names) {
      try {
        const sub = await scope.subscribeOptional(source, name, contexts, 1500);
        out[name] = sub.handle ? (sub.read?.value ?? null) : { unavailable: sub.unavailable || "no_handle" };
      } catch (error) {
        out[name] = { error: String(error.message || error) };
      }
    }
    return out;
  }

  // SQU-R14 / SQU-R15 / SQU-R16 / REC-R02 / REC-R03: 指定一线队球员的生涯履历、约定与实际出场时间、预备队可用性及教练/球探报告
  async function playerCareerAndPlayingTime({ playerIndex = 0 } = {}) {
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const baseCtx = { human: { source: "human" }, Human: { source: "human" }, team: { source: "human", path: "Team" }, Team: { source: "human", path: "Team" } };
      let players = await scope.subscribeOptional({ source: team.handle }, "Players", baseCtx, 2000);
      if (!players.read?.value?.items?.length) {
        players = await scope.subscribeOptional("human", "Players", baseCtx, 2000);
      }
      const items = players.read?.value?.items || [];
      if (playerIndex < 0 || playerIndex >= items.length) {
        throw new Error(`球员索引越界: ${playerIndex} (一线队共 ${items.length} 人)`);
      }

      const pRef = { source: players.handle, path: String(playerIndex) };
      const contexts = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: "human", path: "Club" }, Club: { source: "human", path: "Club" },
        team: { source: "human", path: "Team" }, Team: { source: "human", path: "Team" },
        Person: pRef,
        InPossession: true,
      };

      const nameSub = await scope.subscribeOptional(pRef, "Name", contexts, 1000);
      const data = await readProps(scope, pRef, [
        "BiographyCareerStatsString",
        "CareerStatsPerSeason",
        "CareerStatsPerSeasonLeagueOnly",
        "AwardsCount",
        "AgreedPlayingTime",
        "ActualPlayingTime",
        "AgreedPlayingTimeDescription",
        "FutureAgreedPlayingTime",
        "ExpectedPlayingTimeNextFiveMatches",
        "AgreedPlayingTimePathway",
        "ExpectedPlayingTimeDescriptionText",
        "ExpectedVsPromisedPlayingTimeText",
        "PlayingTimeHappinessLongText",
        "AllowToPlayForReserves",
        "CanChangeAllowToPlayForReserves",
        "ReservesAvailabilityInfoString",
        "CanViewCoachScoutReport",
        "ScoutReportStrengths",
        "ScoutReportWeaknesses",
        "ScoutRecommendation",
        "ScoutRecommendationGrade",
        "ShortScoutRecommendation",
        "DaysSinceLastScouted",
        "IsBeingScouted",
        "CanBeOfferedContract",
        "CanViewAgent",
        "PlayerAgentDemands",
        "ActiveInterestedClubsCount",
      ], contexts);

      // 实机中出场时间与合同到期信息位于 FullContract (FM.UI.ContractReference)
      const fullContract = await scope.subscribeOptional(pRef, "FullContract", contexts, 1000);
      if (fullContract.handle) {
        const contractProps = await readProps(scope, fullContract.handle, [
          "AgreedPlayingTime",
          "ActualPlayingTime",
          "AgreedPlayingTimeDescription",
          "FutureAgreedPlayingTime",
          "ExpectedPlayingTimeNextFiveMatches",
          "AgreedPlayingTimePathway",
          "EndDateDescription",
          "ContractTimeRemainingDecription",
          "IsContractExpiringSoon",
        ], contexts);
        for (const [k, v] of Object.entries(contractProps)) {
          if (!data[k] || data[k]?.unavailable) data[k] = v;
        }
        data.FullContractDetails = contractProps;
      }

      // 实机中球探/教练优缺点、星级、战术角色适配与知识度位于 ClubCoachReport / PlayerReportForContextTeam (FM.UI.PlayerReportReference)
      const coachReport = await scope.subscribeOptional(pRef, "ClubCoachReport", contexts, 1000);
      const playerReport = await scope.subscribeOptional(pRef, "PlayerReportForContextTeam", contexts, 1000);
      const reportHandle = coachReport.handle || playerReport.handle;
      if (reportHandle) {
        const reportProps = await readProps(scope, reportHandle, [
          "ReportTitle",
          "ScoutingKnowledgeLevel",
          "HasScoutedInfo",
          "OverallReportGradeInfo",
          "ScoutedGradeInfo",
          "ScoutedCurrentAbilityInfo",
          "ScoutedPotentialAbilityInfo",
          "ScoutedProConsList",
          "AnalystReportProConsList",
          "BestRoleForPosition",
          "BestOOPRoleForPosition",
          "ScoutedPositionList",
          "ScoutedSquadComparisonPlayersShort",
          "ScoutedTransferInfo",
        ], contexts);
        if (playerReport.handle && playerReport.handle !== reportHandle) {
          const scoutProps = await readProps(scope, playerReport.handle, [
            "ReportTitle",
            "ScoutingKnowledgeLevel",
            "HasScoutedInfo",
            "OverallReportGradeInfo",
            "ScoutedTransferInfo",
          ], contexts);
          reportProps.ScoutReportSummary = scoutProps;
        }
        data.PlayerReportDetails = reportProps;
        if (data.ScoutReportStrengths?.unavailable && reportProps.ScoutedProConsList && !reportProps.ScoutedProConsList.unavailable) {
          data.ScoutReportStrengths = reportProps.ScoutedProConsList;
        }
      }

      return {
        ok: true,
        readOnly: true,
        playerIndex,
        squadCount: items.length,
        playerName: clean(scalar(nameSub.read?.value)) || null,
        playerIdentity: items[playerIndex]?.identity || null,
        insights: data,
      };
    });
  }

  // REC-R01 / REC-R03 / CLB-R10: 俱乐部球探知识覆盖、短名单统计、球探席位与已侦察球队报告
  async function scoutingKnowledgeAndReports() {
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const contexts = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: "human", path: "Club" }, Club: { source: "human", path: "Club" },
        team: { source: "human", path: "Team" }, Team: { source: "human", path: "Team" },
        IsPlayerRecruitment: true,
        Gender: 0,
      };

      const humanData = await readProps(scope, "human", [
        "ScoutingKnowledgeListCount",
        "ScoutingKnowledgeList",
        "HumanScoutedPlayersCount",
        "HumanShortlistsCount",
        "HumanShortlistsContractsExpiringSoonCount",
        "HumanShortlistsContractsExpiringInSixMonthsCount",
        "CareerMilestonesSummary",
        "HighestWorldRanking",
      ], contexts);

      const clubData = await readProps(scope, { source: club.handle }, [
        "CanViewScoutingKnowledge",
        "CanViewTransferHistory",
        "ScoutingVacancies",
        "Scouts",
        "AffiliatesSharedScoutingKnowledgeCount",
        "ReservesTeam",
      ], contexts);

      const teamData = await readProps(scope, { source: team.handle }, [
        "ScoutAssignments",
        "ScoutedTeamReports",
        "CanViewDataHub",
      ], contexts);

      // REC-R09 / REC-R19 / REC-R22: 从球员搜索数据库首名目标读取自由身/合同资格、经纪人要求与球探报告知识度
      let targetPlayerInsights = null;
      const searchCtx = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: club.handle }, Club: { source: club.handle },
        team: { source: team.handle }, Team: { source: team.handle },
        Type: 1, type: 1,
        NumberOfRecruitmentFocusBasicSuggestions: 5,
      };
      const info = await scope.subscribeOptional("human", "ScoutingInfo", searchCtx, 1000);
      let recruitmentSuggestions = null;
      if (info.handle) {
        recruitmentSuggestions = await readProps(scope, info.handle, [
          "RecruitmentFocusBasicSuggestions",
          "SelectedPlayersRecommendedPlayerPool",
          "SelectedPlayersNearMissPlayerPool",
        ], searchCtx);
      }
      const ps = await scope.subscribeOptional("human", "HumanPersonSearch", searchCtx, 1200);
      if (ps.handle) {
        const pl = await scope.subscribeOptional(ps.handle, "PersonList", searchCtx, 1000);
        if (pl.handle && (pl.read?.value?.count ?? 0) > 0) {
          const p0 = { source: pl.handle, path: "0" };
          targetPlayerInsights = await readProps(scope, p0, [
            "Name",
            "CanBeOfferedContract",
            "ContractClub",
            "CanViewAgent",
            "Agent",
            "PlayerAgentDemands",
            "ActiveInterestedClubsCount",
            "ScoutRecommendation",
            "ScoutingKnowledgeLevel",
            "DaysSinceLastScouted",
            "IsBeingScouted",
          ], searchCtx);
        }
      }

      return {
        ok: true,
        readOnly: true,
        human: humanData,
        club: clubData,
        team: teamData,
        targetPlayerInsights,
        recruitmentSuggestions,
      };
    });
  }

  return { playerCareerAndPlayingTime, scoutingKnowledgeAndReports };
}
