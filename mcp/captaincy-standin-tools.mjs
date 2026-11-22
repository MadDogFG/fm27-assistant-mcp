import { createLiveClient } from "./live-client.mjs";

// Captaincy stand-in index for one actual player reference. IPlayerReference exposes the index,
// dropdown candidates and edit permission; event 1315005289 fires the normal selection.
export function createCaptaincyStandinTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (!args.source && !Number.isInteger(args.candidateIndex)) {
      throw new Error("提供实际球员 source（及可选 path）或 candidateIndex。");
    }
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      let player;
      if (args.source) {
        player = { source: args.source, path: args.path || "" };
      } else {
        const cand = await scope.subscribe(team.handle, "CaptainCandidates");
        player = { source: cand.handle, path: String(args.candidateIndex) };
      }
      const contexts = { Human: { source: "human" }, human: { source: "human" }, Team: { source: team.handle }, team: { source: team.handle }, Player: player, player };
      const index = await scope.subscribe(player, "CaptainsStandinIndex", contexts);
      const options = await scope.subscribe(player, "CaptainsStandinDropdownOptions", contexts);
      const canEdit = await scope.subscribe(player, "CanEditCaptainsStandinIndex", contexts);
      const query = { player: index.handle, index: index.handle, options: options.handle, canEdit: canEdit.handle };
      if (!args.optionPath) return perform(scope, query, false);
      query.optionPath = args.optionPath;
      return perform(scope, query, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete) => {
      const state = await scope.api("/api/v1/captaincy/state", query);
      return complete ? { ...state, ...await scope.api("/api/v1/captaincy/preview", query), draftOnly: true, liveVerified: false }
        : { ...state, draftOnly: true, liveVerified: false };
    }),
    set: args => {
      if (!args.optionPath || !args.operationId || !args.expectedChoiceToken) throw new Error("提供 optionPath、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/captaincy/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("替补队长候选或当前值变化，请重新预览。");
        return { ...await scope.api("/api/v1/captaincy/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          standinApplied: false };
      });
    }
  };
}
