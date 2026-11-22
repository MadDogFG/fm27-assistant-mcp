import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createContractTools(call) {
  const client = createLiveClient(call);
  async function context(args, needsChoices, action) {
    if (!args.source && !Number.isInteger(args.squadIndex)) throw new Error("需要当前实时球员/员工的真实引用 source（或一线队序号 squadIndex）。");
    return client.scope(async scope => {
      const routing = await scope.api("/api/v1/contracts/recipes");
      const recipe = routing.recipes.find(item => item.Kind === args.kind);
      if (!recipe) throw new Error("未知合同草稿条款。");
      const resolved = await scope.resolvePlayerRef(args);
      const person = { source: resolved.source, path: resolved.path };
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club");
      const clubRef = { source: club.handle };
      const contexts = { human, Human: human, person, Person: person, player: person, Player: person,
        buyingclub: clubRef, BuyingClub: clubRef, club: clubRef, Club: clubRef };
      // The shipped ContractNegotiationTool uses this person-owned native session. Do not
      // use CurrentViewedPlayerContextTeam or open its panel to initialize the reference.
      const session = await scope.subscribe(person, "ContractEditSession", contexts);
      const current = await scope.subscribe(session.handle, recipe.Current, contexts);
      const state = await scope.api("/api/v1/contracts/state", { kind: args.kind, session: session.handle, club: club.handle, current: current.handle });
      if (!needsChoices) return action({ scope, session, current, club, state });
      const owner = await scope.subscribe(session.handle, recipe.Owner, contexts);
      const cash = recipe.Cash ? await scope.subscribe(owner.handle, "CashSelectionIntervalsInfo", contexts) : null;
      if (needsChoices === "cash") return action({ scope, session, current, club, state, owner, cash });
      const readOnly = await scope.subscribe(session.handle, "NegotiationReadOnly", contexts);
      const willing = await scope.subscribe(session.handle, "IsWillingToEnterNegotiations", contexts);
      const choiceSource = cash || owner;
      const options = await scope.subscribe(choiceSource.handle, recipe.Choices || "PossibleValues", contexts);
      return action({ scope, session, current, club, state, readOnly, willing, owner, options, cash });
    });
  }
  function query(args, values) {
    return { kind: args.kind, session: values.session.handle, club: values.club.handle, current: values.current.handle,
      owner: values.owner.handle, options: values.options.handle, readOnly: values.readOnly.handle,
      willing: values.willing.handle, option: args.optionIndex };
  }
  return {
    get: args => context(args, true, async values => {
      const preview = Number.isInteger(args.optionIndex) ? await values.scope.api("/api/v1/contracts/preview", query(args, values)) : null;
      return { ...values.state, readOnly: scalar(values.readOnly.read.value), willing: scalar(values.willing.read.value),
        component: values.owner.read.value, choices: values.options.read.value, ...(values.cash ? { cashInput: values.cash.read.value,
          cashInputUnit: "native_cash_combobox_foreign_value" } : {}), ...(preview ? { preview } : {}),
        verificationScope: "contract_draft_term", operationSubmitsContract: false, submissionState: "not_inferred_from_draft" };
    }),
    inputAmount: async args => {
      if (!["wage", "loyalty-bonus", "agent-fee"].includes(args.kind) || typeof args.amount !== "string" || !/^[+-]?\d+$/.test(args.amount))
        throw new Error("请选择工资/忠诚奖金/经纪人费，amount 用十进制整数字符串；单位沿用游戏现金输入框的 ForeignValue.PropertyValue。");
      const receipt = await context(args, true, async values => {
        const parameters = { kind: args.kind, session: values.session.handle, club: values.club.handle, owner: values.owner.handle,
          cash: values.cash?.handle, readOnly: values.readOnly.handle, willing: values.willing.handle, amount: args.amount };
        if (!values.cash) throw new Error("游戏未提供该金额输入的原生选择器。");
        const state = await values.scope.api("/api/v1/contracts/cash-state", parameters);
        if (args.expectedCurrent !== undefined && args.expectedCurrent !== state.current) throw new Error("合同金额输入已变化，请刷新。");
        const preview = await values.scope.api("/api/v1/contracts/cash-preview", parameters);
        if (args.expectedChoiceToken && args.expectedChoiceToken !== preview.choiceToken) throw new Error("金额输入上下文已变化，请刷新。");
        return values.scope.api("/api/v1/contracts/input-amount", { ...parameters, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return { ...receipt, operationSubmitsContract: false };
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try {
          observed = await context(args, "cash", ({ scope, session, club, owner, cash }) => scope.api("/api/v1/contracts/cash-state", {
            operationId: receipt.operationId, kind: args.kind, session: session.handle, club: club.handle, owner: owner.handle, cash: cash?.handle }));
        } catch (error) { return { ...receipt, verificationError: String(error.message || error), operationSubmitsContract: false }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, operationSubmitsContract: false, note: "verified只核对游戏输入框的显示单位，不保证内部原始值恢复一致；提交前检查实际草稿金额。" };
    },
    set: async args => {
      if (!Number.isInteger(args.optionIndex) || args.optionIndex < 0) throw new Error("optionIndex 必须是游戏当前合法列表的非负整数下标。");
      const receipt = await context(args, true, async values => {
        if (args.expectedCurrent !== undefined && args.expectedCurrent !== values.state.current) throw new Error("合同条款已变化，请刷新。");
        const parameters = query(args, values);
        const preview = await values.scope.api("/api/v1/contracts/preview", parameters);
        if (args.expectedChoiceToken && args.expectedChoiceToken !== preview.choiceToken) throw new Error("合同状态或选项已变化，请刷新。");
        return values.scope.api("/api/v1/contracts/execute", { ...parameters, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return { ...receipt, operationSubmitsContract: false };
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try {
          observed = await context(args, false, ({ scope, session, current, club }) => scope.api("/api/v1/contracts/state", {
            operationId: receipt.operationId, kind: args.kind, session: session.handle, club: club.handle, current: current.handle }));
        } catch (error) { return { ...receipt, verificationError: String(error.message || error), operationSubmitsContract: false }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, operationSubmitsContract: false, note: "此操作只核对和编辑合同草稿；不推断合同是否已由其他操作提交、签署或同意。" };
    }
  };
}
