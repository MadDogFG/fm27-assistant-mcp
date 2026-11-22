import { createLiveClient, scalar } from "./live-client.mjs";

// 国家队人事（SQU-O17a/b/c：征召/撤回/资格变更）与国家队集训（TRN-O28a/b）
export function createInternationalManagementTools(call) {
  const client = createLiveClient(call);

  // 只读检查当前经理是否执教国家队及集训/国家队阵容状态
  async function getInternationalManagementState() {
    return client.scope(async scope => {
      const [allowIntl, isIntlCtx, inCamp, instr] = await Promise.all([
        scope.subscribeOptional("human", "AllowInternationalManagement"),
        scope.subscribeOptional("human", "IsInternationalContext"),
        scope.subscribeOptional("human", "IsInInternationalCamp"),
        scope.subscribeOptional("human", "InternationalInstructions")
      ]);
      return {
        ok: true,
        readOnly: true,
        allowInternationalManagement: scalar(allowIntl.read?.value),
        isInternationalContext: scalar(isIntlCtx.read?.value) === "True",
        isInInternationalCamp: scalar(inCamp.read?.value) === "True",
        hasInstructions: Boolean(instr.handle && instr.read?.value)
      };
    });
  }

  // SQU-O17a/b/c: 执行国家队征召、撤回征召或处理资格变更
  async function manageInternationalCallup({ action = "call_up", playerIndex = 0, operationId } = {}) {
    if (!["call_up", "withdraw", "eligibility"].includes(action)) {
      throw new Error(`未知国家队征召动作: ${action}（支持 call_up/withdraw/eligibility）`);
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("playerIndex 必须为非负整数。");
    }
    const id = operationId || `intl_callup_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const isIntlCtx = await scope.subscribeOptional("human", "IsInternationalContext");
      if (scalar(isIntlCtx.read?.value) !== "True") {
        return { ok: false, blocked: true, reason: "当前经理未处于国家队执教上下文（IsInternationalContext=False）。", action };
      }
      const team = await scope.subscribe("human", "Team");
      const players = await scope.subscribe(team.handle, "Players", { human: { source: "human" } });
      const count = players.read?.value?.count ?? 0;
      if (playerIndex >= count) throw new Error(`playerIndex 越界: ${playerIndex} >= ${count}`);
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSpeakToQuickActionComplete&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, playerIndex }) }
      );
      return { ok: true, operationId: id, action, playerIndex, dispatch };
    });
  }

  // TRN-O28a/b: 安排国家队集训指定日或应用集训计划
  async function manageInternationalTrainingCamp({ action = "schedule_day", dayIndex = 0, scheduleIndex = 0, operationId } = {}) {
    if (!["schedule_day", "apply_camp_plan"].includes(action)) {
      throw new Error(`未知国家队集训动作: ${action}（支持 schedule_day/apply_camp_plan）`);
    }
    const id = operationId || `intl_camp_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const inCamp = await scope.subscribeOptional("human", "IsInInternationalCamp");
      const isIntlCtx = await scope.subscribeOptional("human", "IsInternationalContext");
      if (scalar(isIntlCtx.read?.value) !== "True" && scalar(inCamp.read?.value) !== "True") {
        return { ok: false, blocked: true, reason: "当前未执教国家队且未处于国家队集训期。", action };
      }
      const eventName = action === "schedule_day" ? "EventFmxConfirmTrainingSession" : "EventFmxConfirmTrainingSchedule";
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "schedule_day" ? dayIndex : scheduleIndex) }
      );
      return { ok: true, operationId: id, action, eventName, dispatch };
    });
  }

  return { getInternationalManagementState, manageInternationalCallup, manageInternationalTrainingCamp };
}
