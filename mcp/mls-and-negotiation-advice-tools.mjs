import { createLiveClient, scalar } from "./live-client.mjs";

// 谈判中职员即时建议（REC-R18）与特殊联赛工资帽/选秀事务（REC-O28c/d）
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

  // REC-O28c/d: 处理特殊联赛（MLS）工资帽与名额调整及选秀（Draft）流程
  async function manageMlsAndDraft({ action = "set_budget_adjustment", value = 0, operationId } = {}) {
    const eventMap = {
      set_budget_adjustment: "EventFmxSetMlsContractBudgetAdjustment",
      cancel_budget_adjustment: "EventFmxMlsContractBudgetAdjustmentCancel",
      complete_draft: "EventFmxCompleteDraft",
      redraft_timeout: "EventFmxRedraftSquadSelectionOnTimeout",
      restart_shuffle_draft: "EventFmxRestartShuffleDraftCompetition"
    };
    const eventName = eventMap[action];
    if (!eventName) {
      throw new Error(`未知特殊联赛/选秀动作: ${action}（支持 ${Object.keys(eventMap).join("/")}）`);
    }
    const id = operationId || `mls_draft_${action}_${Date.now()}`;
    const payload = action === "set_budget_adjustment" ? value : null;
    const dispatch = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    return { ok: true, operationId: id, action, eventName, dispatch };
  }

  return { getNegotiationStaffAdvice, manageMlsAndDraft };
}
