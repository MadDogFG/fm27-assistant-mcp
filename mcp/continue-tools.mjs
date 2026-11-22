import { createLiveClient, scalar } from "./live-client.mjs";

// Decode only the original manager-action record. Latest inbox order is not task priority.
export function describeContinueTask(state) {
  if (!state.requiresManagerAction) return null;
  if (state.continueFlowState === 32 || state.continueFlowState === 33)
    return { available: false, reason: "read_unread_messages",
      note: "当前是未读消息流程；缓存的上一条 currentAction 不代表当前强制待办。" };
  const action = state.currentManagerTask;
  if (action?.kind !== "record") return { available: false, reason: "runtime_task_record_unavailable" };
  const fields = action.fields || {};
  const scalar = key => fields[key]?.kind === "scalar" ? fields[key].value : null;
  const reference = fields["0x31313020"];
  const message = reference?.kind === "reference" && reference.type === "FM.UI.NewsItemReference" ? reference : null;
  const uid = message?.pairs?.find(pair => pair.id === 0x756e6964)?.value;
  return { available: true, continueLabel: scalar("0x35795972"), newsAction: scalar("0x37755247"),
    dynamicCardId: scalar("0x6b746a77"), newsItemCardId: scalar("0x4c694e49"),
    messageIdentity: message?.identity ?? null, messageUid: uid === undefined ? null : String(uid),
    actionDataReferences: fields["0x53554171"] ?? null,
    note: "按原消息身份匹配完整收件箱并读取合法业务选项；卡片ID不是消息UID，最新未读不一定是当前强制任务。" };
}

export function createContinueTools(call) {
  const client = createLiveClient(call);
  async function withState(operationId, action) {
    return client.scope(async scope => {
      const waiting = await scope.subscribe("game", "GameWaiting");
      const date = await scope.subscribe("game", "CurrentGameDate");
      const channels = { waiting: waiting.handle, date: date.handle };
      const raw = await scope.api("/api/v1/game/continue-state", { ...channels, operationId });
      const state = { ...raw, managerTask: describeContinueTask(raw) };
      if (raw.continueFlowState === 25 && !raw.waiting) {
        const future = await scope.subscribeOptional("game", "FutureUserRequiredTask");
        const requiredSelection = await scope.subscribeOptional("game", "HasTeamSelectionRequiredTask");
        const fields = future.read.value?.fields;
        state.fixturesTask = {
          source: "FutureUserRequiredTask",
          nativeNewsAction: scalar(fields?.["0x37755247"]),
          actionDataReferences: fields?.["0x53554171"] ?? null,
          hasTeamSelectionRequiredTask: scalar(requiredSelection.read.value)
        };
      }
      return action ? action(scope, channels, state) : state;
    });
  }
  async function state(args = {}) {
    // Journal recovery remains available while a save is loading. Never resend.
    const receipt = args.operationId ? await client.api("/api/v1/commands/status", { id: args.operationId }) : null;
    if (receipt && receipt.command !== "request_continue_game") throw new Error("该请求号不属于继续游戏。");
    try { return await withState(args.operationId); }
    catch (error) {
      if (!receipt) throw error;
      return { ok: true, ready: false, receipt, stateError: String(error.message || error),
        retrySafe: false, stageAdvanceVerified: false, nextAction: "保留原请求号，只读查询；不要自动重发。" };
    }
  }
  async function request(args) {
    const { operationId: id, expectedGameIdentity: gameIdentity, expectedChoiceToken: choiceToken, mutationCursor } = args;
    if (typeof id !== "string" || !id.trim() || id.length > 100 || typeof gameIdentity !== "string" || !gameIdentity ||
        typeof choiceToken !== "string" || !/^[a-f0-9]{64}$/i.test(choiceToken) || !Number.isSafeInteger(mutationCursor) || mutationCursor < 0)
      throw new Error("需要原预览的 expectedGameIdentity、expectedChoiceToken、mutationCursor 和固定 operationId。");
    // Duplicate POST validates original semantics without needing fresh channels.
    const previous = await client.api("/api/v1/game/continue-receipt", { id });
    if (typeof previous.found !== "boolean") throw new Error("继续请求日志查询未返回明确结果，未执行操作。");
    const parameters = { id, gameIdentity, choiceToken, mutationCursor };
    const receipt = previous.found ? await client.api("/api/v1/game/request-continue", parameters, true) :
      await withState(undefined, async (scope, channels, preview) => {
        if (preview.gameIdentity !== gameIdentity || preview.choiceToken !== choiceToken)
          throw new Error("继续游戏的状态已变化，请重新预览。");
        if (!preview.canRequest || preview.waiting) throw new Error(preview.reason || "当前不可请求继续。");
        return scope.api("/api/v1/game/request-continue", { ...channels, ...parameters }, true);
      });
    if (receipt.status === "transport_result_unknown") return { ...receipt, stageAdvanceVerified: false };
    try {
      return { ok: receipt.ok, receipt, observation: await state({ operationId: id }),
        stageAdvanceVerified: false, commandCausalityVerified: false };
    } catch (error) {
      return { ok: receipt.ok, receipt, observationError: String(error.message || error), retrySafe: false, stageAdvanceVerified: false };
    }
  }
  return { state, request };
}
