import { createLiveClient, scalar, clean } from "./live-client.mjs";

export function createPlayerManagementTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    if (!args.source && !Number.isInteger(args.squadIndex)) throw new Error("提供实际球员/员工source（或 squadIndex）及可选path。");
    if (execute && (!args.operationId || !args.expectedChoiceToken || !args.action)) throw new Error("提供明确action、原token及固定operationId。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      let subjectSource = args.source, subjectPath = args.path || "";
      if (!subjectSource && Number.isInteger(args.squadIndex)) {
        // Convenience: resolve the player by its row index in the manager's Players list.
        const players = await scope.subscribe(team.handle, "Players", { human: { source: "human" } });
        subjectSource = players.handle; subjectPath = String(args.squadIndex);
      }
      const subject = { source: subjectSource, path: subjectPath };
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle }, Records: [{ $reference: subject }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const available = await scope.api("/api/v1/player-management/available", { offered: offered.handle });
      if (!args.action) return available;
      const chosen = available.actions.find(a => a.name === args.action || a.id === args.action);
      if (!chosen) throw new Error("只能选择该球员/员工当前提供的正常管理action名称或ID。");
      const reference = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: chosen.id } });
      const items = await scope.subscribe(reference.handle, "Items", contexts);
      const query = { offered: offered.handle, action: reference.handle, items: items.handle };
      if (!args.entry) {
        if (execute) throw new Error("先从原生管理菜单选具体entry并预览。");
        const keys = Object.fromEntries(await Promise.all(["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"].map(async name => [name, await scope.propertyId(name)])));
        const entries = [];
        function visit(list, path = [], disabled = false) {
          if (list?.kind !== "list") return;
          for (const [index, outer] of (list.items || []).entries()) {
            const fields = (outer?.fields?.[keys.RowData] || outer)?.fields || {};
            const blocked = disabled || scalar(outer?.fields?.[keys.Disabled]) === "True" || scalar(fields[keys.Disabled]) === "True";
            const entry = [...path, index];
            entries.push({ entry, label: clean(scalar(fields[keys.Text]) ?? scalar(outer?.fields?.[keys.Text])), disabled: blocked,
              executableLeaf: scalar(fields[keys.Event]) === "44" && Boolean(fields[keys.ActionData]) });
            visit(outer?.fields?.[keys.ChildList] || fields[keys.ChildList], entry, blocked);
          }
        }
        visit(items.read.value);
        return { ok: true, action: args.action, entries, liveVerified: false };
      }
      query.entry = args.entry;
      const preview = await scope.api("/api/v1/player-management/preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("管理菜单/人员状态已变化，提供原预览token。");
      if (preview.disabled || !preview.silentExecutionImplemented) throw new Error("游戏禁用此选择，或该确认流程尚未接入。");
      // 高危不可逆动作（互相解约/自由解约/撤回报价/终止租借）保留显式二次确认门槛；日常可逆管理动作默认确认
      const highRiskActionIds = new Set(["1214855239", "1917875764"]);
      const isHighRisk = highRiskActionIds.has(String(preview.actionId || "")) || /解约|释放|撤回|终止租借|Termination|Release|Withdraw|Recall/i.test(preview.label || "");
      const confirmed = isHighRisk ? (args.acceptConfirmation === true) : (args.acceptConfirmation !== false);
      if (preview.requiresConfirmation && !confirmed) {
        throw new Error(isHighRisk
          ? "高危不可逆操作（解约/撤回/终止租借），请先向用户确认后再显式传入 acceptConfirmation: true。"
          : "操作需要确认（已显式取消）。");
      }
      const id = args.operationId;
      try { return await scope.api("/api/v1/player-management/execute", { ...query, id, choiceToken: preview.choiceToken, acceptConfirmation: confirmed }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
