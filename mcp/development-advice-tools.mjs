import { createLiveClient, scalar } from "./live-client.mjs";

// 球员发展中心建议与发展计划管理（TRN-O26a 制定、TRN-O26b 更新、TRN-O26c 结束）
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

  // 执行发展中心计划建议操作（制定/更新/结束，EventFmxActionDevelopmentCentreAdvice）
  async function actionDevelopmentPlan({ action = "apply", adviceIndex = 0, operationId } = {}) {
    if (!["apply", "update", "end"].includes(action)) {
      throw new Error(`未知发展计划操作: ${action}（支持 apply/update/end）`);
    }
    if (!Number.isInteger(adviceIndex) || adviceIndex < 0) {
      throw new Error("adviceIndex 必须为非负整数。");
    }
    const id = operationId || `dev_plan_${action}_${Date.now()}`;
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
  }

  return { getDevelopmentAdvice, actionDevelopmentPlan };
}
