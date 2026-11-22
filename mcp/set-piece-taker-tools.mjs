import { createLiveClient } from "./live-client.mjs";

export function createSetPieceTakerTools(call) {
  const client = createLiveClient(call);
  // Contexts come from the game's own property metadata (SetPieceTaker needs type+side;
  // the add-list needs type+human+filter; penalty lists need human). Extra keys are dropped
  // by the live client, so one context bag serves every channel.
  async function context(args, perform) {
    return client.scope(async scope => {
      const { team, tactic } = await scope.tactic();
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = {
        FilterListID: 0, SelectedObjectList: [], ...(args.contexts || {}), human, Human: human, team: teamRef, Team: teamRef, Boolean: true,
        SetPieceType: Number.isInteger(args.setPieceType) ? args.setPieceType : 0,
        SetPiecePitchSide: Number.isInteger(args.setPiecePitchSide) ? args.setPiecePitchSide : 0,
        SetPieceScenario: Number.isInteger(args.setPieceScenario) ? args.setPieceScenario : 0
      };
      const setpiece = await scope.subscribe(tactic.handle, "SetPiece", contexts);
      return perform(scope, { team: team.handle, tactic: tactic.handle, setpiece: setpiece.handle }, contexts, tactic);
    });
  }
  async function readAll(scope, base, contexts) {
    const values = [];
    for (const name of ["SetPieceTaker", "SetPieceTakerAddPlayerList", "SetPieceTakerDataForSide", "SetPiecePenaltyTakersList", "SetPiecePenaltyCandidatesList", "CanAddToLeftFootTakers", "CanAddToRightFootTakers", "SetPieceTypeDropdownList", "CurrentSetPieceRoutine"]) {
      try {
        const opened = await scope.subscribe(base.setpiece, name, contexts);
        values.push({ property: name, value: opened.read.value });
      } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
    }
    return values;
  }
  async function prepare(scope, base, contexts, args) {
    const candidates = await scope.subscribe(base.setpiece, "SetPieceTakerAddPlayerList", contexts);
    const paths = args.playerPaths || [];
    const add = ["add-left", "add-right", "add-both"].includes(args.action);
    const selection = add ? paths.map(path => {
      if (!/^(0|[1-9]\d*)$/.test(path)) throw new Error("从实际候选名单选择完整的球员行。");
      return { $value: { source: candidates.handle, path } };
    }) : [];
    const query = { ...base, action: args.action, paths, destination: args.destination, candidates: candidates.handle };
    for (const [key, name] of Object.entries({ left: "CanAddToLeftFootTakers", right: "CanAddToRightFootTakers",
      penalties: "SetPiecePenaltyTakersList", takerList: "SetPieceTakerDataForSide", penaltyCandidates: "SetPiecePenaltyCandidatesList" })) {
      const channelContexts = add && (key === "left" || key === "right")
        ? { ...contexts, SelectedObjectList: selection, selectedobjectlist: selection } : contexts;
      query[key] = (await scope.subscribe(base.setpiece, name, channelContexts)).handle;
    }
    return query;
  }
  function moveOrder(value, action) {
    const list = action === "move" ? value?.fields?.["0x38435761"] : value;
    if (list?.kind !== "list" || list.truncated) return null;
    const identities = list.items.map(row => row.fields?.["0x706c7972"]?.identity);
    return identities.every(Boolean) && new Set(identities).size === identities.length ? identities : null;
  }

  return {
    get: args => context(args, async (scope, base, contexts) => {
      if (!args.action) return { ok: true, values: await readAll(scope, base, contexts), liveVerified: false };
      const query = await prepare(scope, base, contexts, args);
      return scope.api("/api/v1/setpiece-takers/preview", query);
    }),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken || !args.action) throw new Error("需要原主罚人操作预览token和固定operationId。");
      return context(args, async (scope, base, contexts) => {
        const query = await prepare(scope, base, contexts, args);
        const preview = await scope.api("/api/v1/setpiece-takers/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("主罚候选或当前战术已变化，请刷新。");
        const moveHandle = args.action === "move" ? query.takerList : args.action === "penalty-move" ? query.penalties : null;
        const before = moveHandle && moveOrder((await scope.ready(moveHandle)).value, args.action);
        const receipt = await scope.api("/api/v1/setpiece-takers/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        if (!before || !receipt.ok) return { ...receipt, takerConfigurationVerified: false };
        const expected = [...before];
        const [moved] = expected.splice(Number(query.paths[0]), 1);
        expected.splice(query.destination, 0, moved);
        try {
          let after;
          for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 150));
            after = moveOrder((await scope.ready(moveHandle)).value, args.action);
            if (after?.length === expected.length && after.every((identity, index) => identity === expected[index])) {
              return { ...receipt, takerConfigurationVerified: true, orderObservation: { before, expected, after } };
            }
          }
          return { ...receipt, takerConfigurationVerified: false, orderObservation: { before, expected, after } };
        } catch (error) {
          return { ...receipt, takerConfigurationVerified: false, observationError: String(error.message || error) };
        }
      });
    }
  };
}
