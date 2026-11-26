import { createLiveClient, scalar } from "./live-client.mjs";

// 谈判中职员即时建议（REC-R18）与特殊联赛工资帽/选秀事务（REC-O28c/d，Review #43）
export function createMlsAndNegotiationAdviceTools(call) {
  const client = createLiveClient(call);

  // REC-R18: 读取或请求谈判中总监/职员即时建议（EventFmxTradeOfferDofOpinionRequested）
  async function getNegotiationStaffAdvice({ requestDofOpinion = false, operationId } = {}) {
    const id = operationId || `neg_advice_${Date.now()}`;
    return client.scope(async scope => {
      const advice = await scope.subscribeOptional("human", "DevelopmentCentreAdviceString");
      let dispatch = null;
      if (requestDofOpinion) {
        dispatch = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxTradeOfferDofOpinionRequested&source=human&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
        );
      }
      return {
        ok: true,
        readOnly: !requestDofOpinion,
        operationId: requestDofOpinion ? id : null,
        staffAdviceText: scalar(advice.read?.value),
        dispatch
      };
    });
  }

  // REC-O28c/d (Review #43): 默认只读探测 MLS 工资帽/选秀上下文；非 MLS 或非选秀存档零派发，空参数绝不默认发送数值 0 的预算调整
  async function manageMlsAndDraft({ action = "read", value, operationId } = {}) {
    const eventMap = {
      set_budget_adjustment: "EventFmxSetMlsContractBudgetAdjustment",
      cancel_budget_adjustment: "EventFmxMlsContractBudgetAdjustmentCancel",
      complete_draft: "EventFmxCompleteDraft",
      redraft_timeout: "EventFmxRedraftSquadSelectionOnTimeout",
      restart_shuffle_draft: "EventFmxRestartShuffleDraftCompetition"
    };
    if (action !== "read" && !eventMap[action]) {
      throw new Error(`未知特殊联赛/选秀动作: ${action}（支持 read/${Object.keys(eventMap).join("/")}）`);
    }
    if (action === "set_budget_adjustment" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("set_budget_adjustment 必须明确提供有限整数 value，禁止省略参数默认发送 0。");
    }

    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team", {}, 1200);
      const club = await scope.subscribeOptional("human", "Club", {}, 1200);
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        ...(team.handle ? { team: { source: team.handle }, Team: { source: team.handle } } : {}),
        ...(club.handle ? { club: { source: club.handle }, Club: { source: club.handle } } : {})
      };
      const [hasCapSub, rosterCapSub, draftSub] = await Promise.all([
        team.handle ? scope.subscribeOptional(team.handle, "HasSalaryCap", ctx, 800) : Promise.resolve({ handle: null, read: { value: null } }),
        team.handle ? scope.subscribeOptional(team.handle, "RosterSalaryCapData", ctx, 800) : Promise.resolve({ handle: null, read: { value: null } }),
        scope.subscribeOptional("human", "IsFantasyDraftGame", ctx, 800)
      ]);
      const hasSalaryCap = scalar(hasCapSub.read?.value) === "True";
      const hasRosterCapData = Boolean(rosterCapSub.handle && rosterCapSub.read?.value);
      const isFantasyDraft = scalar(draftSub.read?.value) === "True";
      const leagueContext = {
        hasSalaryCap,
        hasRosterCapData,
        isFantasyDraft,
        supportsMlsBudgetAdjustment: hasSalaryCap && hasRosterCapData,
        supportsDraftActions: isFantasyDraft || hasSalaryCap
      };

      if (action === "read") {
        return { ok: true, readOnly: true, leagueContext };
      }

      const isMlsBudgetOp = action === "set_budget_adjustment" || action === "cancel_budget_adjustment";
      if (isMlsBudgetOp && !leagueContext.supportsMlsBudgetAdjustment) {
        return {
          ok: false,
          blocked: true,
          action,
          leagueContext,
          reason: "当前存档/球队不适用 MLS 工资帽预算规则（HasSalaryCap!=True 或缺少 RosterSalaryCapData），已阻断且零派发。",
          zeroDispatches: true
        };
      }
      if (!isMlsBudgetOp && !leagueContext.supportsDraftActions) {
        return {
          ok: false,
          blocked: true,
          action,
          leagueContext,
          reason: "当前存档不处于选秀（MLS Draft / Fantasy Draft）上下文，已阻断且零派发。",
          zeroDispatches: true
        };
      }

      const id = operationId || `mls_draft_${action}_${Date.now()}`;
      const eventName = eventMap[action];
      const payload = action === "set_budget_adjustment" ? value : null;
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return { ok: true, operationId: id, action, eventName, leagueContext, dispatch };
    });
  }

  return { getNegotiationStaffAdvice, manageMlsAndDraft };
}
