import { createLiveClient, scalar, clean } from "./live-client.mjs";

// 预设战术风格中英文别名映射，支持用中文、英文或数字 ID 一键切换
const TACTICAL_STYLE_ALIASES = {
  "0": ["控制球权", "control possession", "control", "possession"],
  "1": ["高位压迫", "gegenpress", "gegenpressing", "high press"],
  "2": ["密集短传", "tiki-taka", "tiki taka", "tikitaka"],
  "3": ["垂直密集短传", "vertical tiki-taka", "vertical tiki taka"],
  "4": ["双翼齐飞", "wing play", "wingplay", "wings"],
  "5": ["长传冲吊", "route one", "long ball"],
  "6": ["灵活防反", "fluid counter-attack", "fluid counter", "fluid"],
  "7": ["快速防反", "direct counter-attack", "direct counter", "counter"],
  "8": ["链式防守", "catenaccio"],
  "9": ["摆大巴", "park the bus", "park bus", "bus"],
  "10": ["空白", "clean slate", "blank"]
};

const stripStyleText = v => clean(v).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

export function createTacticSlotTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef, Boolean: true };
      const useTeam = args.action === "training" || args.scope !== "current";
      let tactic;
      if (useTeam) tactic = await scope.subscribe(team.handle, "Tactic", contexts);
      else tactic = (await scope.tactic()).tactic;
      const channels = {};
      const properties = new Set((await scope.properties(tactic.handle, "TacticSlot")).map(row => row.name.split(":")[0]));
      const names = [...properties].filter(name => /^TacticSlot[1-9][0-9]*Name$/.test(name) &&
        properties.has(name.replace(/Name$/, "Valid"))).sort();
      if (!names.length) throw new Error("游戏当前未提供战术槽位。");
      for (const name of ["CurrentTacticSlot", ...names.flatMap(name => [name, name.replace(/Name$/, "Valid")])])
        channels[name] = (await scope.subscribe(tactic.handle, name, contexts)).handle;
      if (useTeam) for (const name of ["PrimaryTrainingTacticSlotIndex", "TacticsSlotForRadioGroup"])
        if ((await scope.properties(tactic.handle, name)).some(row => row.name.split(":")[0] === name)) channels[name] = (await scope.subscribe(tactic.handle, name, contexts)).handle;
      if (!useTeam && (await scope.properties(tactic.handle, "CanRevert")).some(row => row.name.split(":")[0] === "CanRevert")) channels.CanRevert = (await scope.subscribe(tactic.handle, "CanRevert", contexts)).handle;
      const query = { action: args.action, team: team.handle, tactic: tactic.handle, channels, slot: args.slotIndex };
      if (args.saveFile) {
        query.info = (await scope.subscribe(tactic.handle, "TacticInfo", contexts)).handle;
        query.saveMethod = (await scope.subscribe("singleton:ApplicationReference", "DefaultAddOnSaveMethod")).handle;
        query.name = args.name;
        query.id = args.operationId;
      }
      if (args.creation) {
        channels.IsCreatingTactic = (await scope.subscribe(tactic.handle, "IsCreatingTactic", contexts)).handle;
        const data = "singleton:StaticDataReference";
        query.styles = (await scope.subscribe(data, "TacticalStylesOptionList")).handle;
        query.formations = (await scope.subscribe(data, "FormationOptionList", { InPossession: true })).handle;
        query.oopFormations = (await scope.subscribe(data, "FormationOptionList", { InPossession: false })).handle;
        Object.assign(query, { style: args.tacticalStyle, ip: args.inPossessionFormation, oop: args.outOfPossessionFormation });
      }
      if (args.manageMenu) {
        const menuKind = args.menuKind || "modify";
        if (!["add", "modify"].includes(menuKind)) throw new Error("menuKind需要add或modify；复制战术候选来自add菜单。");
        const config = await scope.subscribe("singleton:ConfigReference", "ShowSaveLoadTacticsOptionsOnly");
        const reduced = scalar(config.read.value);
        if (!/^(true|false)$/i.test(String(reduced))) throw new Error("原生战术菜单配置尚未就绪。");
        contexts.ShowReducedOptions = String(reduced).toLowerCase() === "true";
        query.choices = (await scope.subscribe(tactic.handle, menuKind === "add" ? "AddTacticOptions" : "ModifyTacticOptions", contexts)).handle;
      }
      return perform(scope, query);
    });
  }
  async function tacticFiles(scope, observedMethod) {
    const app = "singleton:ApplicationReference";
    const method = observedMethod ?? (await scope.subscribe(app, "DefaultAddOnSaveMethod")).handle;
    const files = await scope.subscribe(app, "AddOnsList", {
      SelectedSaveMethod: { valueSource: method },
      AddOnType: "TACTICS_TYPE_HANDLER"
    });
    if (files.read.value?.kind !== "list") throw new Error("游戏未返回战术文件列表。");
    return { ok: true, saveMethod: scalar((await scope.ready(method)).value), files: files.read.value, handle: files.handle };
  }
  return {
    files: () => client.scope(async scope => {
      const { handle, ...result } = await tacticFiles(scope);
      return result;
    }),
    saveFile: args => context({ ...args, scope: "team", saveFile: true }, async (scope, query) => {
      const preview = await scope.api("/api/v1/tactic-slots/save-file-preview", query);
      if (!args.expectedChoiceToken) return preview;
      if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("战术或文件名已变化，请刷新预览。");
      const baseline = await tacticFiles(scope, query.saveMethod);
      const receipt = await scope.api("/api/v1/tactic-slots/save-file", { ...query, choiceToken: args.expectedChoiceToken }, true);
      const result = { ...receipt, filename: preview.filename, slot: preview.slot };
      if (receipt.status !== "dispatched_unverified") return result;
      try {
        const after = (await scope.ready(baseline.handle)).value;
        return { ...result, fileListObservation: { beforeCount: baseline.files.count, afterCount: after?.count } };
      } catch (error) {
        return { ...result, observationError: String(error.message || error) };
      }
    }),
    creation: args => context({ ...args, scope: "team", creation: true }, (scope, query) => scope.api("/api/v1/tactic-slots/creator-preview", query)),
    create: args => {
      if (!args.operationId || !args.expectedChoiceToken ||
        ![args.tacticalStyle, args.inPossessionFormation, args.outOfPossessionFormation].every(Number.isInteger))
        throw new Error("提供原战术风格、持球和无球阵型 ID、创建预览 token 和固定 operationId。");
      return context({ ...args, scope: "team", creation: true }, async (scope, query) => {
        const receipt = await scope.api("/api/v1/tactic-slots/creator-execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        if (receipt.status !== "dispatched_unverified") return receipt;
        try {
          const observation = await context({ scope: "team" }, (fresh, state) => fresh.api("/api/v1/tactic-slots/state", { ...state, operationId: args.operationId }));
          return { receipt: observation.receipt || receipt, observation };
        } catch (error) { return { ...receipt, observationError: String(error.message || error), retrySafe: false }; }
      });
    },
    menu: args => context({ ...args, scope: "team", manageMenu: true }, (scope, query) => args.optionPath ?
      scope.api("/api/v1/tactic-slots/menu-preview", { ...query, path: args.optionPath }) : scope.api("/api/v1/tactic-slots/menu-options", query)),
    manage: args => {
      if (!args.operationId || !args.expectedChoiceToken || !args.optionPath) throw new Error("需要原菜单optionPath/token与固定operationId。");
      return context({ ...args, scope: "team", manageMenu: true }, async (scope, query) => {
        const selected = { ...query, path: args.optionPath };
        const preview = await scope.api("/api/v1/tactic-slots/menu-preview", selected);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("菜单或战术槽位已变化，请刷新。");
        if (preview.requiresDeleteAcknowledgment && args.acceptDelete !== true) throw new Error("需acceptDelete明确确认删除当前预览槽位。");
        const before = await scope.api("/api/v1/tactic-slots/state", query);
        const receipt = await scope.api("/api/v1/tactic-slots/menu-execute", { ...selected, id: args.operationId, choiceToken: args.expectedChoiceToken, acceptDelete: args.acceptDelete === true }, true);
        if (receipt.status === "transport_result_unknown") return receipt;
        try {
          const observation = await context({ scope: "team" }, (fresh, state) => fresh.api("/api/v1/tactic-slots/state", state));
          const occupied = before.slots.filter(slot => slot.exists).length;
          const after = observation.slots.filter(slot => slot.exists).length;
          const sameTarget = before.targetIdentity === observation.targetIdentity;
          const slotCountChangedAsRequested = sameTarget && after === occupied + (preview.requiresDeleteAcknowledgment ? -1 : 1);
          return { ...receipt, observation, slotCountChangedAsRequested, tacticManagementVerified: false };
        }
        catch (error) { return { ...receipt, observationError: String(error.message || error), retrySafe: false, tacticManagementVerified: false }; }
      });
    },
    // 一键读取或切换预设战术风格（直接更新原生 TacticalStyleDropdown 并读回验证心态/风格同步生效）
    setStyle: async ({ style, previewOnly = false } = {}) => client.scope(async scope => {
      const { team, tactic } = await scope.tactic();
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const [sStyle, sDD, sOpts, sRec, sMent] = await Promise.all([
        scope.subscribe(tactic.handle, "TacticalStyle", ctx),
        scope.subscribe(tactic.handle, "TacticalStyleDropdown", ctx),
        scope.subscribe(tactic.handle, "TacticalStyleDropdownOptions", ctx),
        scope.subscribeOptional(tactic.handle, "TopThreeRecommendedTacticalStyles", ctx, 800),
        scope.subscribeOptional(tactic.handle, "Mentality", ctx, 800)
      ]);
      const rawItems = sOpts.read?.value?.items || [];
      const options = rawItems.map((item, idx) => ({
        index: idx,
        id: String(item.fields?.["0x7074766c"]?.value ?? idx),
        label: stripStyleText(item.fields?.["0x71764a36"]?.value || "")
      }));
      const hasActiveTactic = Boolean(sDD.read?.value && sDD.read.value.kind === "record");
      const current = {
        styleId: String(scalar(sStyle.read?.value) ?? ""),
        dropdownId: String(sDD.read?.value?.fields?.["0x7074766c"]?.value ?? ""),
        label: stripStyleText(sDD.read?.value?.fields?.["0x71764a36"]?.value || ""),
        mentality: sMent.handle ? String(scalar(sMent.read?.value) ?? "") : null,
        hasActiveTactic
      };
      const recommendedIds = (sRec.read?.value?.items || []).map(x => String(x?.value ?? x)).filter(Boolean);

      if (style === undefined || style === null || style === "" || previewOnly) {
        return { ok: true, readOnly: true, current, recommendedIds, options };
      }

      if (!hasActiveTactic) {
        return {
          ok: false,
          verified: false,
          blockedReason: "no_active_tactic",
          error: "当前球队尚未创建任何活跃战术（TacticalStyle=-1 且 TacticalStyleDropdown 为空），不能直接写入预设风格。请先通过 get_tactic_creation + create_tactic 创建首套战术槽位后再切换风格。",
          before: current,
          recommendedIds,
          options
        };
      }

      // 解析目标风格（支持数字 ID、中文标签、英文别名模糊匹配）
      const q = stripStyleText(String(style)).toLowerCase();
      let target = options.find(o => o.id === q || o.label.toLowerCase() === q);
      if (!target) {
        target = options.find(o => o.label.toLowerCase().includes(q));
      }
      if (!target) {
        for (const [id, aliases] of Object.entries(TACTICAL_STYLE_ALIASES)) {
          if (aliases.some(a => a.includes(q) || q.includes(a))) {
            target = options.find(o => o.id === id);
            if (target) break;
          }
        }
      }
      if (!target) {
        throw new Error(`未匹配到预设战术风格 "${style}"；可用风格：${options.map(o => `${o.id}:${o.label}`).join(" / ")}`);
      }

      const dispatch = await call(`/api/v1/internal/update?handle=${encodeURIComponent(sDD.handle)}&apply=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ $value: { source: sOpts.handle, path: String(target.index) } })
      });

      // 轮询读回验证 TacticalStyle 与 TacticalStyleDropdown 已生效
      let after = null;
      let verified = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 0 ? 300 : 200));
        const [rStyle, rDD, rMent] = await Promise.all([
          scope.ready(sStyle.handle),
          scope.ready(sDD.handle),
          sMent.handle ? scope.ready(sMent.handle) : Promise.resolve(null)
        ]);
        after = {
          styleId: String(scalar(rStyle?.value) ?? ""),
          dropdownId: String(rDD?.value?.fields?.["0x7074766c"]?.value ?? ""),
          label: stripStyleText(rDD?.value?.fields?.["0x71764a36"]?.value || ""),
          mentality: rMent ? String(scalar(rMent?.value) ?? "") : null
        };
        if (after.styleId === target.id && after.dropdownId === target.id) {
          verified = true;
          break;
        }
      }

      return {
        ok: Boolean(dispatch?.ok !== false && verified),
        verified,
        requested: target,
        before: current,
        after,
        recommendedIds
      };
    }),
    get: args => context(args, (scope, query) => args.action ? scope.api("/api/v1/tactic-slots/preview", query) : scope.api("/api/v1/tactic-slots/state", { ...query, operationId: args.operationId })),
    execute: args => {
      if (!["select", "training"].includes(args.action) || !Number.isInteger(args.slotIndex) || args.slotIndex < 0 || !args.operationId || !args.expectedChoiceToken)
        throw new Error("提供select/training、游戏返回的slotIndex、预览token和固定operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/tactic-slots/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("战术槽位或当前选择已变化，请刷新。");
        const receipt = await scope.api("/api/v1/tactic-slots/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
        if (receipt.status === "transport_result_unknown") return receipt;
        try { return { receipt, observation: await context({ ...args, action: undefined, scope: args.action === "training" ? "team" : args.scope }, (fresh, state) => fresh.api("/api/v1/tactic-slots/state", { ...state, operationId: args.operationId })), matchEngineAcceptanceVerified: false }; }
        catch (error) { return { receipt, observationError: String(error.message || error), retrySafe: false }; }
      });
    }
  };
}
