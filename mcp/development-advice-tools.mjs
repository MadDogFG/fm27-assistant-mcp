import { createLiveClient, scalar } from "./live-client.mjs";

// 球员发展中心建议与发展计划管理（TRN-O26a/b/c）
export function createDevelopmentAdviceTools(call) {
  const client = createLiveClient(call);

  // 只读读取发展中心建议数据与文本
  async function getDevelopmentAdvice() {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const [adviceData, adviceStr, selData, meeting] = await Promise.all([
        scope.subscribeOptional("human", "DevelopmentCentreAdviceData", ctx, 1000),
        scope.subscribeOptional("human", "DevelopmentCentreAdviceString", ctx, 1000),
        scope.subscribeOptional("human", "DevelopmentCentreSelectionData", ctx, 1000),
        scope.subscribeOptional("human", "DevelopmentCentreAdviceMeeting", ctx, 1000)
      ]);
      return {
        ok: true,
        readOnly: true,
        adviceString: scalar(adviceStr.read?.value),
        adviceData: adviceData.read?.value ?? null,
        selectionData: selData.read?.value ?? null,
        hasAdviceMeeting: Boolean(meeting.handle && meeting.read?.value)
      };
    });
  }

  // 执行发展中心计划建议操作：要求显式 action 与 adviceIndex；同时核验原生建议列表边界，防止无区分 action 盲发
  async function actionDevelopmentPlan({ action, adviceIndex, operationId } = {}) {
    if (!["apply", "update", "end"].includes(action)) {
      throw new Error(`必须明确指定发展计划操作 action（支持 apply/update/end）。当前: ${action}`);
    }
    if (!Number.isInteger(adviceIndex) || adviceIndex < 0) {
      throw new Error("必须提供有效的非负整数 adviceIndex。");
    }
    if (action !== "apply") {
      // 原生 EventFmxActionDevelopmentCentreAdvice(adviceIndex) 仅接受单索引，无法区分 update/end 动作意图
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        action,
        adviceIndex,
        reason: `原生发展中心建议事件仅接受建议下标，无法区分 "${action}" 与 apply 意图；已拦截且零派发。`,
        zeroDispatches: true
      };
    }
    const id = operationId || `dev_plan_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const adviceData = await scope.subscribeOptional("human", "DevelopmentCentreAdviceData", ctx, 1000);
      const count = adviceData.read?.value?.count ?? adviceData.read?.value?.items?.length ?? null;
      if (count !== null && adviceIndex >= count) {
        throw new Error(`adviceIndex 越界: ${adviceIndex} >= ${count}`);
      }
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxActionDevelopmentCentreAdvice&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adviceIndex) }
      );
      return {
        ok: true,
        operationId: id,
        action,
        adviceIndex,
        eventName: "EventFmxActionDevelopmentCentreAdvice",
        dispatch
      };
    });
  }

  return { getDevelopmentAdvice, actionDevelopmentPlan };
}
