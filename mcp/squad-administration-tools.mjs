import { randomUUID } from "node:crypto";
import { createLiveClient, scalar, clean } from "./live-client.mjs";

export function createSquadAdministrationTools(call) {
  const client = createLiveClient(call);
  async function captain(args, execute) {
    if (!["captain", "vice_captain"].includes(args.kind)) throw new Error("kind需要captain或vice_captain。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef, Records: [{ $reference: teamRef }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const id = args.kind === "captain" ? "1112887921" : "859991371";
      const action = await scope.subscribeOptional("game", "Action", { ...contexts, ID: { $u32: id } });
      if (!action.handle) return { ok: true, available: false, unavailable: action.unavailable, kind: args.kind };
      const items = await scope.subscribe(action.handle, "Items", contexts);
      const query = { team: team.handle, offered: offered.handle, action: action.handle, items: items.handle, entry: args.entry };
      if (!args.entry) {
        const keys = Object.fromEntries(await Promise.all(["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"].map(async name => [name, await scope.propertyId(name)])));
        const choices = [];
        function visit(node, prefix = [], inheritedDisabled = false) {
          for (const [index, outer] of (node?.items || []).entries()) {
            const row = outer?.fields?.[keys.RowData] || outer, fields = row?.fields || {};
            const disabled = inheritedDisabled || scalar(fields[keys.Disabled])?.toLowerCase() === "true" || scalar(outer?.fields?.[keys.Disabled])?.toLowerCase() === "true";
            const entry = [...prefix, index];
            choices.push({ entry, label: clean(scalar(fields[keys.Text]) || scalar(outer?.fields?.[keys.Text])), disabled,
              executableLeaf: ["44", "1698914672", "1700152161"].includes(scalar(fields[keys.Event])) && Boolean(fields[keys.ActionData]) });
            visit(outer?.fields?.[keys.ChildList] || fields[keys.ChildList], entry, disabled);
          }
        }
        visit(items.read.value);
        return { ok: true, kind: args.kind, choices, liveVerified: false };
      }
      if (!Array.isArray(args.entry) || !args.entry.length || args.entry.length > 8 || args.entry.some(n => !Number.isInteger(n) || n < 0)) throw new Error("entry需要原生菜单路径。");
      const preview = await scope.api("/api/v1/squad/captain-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("队长候选已变化，请重新预览。");
      const operationId = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/squad/captain-execute", { ...query, id: operationId, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId, status: "transport_result_unknown", retrySafe: false, error: String(error.message || error) }; }
    });
  }
  async function numbers(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      // This build's "Players" channel on the numbers edit session asks for a FilterListID
      // context (the symbolic SquadNumbersFilter name is not enough). Default 0 = all players.
      const filterListId = Number.isInteger(args.filterListId) ? args.filterListId : 0;
      const contexts = { Human: human, human, Team: teamRef, team: teamRef,
        SquadNumbersFilter: Number.isInteger(args.squadNumbersFilter) ? args.squadNumbersFilter : 0, FilterListID: filterListId };
      const session = await scope.subscribe(team.handle, "SquadNumbersEditSession", contexts);
      const players = await scope.subscribe(session.handle, "Players", contexts);
      if (!args.operation) return { ok: true, players: players.read.value, operations: ["auto", "clear", "revert", "confirm"],
        note: "auto/clear/revert改变号码编辑会话；confirm通过游戏确认命令提交当前完整草稿。派发不等于游戏最终接受。", liveVerified: false };
      const property = { auto: "SquadNumbersCanChange", clear: "CanClearChanges", revert: "HasMadeChanges", confirm: "CanConfirmChanges" }[args.operation];
      if (!property) throw new Error("未知号码操作。");
      const allowed = await scope.subscribe(session.handle, property, contexts);
      const query = { operation: args.operation, team: team.handle, session: session.handle, players: players.handle, allowed: allowed.handle };
      const preview = await scope.api("/api/v1/squad/numbers-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("号码草稿已变化，请重新预览。");
      const operationId = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/squad/numbers-execute", { ...query, id: operationId, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId, status: "transport_result_unknown", retrySafe: false, error: String(error.message || error) }; }
    });
  }
  async function playerNumber(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef,
        SquadNumbersFilter: Number.isInteger(args.squadNumbersFilter) ? args.squadNumbersFilter : 0,
        FilterListID: Number.isInteger(args.filterListId) ? args.filterListId : 0 };
      const session = await scope.subscribe(team.handle, "SquadNumbersEditSession", contexts);
      const players = await scope.subscribe(session.handle, "Players", contexts);
      if (args.playerPath === undefined) return { ok: true, players: players.read.value, draftOnly: true };
      if (typeof args.playerPath !== "string" || !/^(0|[1-9]\d*)$/.test(args.playerPath)) throw new Error("选择真实Players列表的playerPath。");
      const person = { source: players.handle, path: args.playerPath };
      Object.assign(contexts, { Person: person, person });
      const current = await scope.subscribe(session.handle, "NumSelected", contexts);
      const allowed = await scope.subscribe(session.handle, "CanChangeSquadNumber", contexts);
      const options = await scope.subscribe(session.handle, "SquadNumbersDropdown", contexts);
      const query = { team: team.handle, session: session.handle, players: players.handle, playerPath: args.playerPath,
        current: current.handle, allowed: allowed.handle, options: options.handle, optionPath: args.optionPath };
      if (!args.optionPath && !execute) return { ok: true, playerPath: args.playerPath, current: current.read.value,
        choices: options.read.value, editable: scalar(allowed.read.value), draftOnly: true,
        ...(args.operationId ? { observation: await scope.api("/api/v1/squad/player-number-state", { ...query, operationId: args.operationId }) } : {}) };
      if (!args.optionPath) throw new Error("需要原生号码候选optionPath。");
      const preview = await scope.api("/api/v1/squad/player-number-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("号码候选或球员已变化，请重新预览。");
      return scope.api("/api/v1/squad/player-number-execute", { ...query, choiceToken: args.expectedChoiceToken, id: args.operationId || randomUUID() }, true);
    });
  }
  async function registration(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef, SquadSelectionRule: args.squadSelectionRule ?? 165, PlayerSquadSelectionValue: Number.isInteger(args.playerSquadSelectionValue) ? args.playerSquadSelectionValue : 0 };
      const session = await scope.subscribe(team.handle, "SquadRegistration", contexts);
      const selected = await scope.subscribe(session.handle, "SelectedPlayers", contexts);
      if (!args.operation) {
        const players = await scope.subscribe(session.handle, "Players", contexts);
        return { ok: true, players: players.read.value, selected: selected.read.value, operations: ["auto", "clear", "revert", "confirm"], liveVerified: false };
      }
      const permission = { auto: "CanAskAssistant", clear: "CanClearAllSelectedPlayers", revert: "CanUndoChanges", confirm: "CanConfirmChanges" }[args.operation];
      if (!permission) throw new Error("未知注册操作。");
      const allowed = await scope.subscribe(session.handle, permission, contexts);
      const query = { operation: args.operation, team: team.handle, session: session.handle, selected: selected.handle, allowed: allowed.handle };
      const preview = await scope.api("/api/v1/squad/registration-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("注册草稿已变化，请重新预览。");
      return scope.api("/api/v1/squad/registration-execute", { ...query, id: args.operationId || randomUUID(), choiceToken: args.expectedChoiceToken }, true);
    });
  }
  return { getCaptains: args => captain(args, false), setCaptain: args => captain(args, true), getNumbers: args => numbers(args, false), changeNumbers: args => numbers(args, true),
    getPlayerNumber: args => playerNumber(args, false), setPlayerNumber: args => playerNumber(args, true),
    getRegistration: args => registration(args, false), changeRegistration: args => registration(args, true) };
}
