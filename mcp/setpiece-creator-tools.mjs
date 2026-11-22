import { createLiveClient } from "./live-client.mjs";

// Uses original answers and the normal completion event only in its native creation phase.
export function createSetPieceCreatorTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { human: { source: "human" }, Human: { source: "human" }, Tactic: { source: tactic }, tactic: { source: tactic } };
      const creator = await scope.subscribe(tactic, "SetPieceCreator", contexts);
      const handles = {};
      for (const [key, property] of Object.entries({started: "HasSetPieceCreatorStarted", completed: "HasSetPieceCreatorCompleted", question: "QuestionID", answers: "AnswerList", step: "CurrentCreatorStep", substep: "CurrentCreatorSubstep", state: "SetPieceCreatorState", final: "IsFinalQuestion", maxStep: "MaxCreatorStep", maxSubstep: "MaxSubstep"}))
        handles[key] = (await scope.subscribe(creator.handle, property)).handle;
      return perform(scope, { creator: creator.handle, ...handles, action: args.action, optionPath: args.optionPath ?? "" });
    });
  }
  return {
    preview: (args = {}) => context(args, (scope, query) => scope.api(args.action ? "/api/v1/set-piece/creator-preview" : "/api/v1/set-piece/creator-state", query)),
    execute: async args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      const dispatched = await context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/set-piece/creator-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("向导状态变化，请重新预览。");
        const receipt = await scope.api("/api/v1/set-piece/creator-execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        return { receipt, sessionId: preview.sessionId, epoch: preview.epoch, creatorIdentity: preview.creatorIdentity };
      });
      let observation;
      if (dispatched.receipt.status === "dispatched_unverified") {
        try {
          observation = await context({}, (scope, query) => scope.api("/api/v1/set-piece/creator-state", query));
          if (observation.sessionId !== dispatched.sessionId || observation.epoch !== dispatched.epoch ||
              observation.creatorIdentity !== dispatched.creatorIdentity)
            throw new Error("游戏会话或定位球向导已变化，无法关联此次读回。");
        } catch (error) { observation = { verified: false, error: String(error.message || error) }; }
      }
      return { ...dispatched.receipt, ...(observation ? { observation } : {}),
        note: "向导读回不等于套路已生效；完成后核对阵容提交校验及实际套路。" };
    }
  };
}

