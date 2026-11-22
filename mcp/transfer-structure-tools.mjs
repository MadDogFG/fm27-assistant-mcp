import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTransferStructureTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (!args.source || !["add-clause", "remove-clause", "offer-type"].includes(args.action)) throw new Error("提供球员 source 和 add-clause/remove-clause/offer-type。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "transfer" });
      const editable = await scope.subscribe(session.handle, "CanMakeChangesToOffer", contexts);
      const query = { action: args.action, session: session.handle, club: club.handle, editable: editable.handle };
      let value;
      if (args.action === "remove-clause") {
        const routing = await scope.api("/api/v1/transfers/recipes");
        if (!routing.collections.includes(args.collection)) throw new Error("collection 必须来自游戏报价条款集合。");
        if (!args.clausePath) throw new Error("提供 get_transfer_clauses 返回的 clausePath。");
        const collection = await scope.subscribe(session.handle, args.collection, contexts);
        const permission = await scope.subscribe({ source: collection.handle, path: args.clausePath }, "CanRemoveClause", contexts);
        Object.assign(query, { collection: collection.handle, clausePath: args.clausePath, canRemove: permission.handle });
        value = collection.read.value;
      } else {
        const routing = await scope.api("/api/v1/transfers/structure-recipes");
        let property = args.action === "offer-type" ? "TransferOfferTypeList" : args.candidateProperty;
        if (args.action === "add-clause" && !routing.candidateProperties.includes(property)) throw new Error("candidateProperty 必须来自游戏提供的费用/条款候选集合。");
        let owner = session;
        if (!(await scope.properties(owner.handle, property)).some(item => item.name.split(":")[0] === property)) {
          if (args.action === "offer-type" && (await scope.properties(session.handle, "TypeOptionList")).some(item => item.name.split(":")[0] === "TypeOptionList")) {
            property = "TypeOptionList";
          } else {
            owner = await scope.subscribe(session.handle, "TransferOfferClientContext", contexts);
          }
        }
        const options = await scope.subscribe(owner.handle, property, contexts);
        Object.assign(query, { options: options.handle, optionPath: args.optionPath });
        if (args.action === "offer-type") query.current = (await scope.subscribe(session.handle, "TransferOfferTypeDropdownSelection", contexts)).handle;
        value = options.read.value;
      }
      return perform({ scope, query, value });
    });
  }
  return {
    get: args => context(args, async ({ scope, query, value }) => ({ ok: true, action: args.action, choices: value,
      ...(args.optionPath || args.action === "remove-clause" ? { preview: await scope.api("/api/v1/transfers/structure-preview", query) } : {}) })),
    execute: async args => {
      if (!args.expectedChoiceToken) throw new Error("先读取并预览原生选项，再提供 expectedChoiceToken。");
      const receipt = await context(args, async ({ scope, query }) => {
        const preview = await scope.api("/api/v1/transfers/structure-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("报价结构或候选项已变化，请刷新。");
        return scope.api("/api/v1/transfers/structure-execute", { ...query, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (args.action !== "offer-type" || receipt.verified || receipt.status !== "dispatched_unverified")
        return { ...receipt, offerSubmitted: false, note: "新增/删除只记录原生派发；条款下标可能被游戏重排，不能用旧下标的存在/消失证明执行成功。" };
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try { observed = await context(args, ({ scope, query }) => scope.api("/api/v1/transfers/type-state", { ...query, operationId: receipt.operationId })); }
        catch (error) { return { ...receipt, verificationError: String(error.message || error), offerSubmitted: false }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, offerSubmitted: false };
    }
  };
}
