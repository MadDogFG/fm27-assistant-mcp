import { createLiveClient } from "./live-client.mjs";

// Player-side operations recovered from the current build's UI index:
// assistant individual training (target TeamTraining) and agent-offer discards (target human).
export function createPlayerSideTools(call) {
  const client = createLiveClient(call);
  async function trainingContext(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      return perform(scope, { training: training.handle });
    });
  }
  return {
    assistantTrainingPreview: args => trainingContext(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/player-side/assistant-training-preview", query), draftOnly: true, liveVerified: false })),
    assistantTrainingExecute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return trainingContext(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/player-side/assistant-training-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("球队训练状态变化，请重新预览。");
        return { ...await scope.api("/api/v1/player-side/assistant-training-execute",
          { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true), individualTrainingAssigned: false };
      });
    },
    discardOfferPreview: args => discarding(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/player-side/discard-agent-offer-preview", query), draftOnly: true, liveVerified: false })),
    discardOfferExecute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return discarding(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/player-side/discard-agent-offer-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("经纪人报价列表变化，请重新预览。");
        return { ...await scope.api("/api/v1/player-side/discard-agent-offer-execute",
          { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true), offerRemoved: false };
      });
    }
  };
  async function discarding(args, perform) {
    const all = Boolean(args.all);
    return client.scope(async scope => {
      const query = { all: all ? "1" : "0" };
      if (!all) {
        if (!args.source) throw new Error("discard-one 需要球员 source/path。");
        const person = { source: args.source, path: args.path || "" };
        query.person = (await scope.subscribe(person, "Name")).handle;
      }
      return perform(scope, query);
    });
  }
}
