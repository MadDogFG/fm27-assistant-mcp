import { createLiveClient } from "./live-client.mjs";

export function createMentoringTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      const groups = await scope.subscribe(team.handle, "MentoringGroups", contexts);
      const query = { team: team.handle, training: training.handle, groups: groups.handle, mode: args.mode || "existing", groupPath: args.groupPath || "",
        action: args.action, indices: args.playerIndices || [], name: args.name || "" };
      if (args.action === "create") return perform(scope, query, {}, true);
      if (query.mode === "existing" && !args.groupPath) return perform(scope, query, { groups: groups.read.value }, false);
      let source = groups;
      if (query.mode === "new") {
        source = await scope.subscribe(training.handle, "NewlyCreatedMentoringGroup", contexts);
        query.groups = source.handle; query.groupPath = "";
      }
      const group = { source: source.handle, path: query.groupPath }, channels = {};
      for (const name of ["Team", "UniqueId", "Name", "IsValid", "Count", "MaxValue", "Players", "SelectedPlayers", "PlayersAvailableForMentoring", "CanAutoSelectMentoringGroup", "PendingUpdate"])
        channels[name] = (await scope.subscribe(group, name, contexts)).handle;
      query.channels = channels;
      return perform(scope, query, {}, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, values, complete) => {
      if (!complete) return { ok: true, ...values };
      if (args.action === "create") return scope.api("/api/v1/training-management/mentoring/create-preview", query);
      return { ...await scope.api("/api/v1/training-management/mentoring/state", query),
        ...(args.action ? { preview: await scope.api("/api/v1/training-management/mentoring/preview", query) } : {}) };
    }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供明确指导小组操作、原token及固定operationId。");
      return context(args, async (scope, query, _values, complete) => {
        if (!complete) throw new Error("从实际指导小组列表选择groupPath，或使用mode=new读取已创建的小组。");
        const previewRoute = args.action === "create" ? "/api/v1/training-management/mentoring/create-preview" : "/api/v1/training-management/mentoring/preview";
        const preview = await scope.api(previewRoute, query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("指导小组、候选或草稿已变化，请重新读取。");
        return scope.api(args.action === "create" ? "/api/v1/training-management/mentoring/create" : "/api/v1/training-management/mentoring/execute",
          { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
      });
    }
  };
}
