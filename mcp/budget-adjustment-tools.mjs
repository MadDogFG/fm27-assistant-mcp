import { createLiveClient } from "./live-client.mjs";

// Club budget adjustment dialog: human.Club -> BudgetAdjustment -> strings + CanEditBudgets, then
// confirm event 146. Slider editing is intentionally not wired in this batch.
export function createBudgetAdjustmentTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const club = await scope.subscribe("human", "Club", { Human: human, human });
      const contexts = { Human: human, human, Club: { source: club.handle }, club: { source: club.handle },
        team: { source: team.handle }, Team: { source: team.handle }, ViewID: 0 };
      const budget = await scope.subscribe(club.handle, "BudgetAdjustment", contexts);
      const query = { budget: budget.handle };
      query.canEdit = (await scope.subscribe(budget.handle, "BudgetAdjustmentCanEditBudgets", contexts)).handle;
      for (const [key, name] of [["board", "BudgetAdjustmentBoardString"], ["currentSpend", "BudgetAdjustmentCurrentSpendString"],
        ["ffp", "BudgetAdjustmentFFpString"], ["scouting", "BudgetAdjustmentScoutingBudgetString"], ["agentFees", "BudgetAdjustmentAgentFeesString"]])
        query[key] = (await scope.subscribe(budget.handle, name, contexts)).handle;
      if (!args.action) return perform(scope, query, false);
      return perform(scope, query, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete) => {
      const state = await scope.api("/api/v1/budget-adjustment/state", query);
      return complete ? { ...state, ...await scope.api("/api/v1/budget-adjustment/preview", query), draftOnly: true, liveVerified: false }
        : { ...state, draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/budget-adjustment/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("预算调整草稿变化，请重新预览。");
        return { ...await scope.api("/api/v1/budget-adjustment/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          budgetApplied: false };
      });
    }
  };
}
