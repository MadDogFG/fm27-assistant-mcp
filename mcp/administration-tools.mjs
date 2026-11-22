import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createAdministrationTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      const container = await scope.subscribe(team.handle, "TeamContainer", contexts);
      const settings = await scope.subscribe(container.handle, "TeamSettingsEditSession", contexts);
      const tabs = await scope.subscribe(settings.handle, "ResponsibilitySimpleTabList", contexts);
      if (!args.tabPath) return { ok: true, tabs: tabs.read.value, instructions: "选择实际 tabPath 后读取职责组。", liveVerified: false };
      const groups = await scope.subscribe({ source: tabs.handle, path: args.tabPath }, "ResponsibilitySimpleGroupList", contexts);
      if (!args.groupPath) return { ok: true, groups: groups.read.value, liveVerified: false };
      const group = { source: groups.handle, path: args.groupPath };
      const responsibilities = await scope.subscribe(group, "ResponsibilityList", contexts);
      if (!args.action) return { ok: true, responsibilities: responsibilities.read.value, actions: ["take_control", "delegate", "group_take_control", "group_recommended"], liveVerified: false };
      const individual = ["take_control", "delegate"].includes(args.action);
      if (!individual && !["group_take_control", "group_recommended"].includes(args.action)) throw new Error("未知职责操作。");
      if (individual && !args.responsibilityPath) throw new Error("需要原生列表中实际 responsibilityPath。");
      const target = individual ? { source: responsibilities.handle, path: args.responsibilityPath } : group;
      const property = args.action === "group_recommended" ? "IsRecommendedStaffMemberInControl" : "IsUserInControl";
      const current = await scope.subscribe(target, property, contexts);
      const editable = await scope.subscribe(target, "CanHumanChange", contexts);
      const takeControl = await scope.subscribe(target, "CanHumanTakeControl", contexts);
      const query = { action: args.action, team: team.handle, container: container.handle, session: settings.handle,
        tabs: tabs.handle, tabPath: args.tabPath, groups: groups.handle, groupPath: args.groupPath,
        responsibilities: responsibilities.handle, responsibilityPath: args.responsibilityPath,
        current: current.handle, editable: editable.handle, takeControl: takeControl.handle };
      const preview = await scope.api("/api/v1/administration/responsibility-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("职责状态已变化，请重新读取预览。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/administration/responsibility-execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), change: args => context(args, true) };
}
