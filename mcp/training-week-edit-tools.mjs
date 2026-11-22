import { createLiveClient } from "./live-client.mjs";

// Commit or cancel the training week edit through human.TrainingCalendar (training selector).
export function createTrainingWeekEditTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { Human: human, human, team: { source: team.handle }, Team: { source: team.handle } };
      const calendar = await scope.subscribe("human", "TrainingCalendar", contexts);
      const query = { selector: calendar.handle };
      if (!args.action) return perform(scope, query, false);
      query.action = args.action;
      return perform(scope, query, true);
    });
  }
  async function copyContext(args, perform) {
    if (args.weekIndex === undefined) throw new Error("copy 需要 weekIndex（CalendarWeekAsList 行下标）。");
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { Human: human, human, team: { source: team.handle }, Team: { source: team.handle } };
      const calendar = await scope.subscribe("human", "TrainingCalendar", contexts);
      const month = await scope.subscribe(calendar.handle, "TodayMonthIndex", contexts);
      const weeks = await scope.subscribe(calendar.handle, "TrainingScheduleWeeks", {
        ...contexts, MonthIndex: { valueSource: month.handle }
      });
      const row = { source: weeks.handle, path: String(args.weekIndex) };
      const date = await scope.subscribe(row, "WeekStartDate", contexts);
      const paste = await scope.subscribe(calendar.handle, "CanPasteTrainingWeek", {
        ...contexts, Date: { valueSource: date.handle }
      });
      return perform(scope, { selector: calendar.handle, date: date.handle, allowed: paste.handle }, {
        weekIndex: args.weekIndex, date: date.read.value, canPaste: paste.read.value
      });
    });
  }
  return {
    pastePreview: args => copyContext(args, async (scope, query, observation) => ({
      ...await scope.api("/api/v1/training-week-edit/paste-preview", query), observation, liveVerified: false
    })),
    pasteExecute: args => {
      if (!args.operationId || !args.expectedChoiceToken)
        throw new Error("Provide the original paste preview token and operation ID.");
      return copyContext(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/training-week-edit/paste-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken)
          throw new Error("The target week or its permission changed.");
        return scope.api("/api/v1/training-week-edit/paste-execute", {
          ...query, id: args.operationId, choiceToken: args.expectedChoiceToken
        }, true);
      });
    },
    copyPreview: args => copyContext(args, async (scope, query, observation) =>
      ({ ...await scope.api("/api/v1/training-week-edit/copy-preview", query), observation, draftOnly: true, liveVerified: false })),
    copyExecute: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return copyContext(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/training-week-edit/copy-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("训练周选择变化，请重新预览。");
        return { ...await scope.api("/api/v1/training-week-edit/copy-execute", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), copied: false };
      });
    },
    get: args => context(args, async (scope, query, complete) => {
      if (!complete) return { ok: true, selector: true, draftOnly: true, liveVerified: false };
      return { ...await scope.api("/api/v1/training-week-edit/preview", query), draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.action || !args.operationId || !args.expectedChoiceToken) throw new Error("提供 action(commit|cancel)、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/training-week-edit/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("训练周编辑状态变化，请重新预览。");
        return { ...await scope.api("/api/v1/training-week-edit/execute", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), trainingWeekCommitted: false };
      });
    }
  };
}
