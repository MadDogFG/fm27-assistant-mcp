import { createLiveClient, scalar, clean } from "./live-client.mjs";

export function createPlayerAvailabilityTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    if (!args.source) throw new Error("提供当前球员的source/path。");
    return client.scope(async scope => {
      const subject = { source: args.source, path: args.path || "" };
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const playerClub = await scope.subscribe(subject, "Club");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, Team: { source: team.handle }, team: { source: team.handle }, Records: [{ $reference: subject }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const query = { source: args.source, path: args.path || "", club: club.handle, playerClub: playerClub.handle, offered: offered.handle };
      const choices = await scope.api("/api/v1/player-availability/offered", query);
      if (args.action === undefined) return perform(scope, query, choices);
      const matches = choices.actions.filter(item => item.id === args.action || item.name === args.action);
      if (matches.length !== 1 || !matches[0].offered) throw new Error("选择游戏当前提供的队伍调动/预备队可用性动作。");
      const action = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: matches[0].id } });
      const items = await scope.subscribe(action.handle, "Items", contexts);
      Object.assign(query, { action: action.handle, items: items.handle, entry: args.entry });
      return perform(scope, query, choices, items.read.value);
    });
  }
  return {
    get: args => context(args, async (scope, query, choices, items) => {
      if (!items) return choices;
      if (args.entry) return scope.api("/api/v1/player-availability/preview", query);
      const names = ["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"];
      const keys = Object.fromEntries(await Promise.all(names.map(async name => [name, await scope.propertyId(name)])));
      const entries = [];
      function visit(list, prefix = [], labels = [], disabled = false) {
        for (const [index, original] of (list?.items || []).entries()) {
          const row = original?.fields?.[keys.RowData] || original, fields = row?.fields || {};
          const path = [...prefix, index], label = clean(scalar(fields[keys.Text]) ?? scalar(original?.fields?.[keys.Text]));
          const blocked = disabled || scalar(fields[keys.Disabled])?.toLowerCase() === "true" || scalar(original?.fields?.[keys.Disabled])?.toLowerCase() === "true";
          entries.push({ entry: path, label: [...labels, label].filter(Boolean).join(" > "), disabled: blocked, executableLeaf: scalar(fields[keys.Event]) === "44" && Boolean(fields[keys.ActionData]) });
          visit(original?.fields?.[keys.ChildList] || fields[keys.ChildList], path, [...labels, label], blocked);
        }
      }
      visit(items); return { ok: true, actions: choices.actions, entries, liveVerified: false };
    }),
    execute: args => {
      if (!args.action || !args.operationId || !args.expectedChoiceToken || !Array.isArray(args.entry) || args.entry.length < 1) throw new Error("需要原菜单action/entry/token与固定operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/player-availability/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("球员或菜单动作已变化，请刷新。");
        if (preview.requiresConfirmation && !args.acceptConfirmation) throw new Error("请先阅读原生确认数据并显式acknowledge。");
        return { ...await scope.api("/api/v1/player-availability/execute", { ...query, id: args.operationId, choiceToken: preview.choiceToken, acceptConfirmation: args.acceptConfirmation === true }, true),
          playerAvailabilityVerified: false };
      });
    }
  };
}
