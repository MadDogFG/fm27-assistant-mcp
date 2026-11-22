import { createLiveClient } from "./live-client.mjs";

// Club code-of-conduct fines: human.Club -> CodeOfConduct, Fines rows, then increment/decrement/change
// on an actual CodeOfConductFineReference. Events 80/79/1850488427 come from ClubCodeOfConductFineCell.
export function createCodeOfConductTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club", { Human: human, human });
      const contexts = { Human: human, human, Club: { source: club.handle }, club: { source: club.handle } };
      const coc = await scope.subscribeOptional(club.handle, "CodeOfConduct", contexts);
      if (!coc.handle) return { ok: true, available: false, unavailable: coc.unavailable, fines: null };
      const fines = await scope.subscribeOptional(coc.handle, "Fines", contexts);
      if (!fines.handle) return { ok: true, available: true, coc: coc.handle, fines: null, unavailable: fines.unavailable };
      const query = { coc: coc.handle, fines: fines.handle };
      if (args.finePath === undefined) return perform(scope, query, { fines: fines.read.value }, false);
      const row = { source: fines.handle, path: String(args.finePath) };
      query.finePath = String(args.finePath);
      query.fineString = (await scope.subscribe(row, "FineString", contexts)).handle;
      query.canEdit = (await scope.subscribe(row, "CanEdit", contexts)).handle;
      query.canIncrement = (await scope.subscribe(row, "CanIncrementValue", contexts)).handle;
      query.canDecrement = (await scope.subscribe(row, "CanDecrementValue", contexts)).handle;
      query.fineType = (await scope.subscribe(row, "FineAndOffenceType", contexts)).handle;
      query.dropdown = (await scope.subscribe(row, "FineDropdown", contexts)).handle;
      if (!args.action) return perform(scope, query, {}, false);
      query.action = args.action; query.optionPath = args.optionPath;
      return perform(scope, query, {}, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, values, complete) => {
      if (!complete) return { ok: true, ...values, draftOnly: true, liveVerified: false };
      const state = await scope.api("/api/v1/code-of-conduct/state", query);
      return { ...state, ...await scope.api("/api/v1/code-of-conduct/preview", query), draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken || args.finePath === undefined) throw new Error("提供 finePath、action、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/code-of-conduct/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("行为准则罚款草稿变化，请重新预览。");
        return { ...await scope.api("/api/v1/code-of-conduct/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          fineApplied: false };
      });
    }
  };
}
