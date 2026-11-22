import { createLiveClient } from "./live-client.mjs";

// Refresh staff suggestions on the current tactic (SuggestedTeamRequested 1349935671 /
// SuggestedChangesRequested 1114723152). Payload is the tactic's current suggestion list value.
export function createTacticSuggestionTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (args.kind !== "team" && args.kind !== "changes") throw new Error("kind 必须是 team 或 changes。");
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      // Only the list that the requested suggestion event uses is required. The other list can be
      // absent or demand extra contexts (SuggestedChangesList wants a Person context), so never
      // subscribe it blindly just to build the query.
      const wanted = args.kind === "team" ? "SuggestedTeamList" : "SuggestedChangesList";
      const list = await scope.subscribeOptional(tactic, wanted, contexts);
      if (!list.handle) throw new Error(`${wanted} 当前不可读：${list.unavailable}`);
      const query = { kind: args.kind, tactic,
        suggestedTeam: args.kind === "team" ? list.handle : "",
        suggestedChanges: args.kind === "changes" ? list.handle : "" };
      return perform(scope, query);
    });
  }
  return {
    preview: args => context(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/tactics/suggestion", query), draftOnly: true, liveVerified: false })),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/tactics/suggestion", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("战术或建议列表变化，请重新预览。");
        return { ...await scope.api("/api/v1/tactics/suggestion", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), suggestionRefreshed: false };
      });
    }
  };
}
