import { createLiveClient } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";

export function createPreContractTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (!args.source) throw new Error("提供实际球员 source 及可选 path。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "promises" });
      const routing = await scope.api("/api/v1/contracts/promises/recipes");
      const readOnly = await scope.subscribe(session.handle, "NegotiationReadOnly", contexts);
      const willing = await scope.subscribe(session.handle, "IsWillingToEnterNegotiations", contexts);
      const query = { action: args.action, session: session.handle, club: club.handle, readOnly: readOnly.handle, willing: willing.handle };
      if (!args.action) {
        const promises = await scope.subscribe(session.handle, "PromisesList", contexts);
        const future = await scope.subscribe(session.handle, "FuturePlayingTimesList", contexts);
        return perform(scope, query, { routing, promises: promises.read.value, futurePlayingTimes: future.read.value,
          readOnly: readOnly.read.value, willing: willing.read.value }, false);
      }
      const recipe = routing.recipes.find(r => r.Action === args.action);
      if (!recipe) throw new Error("未知签约前承诺操作；先读取工具返回的 recipes。");
      let target = session.handle, choices;
      if (recipe.Collection) {
        const list = await scope.subscribe(session.handle, recipe.Collection, contexts);
        if (!args.componentPath) return perform(scope, query, { collection: recipe.Collection, components: list.read.value }, false);
        target = { source: list.handle, path: args.componentPath };
        Object.assign(query, { collection: list.handle, componentPath: args.componentPath });
      }
      let owner = target;
      if (recipe.Owner) {
        const component = await scope.subscribe(target, recipe.Owner, contexts);
        owner = component.handle; query.owner = component.handle;
      }
      if (recipe.Permission) query.permission = (await scope.subscribe(target, recipe.Permission, contexts)).handle;
      if (recipe.Lock) {
        const base = await scope.subscribe(owner, "BaseComponentData", contexts);
        owner = base.handle; query.baseInfo = base.handle;
      }
      if (recipe.Current) query.current = (await scope.subscribe(target, recipe.Current, contexts)).handle;
      if (recipe.Choices) {
        const options = await scope.subscribe(owner, recipe.Choices, contexts);
        Object.assign(query, { options: options.handle, optionPath: args.optionPath }); choices = options.read.value;
      }
      if (recipe.Numeric) {
        if (args.value !== undefined && args.value !== null && String(args.value).trim() !== "") query.value = String(args.value);
        return perform(scope, query, { numericInput: true, requestedValue: args.value ?? null },
          args.value !== undefined && args.value !== null && String(args.value).trim() !== "");
      }
      return perform(scope, query, { choices }, !recipe.Choices || Boolean(args.optionPath));
    });
  }
  return {
    get: args => context(args, async (scope, query, values, canPreview) => ({ ok: true, ...values,
      ...(query.current ? { state: await scope.api("/api/v1/contracts/promises/state", { ...query, operationId: args.operationId }) } : {}),
      ...(canPreview ? { preview: await scope.api("/api/v1/contracts/promises/preview", query) } : {}),
      draftOnly: true, liveVerified: false })),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供明确操作、原token及固定operationId。");
      return context(args, async (scope, query, _values, canPreview) => {
        if (!canPreview) throw new Error("先从实际组件/候选中选择 componentPath 或 optionPath。");
        const preview = await scope.api("/api/v1/contracts/promises/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("承诺草稿或合法选项变化，请重新预览。");
        return { ...await scope.api("/api/v1/contracts/promises/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          contractSigned: false, promiseFulfilled: false };
      });
    }
  };
}
