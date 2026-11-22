import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTrainingTools(call) {
  const client = createLiveClient(call);
  async function context(args, choicesNeeded, action) {
    if (Boolean(args.source) === Number.isInteger(args.squadIndex) || args.squadIndex < 0)
      throw new Error("提供队内球员 squadIndex 或实时球员引用 source，二选一。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const squad = args.source ? null : await scope.subscribe(team.handle, "Players", { human });
      const player = args.source ? { source: args.source, path: args.path || "" } :
        { source: squad.handle, path: String(args.squadIndex) };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef, person: player, Person: player };
      const judge = await scope.subscribe(team.handle, "AssistantManagerOrBestCoach", contexts);
      contexts.Judge = contexts.judge = { source: judge.handle };
      const training = await scope.subscribe(player, "PlayerTraining", contexts);
      if (args.kind === "weaker-foot" && action === null) {
        const allowed = await scope.subscribe(training.handle, "CanTrainWeakerFoot", contexts);
        const active = await scope.subscribe(training.handle, "IsTrainingWeakerFoot", contexts);
        const readFlag = value => {
          const flag = scalar(value);
          if (flag === "True" || flag === true) return true;
          if (flag === "False" || flag === false) return false;
          throw new Error("游戏未返回有效的弱脚训练状态。");
        };
        return { ok: true, canTrainWeakerFoot: readFlag(allowed.read.value), isTrainingWeakerFoot: readFlag(active.read.value) };
      }
      const routing = await scope.api("/api/v1/training/recipes");
      const recipe = routing.recipes.find(r => r.Kind === args.kind);
      if (!recipe) throw new Error("未知个人训练种类。");
      const owner = await scope.subscribe(training.handle, recipe.Owner, contexts);
      const state = await scope.api("/api/v1/training/state", { kind: args.kind, training: training.handle, owner: owner.handle });
      if (!choicesNeeded) return action({ scope, training, owner, state });
      const editable = await scope.subscribe(owner.handle, "CanEdit", contexts);
      const options = await scope.subscribe(recipe.ChoicesOnOwner ? owner.handle : training.handle, recipe.Choices, contexts);
      return action({ scope, training, owner, state, editable, options, contexts });
    });
  }
  return {
    squad: () => client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const squad = await scope.subscribe(team.handle, "Players", { human });
      const players = [];
      for (let index = 0; index < squad.read.value.count; index++) {
        const path = String(index);
        const person = await scope.ready(squad.handle, path);
        if (person.value?.type !== "FM.UI.PersonReference") continue;
        const name = await scope.subscribe({ source: squad.handle, path }, "Name", { human, Human: human });
        players.push({ squadIndex: index, identity: person.value.identity, name: scalar(name.read.value) });
      }
      return { ok: true, players };
    }),
    get: args => context(args, true, args.kind === "weaker-foot" ? null : async ({ scope, training, owner, state, editable, options, contexts }) => {
      const preview = Number.isInteger(args.optionIndex) ? await scope.api("/api/v1/training/preview", { kind: args.kind,
        training: training.handle, owner: owner.handle, editable: editable.handle, options: options.handle, option: args.optionIndex, roleIndex: args.roleIndex, delegation: args.delegation || "respect" }) : null;
      const rest = args.kind === "intensity" ? await scope.subscribeOptional(owner.handle, "RestDaysRemaining", contexts) : null;
      return { ...state, ...(rest ? { restDaysRemaining: scalar(rest.read.value), restStatusUnavailable: rest.unavailable } : {}), editable: scalar(editable.read.value), choices: options.read.value, ...(preview ? { preview } : {}) };
    }),
    set: async args => {
      if (Number.isInteger(args.squadIndex) && !args.expectedChoiceToken)
        throw new Error("使用 squadIndex 执行前，先预览并提供 expectedChoiceToken。");
      if (!Number.isInteger(args.optionIndex) || args.optionIndex < 0) throw new Error("optionIndex 必须是当前游戏选项列表的非负整数下标。");
      const receipt = await context(args, true, async ({ scope, training, owner, state, editable, options }) => {
        if (args.expectedCurrent !== undefined && args.expectedCurrent !== state.current) throw new Error("个人训练状态已变化，请刷新。");
        const query = { kind: args.kind, training: training.handle, owner: owner.handle, editable: editable.handle, options: options.handle, option: args.optionIndex, roleIndex: args.roleIndex, delegation: args.delegation || "respect" };
        const preview = await scope.api("/api/v1/training/preview", query);
        if (args.expectedChoiceToken && args.expectedChoiceToken !== preview.choiceToken) throw new Error("训练选项或当前状态已改变。");
        return scope.api("/api/v1/training/execute", { ...query, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return receipt;
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try {
          // New subscriptions resolve the player and selector again. Do not verify an optimistically set local binding.
          observed = await context(args, false, ({ scope, training, owner }) => scope.api("/api/v1/training/state", {
            kind: args.kind, training: training.handle, owner: owner.handle, operationId: receipt.operationId }));
        } catch (error) { return { ...receipt, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed") return observed;
        await pause(200);
      } while (Date.now() < until);
      return { ...observed, note: "尚未读到目标训练状态；保留 operationId 查询，不自动重发。" };
    }
  };
}
