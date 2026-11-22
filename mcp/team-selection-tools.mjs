import { createLiveClient } from "./live-client.mjs";

// Confirm the currently shown team selection through event 1714714946 (target=Tactic, data=true).
export function createTeamSelectionTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      return perform(scope, { tactic }, t);
    });
  }
  async function deleteContext(args, perform) {
    if (args.optionPath === undefined) throw new Error("delete 需要 optionPath（Tactic.TeamSelections 叶子）。");
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const selections = await scope.subscribe(tactic, "TeamSelections", contexts);
      return perform(scope, { tactic, selections: selections.handle, optionPath: args.optionPath });
    });
  }
  return {
    deletePreview: args => deleteContext(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/tactics/team-selection-delete", query), draftOnly: true, liveVerified: false })),
    deleteExecute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return deleteContext(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/tactics/team-selection-delete", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("球队选择列表变化，请重新预览。");
        return { ...await scope.api("/api/v1/tactics/team-selection-delete", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), deleted: false };
      });
    },
    confirm: args => {
      if (!args.operationId) throw new Error("提供固定 operationId。");
      return context(args, async (scope, query, t) => {
        const preview = await scope.api("/api/v1/tactics/confirm-selection", query);
        if (args.expectedChoiceToken && preview.choiceToken !== args.expectedChoiceToken) throw new Error("当前战术/选择变化，请重新预览。");
        return { ...await scope.api("/api/v1/tactics/confirm-selection", { ...query, id: args.operationId,
          choiceToken: preview.choiceToken }, true), selectionConfirmed: false };
      });
    },
    preview: args => context(args, async (scope, query) => ({
      ...await scope.api("/api/v1/tactics/confirm-selection", query), liveVerified: false
    })),
    // SQU-O02a/b/c: 读取已保存阵容选择预设列表，并支持创建、覆盖保存、加载或重命名
    listPresets: () => context({}, async (scope, { tactic }, t) => {
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const selections = await scope.subscribe(tactic, "TeamSelections", contexts);
      return { ok: true, readOnly: true, selections: selections.read?.value ?? null };
    }),
    managePreset: async ({ action = "create", name, optionPath, operationId } = {}) => {
      if (!["create", "save", "load", "rename"].includes(action)) {
        throw new Error(`未知阵容选择预设动作: ${action}（支持 create/save/load/rename）`);
      }
      if ((action === "create" || action === "rename") && !String(name || "").trim()) {
        throw new Error(`${action} 需要提供阵容选择名称 name。`);
      }
      if ((action === "save" || action === "load") && (optionPath === undefined || optionPath === "")) {
        throw new Error(`${action} 需要提供 TeamSelections 叶子 optionPath。`);
      }
      const id = operationId || `team_sel_${action}_${Date.now()}`;
      return context({}, async (scope, { tactic }, t) => {
        const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
        const selections = await scope.subscribe(tactic, "TeamSelections", contexts);
        const eventMap = {
          create: "EventFmxSaveTeamSelectionConfirm",
          save: "EventFmxSaveTeamSelectionConfirmOverwrite",
          load: "EventFmxSelectTeamSelection",
          rename: "EventFmxRenameTeamSelectionConfirm",
        };
        const eventName = eventMap[action];
        const payload = (action === "create" || action === "rename")
          ? String(name).trim()
          : { $value: { source: selections.handle, path: String(optionPath) } };
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(tactic)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        );
        return { ok: true, operationId: id, action, eventName, dispatch: send };
      });
    }
  };
}
