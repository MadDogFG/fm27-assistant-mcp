import { createLiveClient } from "./live-client.mjs";
import { randomUUID } from "node:crypto";

// Set-piece routing is edited through the game's own edit session; every value is read from
// and written to live bindable channels, so nothing is tailored to a save or a club.
export function createSetPieceEditTools(call) {
  const client = createLiveClient(call);
  async function withSetPiece(args, perform) {
    return client.scope(async scope => {
      const { team, tactic } = await scope.tactic();
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { FilterListID: 0, SelectedObjectList: [], ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef, Boolean: true,
        SetPieceType: Number.isInteger(args.setPieceType) ? args.setPieceType : 0 };
      const setpiece = await scope.subscribe(tactic.handle, "SetPiece", contexts);
      return perform(scope, { team: team.handle, tactic: tactic.handle, setpiece: setpiece.handle }, contexts);
    });
  }
  async function subscribeChannel(scope, query, name, contexts) {
    try {
      return { opened: await scope.subscribe(query.setpiece, name, contexts), routineHandle: undefined };
    } catch (primaryError) {
      const routine = await scope.subscribeOptional(query.setpiece, "CurrentSetPieceRoutine", contexts, 800);
      if (!routine.handle) throw primaryError;
      return { opened: await scope.subscribe(routine.handle, name, contexts), routineHandle: routine.handle };
    }
  }
  async function read(args) {
    return withSetPiece(args, async (scope, query, contexts) => {
      const names = Array.isArray(args.properties) ? args.properties : [];
      if (!names.length) throw new Error("提供要读取的实时属性名（例如 SetPieceDeliveryType、SetPieceCategoryInstructionList）。");
      const values = [];
      for (const name of names) {
        try {
          const { opened } = await subscribeChannel(scope, query, name, contexts);
          values.push({ property: name, value: opened.read.value });
        } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
      }
      return { ok: true, values, liveVerified: false };
    });
  }
  async function preview(args) {
    if (!args.action) return read(args);
    return withSetPiece(args, async (scope, query, contexts) => {
      const edit = { ...query, action: args.action };
      if (args.action === "option") {
        if (typeof args.property !== "string" || typeof args.optionsProperty !== "string" || args.optionPath === undefined)
          throw new Error("option 需要 property、optionsProperty 和 optionPath。");
        const { opened: current, routineHandle } = await subscribeChannel(scope, query, args.property, contexts);
        const { opened: options } = await subscribeChannel(scope, query, args.optionsProperty, contexts);
        Object.assign(edit, { channel: current.handle, property: args.property, options: options.handle, optionPath: String(args.optionPath), routine: routineHandle });
      } else if (!["begin", "end", "cancel"].includes(args.action)) throw new Error("action 需要 option 或 begin/end/cancel。");
      return scope.api("/api/v1/set-piece/edit-preview", edit);
    });
  }
  async function execute(args) {
    if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 operationId 与 expectedChoiceToken。");
    return withSetPiece(args, async (scope, query, contexts) => {
      const edit = { ...query, action: args.action };
      if (args.action === "option") {
        if (typeof args.property !== "string" || typeof args.optionsProperty !== "string" || args.optionPath === undefined)
          throw new Error("option 需要 property、optionsProperty 和 optionPath。");
        const { opened: current, routineHandle } = await subscribeChannel(scope, query, args.property, contexts);
        const { opened: options } = await subscribeChannel(scope, query, args.optionsProperty, contexts);
        Object.assign(edit, { channel: current.handle, property: args.property, options: options.handle, optionPath: String(args.optionPath), routine: routineHandle });
      }
      const preview = await scope.api("/api/v1/set-piece/edit-preview", edit);
      if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("定位球设置、会话或选项已变化，请重新预览。");
      return scope.api("/api/v1/set-piece/edit-execute", { ...edit, id: args.operationId, choiceToken: preview.choiceToken }, true);
    });
  }
  // TAC-O26b/c/d: 修改定位球站位指令、跑位次级指令、发球/频率与职责分配
  async function editRoutine(args = {}) {
    const actionMap = {
      instruction: "EventFmxSetPieceInstrChanged",
      secondary_instruction: "EventFmxSetPieceSecondaryInstrChanged",
      delivery: "EventFmxSetPieceRoutineDeliverySelect",
      frequency: "EventFmxSetPieceSetRoutineFrequency",
      assign_takers: "EventFmxSetPieceAskToAssignTakers",
      assign_category: "EventFmxSetPieceAskToAssignCategory",
      refresh_responsibilities: "EventFmxSetPieceRefreshResponsibilities",
      undo: "EventFmxSetPieceEditSessionUndo",
    };
    const eventName = actionMap[args.action];
    if (!eventName) {
      throw new Error(`未知定位球套路编辑动作: ${args.action}（支持 ${Object.keys(actionMap).join("/")}）`);
    }
    const id = args.operationId || `sp_routine_${args.action}_${Date.now()}`;
    return withSetPiece(args, async (_scope, query) => {
      const payload = args.value === undefined ? null : args.value;
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(query.setpiece)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return { ok: true, operationId: id, action: args.action, eventName, dispatch: send };
    });
  }

  return { get: args => preview(args), set: args => execute(args), editRoutine };
}
