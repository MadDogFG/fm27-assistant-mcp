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
        // 进攻定位球主罚位于 SetPieceScenario=1（0 为防守站位无主罚手），默认使用 1
        SetPieceScenario: Number.isInteger(args.setPieceScenario) ? args.setPieceScenario : 1
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
    if (["add-left", "add-right", "add-both", "remove", "move", "penalty-add", "penalty-remove", "penalty-move"].includes(args.action) && !paths.length) {
      throw new Error(`action="${args.action}" 必须传入 playerPaths（例如 ["0"]）；请先不带 action 调 get_set_piece_takers 读取候选下标，无需切到游戏定位球页面。`);
    }
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
  function takerIds(value, isSideRecord) {
    const list = isSideRecord ? value?.fields?.["0x38435761"] : value;
    if (list?.kind !== "list" || list.truncated) return null;
    const identities = list.items.map(row => row.fields?.["0x706c7972"]?.identity || row.identity);
    return identities.every(Boolean) ? identities : null;
  }

  return {
    get: args => context(args, async (scope, base, contexts) => {
      if (!args.action) return {
        ok: true,
        values: await readAll(scope, base, contexts),
        liveVerified: false,
        note: "只读模式下未选中具体球员（SelectedObjectList 为空），因此 CanAddToLeftFootTakers/CanAddToRightFootTakers 为 False 属正常现象，不代表游戏禁止添加或需要切到定位球页面。默认读取进攻定位球（setPieceScenario=1）；请从 SetPieceTakerAddPlayerList 选出球员下标后，直接带 action='add-left'|'add-right'|'add-both'|'remove'|'move' 与 playerPaths:['下标'] 调用本工具预览（无需切页）。"
      };
      const query = await prepare(scope, base, contexts, args);
      return scope.api("/api/v1/setpiece-takers/preview", query);
    }),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken || !args.action) throw new Error("需要原主罚人操作预览token和固定operationId。");
      return context(args, async (scope, base, contexts) => {
        const query = await prepare(scope, base, contexts, args);
        const preview = await scope.api("/api/v1/setpiece-takers/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("主罚候选或当前战术已变化，请刷新。");
        const isSideAction = ["add-left", "add-right", "add-both", "remove", "move"].includes(args.action);
        const isPenaltyAction = ["penalty-add", "penalty-remove", "penalty-move", "penalty-quick-pick"].includes(args.action);
        // add-right 默认写入 SetPiecePitchSide=1（右路），add-left 默认写入 SetPiecePitchSide=0（左路）
        let watchHandle = isPenaltyAction ? query.penalties : query.takerList;
        if (args.action === "add-left" && contexts.SetPiecePitchSide !== 0) {
          watchHandle = (await scope.subscribe(base.setpiece, "SetPieceTakerDataForSide", { ...contexts, SetPiecePitchSide: 0 })).handle;
        } else if (args.action === "add-right" && contexts.SetPiecePitchSide !== 1) {
          watchHandle = (await scope.subscribe(base.setpiece, "SetPieceTakerDataForSide", { ...contexts, SetPiecePitchSide: 1 })).handle;
        }
        const before = (isSideAction || isPenaltyAction) ? takerIds((await scope.ready(watchHandle)).value, isSideAction) : null;
        const receipt = await scope.api("/api/v1/setpiece-takers/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        if (!before || !receipt.ok) return { ...receipt, takerConfigurationVerified: false };

        let expected = null;
        if (args.action === "move" || args.action === "penalty-move") {
          expected = [...before];
          const [moved] = expected.splice(Number(query.paths[0]), 1);
          expected.splice(query.destination, 0, moved);
        }
        try {
          let after;
          for (let attempt = 0; attempt < 6; attempt++) {
            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 180));
            after = takerIds((await scope.ready(watchHandle)).value, isSideAction);
            if (!after) continue;
            const ok = expected
              ? after.length === expected.length && after.every((id, idx) => id === expected[idx])
              : (args.action === "remove" || args.action === "penalty-remove")
                ? after.length < before.length
                : (args.action === "add-left" || args.action === "add-right" || args.action === "add-both" || args.action === "penalty-add")
                  ? after.length > before.length
                  : JSON.stringify(after) !== JSON.stringify(before);
            if (ok) {
              return { ...receipt, takerConfigurationVerified: true, orderObservation: { before, ...(expected ? { expected } : {}), after } };
            }
          }
          return { ...receipt, takerConfigurationVerified: false, orderObservation: { before, ...(expected ? { expected } : {}), after } };
        } catch (error) {
          return { ...receipt, takerConfigurationVerified: false, observationError: String(error.message || error) };
        }
      });
    }
  };
}
