import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createRecruitmentTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    const mode = args.mode || "new";
    if (!["new", "existing"].includes(mode) || mode === "existing" && !args.focusPath) throw new Error("使用 new 或 existing；已有重点必须提供实际 focusPath。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const info = await scope.subscribeOptional("human", "ScoutingInfo", contexts);
      if (!info.handle) return { ok: true, available: false, unavailable: info.unavailable };
      const source = await scope.subscribeOptional(info.handle, mode === "new" ? "NewRecruitmentFocus" : "RecruitmentFocusesList", contexts);
      if (!source.handle) return { ok: true, available: false, unavailable: source.unavailable };
      const focus = { source: source.handle, path: mode === "new" ? "" : args.focusPath };
      const query = { info: info.handle, ...focus };
      return action({ scope, focus, query, contexts, team: team.handle });
    });
  }
  async function setting(args, action) {
    return context(args, async ({ scope, focus, query, contexts }) => {
      const routing = await scope.api("/api/v1/recruitment/recipes");
      const recipe = routing.recipes.find(row => row.Kind === args.kind);
      if (!recipe) throw new Error("未知招募重点设置。");
      query.kind = args.kind;
      query.current = (await scope.subscribe(focus, recipe.Current, contexts)).handle;
      const state = await scope.api("/api/v1/recruitment/state", query);
      const value = { ...state, kind: args.kind, inputType: recipe.Input };
      if (recipe.Choices) {
        const choices = await scope.subscribe(focus, recipe.Choices, contexts);
        query.choices = choices.handle; value.choices = choices.read.value;
      }
      if (recipe.Input === "star-step") {
        const increment = await scope.subscribe(focus, recipe.Increment, contexts);
        const decrement = await scope.subscribe(focus, recipe.Decrement, contexts);
        Object.assign(query, { increment: increment.handle, decrement: decrement.handle });
        value.increaseEnabled = increment.read.value; value.decreaseEnabled = decrement.read.value;
        value.operation = "one native scouting requirement step; player attributes are not edited";
      }
      if (recipe.Input === "proficiency-step") {
        if (!/^[123]$/.test(String(state.current))) throw new Error("游戏未返回 1～3 档角色熟练度要求。");
        const level = Number(state.current);
        value.increaseEnabled = level < 3; value.decreaseEnabled = level > 1;
        value.stepBounds = { min: 1, max: 3, source: "current_build_shipped_ui_comparison_and_native_event" };
        value.operation = "one native role proficiency requirement step; player attributes are not edited";
      }
      if (recipe.Input === "priority_index") {
        const mode = await scope.subscribe("singleton:FM.UI.ConfigReference", "UseSimplifiedRecruitment");
        query.simplified = mode.handle;
        const isSimplified = scalar(mode.read.value);
        if (!["True", "False"].includes(isSimplified)) throw new Error("招募模式不可用。");
        value.priorityIndices = isSimplified === "True" ? [0, 1] : [0, 1, 2];
        value.choiceSource = "current_build_shipped_focus_priority_buttons_and_live_mode";
      }
      Object.assign(query, { option: args.optionIndex, optionPath: args.optionPath, input: args.input });
      if (args.optionIndex !== undefined || args.optionPath !== undefined || args.input !== undefined) value.preview = await scope.api("/api/v1/recruitment/preview", query);
      return action({ scope, query, state, value });
    });
  }
  async function snapshot(args, action) {
    return context(args, async ({ scope, focus, query, contexts }) => {
      const routing = await scope.api("/api/v1/recruitment/recipes");
      const fields = {};
      for (const name of routing.snapshotFields) fields[name] = (await scope.subscribe(focus, name, contexts)).handle;
      query.fields = fields;
      const draft = await scope.api("/api/v1/recruitment/snapshot", query);
      return action({ scope, query, draft });
    });
  }
  async function areaState(args, operationId, areaKey) {
    return context(args, async ({ scope, focus, query, contexts }) => {
      query.areas = (await scope.subscribe(focus, "Areas", contexts)).handle;
      return scope.api("/api/v1/recruitment/area-state", { ...query, operationId, areaKey });
    });
  }
  async function areaOptions(args, action) {
    if (!["add", "remove"].includes(args.action)) throw new Error("地区操作使用 add 或 remove。");
    return context(args, async ({ scope, focus, query, contexts, team }) => {
      query.areas = (await scope.subscribe(focus, "Areas", contexts)).handle;
      query.action = args.action;
      const value = await scope.api("/api/v1/recruitment/area-state", query);
      if (args.action === "add") {
        query.team = team;
        query.selector = (await scope.subscribe(focus, "PossibleScoutingAreasDropdownSelectedOption", contexts)).handle;
        const choices = await scope.subscribe(team, "PossibleScoutingAreasDropdown", contexts);
        query.choices = choices.handle; value.choices = choices.read.value;
      }
      if (args.optionPath !== undefined) {
        query.optionPath = args.optionPath;
        value.preview = await scope.api("/api/v1/recruitment/area-preview", query);
      }
      return action({ scope, query, value });
    });
  }
  async function staffState(args, operationId) {
    if (!["scouts", "analysts"].includes(args.kind)) throw new Error("人员类型使用 scouts 或 analysts。");
    return context(args, async ({ scope, focus, query, contexts }) => {
      query.kind = args.kind;
      query.current = (await scope.subscribe(focus, args.kind === "scouts" ? "Scouts" : "Analysts", contexts)).handle;
      query.any = (await scope.subscribe(focus, args.kind === "scouts" ? "AnyScout" : "AnyAnalyst", contexts)).handle;
      return scope.api("/api/v1/recruitment/staff-state", { ...query, operationId });
    });
  }
  async function staffOptions(args, action) {
    if (!["scouts", "analysts"].includes(args.kind)) throw new Error("人员类型使用 scouts 或 analysts。");
    if (args.selection !== undefined && !["any", "explicit"].includes(args.selection)) throw new Error("人员选择使用 any 或 explicit。");
    return context(args, async ({ scope, focus, query, contexts, team }) => {
      query.kind = args.kind;
      const property = args.kind === "scouts" ? "Scouts" : "Analysts";
      query.current = (await scope.subscribe(focus, property, contexts)).handle;
      query.any = (await scope.subscribe(focus, args.kind === "scouts" ? "AnyScout" : "AnyAnalyst", contexts)).handle;
      const value = await scope.api("/api/v1/recruitment/staff-state", query);
      if (args.selection !== "any") {
        query.team = team;
        query.container = (await scope.subscribe(team, "TeamContainer", contexts)).handle;
        const choices = await scope.subscribe(query.container, property, contexts);
        query.choices = choices.handle; value.choices = choices.read.value;
      }
      if (args.selection !== undefined) {
        query.selection = args.selection; query.personPaths = args.personPaths;
        if (args.selection === "any" || args.personPaths !== undefined) value.preview = await scope.api("/api/v1/recruitment/staff-preview", query);
      }
      return action({ scope, query, value });
    });
  }
  return {
    list: () => client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const info = await scope.subscribe("human", "ScoutingInfo", contexts);
      return { ok: true, focuses: (await scope.subscribe(info.handle, "RecruitmentFocusesList", contexts)).read.value, liveVerified: false };
    }),
    get: args => setting(args, async ({ value }) => value),
    set: async args => {
      if (!args.expectedChoiceToken || args.optionIndex === undefined && args.optionPath === undefined && args.input === undefined) throw new Error("先预览合法招募重点设置，再提供 expectedChoiceToken 和原选项/输入。");
      const receipt = await setting(args, async ({ scope, query, value }) => {
        if (value.preview?.choiceToken !== args.expectedChoiceToken) throw new Error("重点或合法选项已变化，请重新读取。");
        return scope.api("/api/v1/recruitment/execute", { ...query, choiceToken: args.expectedChoiceToken, id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || receipt.status !== "dispatched_unverified") return { ...receipt, focusSubmitted: false };
      const until = Date.now() + 8000; let observed = receipt;
      do {
        try { observed = await setting({ ...args, optionIndex: undefined, optionPath: undefined, input: undefined }, ({ scope, query }) =>
          scope.api("/api/v1/recruitment/state", { ...query, operationId: receipt.operationId })); }
        catch (error) { return { ...receipt, focusSubmitted: false, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, focusSubmitted: false };
    },
    draft: args => snapshot(args, async ({ draft }) => draft),
    areas: args => areaOptions(args, async ({ value }) => value),
    staff: args => args.operationId ? staffState(args, args.operationId) : staffOptions(args, async ({ value }) => value),
    stageStaff: async args => {
      if (!args.expectedChoiceToken || !["any", "explicit"].includes(args.selection) ||
          args.selection === "explicit" && (!Array.isArray(args.personPaths) || args.personPaths.some(path => typeof path !== "string")) ||
          args.selection === "any" && args.personPaths !== undefined && (!Array.isArray(args.personPaths) || args.personPaths.length))
        throw new Error("先预览人员选择并提供 token；explicit 必须提供原人员列表的 personPaths（可为 []），any 不指定人员。");
      const receipt = await staffOptions(args, async ({ scope, query, value }) => {
        if (value.preview?.choiceToken !== args.expectedChoiceToken) throw new Error("人员、候选或任意人员模式已变化，请重新读取。");
        return scope.api("/api/v1/recruitment/staff-execute", { ...query, choiceToken: args.expectedChoiceToken,
          id: args.operationId || randomUUID() }, true);
      });
      if (receipt.verified || receipt.status !== "dispatched_unverified") return { ...receipt, focusSubmitted: false };
      const until = Date.now() + 8000; let observed = receipt;
      do {
        try { observed = await staffState(args, receipt.operationId); }
        catch (error) { return { ...receipt, focusSubmitted: false, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, focusSubmitted: false };
    },
    changeArea: async args => {
      if (!args.expectedChoiceToken || typeof args.optionPath !== "string" || !args.optionPath.length)
        throw new Error("先预览实际地区候选，再提供原 optionPath 和 expectedChoiceToken。");
      const receipt = await areaOptions(args, async ({ scope, query, value }) => {
        if (value.preview?.choiceToken !== args.expectedChoiceToken) throw new Error("地区或候选已变化，请重新读取。");
        const result = await scope.api("/api/v1/recruitment/area-execute", { ...query, choiceToken: args.expectedChoiceToken,
          id: args.operationId || randomUUID() }, true);
        return { ...(result.receipt || result), areaKey: result.areaKey || value.preview.areaKey, focusSubmitted: false };
      });
      if (receipt.verified || receipt.status !== "dispatched_unverified") return receipt;
      const until = Date.now() + 8000; let observed = receipt;
      do {
        try { observed = await areaState(args, receipt.operationId, receipt.areaKey); }
        catch (error) { return { ...receipt, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, areaKey: receipt.areaKey, focusSubmitted: false };
    },
    complete: args => {
      if (!["submit", "cancel"].includes(args.action) || !args.expectedDraftToken) throw new Error("先读取重点草稿，再提供 submit/cancel 和 expectedDraftToken。");
      return snapshot(args, async ({ scope, query, draft }) => {
        if (draft.draftToken !== args.expectedDraftToken) throw new Error("重点草稿已变化，请重新读取。");
        const receipt = await scope.api("/api/v1/recruitment/complete", { ...query, action: args.action, draftToken: args.expectedDraftToken,
          id: args.operationId || randomUUID() }, true);
        return { ...receipt, note: "只记录原生提交/取消派发。提交 token 覆盖已恢复字段，尚非完整筛选序列化；新建 ID、实际创建/变更与球探任务生效需从游戏结果另外核对。" };
      });
    }
  };
}
