import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";

export function createNegotiationLifecycleTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!args.source) throw new Error("提供实时球员 source。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "transfer" });
      const routing = await scope.api("/api/v1/transfers/lifecycle-recipes");
      const recipe = routing.recipes.find(r => r.Kind === args.kind || r.kind === args.kind);
      if (!recipe) throw new Error("选择实际支持的报价/交换球员操作。");
      const editable = await scope.subscribe(session.handle, "CanMakeChangesToOffer", contexts);
      const query = { kind: args.kind, session: session.handle, club: club.handle, editable: editable.handle };
      let owner = session.handle;
      if (recipe.Exchange ?? recipe.exchange) {
        const exCtx = { ...contexts, ExchangePlayerListFilter: Number.isInteger(args.exchangeFilter) ? args.exchangeFilter : 0 };
        const collection = await scope.subscribe(session.handle, routing.exchangeCollection, exCtx);
        if (!args.playerPath) return action(scope, query, collection.read.value);
        owner = { source: collection.handle, path: args.playerPath };
        Object.assign(query, { collection: collection.handle, playerPath: args.playerPath });
      }
      const curCtx = { ...contexts, ExchangePlayerListFilter: Number.isInteger(args.exchangeFilter) ? args.exchangeFilter : 0 };
      query.current = (await scope.subscribe(owner, recipe.Property || recipe.property, curCtx)).handle;
      return action(scope, query);
    });
  }
  async function dateContext(args, action) {
    if (!args.source || !["start-date", "end-date"].includes(args.kind) || !args.collection || !args.clausePath)
      throw new Error("提供真实球员 source、报价条款collection/clausePath和start-date/end-date。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "transfer" });
      const recipes = await scope.api("/api/v1/transfers/recipes");
      if (!recipes.collections.includes(args.collection)) throw new Error("必须使用原生报价条款集合。");
      const collection = await scope.subscribe(session.handle, args.collection, contexts);
      const clause = { source: collection.handle, path: args.clausePath };
      const editable = await scope.subscribe(session.handle, "CanMakeChangesToOffer", contexts);
      const enabled = await scope.subscribe(clause, "IsEnabled", contexts);
      const selector = await scope.subscribe(clause, args.kind === "start-date" ? "TransferOfferClauseStartDateSelection" : "TransferOfferClauseEndDateSelection", contexts);
      return action(scope, { kind: args.kind, session: session.handle, club: club.handle, collection: collection.handle, clausePath: args.clausePath,
        editable: editable.handle, enabled: enabled.handle, selector: selector.handle, dateSource: args.dateSource, datePath: args.datePath || "" });
    });
  }
  return {
    dateGet: args => dateContext(args, (scope, query) => args.dateSource ? scope.api("/api/v1/transfers/date-preview", query) :
      scope.api("/api/v1/transfers/date-state", { ...query, operationId: args.operationId })),
    dateExecute: args => {
      if (!args.dateSource || !args.expectedChoiceToken) throw new Error("需要真实GameDate的dateSource/datePath和原预览token。");
      return dateContext(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/transfers/date-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("日期候选、范围或条款已变化，请刷新。");
        return { ...await scope.api("/api/v1/transfers/date-execute", { ...query, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true), offerSubmitted: false };
      });
    },
    get: args => context(args, async (scope, query, players) => players ? { ok: true, potentialExchangePlayers: players } :
      typeof args.selected === "boolean" ? scope.api("/api/v1/transfers/lifecycle-preview", { ...query, selected: args.selected }) :
        scope.api("/api/v1/transfers/lifecycle-state", { ...query, operationId: args.operationId })),
    execute: args => {
      if (typeof args.selected !== "boolean" || !args.expectedChoiceToken) throw new Error("提供selected布尔值和原预览expectedChoiceToken。");
      return context(args, async (scope, query, players) => {
        if (players) throw new Error("先选择真实playerPath，不能按名称猜球员。");
        const preview = await scope.api("/api/v1/transfers/lifecycle-preview", { ...query, selected: args.selected });
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("报价草稿或选人状态已变化，请刷新。");
        return { ...await scope.api("/api/v1/transfers/lifecycle-execute", { ...query, selected: args.selected, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true),
          offerSubmitted: false, playerTransferred: false };
      });
    }
  };
}
