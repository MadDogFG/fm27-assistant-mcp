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
      // 同步订阅滑杆与调整后金额通道，使两套预算确认入口都绑定到真实滑杆草稿快照
      const sliderQuery = {
        budget: budget.handle,
        current: (await scope.subscribe(budget.handle, "BudgetAdjustmentSliderValue")).handle,
        editable: query.canEdit,
        transfer: (await scope.subscribe(budget.handle, "BudgetAdjustmentEditedTransferValue")).handle,
        other: (await scope.subscribe(budget.handle, "BudgetAdjustmentEditedOtherValue")).handle
      };
      if (!args.action) return perform(scope, query, false, sliderQuery);
      return perform(scope, query, true, sliderQuery);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete, sliderQuery) => {
      const state = await scope.api("/api/v1/budget-adjustment/state", query);
      if (!complete) return { ...state, draftOnly: true, liveVerified: false };
      const preview = await scope.api("/api/v1/budget-adjustment/preview", query);
      const confirmPreview = await scope.api("/api/v1/commands/preview-budget-confirm", sliderQuery).catch(() => null);
      const combinedToken = confirmPreview?.confirmationToken
        ? `${preview.choiceToken}:${confirmPreview.confirmationToken}`
        : preview.choiceToken;
      return { ...state, ...preview, choiceToken: combinedToken, confirmationToken: confirmPreview?.confirmationToken || null, draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query, _complete, sliderQuery) => {
        const preview = await scope.api("/api/v1/budget-adjustment/preview", query);
        const confirmPreview = await scope.api("/api/v1/commands/preview-budget-confirm", sliderQuery).catch(() => null);
        const expectedRaw = String(args.expectedChoiceToken);
        const expectedParts = expectedRaw.split(":");
        const expectedDialogToken = expectedParts[0];
        const expectedSliderToken = expectedParts[1] || null;
        if (preview.choiceToken !== expectedDialogToken) {
          throw new Error("预算调整草稿变化，请重新预览。");
        }
        if (confirmPreview?.confirmationToken && expectedSliderToken !== confirmPreview.confirmationToken) {
          throw new Error("预算滑杆草稿已变化，请重新调用 get_club_budget_adjustment(action:'confirm') 预览后再确认。");
        }
        return { ...await scope.api("/api/v1/budget-adjustment/execute", { ...query, id: args.operationId, choiceToken: expectedDialogToken }, true),
          budgetApplied: false };
      });
    }
  };
}
