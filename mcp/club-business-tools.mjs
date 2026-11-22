import { createLiveClient } from "./live-client.mjs";

export function createClubBusinessTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!["opponent", "rules"].includes(args.kind)) throw new Error("kind使用opponent或rules。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef };
      const friendly = await scope.subscribe(team.handle, "ArrangeFriendly", contexts);
      const choices = await scope.subscribe(friendly.handle, args.kind === "opponent" ? "TeamOpponent" : "MatchRules", contexts);
      return action(scope, { kind: args.kind, team: team.handle, friendly: friendly.handle, choices: choices.handle, optionPath: args.optionPath });
    });
  }
  async function dates(args, action) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef };
      const friendly = await scope.subscribe(team.handle, "ArrangeFriendly", contexts);
      const available = await scope.subscribe(friendly.handle, "AvailableDates", contexts);
      const current = await scope.subscribe(friendly.handle, "Date", contexts);
      return action(scope, { team: team.handle, friendly: friendly.handle, available: available.handle, current: current.handle, index: args.dateIndex });
    });
  }
  return {
    dates: args => dates(args, (scope, query) => Number.isInteger(args.dateIndex) ? scope.api("/api/v1/friendlies/date-preview", query) :
      scope.api("/api/v1/friendlies/date-state", { ...query, operationId: args.operationId })),
    setDate: args => {
      if (!Number.isInteger(args.dateIndex) || args.dateIndex < 0 || !args.operationId || !args.expectedChoiceToken)
        throw new Error("需要原可用日期的dateIndex/token与固定operationId。");
      return dates(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/friendlies/date-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("日期列表或友谊赛草稿已变化，请刷新。");
        return { ...await scope.api("/api/v1/friendlies/date-execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          friendlyConfirmed: false, createdFixtureVerified: false };
      });
    },
    get: args => context(args, (scope, query) => args.optionPath ? scope.api("/api/v1/friendlies/selection-preview", query) :
      scope.api("/api/v1/friendlies/selection-options", query)),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken || !args.optionPath) throw new Error("需要原optionPath/token和固定operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/friendlies/selection-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("候选或友谊赛草稿已变化，请刷新。");
        return { ...await scope.api("/api/v1/friendlies/selection-execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          friendlyConfirmed: false, createdFixtureVerified: false };
      });
    }
  };
}
