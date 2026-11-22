import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

const clean = text => String(text ?? "").replace(/[\u200b-\u200d\ufeff]/g, "");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createTacticTools(call) {
  const { api, finish } = createLiveClient(call);

  async function ready(handle) {
    const deadline = Date.now() + 7000;
    do {
      const result = await api("/api/v1/live/read", { handle, depth: 6 });
      if (result.status === "ready") return result;
      await pause(50);
    } while (Date.now() < deadline);
    throw new Error("游戏数据仍未返回，请重新读取状态。");
  }

  async function withTactic(slot, inPossession, action) {
    if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot > 10)) throw new Error("selectionIndex 必须为 0..10。");
    const handles = [];
    async function subscribe(source, name, contexts = {}) {
      const properties = await api("/api/v1/live/properties", { source, filter: name });
      const property = properties.properties.find(item => item.name.split(":")[0] === name);
      if (!property) throw new Error(`当前游戏引用不支持 ${name}`);
      const selectedContexts = {};
      for (const required of property.contexts || []) {
        const key = required.name.split(":")[0];
        if (!Object.hasOwn(contexts, key)) throw new Error(`${name} 缺少上下文 ${key}`);
        selectedContexts[key] = contexts[key];
      }
      const opened = await api("/api/v1/live/open", { source, property: property.id, contexts: selectedContexts }, true);
      handles.push(opened.handle);
      return { handle: opened.handle, read: await ready(opened.handle) };
    }
    try {
      const match = await api("/api/v1/match/state");
      const team = await subscribe("human", "Team");
      const humanRef = { source: "human" }, teamRef = { source: team.handle };
      const useMatch = match.inMatch && !match.pastMatch && !match.replay && !match.finished && !match.spectating;
      const tactic = await subscribe(useMatch ? "match" : team.handle, "Tactic", { Boolean: true,
        human: humanRef, Human: humanRef, team: teamRef, Team: teamRef });
      const name = await subscribe(tactic.handle, "Name");
      if (slot === null) return await action({ tactic, name: clean(name.read.value?.value), subscribe });
      const context = { TeamSelectionIndex: slot, InPossession: inPossession };
      const options = await subscribe(tactic.handle, "AvailableRolesDropdown", context);
      const current = await subscribe(tactic.handle, "RoleValue", context);
      const roles = (options.read.value?.items || []).flatMap((item, index) => {
        const row = item?.fields?.["0x526f7744"]?.fields;
        const detail = row?.["0x71764a36"]?.fields;
        if (row?.["0x7074766c"]?.value !== "1" || !detail?.["0x506f736a"]) return [];
        return [{ optionIndex: index, mask: detail["0x506f736a"].value,
          name: clean(detail["0x36392020"]?.value), selected: detail["0x736c7464"]?.value === "True" }];
      });
      return await action({ tactic, name: clean(name.read.value?.value), options, current, roles });
    } finally {
      for (const handle of handles.reverse()) {
        try { await api("/api/v1/live/close", { handle }, true); } catch { /* session may have changed */ }
      }
    }
  }

  async function formationContext(inPossession, action) {
    return withTactic(null, inPossession, async context => {
      const current = await context.subscribe(context.tactic.handle, "Formation", { InPossession: inPossession });
      const options = await context.subscribe(context.tactic.handle, "AddFormationOptions", { InPossession: inPossession });
      const choices = [];
      function visit(node, path = "") {
        if (node?.kind === "list") node.items.forEach((item, index) => visit(item, path ? `${path}/${index}` : String(index)));
        if (node?.kind !== "record") return;
        const id = node.fields["0x7074766c"]?.value;
        const label = node.fields["0x71764a36"];
        if (!path.split("/").includes("0x526f7744") && node.count === 2 && Number(id) > 0 && label?.type === "System.String")
          choices.push({ id, name: clean(label.value), path });
        for (const [key, value] of Object.entries(node.fields))
          if (value?.kind === "list" || value?.kind === "record") visit(value, `${path}/${key}`);
      }
      visit(options.read.value);
      return action({ ...context, current, options, choices });
    });
  }

  return {
    async getRoles(args) {
      const slot = args.selectionIndex;
      const inPossession = args.inPossession ?? true;
      return withTactic(slot, inPossession, async context => ({ ok: true, source: "live_game",
        tactic: context.name, selectionIndex: slot, inPossession,
        currentRole: context.current.read.value?.value, roles: context.roles }));
    },
    async setRole(args) {
      const slot = args.selectionIndex;
      const inPossession = args.inPossession ?? true;
      const operationId = args.operationId || randomUUID();
      return withTactic(slot, inPossession, async context => {
        const wanted = clean(args.role);
        const matches = context.roles.filter(role => role.mask === wanted || role.name === wanted);
        if (matches.length !== 1) throw new Error(`请从当前合法选项中指定角色：${context.roles.map(role => `${role.name} (${role.mask})`).join("、")}`);
        const expected = args.expectedRole ?? context.current.read.value?.value;
        let receipt = await api("/api/v1/commands/set-role", { id: operationId, tactic: context.tactic.handle,
          options: context.options.handle, current: context.current.handle, option: matches[0].optionIndex,
          slot, inPossession, expected }, true);
        receipt = await finish(receipt);
        return { ...receipt, tactic: context.name, role: matches[0].name,
          ...(receipt.status === "pending" ? { warning: "结果尚未确认。用 operation_status 查询，勿重发命令。" } : {}) };
      });
    },
    getFormations: args => formationContext(args.inPossession ?? true, async context => ({ ok: true, source: "live_game",
      tactic: context.name, inPossession: args.inPossession ?? true, currentFormation: context.current.read.value?.value,
      choices: [...new Map(context.choices.map(({ id, name }) => [id, { id, name }])).values()] })),
    setFormation: args => formationContext(args.inPossession ?? true, async context => {
      const matches = context.choices.filter(choice => choice.id === args.formation || choice.name === clean(args.formation));
      const unique = [...new Map(matches.map(choice => [choice.id, choice])).values()];
      if (unique.length !== 1) throw new Error("请从 get_formation_options 返回的阵型名称或 ID 中选择。");
      const receipt = await api("/api/v1/commands/set-formation", { id: args.operationId || randomUUID(),
        tactic: context.tactic.handle, options: context.options.handle, current: context.current.handle,
        optionPath: unique[0].path, inPossession: args.inPossession ?? true,
        expected: args.expectedFormation ?? context.current.read.value?.value }, true);
      return { ...await finish(receipt), tactic: context.name, formation: unique[0].name };
    }),
    operationStatus: args => api("/api/v1/commands/status", { id: args.operationId })
  };
}
