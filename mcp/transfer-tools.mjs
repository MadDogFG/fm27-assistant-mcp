import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTransferTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!args.source) throw new Error("需要当前实时球员引用 source。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "transfer" });
      const routing = await scope.api("/api/v1/transfers/recipes");
      const collectionName = args.collection || "TransferOfferTransferBaseOptions";
      if (!routing.collections.includes(collectionName)) throw new Error("请从游戏报价条款集合中选择 collection。");
      const collection = await scope.subscribe(session.handle, collectionName, contexts);
      const references = [];
      function visit(node, path = "") {
        if (node?.kind === "reference" && node.type === "FM.UI.TransferOfferClauseReference") references.push({ path, identity: node.identity });
        if (node?.kind === "list") (node.items || []).forEach((item, index) => visit(item, path ? `${path}/${index}` : String(index)));
        if (node?.kind === "record") for (const [key, value] of Object.entries(node.fields || {})) visit(value, path ? `${path}/${key}` : key);
      }
      visit(collection.read.value);
      return action({ scope, session, club, contexts, collection, references, routing });
    });
  }
  async function term(args, action) {
    return context(args, async values => {
      const { scope, session, collection, contexts, references, routing } = values;
      const recipe = routing.recipes.find(recipe => recipe.Kind === args.kind);
      if (!recipe) throw new Error("未知转会条款字段。");
      if (!references.some(reference => reference.path === args.clausePath)) throw new Error("clausePath 必须来自当前游戏条款列表。");
      const clause = { source: collection.handle, path: args.clausePath };
      const current = await scope.subscribe(clause, recipe.Current, contexts);
      const cash = args.kind === "cash" ? await scope.subscribe(clause, recipe.Choices, contexts) : null;
      const choices = cash || await scope.subscribe(clause, recipe.Choices, contexts);
      const offerEditable = await scope.subscribe(session.handle, "CanMakeChangesToOffer", contexts);
      const clauseEnabled = await scope.subscribe(clause, "IsEnabled", contexts);
      const query = { kind: args.kind, session: session.handle, club: values.club.handle, collection: collection.handle,
        clausePath: args.clausePath, current: current.handle, cash: cash?.handle, choices: choices.handle,
        offerEditable: offerEditable.handle, clauseEnabled: clauseEnabled.handle, option: args.optionIndex, amount: args.amount };
      const state = await scope.api("/api/v1/transfers/state", query);
      return action({ ...values, current, cash, choices, offerEditable, clauseEnabled, query, state });
    });
  }
  return {
    list: args => context(args, async ({ scope, collection, contexts, references }) => {
      const clauses = [];
      for (const reference of references) {
        try {
          const source = { source: collection.handle, path: reference.path };
          const description = await scope.subscribe(source, "Description", contexts);
          const enabled = await scope.subscribe(source, "IsEnabled", contexts);
          clauses.push({ ...reference, description: scalar(description.read.value), enabled: scalar(enabled.read.value) });
        } catch (error) { clauses.push({ ...reference, readError: String(error.message || error) }); }
      }
      return { ok: true, clauses, collection: args.collection || "TransferOfferTransferBaseOptions", truncated: Boolean(collection.read.value?.truncated) };
    }),
    get: args => term(args, async ({ state, current, cash, choices, offerEditable, clauseEnabled }) => ({ ...state,
      value: current.read.value, choices: choices.read.value, cashInput: cash?.read.value,
      offerEditable: scalar(offerEditable.read.value), clauseEnabled: scalar(clauseEnabled.read.value) })),
    set: async args => {
      if (args.kind === "cash" ? typeof args.amount !== "string" || !/^[+-]?\d+$/.test(args.amount) : !Number.isInteger(args.optionIndex) || args.optionIndex < 0)
        throw new Error("金额使用游戏现金输入框同单位的整数字符串 amount；其它字段使用合法 optionIndex。");
      const receipt = await term(args, async ({ scope, query, state }) => {
        if (args.expectedCurrent !== undefined && args.expectedCurrent !== state.current) throw new Error("报价条款已变化，请刷新。");
        const preview = await scope.api("/api/v1/transfers/preview", query);
        if (args.expectedChoiceToken && args.expectedChoiceToken !== preview.choiceToken) throw new Error("报价选项或金额上下文已变化。");
        return scope.api("/api/v1/transfers/execute", { ...query, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return receipt;
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try { observed = await term(args, ({ scope, query }) => scope.api("/api/v1/transfers/state", { ...query, operationId: receipt.operationId })); }
        catch (error) { return { ...receipt, verificationError: String(error.message || error), offerSubmitted: false }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, offerSubmitted: false, note: "只核对报价草稿字段；金额可能被游戏换算、取整或限额。未提交报价。" };
    }
  };
}
