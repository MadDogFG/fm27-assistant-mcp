import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";
import { resolveNegotiationSession } from "./negotiation-tools.mjs";

export function createContractStructureTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (!args.source) throw new Error("提供真实球员或员工 source。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, { ...args, domain: "contract" });
      const readOnly = await scope.subscribe(session.handle, "NegotiationReadOnly", contexts);
      const willing = await scope.subscribe(session.handle, "IsWillingToEnterNegotiations", contexts);
      const query = { action: args.action, session: session.handle, club: club.handle, readOnly: readOnly.handle, willing: willing.handle };
      let choices;
      if (["add-bonus", "add-clause"].includes(args.action)) {
        const candidates = args.action === "add-clause" ? ["ClausesCanAdd"] : ["BonusesCanAdd", "BonusesTabCanAdd"];
        const metadata = await scope.properties(session.handle);
        const name = candidates.find(name => metadata.some(p => p.name.split(":")[0] === name));
        if (!name) throw new Error("游戏未提供该合同新增候选。");
        const options = await scope.subscribe(session.handle, name, contexts);
        Object.assign(query, { options: options.handle, optionPath: args.optionPath }); choices = options.read.value;
      } else if (["reset", "use-existing"].includes(args.action)) {
        const permission = await scope.subscribe(session.handle, args.action === "reset" ? "CanResetTerms" : "CanUseExistingContract", contexts);
        if (String(scalar(permission.read.value)).toLowerCase() !== "true") throw new Error("游戏当前不允许重置条款或采用现有合同。");
        query.permission = permission.handle;
      } else {
        if (!["AddOnList", "BonusesList", "ClausesList"].includes(args.collection) || !args.componentPath)
          throw new Error("提供真实 AddOnList/BonusesList/ClausesList 与 componentPath。");
        const collection = await scope.subscribe(session.handle, args.collection, contexts);
        const component = { source: collection.handle, path: args.componentPath };
        const baseInfo = await scope.subscribe(component, "BaseComponentData", contexts);
        Object.assign(query, { collection: collection.handle, componentPath: args.componentPath, baseInfo: baseInfo.handle });
        const permissions = { "remove-addon": "AddOnCanBeRemoved", numeric: "AddOnRequiresNumericValue", "cash-increase": "AddOnRequiresCashValue", "cash-decrease": "AddOnRequiresCashValue" };
        if (permissions[args.action]) query.permission = (await scope.subscribe(component, permissions[args.action], contexts)).handle;
        if (["numeric", "lock"].includes(args.action)) {
          query.current = (await scope.subscribe(component, args.action === "numeric" ? "AddOnNumericValue" : "AddOnLockStatus", contexts)).handle;
          const options = await scope.subscribe(args.action === "numeric" ? component : baseInfo.handle,
            args.action === "numeric" ? "AddOnPossibleNumericValues" : "PossibleLockStatuses", contexts);
          Object.assign(query, { options: options.handle, optionPath: args.optionPath }); choices = options.read.value;
        } else choices = collection.read.value;
      }
      return perform(scope, query, choices);
    });
  }
  return {
    get: args => context(args, async (scope, query, choices) => ({ ok: true, choices,
      ...(args.optionPath || !["add-bonus", "add-clause", "numeric", "lock"].includes(args.action) ? { preview: await scope.api("/api/v1/contracts/structure-preview", query) } : {}) })),
    execute: args => {
      if (!args.expectedChoiceToken) throw new Error("先读取合同结构候选并预览，提供原 expectedChoiceToken。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/contracts/structure-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("合同结构或选项已变化，请刷新。");
        return { ...await scope.api("/api/v1/contracts/structure-execute", { ...query, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true),
          operationSubmitsContract: false, liveVerified: false };
      });
    }
  };
}
