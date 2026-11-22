import { createLiveClient } from "./live-client.mjs";

// Apply opposition-instruction advice (event 1853321843, target=Tactic, data=Tactic.AllOppositionInstructionSuggestions).
export function createOppositionAdviceTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const suggestions = await scope.subscribe(tactic, "AllOppositionInstructionSuggestions", contexts);
      return perform(scope, { tactic, suggestions: suggestions.handle });
    });
  }
  return {
    preview: args => context(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/tactics/opposition-apply", query), draftOnly: true, liveVerified: false })),
    apply: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/tactics/opposition-apply", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("针对性指令建议变化，请重新预览。");
        return { ...await scope.api("/api/v1/tactics/opposition-apply", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), applied: false };
      });
    }
  };
}
