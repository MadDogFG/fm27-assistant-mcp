import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 世界赛事赛程、阵容合规停赛与合同汇总、发展中心报告只读工具组
export function createWorldAndSquadTools(call) {
  const client = createLiveClient(call);

  async function readProperties(scope, source, names, contexts) {
    const out = {};
    for (const name of names) {
      try {
        const sub = await scope.subscribeOptional(source, name, contexts, 1500);
        if (sub.handle) out[name] = sub.read?.value ?? null;
        else out[name] = { unavailable: sub.unavailable || "no_handle" };
      } catch (error) {
        out[name] = { error: String(error.message || error) };
      }
    }
    return out;
  }

  async function withRoots(fn) {
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const contexts = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: club.handle }, Club: { source: club.handle },
        team: { source: team.handle }, Team: { source: team.handle }
      };
      return fn(scope, club, team, contexts);
    });
  }

  return {
    // MGR-R09, MGR-R16: 世界新闻、赛程、比分及赛事列表读取
    worldAndCompetitions: () => withRoots(async (scope, _club, team, contexts) => {
      const humanProps = await readProperties(scope, "human", [
        "HumanTodayFixtures", "LatestScoresComps", "LatestScoresHumanFixtures",
        "HumanAroundTheWorldTransferStories"
      ], contexts);
      const teamProps = await readProperties(scope, team.handle, [
        "Next5Fixtures", "CurrentComps", "RecentFormValuesAllComps"
      ], contexts);
      return {
        ok: true,
        teamIdentity: team.read.value?.identity ?? null,
        todayFixtures: humanProps.HumanTodayFixtures,
        latestScoresComps: humanProps.LatestScoresComps,
        latestScoresHumanFixtures: humanProps.LatestScoresHumanFixtures,
        aroundTheWorldTransferStories: humanProps.HumanAroundTheWorldTransferStories,
        next5Fixtures: teamProps.Next5Fixtures,
        currentCompetitions: teamProps.CurrentComps,
        recentFormAllComps: teamProps.RecentFormValuesAllComps,
        liveVerified: true
      };
    }),

    // SQU-R05, SQU-R17, SQU-R18: 停赛、注册合规、可用人数、外租及合同到期汇总
    complianceAndContracts: () => withRoots(async (scope, club, team, contexts) => {
      const teamProps = await readProperties(scope, team.handle, [
        "AllCompsActiveBans", "AllCompsActiveBansCount", "AllCompsPotentialBansCount",
        "AvailableFirstTeamPlayersCount", "NextMatchEligibilityRule", "SquadRegistrationRulesCompliance"
      ], contexts);
      const clubProps = await readProperties(scope, club.handle, [
        "PlayerExpiringContractsCount", "PlayersOutOnLoanCount", "PlayersTimeLeftOnContractsCounts"
      ], contexts);
      const availCount = scalar(teamProps.AvailableFirstTeamPlayersCount);
      const playersSub = await scope.subscribeOptional(team.handle, "Players", contexts, 1000);
      const squadCount = playersSub.read?.value?.count ?? (playersSub.read?.value?.items?.length || 0);
      if (playersSub.handle) await scope.release(playersSub.handle);

      const suspiciousZero = (availCount === "0" || availCount === null) && squadCount > 0;
      return {
        ok: true,
        degraded: availCount === null || suspiciousZero,
        teamIdentity: team.read.value?.identity ?? null,
        bans: {
          activeBansCount: scalar(teamProps.AllCompsActiveBansCount),
          potentialBansCount: scalar(teamProps.AllCompsPotentialBansCount),
          activeBans: teamProps.AllCompsActiveBans
        },
        availability: {
          availableFirstTeamCount: availCount,
          squadTotalCount: squadCount,
          nextMatchEligibilityRule: clean(scalar(teamProps.NextMatchEligibilityRule)),
          registrationCompliance: teamProps.SquadRegistrationRulesCompliance,
          ...(suspiciousZero ? { note: "AvailableFirstTeamPlayersCount 仅在赛前选人上下文更新，非比赛窗口常返回 0；实际阵容人数请参考 squadTotalCount 或调用 get_squad_snapshot。" } : {})
        },
        contractsSummary: {
          expiringCount: scalar(clubProps.PlayerExpiringContractsCount),
          outOnLoanCount: scalar(clubProps.PlayersOutOnLoanCount),
          timeLeftCounts: clubProps.PlayersTimeLeftOnContractsCounts
        },
        liveVerified: true
      };
    }),

    // TRN-R14, TRN-R19: 发展中心一线队报告、评级与球队整体表现
    developmentReport: () => withRoots(async (scope, _club, team, contexts) => {
      const teamProps = await readProperties(scope, team.handle, [
        "DevCentreSquadReportFirstTeamPlayersString", "DevCentreSquadReportGoodnessStarRating",
        "DevCentreSquadReportGoodnessString", "DevCentreSquadReportPotentialString",
        "TeamReportGeneralPerformance"
      ], contexts);
      return {
        ok: true,
        teamIdentity: team.read.value?.identity ?? null,
        firstTeamPlayersSummary: clean(scalar(teamProps.DevCentreSquadReportFirstTeamPlayersString)),
        goodnessStarRating: scalar(teamProps.DevCentreSquadReportGoodnessStarRating),
        goodnessSummary: clean(scalar(teamProps.DevCentreSquadReportGoodnessString)),
        potentialSummary: clean(scalar(teamProps.DevCentreSquadReportPotentialString)),
        generalPerformance: teamProps.TeamReportGeneralPerformance,
        liveVerified: true
      };
    })
  };
}
