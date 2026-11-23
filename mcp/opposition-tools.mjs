import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createOppositionTools(call) {
  const client = createLiveClient(call);
  const recipes = {
    marking: ["OppositionPlayerMarking", "OppositionPlayerMarkingOptions"],
    pressing: ["OppositionPlayerPressingTrigger", "OppositionPlayerPressingTriggerOptions"],
    tackling: ["OppositionPlayerTackling", "OppositionPlayerTacklingOptions"],
    "show-foot": ["OppositionPlayerShowOnToFoot", "OppositionPlayerShowOnToFootOptions"],
    personalised: ["OppositionPlayerPersonalisedInstructionsUsed", null]
  };
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const match = await scope.api("/api/v1/match/state");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef, Boolean: true };
      const useMatch = match.inMatch && !match.finished && !match.pastMatch && !match.replay && !match.spectating;
      const tactic = await scope.subscribe(useMatch ? "match" : team.handle, "Tactic", contexts);
      const valid = await scope.subscribe(tactic.handle, "NextOppositionTacticIsValid", contexts);
      const instructions = await scope.subscribe(tactic.handle, "NextOppositionInstructions", contexts);
      const opponent = await scope.subscribe(instructions.handle, "Team", contexts);
      const nextOpponent = await scope.subscribe(tactic.handle, "NextOppositionInstructionsTeam", contexts);
      const teamProperties = await scope.properties(team.handle, "NextMatchInformation");
      const fixture = teamProperties.some(property => property.name.split(":")[0] === "NextMatchInformation")
        ? await scope.subscribe(team.handle, "NextMatchInformation", contexts) : null;
      const mode = args.mode || "players";
      if (!["players", "positions"].includes(mode)) throw new Error("mode需要players或positions。");
      const rows = await scope.subscribe(instructions.handle, mode === "players" ? "OppositionPredictedLineupInstructions" : "OppositionAllPositionsInstructions", contexts);
      if (args.rowPath === undefined) {
        const opponentName = await scope.resolveRefName(opponent.handle, contexts, 500);
        const nextOpponentName = await scope.resolveRefName(nextOpponent.handle, contexts, 500);
        // 解析对手预计首发球员的姓名、球衣号与位置，便于直接下达“盯死某号球员”指令
        let resolvedPlayers;
        if (mode === "players" && rows.read.value?.kind === "list" && Array.isArray(rows.read.value.items)) {
          resolvedPlayers = [];
          const items = rows.read.value.items.slice(0, 25);
          for (let i = 0; i < items.length; i++) {
            const fields = items[i]?.fields || {};
            const personKey = Object.keys(fields).find(k => fields[k]?.kind === "reference" && fields[k]?.type === "FM.UI.PersonReference");
            const personIdentity = personKey ? fields[personKey].identity : (items[i]?.identity ?? null);
            let name = null, squadNumber = null, position = null;
            if (personKey) {
              const pRef = { source: rows.handle, path: `${i}/${personKey}` };
              const pCtx = { ...contexts, Person: pRef };
              const nR = await scope.readAndRelease(pRef, "Name", pCtx, 500).catch(() => null);
              const numR = await scope.readAndRelease(pRef, "SquadNumber", pCtx, 400).catch(() => null);
              const posR = await scope.readAndRelease(pRef, "BestPositionShortString", pCtx, 400).catch(() => null);
              name = nR?.scalar ?? null;
              squadNumber = numR?.scalar ?? null;
              position = posR?.scalar ?? null;
            }
            resolvedPlayers.push({ rowPath: String(i), name, squadNumber, position, identity: personIdentity });
          }
        }
        const compact = args.compact !== false;
        return { ok: true, mode, ...(resolvedPlayers ? { resolvedPlayers } : {}), ...(compact && resolvedPlayers ? {} : { rows: rows.read.value }),
          opponent: opponent.read.value?.identity ?? opponent.read.value, opponentName,
          nextOpponent: nextOpponent.read.value?.identity ?? nextOpponent.read.value, nextOpponentName,
          fixture: compact ? undefined : fixture?.read.value, kinds: Object.keys(recipes), valid: valid.read.value, compact, liveVerified: false };
      }
      if (typeof args.rowPath !== "string" || !args.rowPath || !recipes[args.kind]) throw new Error("从原名单选择rowPath和合法kind。");
      const row = { source: rows.handle, path: args.rowPath };
      const index = await scope.subscribe(row, "Index", contexts);
      const position = await scope.subscribe(row, "Position", contexts);
      const scoped = { ...contexts, teamselectionindex: { valueSource: index.handle }, TeamSelectionIndex: { valueSource: index.handle },
        positionmask: { valueSource: position.handle }, PositionMask: { valueSource: position.handle },
        // Empty list rather than JSON null: the plugin's context audit rejects a null
        // SelectedObjectList description before it can read a single-target instruction.
        selectedobjectlist: [], SelectedObjectList: [] };
      const [property, choices] = recipes[args.kind];
      const current = await scope.subscribe(tactic.handle, property, scoped);
      const options = choices ? await scope.subscribe(tactic.handle, choices, scoped) : null;
      if (args.optionPath === undefined) return { ok: true, mode, kind: args.kind, current: current.read.value,
        options: options ? options.read.value : ["true", "false"], optionSource: options ? "game_native_options" : "shipped_UI_boolean_constants", liveVerified: false };
      const channels = { valid: valid.handle, opponent: opponent.handle, nextOpponent: nextOpponent.handle,
        ...(fixture ? { fixture: fixture.handle } : {}), index: index.handle, position: position.handle,
        current: current.handle, ...(options ? { options: options.handle } : {}) };
      const query = { team: team.handle, tactic: tactic.handle, instructions: instructions.handle, rows: rows.handle,
        rowPath: args.rowPath, mode, kind: args.kind, channels, optionPath: args.optionPath };
      const preview = await scope.api("/api/v1/opposition/preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("针对性指令或选项已变化，请重新预览。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/opposition/execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", verified: false, retrySafe: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), set: args => {
    if (!args.operationId || !args.expectedChoiceToken || !args.rowPath || !args.kind || args.optionPath === undefined) throw new Error("提供原对手行、种类、选项、token和固定operationId。");
    return context(args, true);
  } };
}
