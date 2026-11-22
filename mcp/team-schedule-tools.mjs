import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createTeamScheduleTools(call) {
  const client = createLiveClient(call);
  async function context(args, choices, action) {
    const delegation = args.delegation || "respect";
    if (!["respect", "take_control_this_once", "take_control_all"].includes(delegation)) throw new Error("未知团队训练职责模式。");
    const teamType = args.teamType || "first";
    if (!["first", "reserves", "youth"].includes(teamType)) throw new Error("未知球队类型 teamType（支持 first/reserves/youth）。");
    return client.scope(async scope => {
      const human = { source: "human" };
      let team;
      if (teamType === "first") {
        team = await scope.subscribe("human", "Team");
      } else {
        const club = await scope.subscribe("human", "Club", { human, Human: human });
        const propName = teamType === "reserves" ? "ReservesTeam" : "YouthTeam";
        const sub = await scope.subscribeOptional(club.handle, propName, { human, Human: human, club: { source: club.handle }, Club: { source: club.handle } }, 1500);
        if (!sub.handle || !sub.read?.value) throw new Error(`当前俱乐部没有可用的 ${propName}。`);
        team = sub;
      }
      const teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      const calendar = await scope.subscribe("human", "TrainingCalendar", contexts);
      const month = await scope.subscribe(calendar.handle, "TodayMonthIndex", contexts);
      const months = args.monthPath !== undefined ? await scope.subscribe(calendar.handle, "MonthsDropdown", contexts) : null;
      const monthValue = months ? { valueSource: months.handle, path: args.monthPath } : { valueSource: month.handle };
      contexts.MonthIndex = monthValue;
      const weeks = teamType === "first"
        ? await scope.subscribe(calendar.handle, "TrainingScheduleWeeks", contexts)
        : await scope.subscribeOptional(calendar.handle, "TrainingScheduleWeeks", contexts, 1500);
      if (!weeks.handle || weeks.unavailable) {
        throw new Error(`当前 ${teamType} 球队训练日历未就绪 (${weeks.unavailable || "unavailable"})`);
      }
      const query = { calendar: calendar.handle, weeks: weeks.handle, weekPath: args.weekPath, delegation };
      if (args.weekPath === undefined) {
        const allMonths = months || await scope.subscribe(calendar.handle, "MonthsDropdown", contexts);
        return action({ scope, query, value: { ok: true, months: allMonths.read.value, weeks: weeks.read.value } });
      }
      const week = { source: weeks.handle, path: args.weekPath };
      const date = await scope.subscribe(week, "WeekStartDate", contexts);
      query.date = date.handle;
      contexts.Date = { valueSource: date.handle };
      const state = await scope.api("/api/v1/team-training/state", query);
      if (args.expectedDateFingerprint && state.dateFingerprint !== args.expectedDateFingerprint) throw new Error("训练周列表已变化，当前下标不是原日期。");
      if (!choices) return action({ scope, query, state });
      query.editable = (await scope.subscribe(week, "CanEditTrainingSchedule", contexts)).handle;
      query.control = (await scope.subscribe(calendar.handle, "GeneralTrainingHumanControlled", contexts)).handle;
      const categories = await scope.subscribe(calendar.handle, "TrainingScheduleCategoryDropdown", contexts);
      query.categories = categories.handle;
      const value = { ok: true, ...state, categories: categories.read.value };
      if (args.categoryPath !== undefined) {
        contexts.TrainingScheduleCategory = { valueSource: categories.handle, path: args.categoryPath };
        const schedules = await scope.subscribe(calendar.handle, "TrainingSchedules", contexts);
        Object.assign(query, { categoryPath: args.categoryPath, schedules: schedules.handle, schedulePath: args.schedulePath });
        value.schedules = schedules.read.value;
        if (args.schedulePath !== undefined) {
          query.eventData = (await scope.subscribe({ source: schedules.handle, path: args.schedulePath }, "EventData", contexts)).handle;
          value.preview = await scope.api("/api/v1/team-training/preview", query);
        }
      }
      return action({ scope, query, value, state });
    });
  }
  return {
    get: args => context(args, true, async ({ value }) => value),
    state: args => {
      if (args.weekPath === undefined) throw new Error("提供训练周 weekPath。");
      return context(args, false, async ({ state }) => state);
    },
    set: async args => {
      if ([args.weekPath, args.categoryPath, args.schedulePath].some(path => typeof path !== "string" || !path.length) || !args.expectedChoiceToken)
        throw new Error("先读取并预览训练计划，再提供 weekPath/categoryPath/schedulePath 和 expectedChoiceToken。");
      const { receipt, state, template } = await context(args, true, async ({ scope, query, value, state }) => {
        if (value.preview?.choiceToken !== args.expectedChoiceToken) throw new Error("训练周、职责或计划选项已变化，请刷新预览。");
        const template = value.preview.payload?.fields?.["0x65766474"]?.fields?.["0x74737470"]?.value;
        return { receipt: await scope.api("/api/v1/team-training/execute", { ...query, id: args.operationId || randomUUID(), choiceToken: args.expectedChoiceToken }, true), state, template };
      });
      let observation;
      if (receipt.status === "dispatched_unverified") {
        try {
          observation = await context({ ...args, expectedDateFingerprint: state.dateFingerprint }, false, async ({ state }) => state);
          if (observation.sessionId !== state.sessionId || observation.epoch !== state.epoch || observation.targetIdentity !== state.targetIdentity)
            throw new Error("游戏会话或训练日历变化，不能核对本次操作。");
        } catch (error) { observation = { error: String(error.message || error) }; }
      }
      const beforeTemplate = state.week?.fields?.["0x33475070"]?.value;
      const afterTemplate = observation?.week?.fields?.["0x33475070"]?.value;
      return { ...receipt, ...(observation ? { observation } : {}),
        templateObservation: { before: beforeTemplate ?? null, requested: template ?? null, after: afterTemplate ?? null,
          changedToRequested: template != null && beforeTemplate != null && beforeTemplate !== template && afterTemplate === template },
        note: "读取同一训练周的计划模板变化。实际训练时段可另用 get_team_training_sessions 查询。" };
    }
  };
}
