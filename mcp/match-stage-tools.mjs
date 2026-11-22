import { createLiveClient } from "./live-client.mjs";

export function createMatchStageTools(call) {
  const client = createLiveClient(call);
  async function context(action) {
    return client.scope(async scope => {
      const match = await scope.api("/api/v1/match/state");
      if (!match.inMatch || match.pastMatch || match.replay || match.spectating)
        throw new Error("需要当前经理执教的真实比赛阶段。");
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      let isHomeTeam = match.isHomeTeam;
      let managerSide;
      if (typeof isHomeTeam !== "boolean") {
        const side = await scope.subscribe("match", "MatchHumanFixtureTeam", { human });
        if (!["0", "1"].includes(side.read.value?.value)) throw new Error("本场比赛尚未确认当前经理的执教方。");
        managerSide = side.handle;
        isHomeTeam = side.read.value.value === "0";
      }
      const contexts = { Boolean: true, human, Human: human, team: teamRef, Team: teamRef, isHomeTeam, IsHomeTeam: isHomeTeam };
      const tactic = await scope.subscribeOptional("match", "Tactic", contexts, 1500);
      const pending = tactic.handle ? await scope.subscribeOptional(tactic.handle, "CanRevert", contexts, 1500) : { handle: null };
      const waiting = await scope.subscribe("game", "GameWaiting");
      const date = await scope.subscribe("game", "CurrentGameDate");
      return action(scope, { waiting: waiting.handle, date: date.handle, tactic: tactic.handle || "", pending: pending.handle || "", managerSide });
    });
  }
  async function state(args = {}) {
    const receipt = args.operationId ? await client.api("/api/v1/commands/status", { id: args.operationId }) : null;
    if (receipt && receipt.command !== "continue_match_stage") throw new Error("请求号不属于比赛阶段继续。");
    try { return await context((scope, query) => scope.api("/api/v1/match/stage-state", { ...query, operationId: args.operationId })); }
    catch (error) {
      if (!receipt) throw error;
      return { ok: true, ready: false, receipt, stageAdvanceVerified: false, retrySafe: false, stateError: String(error.message || error) };
    }
  }
  async function advance(args) {
    const { operationId: id, expectedMatchIdentity: matchIdentity, expectedChoiceToken: choiceToken, mutationCursor } = args;
    if (typeof id !== "string" || !id.trim() || id.length > 100 || typeof matchIdentity !== "string" || !matchIdentity ||
        !/^[a-f0-9]{64}$/i.test(choiceToken || "") || !Number.isSafeInteger(mutationCursor) || mutationCursor < 0)
      throw new Error("需要原预览的比赛身份、token、活动游标与固定 operationId。");
    const lookup = await client.api("/api/v1/game/continue-receipt", { id });
    if (typeof lookup.found !== "boolean") throw new Error("未取得明确请求历史，未执行。");
    const parameters = { id, matchIdentity, choiceToken, mutationCursor };
    const receipt = lookup.found ? await client.api("/api/v1/match/stage-continue", parameters, true) :
      await context(async (scope, query) => {
        const preview = await scope.api("/api/v1/match/stage-state", query);
        if (preview.matchIdentity !== matchIdentity || preview.choiceToken !== choiceToken || !preview.canRequest)
          throw new Error(preview.reason || "比赛阶段或候选已变化，请重新预览。");
        return scope.api("/api/v1/match/stage-continue", { ...query, ...parameters }, true);
      });
    if (receipt.status === "transport_result_unknown") return receipt;
    try { return { receipt, observation: await state({ operationId: id }), stageAdvanceVerified: false, retrySafe: false }; }
    catch (error) { return { receipt, observationError: String(error.message || error), retrySafe: false }; }
  }
  return { state, advance };
}
