import { createLiveClient } from "./live-client.mjs";

export function createLineupSubmissionTools(call) {
  const client = createLiveClient(call);
  const context = action => client.scope(async scope => {
    const team = await scope.subscribe("human", "Team");
    const human = { source: "human" }, teamRef = { source: team.handle };
    const tactic = await scope.subscribe(team.handle, "Tactic", { Boolean: true, human, Human: human, team: teamRef, Team: teamRef });
    const query = { tactic: tactic.handle };
    for (const [key, property] of Object.entries({ valid: "IsTeamSelectionValid", canConfirm: "CanConfirmTeamSelection",
      message: "TeamSelectionMessage", lineup: "TacticsTeamSelectionData" }))
      query[key] = (await scope.subscribe(tactic.handle, property)).handle;
    query.waiting = (await scope.subscribe("game", "GameWaiting")).handle;
    query.date = (await scope.subscribe("game", "CurrentGameDate")).handle;
    return action(scope, query, await scope.api("/api/v1/tactics/lineup-submission", query));
  });
  return {
    get: () => context(async (_, __, state) => state),
    submit: args => {
      if (!args.operationId || !args.expectedChoiceToken || !Number.isSafeInteger(args.mutationCursor) || args.mutationCursor < 0)
        throw new Error("提供原阵容预览的 token、mutationCursor 和固定 operationId。");
      return context(async (scope, query, preview) => {
        if (!preview.canSubmit) throw new Error(preview.reason + ": " + JSON.stringify(preview.validationMessage));
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("阵容或比赛前置状态已变化，请重新预览。");
        return scope.api("/api/v1/tactics/submit-lineup", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken, mutationCursor: args.mutationCursor }, true);
      });
    }
  };
}
