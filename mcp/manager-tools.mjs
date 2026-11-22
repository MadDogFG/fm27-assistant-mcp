import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";

export function createManagerTools(call) {
  const client = createLiveClient(call);
  async function budget(action) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const club = await scope.subscribe("human", "Club", { human, Human: human });
      const adjustment = await scope.subscribe(club.handle, "BudgetAdjustment",
        { human, Human: human, team: { source: team.handle }, Team: { source: team.handle }, ViewID: 0 });
      const current = await scope.subscribe(adjustment.handle, "BudgetAdjustmentSliderValue");
      const limits = await scope.subscribe(adjustment.handle, "BudgetAdjustmentSliderProps");
      const editable = await scope.subscribe(adjustment.handle, "BudgetAdjustmentCanEditBudgets");
      const transfer = await scope.subscribe(adjustment.handle, "BudgetAdjustmentEditedTransferValue");
      const other = await scope.subscribe(adjustment.handle, "BudgetAdjustmentEditedOtherValue");
      return action({ scope, adjustment, current, limits, editable, transfer, other });
    });
  }
  return {
    getClubBudgetBalances: () => client.scope(async scope => {
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club", { human, Human: human });
      const transfer = await scope.subscribe(club.handle, "TransferBudget");
      const wages = await scope.subscribe(club.handle, "WagesData");
      const wageBudget = await scope.subscribe(wages.handle, "CurrentWageBudgetValue");
      return { ok: true, scope: "live_club_budget",
        transferBudget: transfer.read.value, wageBudget: wageBudget.read.value };
    }),
    getBudgetAllocation: () => budget(async ({ current, limits, editable, transfer, other }) => ({ ok: true, scope: "budget_draft",
      index: scalar(current.read.value), editable: scalar(editable.read.value), limits: limits.read.value,
      editedTransferDisplay: scalar(transfer.read.value), editedOtherDisplay: scalar(other.read.value),
      note: "预算金额是游戏的显示文本；读取来源为当前经理的俱乐部预算分配引用。" })),
    stageBudgetAllocation: args => budget(async ({ scope, adjustment, current, limits, editable }) => {
      if (!Number.isInteger(args.index)) throw new Error("index 必须是游戏合法分配档位的整数索引。");
      return scope.finish(await scope.api("/api/v1/commands/stage-budget-allocation", { id: args.operationId || randomUUID(),
        budget: adjustment.handle, current: current.handle, limits: limits.handle, editable: editable.handle, index: args.index,
        expected: args.expected ?? scalar(current.read.value) }, true));
    }),
    confirmBudgetAllocation: args => budget(async ({ scope, adjustment, current, editable, transfer, other }) => {
      const query = { budget: adjustment.handle, current: current.handle, editable: editable.handle, transfer: transfer.handle, other: other.handle };
      const preview = await scope.api("/api/v1/commands/preview-budget-confirm", query);
      if (args.expectedConfirmationToken && args.expectedConfirmationToken !== preview.confirmationToken) throw new Error("预算草稿已变化，请刷新。");
      return scope.api("/api/v1/commands/confirm-budget-allocation", { ...query, id: args.operationId || randomUUID(), confirmationToken: preview.confirmationToken }, true);
    }),
    // Read only: return missing context requirements rather than filling them with guesses or opening pages.
    readArea: args => client.scope(async scope => {
      const filters = { finance: /Budget|Balance|Finance|Wage|Spend/i, training: /Training|Fitness|Workload|Schedule/i,
        recruitment: /Scout|Recruit|Shortlist|Knowledge/i, transfers: /Transfer|Contract|Negotiat|Offer/i,
        club: /Club|Board|Facilities|Staff|Vision|Responsib/i, match: /Match|Fixture|TeamSelection|Tactic/i };
      const pattern = filters[args.area];
      if (!pattern) throw new Error("未知管理领域。");
      const source = { source: args.source || "human", ...(args.path ? { path: args.path } : {}) };
      const metadata = (await scope.properties(source)).filter(p => pattern.test(p.name));
      const values = [], skipped = [];
      for (const property of metadata.slice(0, Math.min(args.limit ?? 20, 40))) {
        const name = property.name.split(":")[0];
        const missing = (property.contexts || []).map(c => c.name.split(":")[0]).filter(n => !Object.hasOwn(args.contexts || {}, n));
        if (missing.length) { skipped.push({ name, requiredContexts: missing }); continue; }
        const data = await scope.subscribe(source, name, args.contexts || {});
        values.push({ name, value: data.read.value, revision: data.read.revision, updatedAt: data.read.updatedAt });
      }
      return { ok: true, area: args.area, source: "live_game", values, skipped, totalProperties: metadata.length,
        truncated: metadata.length > (args.limit ?? 20) };
    })
  };
}
