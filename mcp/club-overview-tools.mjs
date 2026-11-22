import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 俱乐部概览、财务预测、设施青训、董事会信心与更衣室动态只读工具组
export function createClubOverviewTools(call) {
  const client = createLiveClient(call);

  // 通用安全批量订阅读取助手，避免重复订阅样板代码
  async function readProperties(scope, source, names, contexts) {
    const out = {};
    for (const name of names) {
      try {
        const sub = await scope.subscribeOptional(source, name, contexts, 1500);
        if (sub.handle) {
          out[name] = sub.read?.value ?? null;
        } else {
          out[name] = { unavailable: sub.unavailable || "no_handle" };
        }
      } catch (error) {
        out[name] = { error: String(error.message || error) };
      }
    }
    return out;
  }

  async function withClubAndTeam(fn) {
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
    // CLB-R04 / CLB-R13: 财务余额、债务、未来预测与阵容成本/工资帽读取
    finances: () => withClubAndTeam(async (scope, club, team, contexts) => {
      const values = await readProperties(scope, club.handle, [
        "NetDebt", "TransferDebt", "ProjectionBalance", "ProjectionExpenditure",
        "ProjectionTotalWageCosts", "ProjectionTransferBudget", "ProjectionTurnover",
        "CurrentSalaryCapString", "RemainingSalaryCapSpaceString",
        "SalaryCapAllowedString", "SalaryCapTakenUpPercentage", "YearlySalaryCapRatioString"
      ], contexts);
      const teamCap = await readProperties(scope, team.handle, ["HasSalaryCap", "RosterSalaryCapData"], contexts);
      return {
        ok: true,
        clubIdentity: club.read.value?.identity ?? null,
        netDebt: scalar(values.NetDebt),
        transferDebt: scalar(values.TransferDebt),
        projections: {
          balance: values.ProjectionBalance,
          expenditure: values.ProjectionExpenditure,
          totalWageCosts: values.ProjectionTotalWageCosts,
          transferBudget: values.ProjectionTransferBudget,
          turnover: values.ProjectionTurnover
        },
        salaryCap: {
          hasSalaryCap: scalar(teamCap.HasSalaryCap),
          current: scalar(values.CurrentSalaryCapString),
          remainingSpace: scalar(values.RemainingSalaryCapSpaceString),
          allowed: scalar(values.SalaryCapAllowedString),
          takenUpPercentage: scalar(values.SalaryCapTakenUpPercentage),
          yearlyRatio: scalar(values.YearlySalaryCapRatioString),
          rosterSalaryCapData: teamCap.RosterSalaryCapData
        },
        liveVerified: true
      };
    }),

    // CLB-R11, CLB-R16, SQU-R12: 设施、球场、青训升级反馈及青训候选读取
    facilities: () => withClubAndTeam(async (scope, club, _team, contexts) => {
      const values = await readProperties(scope, club.handle, [
        "TrainingFacilityRating", "YouthFacilityRating", "CorporateFacilityRating",
        "YouthCoachingLevel", "YouthRecruitment", "YouthSetupCategory",
        "DaysUntilYouthIntake", "YouthIntakeRating", "YouthCandidatesCount",
        "YouthIntakeFeedbackString", "AllYouthCandidates"
      ], contexts);
      return {
        ok: true,
        clubIdentity: club.read.value?.identity ?? null,
        facilities: {
          training: values.TrainingFacilityRating,
          youth: values.YouthFacilityRating,
          corporate: values.CorporateFacilityRating
        },
        youthSetup: {
          coachingLevel: scalar(values.YouthCoachingLevel),
          recruitment: scalar(values.YouthRecruitment),
          setupCategory: scalar(values.YouthSetupCategory),
          daysUntilIntake: scalar(values.DaysUntilYouthIntake),
          intakeRating: scalar(values.YouthIntakeRating),
          intakeFeedback: clean(scalar(values.YouthIntakeFeedbackString)),
          candidatesCount: scalar(values.YouthCandidatesCount),
          candidates: values.AllYouthCandidates
        },
        liveVerified: true
      };
    }),

    // CLB-R12: 董事会和球迷信心、文化与评估反馈
    confidence: () => withClubAndTeam(async (scope, club, _team, contexts) => {
      const values = await readProperties(scope, club.handle, [
        "CurrentMonthManagerSupportLevel", "PreviousMonthManagerSupportLevel",
        "ManagerialSupportFeedback", "SupporterBoardInfluenceString",
        "BoardCulture", "SupporterCulture"
      ], contexts);
      return {
        ok: true,
        clubIdentity: club.read.value?.identity ?? null,
        supportLevel: {
          currentMonth: scalar(values.CurrentMonthManagerSupportLevel),
          previousMonth: scalar(values.PreviousMonthManagerSupportLevel)
        },
        supporterBoardInfluence: clean(scalar(values.SupporterBoardInfluenceString)),
        boardCulture: clean(scalar(values.BoardCulture)),
        supporterCulture: clean(scalar(values.SupporterCulture)),
        managerialSupportFeedback: values.ManagerialSupportFeedback,
        liveVerified: true
      };
    }),

    // CLB-R15, CLB-R14: 基础资料、历史、荣誉、关联球队及岗位空缺
    history: () => withClubAndTeam(async (scope, club, _team, contexts) => {
      const values = await readProperties(scope, club.handle, [
        "YearFounded", "BackgroundShort", "HistoryHonours", "Legends", "Icons",
        "AffiliatedClubsCount", "StaffVacancies"
      ], contexts);
      const affiliatedClubs = await scope.resolveRefList(club.handle, "AffiliatedClubsList", contexts, 15);
      const youthTeams = await scope.resolveRefList(club.handle, "YouthTeams", contexts, 10);
      return {
        ok: true,
        clubIdentity: club.read.value?.identity ?? null,
        yearFounded: scalar(values.YearFounded),
        background: clean(scalar(values.BackgroundShort)),
        honours: values.HistoryHonours,
        legends: values.Legends,
        icons: values.Icons,
        affiliatedClubsCount: scalar(values.AffiliatedClubsCount),
        affiliatedClubs,
        youthTeams,
        staffVacancies: scalar(values.StaffVacancies),
        liveVerified: true
      };
    }),

    // SQU-R09: 更衣室层级、社交群体与凝聚力反馈（自动映射球员姓名）
    dynamics: () => withClubAndTeam(async (scope, _club, team, contexts) => {
      const values = await readProperties(scope, team.handle, [
        "HierarchyTeamLeadersCount", "HierarchyHighlyInfluentialCount",
        "HierarchyInfluentialCount", "SocialGroupFeedbackString",
        "MatchCohesionFeedback", "SocialGroupList",
        "HierarchyTeamLeaders", "HierarchyHighlyInfluential", "HierarchyInfluential"
      ], contexts);

      // 建立一线队 identity -> 姓名 映射，避免仅返回晦涩的 identity 字符串
      const nameByIdentity = new Map();
      const playersSub = await scope.subscribeOptional(team.handle, "Players", contexts, 1500);
      const pItems = playersSub.read?.value?.items || [];
      for (let i = 0; i < pItems.length; i++) {
        const id = pItems[i]?.identity;
        if (!id) continue;
        const pRef = { source: playersSub.handle, path: String(i) };
        const nr = await scope.readAndRelease(pRef, "Name", { ...contexts, Person: pRef }, 500);
        if (nr.scalar) nameByIdentity.set(id, nr.scalar);
      }
      if (playersSub.handle) await scope.release(playersSub.handle);

      const enrichNode = node => {
        if (node === null || node === undefined) return node;
        if (Array.isArray(node)) return node.map(enrichNode);
        if (typeof node === "object") {
          if (node.kind === "list" && Array.isArray(node.items)) {
            return node.items.map(enrichNode);
          }
          if (node.identity && nameByIdentity.has(node.identity)) {
            return { identity: node.identity, name: nameByIdentity.get(node.identity) };
          }
          const out = {};
          for (const [k, v] of Object.entries(node)) out[k] = enrichNode(v);
          return out;
        }
        return node;
      };

      return {
        ok: true,
        teamIdentity: team.read.value?.identity ?? null,
        hierarchy: {
          teamLeadersCount: scalar(values.HierarchyTeamLeadersCount),
          highlyInfluentialCount: scalar(values.HierarchyHighlyInfluentialCount),
          influentialCount: scalar(values.HierarchyInfluentialCount),
          teamLeaders: enrichNode(values.HierarchyTeamLeaders),
          highlyInfluential: enrichNode(values.HierarchyHighlyInfluential),
          influential: enrichNode(values.HierarchyInfluential)
        },
        socialGroups: enrichNode(values.SocialGroupList),
        socialGroupFeedback: clean(scalar(values.SocialGroupFeedbackString)) || values.SocialGroupFeedbackString,
        matchCohesionFeedback: clean(scalar(values.MatchCohesionFeedback)) || values.MatchCohesionFeedback,
        liveVerified: true
      };
    })
  };
}
