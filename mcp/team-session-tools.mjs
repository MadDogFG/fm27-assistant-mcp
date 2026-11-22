import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTeamSessionTools(call) {
  const client = createLiveClient(call);
  async function context(args, choices, action) {
    const delegation = args.delegation || "respect";
    if (!["respect", "take_control_this_once", "take_control_all"].includes(delegation)) throw new Error("未知团队训练职责模式。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      const calendar = await scope.subscribe("human", "TrainingCalendar", contexts);
      const month = await scope.subscribe(calendar.handle, "TodayMonthIndex", contexts);
      const months = args.monthPath !== undefined ? await scope.subscribe(calendar.handle, "MonthsDropdown", contexts) : null;
      contexts.MonthIndex = months ? { valueSource: months.handle, path: args.monthPath } : { valueSource: month.handle };
      const days = await scope.subscribe(calendar.handle, "MonthEvents", contexts);
      const query = { calendar: calendar.handle, days: days.handle, dayPath: args.dayPath, eventPath: args.eventPath, delegation };
      if (args.dayPath === undefined) return action({ scope, query, value: { ok: true, days: days.read.value } });
      const day = { source: days.handle, path: args.dayPath };
      const date = await scope.subscribe(day, "Date", contexts);
      const events = await scope.subscribe(day, "Events", contexts);
      Object.assign(query, { date: date.handle, events: events.handle });
      if (args.eventPath === undefined) return action({ scope, query, value: { ok: true, date: date.read.value, events: events.read.value } });
      const event = { source: events.handle, path: args.eventPath };
      const index = await scope.subscribe(event, "SessionIndex", contexts);
      Object.assign(query, { index: index.handle, current: (await scope.subscribe(event, "SessionType", contexts)).handle,
        control: (await scope.subscribe(calendar.handle, "GeneralTrainingHumanControlled", contexts)).handle });
      const state = await scope.api("/api/v1/team-training/session-state", query);
      if (args.expectedSlotIdentity && state.slotIdentity !== args.expectedSlotIdentity) throw new Error("日历日期或训练时段已变化，请重新读取。");
      if (!choices) return action({ scope, query, state });
      Object.assign(query, { editable: (await scope.subscribe(event, "CanEdit", contexts)).handle,
        passed: (await scope.subscribe(day, "HasDayPassed", contexts)).handle });
      contexts.Date = { valueSource: date.handle };
      contexts.TrainingSessionDayIndex = { valueSource: index.handle };
      const menu = await scope.subscribe(calendar.handle, "TrainingCategoryAndSessionsDropdown", contexts);
      Object.assign(query, { menu: menu.handle, optionPath: args.optionPath });
      const value = { ...state, choices: menu.read.value };
      if (args.optionPath !== undefined) value.preview = await scope.api("/api/v1/team-training/session-preview", query);
      return action({ scope, query, state, value });
    });
  }
  return {
    get: args => context(args, true, async ({ value }) => value),
    state: args => {
      if (!args.dayPath || !args.eventPath) throw new Error("提供训练 dayPath 和 eventPath。");
      return context(args, false, async ({ state }) => state);
    },
    set: async args => {
      if ([args.dayPath, args.eventPath, args.optionPath].some(value => typeof value !== "string" || !value.length) || !args.expectedChoiceToken)
        throw new Error("先预览合法单次训练选项，再提供 dayPath/eventPath/optionPath 和 expectedChoiceToken。");
      const { receipt, slot } = await context(args, true, async ({ scope, query, state, value }) => {
        if (value.preview?.choiceToken !== args.expectedChoiceToken) throw new Error("训练槽位或合法选项已变化，请刷新预览。");
        return { receipt: await scope.api("/api/v1/team-training/session-execute", { ...query, choiceToken: args.expectedChoiceToken,
          id: args.operationId || randomUUID() }, true), slot: state.slotIdentity };
      });
      if (receipt.verified || receipt.status !== "dispatched_unverified") return receipt;
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try {
          observed = await context({ ...args, expectedSlotIdentity: slot }, false, ({ scope, query }) =>
            scope.api("/api/v1/team-training/session-state", { ...query, operationId: receipt.operationId }));
        } catch (error) { return { ...receipt, verificationError: String(error.message || error), retrySafe: false }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, note: "核对范围仅为同一日期、同一时段的训练配置；不代表训练已经发生或更广的训练计划已验证。" };
    }
  };
}
