import { createLiveClient } from "./live-client.mjs";

export function createMatchShoutTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const match = await scope.api("/api/v1/match/state");
      if (!match.inMatch || match.finished || !match.kickedOff || match.pastMatch || match.replay || match.spectating || typeof match.isHomeTeam !== "boolean")
        throw new Error("喊话需要当前经理执教、已开赛且未结束的真实比赛。");
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef, Boolean: true, isHomeTeam: match.isHomeTeam, IsHomeTeam: match.isHomeTeam };
      const tactic = await scope.subscribe("match", "Tactic", contexts);
      const channels = {};
      for (const name of ["TouchlineShoutsEnabled", "TouchlineShouts", "TouchlineShoutGroupType", "TouchlineShoutSelectedPlayers", "TouchlineShoutAvailablePlayers"])
        channels[name] = (await scope.subscribe(tactic.handle, name, contexts)).handle;
      return perform(scope, { tactic: tactic.handle, channels, kind: args.kind || "shout", option: args.optionIndex });
    });
  }
  return {
    getRecipients: args => context(args, (scope, query) => Array.isArray(args.playerIndices)
      ? scope.api("/api/v1/match/shouts/players-preview", { ...query, playerIndices: args.playerIndices })
      : scope.api("/api/v1/match/shouts/players-state", { ...query, operationId: args.operationId })),
    selectRecipients: args => {
      if (!args.operationId || !args.expectedChoiceToken || !Array.isArray(args.playerIndices)) throw new Error("提供原球员候选indices、token和固定operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/match/shouts/players-preview", { ...query, playerIndices: args.playerIndices });
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("候选或喊话对象已变化，请刷新。");
        return scope.api("/api/v1/match/shouts/players-execute", { ...query, playerIndices: args.playerIndices, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
      });
    },
    get: args => context(args, (scope, query) => Number.isInteger(args.optionIndex) ? scope.api("/api/v1/match/shouts/preview", query) : scope.api("/api/v1/match/shouts/state", query)),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken || !Number.isInteger(args.optionIndex)) throw new Error("提供原喊话/组别候选optionIndex、token及固定operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/match/shouts/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("喊话选项、对象或冷却状态已变化，请刷新。");
        return { ...await scope.api("/api/v1/match/shouts/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          shoutEffectVerified: false };
      });
    }
  };
}
