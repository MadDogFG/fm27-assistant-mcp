import { createLiveClient, scalar, clean } from "./live-client.mjs";
import { randomUUID } from "node:crypto";

export function createMedicalTools(call) {
  const client = createLiveClient(call);
  const actions = { physio_report: "1768890488", injury_risk_update: "1884122488" };
  async function context(args, execute) {
    if (!args.source || !Object.hasOwn(actions, args.action)) throw new Error("提供实际球员source与physio_report/injury_risk_update。");
    return client.scope(async scope => {
      const subject = { source: args.source, path: args.path || "" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle }, Records: [{ $reference: subject }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const reference = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: actions[args.action] } });
      const items = await scope.subscribe(reference.handle, "Items", contexts);
      const query = { offered: offered.handle, action: reference.handle, items: items.handle };
      if (!args.entry) {
        if (execute) throw new Error("先从原生医疗菜单选具体entry并预览。");
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
      const preview = await scope.api("/api/v1/medical/preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("医疗菜单/球员状态已变化，提供原预览token。");
      if (preview.disabled || !preview.silentExecutionImplemented) throw new Error("游戏禁用此选择，或该确认流程尚未接入。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/medical/execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
