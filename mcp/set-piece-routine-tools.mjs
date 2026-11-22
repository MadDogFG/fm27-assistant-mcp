import { createLiveClient } from "./live-client.mjs";

// Request the assistant to update the set-piece tactic (event 1296390501, target=team.tactic.SetPiece, data=true).
export function createSetPieceRoutineTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const setPiece = await scope.subscribe(tactic, "SetPiece", contexts);
      return perform(scope, { setPiece: setPiece.handle });
    });
  }
  return {
    preview: args => context(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/set-piece/tactic-update-preview", query), draftOnly: true, liveVerified: false })),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/set-piece/tactic-update-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("定位球状态变化，请重新预览。");
        return { ...await scope.api("/api/v1/set-piece/tactic-update-execute", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), updated: false };
      });
    }
  };
}
