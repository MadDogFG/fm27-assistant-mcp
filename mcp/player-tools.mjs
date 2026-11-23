import { randomUUID } from "node:crypto";
import { createLiveClient, clean, scalar } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createPlayerTools(call) {
  const client = createLiveClient(call);
  const phase = args => args.inPossession ?? true;
  const field = (node, key) => node?.fields?.[key];
  const choose = (choices, wanted, keys) => {
    const matches = choices.filter(choice => keys.some(key => String(choice[key]) === clean(wanted)));
    if (matches.length !== 1) throw new Error("请从本次查询返回的游戏选项中选择唯一名称或 ID。");
    return matches[0];
  };

  async function mentalities(action) {
    return client.scope(async scope => {
      const { tactic } = await scope.tactic();
      const current = await scope.subscribe(tactic.handle, "Mentality");
      const options = await scope.subscribe(tactic.handle, "MentalityDropdownOptions");
      const valueKey = await scope.propertyId("PropertyValue");
      const labelKey = await scope.propertyId("DisplayValue");
      const choices = (options.read.value?.items || []).flatMap((row, index) => {
        const id = scalar(field(row, valueKey));
        return id === null ? [] : [{ id, name: clean(scalar(field(row, labelKey))), optionPath: String(index) }];
      });
      return action({ scope, tactic, current, options, choices });
    });
  }

  async function instructionContext(args, kind, action) {
    return client.scope(async scope => {
      const { tactic } = await scope.tactic();
      const catalog = await scope.api("/api/v1/tactics/catalog", { kind });
      if (catalog.status !== "ready") return { ok: false, status: catalog.status, error: "游戏尚未加载指令资源；插件不会自动打开页面。" };
      const groups = catalog.instructions.map(g => ({ key: g.Key, id: g.Id, name: clean(g.Name), phase: g.Phase,
        options: g.Options.map(o => ({ key: o.Key, id: String(o.Id), name: clean(o.Name) })) }));
      const group = args.group === undefined ? null : choose(groups, args.group, ["key", "id", "name"]);
      const queried = [];
      for (const item of group ? [group] : groups) {
        const contexts = kind === "team" ? { TeamInstructionID: item.id } : {
          PlayerInstructionGroupID: item.id, TeamSelectionIndex: args.selectionIndex, InPossession: phase(args) };
        const current = await scope.subscribe(tactic.handle, kind === "team" ? "SelectedTeamInstructionOption" : "SelectedPlayerInstruction", contexts);
        const locked = kind === "player" ? await scope.subscribe(tactic.handle, "PlayerInstructionGroupIsLocked", contexts) : null;
        queried.push({ ...item, current: scalar(current.read.value), locked: locked ? scalar(locked.read.value)?.toLowerCase() === "true" : null,
          ...(kind === "player" ? { options: item.options.some(option => option.id === "0") ? item.options : [{ key: "None", id: "0", name: "无额外指令" }, ...item.options] } : {}),
          currentHandle: current.handle, lockedHandle: locked?.handle });
      }
      return action({ scope, tactic, groups: queried });
    });
  }

  async function lineup(args, action) {
    if (!Number.isInteger(args.selectionIndex) || args.selectionIndex < 0 || args.selectionIndex > 25) throw new Error("selectionIndex 必须为 0..25。");
    return client.scope(async scope => {
      const { tactic, contexts: ownerContexts } = await scope.tactic();
      const column = tactic.read.value?.type === "FM.UI.MatchTacticReference" && (!args.variant || args.variant === "auto");
      const contexts = { ...ownerContexts, TeamSelectionIndex: args.selectionIndex, InPossession: true };
      const options = await scope.subscribe(tactic.handle, column ? "PlayerColumnDropdownOptions" : "TeamSelectionIndexDropdown", contexts);
      const current = await scope.subscribe(tactic.handle, "PlayerFromTeamSelectionIndex", contexts);
      const rowKey = await scope.propertyId("RowData"), playerKey = await scope.propertyId("Player"), indexKey = await scope.propertyId("Index");
      const choices = [];
      for (const [index, row] of (options.read.value?.items || []).entries()) {
        const data = field(row, rowKey), display = column ? field(data, "0x71764a36") : data, player = field(display, playerKey);
        if (player?.kind !== "reference" || player.type !== "FM.UI.PersonReference") continue;
        const path = `${index}/${rowKey}/${column ? "0x71764a36/" : ""}${playerKey}`;
        const name = await scope.subscribe({ source: options.handle, path }, "Name");
        const choice = { player: player.identity, name: clean(scalar(name.read.value)),
          currentSelectionIndex: scalar(field(display, column ? "0x61766742" : indexKey)), optionIndex: index };
        try {
          Object.assign(choice, await scope.api("/api/v1/commands/pick-preview", { tactic: tactic.handle, options: options.handle,
            current: current.handle, option: index, slot: args.selectionIndex, variant: args.variant }), { selectable: true });
        } catch (error) { choice.selectable = false; choice.previewError = String(error.message || error); }
        choices.push(choice);
      }
      // 若主下拉候选列表为空，尝试二次读取或回退探测 TeamSelectionFilteredPlayers，给出明确上下文信息
      let fallbackPlayers = null;
      if (choices.length === 0) {
        const filtered = await scope.subscribeOptional(tactic.handle, "TeamSelectionFilteredPlayers", contexts, 1200);
        if (filtered.handle && filtered.read?.value?.kind === "list" && filtered.read.value.items?.length) {
          fallbackPlayers = [];
          const items = filtered.read.value.items.slice(0, 25);
          for (let i = 0; i < items.length; i++) {
            const pName = await scope.resolveRefName({ source: filtered.handle, path: String(i) }, contexts, 400).catch(() => null);
            fallbackPlayers.push({ index: i, identity: items[i]?.identity ?? null, name: pName });
          }
          await scope.release(filtered.handle);
        }
      }
      return action({ scope, tactic, options, current, choices, fallbackPlayers });
    });
  }

  async function lineupState(args) {
    if (!Number.isInteger(args.selectionIndex) || args.selectionIndex < 0 || args.selectionIndex > 25 || !args.operationId)
      throw new Error("需要 0..25 的 selectionIndex 和原 operationId。");
    return client.scope(async scope => {
      const { tactic } = await scope.tactic();
      const current = await scope.subscribe(tactic.handle, "PlayerFromTeamSelectionIndex", { TeamSelectionIndex: args.selectionIndex, InPossession: true });
      return { ...await scope.api("/api/v1/commands/pick-state", { tactic: tactic.handle, current: current.handle,
        slot: args.selectionIndex, operationId: args.operationId }), matchEffectVerified: false };
    });
  }

  return {
    withLineup: lineup,
    getMentalities: () => mentalities(async ({ current, choices }) => ({ ok: true, current: scalar(current.read.value), choices })),
    setMentality: async args => {
      const execOnce = (opId) => mentalities(async ({ scope, tactic, current, options, choices }) => {
        const choice = choose(choices, args.mentality, ["id", "name"]);
        const write = await scope.subscribe(tactic.handle, "MentalityDropdown");
        const receipt = await scope.finish(await scope.api("/api/v1/commands/set-mentality", { id: opId, tactic: tactic.handle,
          current: current.handle, write: write.handle, options: options.handle, optionPath: choice.optionPath,
          expected: args.expected ?? scalar(current.read.value) }, true));
        if (receipt.status === "unverified_timeout") {
          await pause(300);
          const fresh = await scope.api("/api/v1/live/read", { handle: current.handle }).catch(() => null);
          const actual = scalar(fresh?.value);
          if (actual !== null && String(actual) === String(choice.id)) {
            return { ...receipt, status: "verified", verified: true, after: actual, recoveredByReadback: true };
          }
          return { ...receipt, after: actual };
        }
        return receipt;
      });
      const first = await execOnce(args.operationId || randomUUID());
      if (first.status === "unverified_timeout" && !args.operationId && String(first.after ?? "") !== String(first.requested ?? "")) {
        await pause(250);
        return execOnce(randomUUID());
      }
      return first;
    },
    getInstructions: (args, kind) => instructionContext(args, kind, async ({ groups }) => ({ ok: true,
      instructions: groups.map(({ currentHandle, lockedHandle, ...rest }) => rest) })),
    setInstruction: async (args, kind) => {
      const execOnce = (opId) => instructionContext(args, kind, async ({ scope, tactic, groups }) => {
        if (groups.length !== 1) throw new Error("必须明确指定一个指令组。");
        const group = groups[0];
        if (group.locked) throw new Error("该指令组被当前角色锁定。");
        const option = choose(group.options, args.option, ["key", "id", "name"]);
        const receipt = await scope.finish(await scope.api("/api/v1/commands/set-instruction", { id: opId, tactic: tactic.handle,
          kind, current: group.currentHandle, locked: group.lockedHandle, group: group.id, option: option.id,
          slot: args.selectionIndex ?? -1, inPossession: phase(args), expected: args.expected ?? group.current }, true));
        if (receipt.status === "unverified_timeout") {
          await pause(300);
          const fresh = await scope.api("/api/v1/live/read", { handle: group.currentHandle }).catch(() => null);
          const actual = scalar(fresh?.value);
          if (actual !== null && String(actual) === String(option.id)) {
            return { ...receipt, status: "verified", verified: true, after: actual, recoveredByReadback: true };
          }
          return { ...receipt, after: actual };
        }
        return receipt;
      });
      const first = await execOnce(args.operationId || randomUUID());
      // 若首次确实超时且未生效（且调用方未固定自定义 operationId），自动重试一次提升稳定性
      if (first.status === "unverified_timeout" && !args.operationId && String(first.after ?? "") !== String(first.requested ?? "")) {
        await pause(250);
        return execOnce(randomUUID());
      }
      return first;
    },
    getLineupOptions: args => lineup(args, async ({ current, choices, options, fallbackPlayers }) => ({ ok: true, selectionIndex: args.selectionIndex,
      currentPlayer: current.read.value?.identity ?? null, choices, mutationCursor: choices.find(choice => choice.selectable)?.mutationCursor,
      truncated: Boolean(options.read.value?.truncated),
      ...(choices.length === 0 && fallbackPlayers ? {
        fallbackPlayers,
        note: "游戏当前 TeamSelectionIndexDropdown 候选列表为空（可能处于赛前待处理消息流程锁或未初始化选人界面），已附带 TeamSelectionFilteredPlayers 只读名单供参考。"
      } : {}) })),
    lineupState,
    pickPlayer: async args => {
      const receipt = await lineup(args, async ({ scope, tactic, options, current, choices }) => {
        const choice = choose(choices.filter(row => row.selectable), args.player, ["player", "name", "databaseIndex"]);
        if (args.expectedChoiceToken && args.expectedChoiceToken !== choice.choiceToken) throw new Error("球员或阵容选项已改变，请重新读取。");
        return scope.api("/api/v1/commands/pick-player", { id: args.operationId || randomUUID(), tactic: tactic.handle,
          current: current.handle, options: options.handle, option: choice.optionIndex, slot: args.selectionIndex,
          expected: args.expectedPlayer ?? current.read.value?.identity ?? "", choiceToken: choice.choiceToken, mutationCursor: args.mutationCursor,
          variant: args.variant }, true);
      });
      if (receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return { ...receipt, matchEffectVerified: false };
      const until = Date.now() + 8000; let observed = receipt;
      do {
        try { observed = await lineupState({ selectionIndex: args.selectionIndex, operationId: receipt.operationId }); }
        catch (error) { return { ...receipt, matchEffectVerified: false, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed") break;
        await pause(150);
      } while (Date.now() < until);
      return { ...observed, matchEffectVerified: false };
    }
  };
}
