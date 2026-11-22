import { createLiveClient } from "./live-client.mjs";

export function createFriendlyTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef };
      const friendly = await scope.subscribe(team.handle, "ArrangeFriendly", contexts);
      const channels = {};
      for (const name of ["Date", "TeamOpponent", "MatchRules", "IsValid", "IsOppositionTeamValid", "CanPlayAway"])
        channels[name] = (await scope.subscribe(friendly.handle, name, contexts)).handle;
      const query = { operation: args.operation, team: team.handle, friendly: friendly.handle, channels };
      const preview = await scope.api("/api/v1/friendlies/preview", query);
      if (!execute) return preview;
      if (!args.operationId || !args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken)
        throw new Error("需要原友谊赛预览token与固定operationId，草稿改变后应重新预览。");
      return scope.api("/api/v1/friendlies/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
