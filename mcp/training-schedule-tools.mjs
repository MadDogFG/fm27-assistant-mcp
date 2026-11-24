import { clean, createLiveClient, scalar } from "./live-client.mjs";

// Custom training schedule operations and their native dropdown candidates.
export function createTrainingScheduleTools(call) {
  const client = createLiveClient(call);
  function customDropdownChoices(value) {
    const choices = [];
    function visit(list, prefix) {
      for (const [index, row] of (list?.items ?? []).entries()) {
        const path = prefix + index;
        const fields = row.fields;
        const children = fields?.["0x34453354"];
        if (children?.kind === "list") {
          visit(children, `${path}/0x34453354/`);
          continue;
        }
        const entry = fields?.["0x526f7744"]?.fields ?? fields;
        const payload = entry?.["0x7074766c"];
        if (scalar(payload?.fields?.["0x74797065"]) !== "0" || scalar(payload.fields["0x70757343"]) !== "True") continue;
        choices.push({ path, name: clean(scalar(entry["0x71764a36"])) });
      }
    }
    visit(value, "");
    return choices;
  }
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const baseContexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      async function scheduleOptions() {
        const calendar = await scope.subscribe("human", "TrainingCalendar", baseContexts);
        if (args.weekPath === undefined || args.categoryPath === undefined)
          throw new Error("用 get_team_training_schedules 查询并提供 weekPath 和 categoryPath。");
        const month = args.monthPath === undefined
          ? await scope.subscribe(calendar.handle, "TodayMonthIndex", baseContexts)
          : await scope.subscribe(calendar.handle, "MonthsDropdown", baseContexts);
        const contexts = { ...baseContexts, MonthIndex: { valueSource: month.handle, path: args.monthPath } };
        const weeks = await scope.subscribe(calendar.handle, "TrainingScheduleWeeks", contexts, 2500);
        const date = await scope.subscribe({ source: weeks.handle, path: args.weekPath }, "WeekStartDate", contexts);
        contexts.Date = { valueSource: date.handle };
        const categories = await scope.subscribe(calendar.handle, "TrainingScheduleCategoryDropdown", contexts);
        contexts.TrainingScheduleCategory = { valueSource: categories.handle, path: args.categoryPath };
        const schedules = args.includeOptions && !args.action
          ? await scope.subscribeOptional(calendar.handle, "TrainingSchedules", contexts)
          : await scope.subscribe(calendar.handle, "TrainingSchedules", contexts);
        return { calendar, schedules };
      }
      if (args.includeOptions && !args.action) {
        const { schedules } = await scheduleOptions();
        return { ok: true, options: schedules.read.value, optionsUnavailable: schedules.unavailable, liveVerified: false };
      }
      if (args.action === "delete") {
        const { calendar, schedules } = await scheduleOptions();
        return perform(scope, { action: "delete", calendar: calendar.handle, schedules: schedules.handle, optionPath: args.optionPath }, true);
      }
      const session = await scope.subscribe("human", "CustomTrainingSchedule", baseContexts);
      const query = { schedule: session.handle, name: args.name };
      query.canSave = (await scope.subscribe(session.handle, "CanSave", baseContexts)).handle;
      query.canClear = (await scope.subscribe(session.handle, "CanClearSchedule", baseContexts)).handle;
      query.dropdownName = (await scope.subscribe(session.handle, "TrainingScheduleDropdownName", baseContexts)).handle;
      query.scheduleName = (await scope.subscribe(session.handle, "Name", baseContexts)).handle;
      if (!args.action) return perform(scope, query, false);
      if (args.action === "confirm") {
        const dropdown = await scope.subscribe(session.handle, "TrainingScheduleDropdown", baseContexts);
        if (args.optionPath === undefined) return { ok: true, options: dropdown.read.value,
          customChoices: customDropdownChoices(dropdown.read.value), liveVerified: false };
        query.options = dropdown.handle; query.optionPath = args.optionPath; query.action = "confirm";
      }
      return perform(scope, query, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete) => complete && query.action === "delete"
      ? { ...await scope.api("/api/v1/training-schedule/delete-preview", query), draftOnly: true, liveVerified: false }
      : complete && query.action === "confirm"
      ? { ...await scope.api("/api/v1/training-schedule/confirm-preview", query), draftOnly: true, liveVerified: false }
      : complete
      ? { ...await scope.api("/api/v1/training-schedule/preview", { ...query, action: args.action }), draftOnly: true, liveVerified: false }
      : { ...await scope.api("/api/v1/training-schedule/state", query), draftOnly: true, liveVerified: false }),
    execute: async args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供 action、token 及固定 operationId。");
      if (["confirm", "delete"].includes(args.action) && !args.optionPath) throw new Error("选择具体日程行并提供 optionPath。");
      const { receipt, before } = await context(args, async (scope, query) => {
        const confirm = query.action === "confirm", del = query.action === "delete";
        const preview = await scope.api(`/api/v1/training-schedule/${confirm ? "confirm-" : del ? "delete-" : ""}preview`, { ...query, action: args.action });
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("自定义训练计划草稿变化，请重新预览。");
        const before = args.action === "create" ? await scope.api("/api/v1/training-schedule/state", query) : null;
        const receipt = await scope.api(`/api/v1/training-schedule/${confirm ? "confirm-" : del ? "delete-" : ""}execute`, { ...query, action: args.action, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        return { receipt, before };
      });
      const result = { ...receipt, scheduleSaved: false };
      if (!before || !receipt.ok) return result;
      try {
        const after = await context({}, (scope, query) => scope.api("/api/v1/training-schedule/state", query));
        const previousName = clean(scalar(before.trainingScheduleDropdownName));
        const observedName = clean(scalar(after.trainingScheduleDropdownName));
        const suggestedName = clean(scalar(before.trainingScheduleName));
        const requestedName = args.name.trim();
        const draftCreated = after.scheduleIdentity === before.scheduleIdentity && before.canSave === false && after.canSave === true &&
          Boolean(observedName && observedName !== previousName && [suggestedName, requestedName].includes(observedName));
        return { ...result, draftCreated, draftObservation: { previousName, observedName, requestedName,
          requestedNameApplied: draftCreated && observedName === requestedName, canSave: after.canSave } };
      } catch (error) {
        return { ...result, draftCreated: false, observationError: String(error.message || error) };
      }
    },
    // TRN-O05b: 重命名已有自定义训练日程（先可选选中目标日程，再更新 Name 并派发 SaveCustomTrainingSchedule）
    rename: async ({ newName, optionPath, operationId } = {}) => {
      const trimmed = String(newName || "").trim();
      if (!trimmed) throw new Error("必须提供新的训练日程名称 newName。");
      const id = operationId || `rename_training_schedule_${Date.now()}`;
      return client.scope(async scope => {
        const human = { source: "human" };
        const team = await scope.subscribe("human", "Team");
        const baseContexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
        const session = await scope.subscribe("human", "CustomTrainingSchedule", baseContexts);
        if (optionPath !== undefined && optionPath !== "") {
          const dropdown = await scope.subscribe(session.handle, "TrainingScheduleDropdown", baseContexts);
          const preview = await scope.api("/api/v1/training-schedule/confirm-preview", {
            schedule: session.handle, options: dropdown.handle, optionPath, action: "confirm"
          });
          await scope.api("/api/v1/training-schedule/confirm-execute", {
            schedule: session.handle, options: dropdown.handle, optionPath, action: "confirm",
            id: `${id}_select`, choiceToken: preview.choiceToken
          }, true);
        }
        const nameSub = await scope.subscribe(session.handle, "Name", baseContexts);
        const dropNameBefore = await scope.subscribe(session.handle, "TrainingScheduleDropdownName", baseContexts);
        const beforeName = clean(scalar(nameSub.read?.value) || scalar(dropNameBefore.read?.value));
        const upd = await call(
          `/api/v1/internal/update?handle=${encodeURIComponent(nameSub.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmed) }
        );
        const saveDispatch = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSaveCustomTrainingSchedule&source=${encodeURIComponent(session.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
        );
        await new Promise(r => setTimeout(r, 200));
        const nameAfter = await scope.subscribe(session.handle, "Name", baseContexts);
        const dropNameAfter = await scope.subscribe(session.handle, "TrainingScheduleDropdownName", baseContexts);
        const afterName = clean(scalar(nameAfter.read?.value) || scalar(dropNameAfter.read?.value));
        return {
          ok: true,
          operationId: id,
          beforeName,
          requestedName: trimmed,
          afterName,
          update: upd,
          saveDispatch,
          verified: afterName === trimmed
        };
      });
    }
  };
}
