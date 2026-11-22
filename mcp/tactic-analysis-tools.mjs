import { createLiveClient } from "./live-client.mjs";

// Tactic analysis reads: the tactic's native "TacticalEffectiveness" record (understanding, player
// ability, player buy-in, next-match information, overall effectiveness, status flags, player list)
// and "TacticComplexity" record (overall / team / player / opposition instruction complexity).
// Both are exposed with hashed field ids; the plugin's property registry maps id -> name.
export function createTacticAnalysisTools(call) {
  const client = createLiveClient(call);
  async function propertyNames() {
    try {
      const registry = await call("/api/v1/internal/registry?kind=properties");
      const names = new Map();
      for (const item of registry.items || []) names.set(String(item.id), item.name);
      return names;
    } catch { return new Map(); }
  }
  function decoder(names) {
    const nameOf = key => {
      const hex = String(key).replace(/^0x/, "");
      if (!/^[0-9a-f]{8}$/i.test(hex)) return key;
      const value = parseInt(hex, 16);
      return names.get(String(value)) || `unknown:${value}`;
    };
    const decode = (value, depth) => {
      if (value === null || value === undefined || depth > 8) return value;
      if (value.kind === "scalar") return value.value;
      if (value.kind === "reference") return { reference: value.type, identity: value.identity };
      if (value.kind === "record") {
        const fields = {};
        for (const [key, child] of Object.entries(value.fields || {})) fields[nameOf(key)] = decode(child, depth + 1);
        return fields;
      }
      if (value.kind === "list") {
        const items = (value.items || []).slice(0, 100).map(item => decode(item, depth + 1));
        return { count: value.count, truncated: value.truncated === true || (value.count ?? items.length) > items.length, items };
      }
      return value;
    };
    return decode;
  }
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const effectiveness = await scope.subscribeOptional(tactic, "TacticalEffectiveness", contexts);
      const complexity = await scope.subscribeOptional(tactic, "TacticComplexity", contexts);
      if (!effectiveness.handle && !complexity.handle)
        throw new Error("当前战术未提供 TacticalEffectiveness / TacticComplexity；请确认已在战术界面且战术可用。");
      return perform({ tactic, effectiveness, complexity });
    });
  }
  return {
    get: args => context(args, async ({ tactic, effectiveness, complexity }) => {
      const names = await propertyNames();
      const decode = decoder(names);
      const read = channel => channel?.handle ? decode(channel.read?.value ?? null, 0) : null;
      return {
        ok: true,
        tactic,
        effectiveness: read(effectiveness),
        complexity: read(complexity),
        missing: {
          effectiveness: effectiveness?.handle ? null : effectiveness?.unavailable ?? "unavailable",
          complexity: complexity?.handle ? null : complexity?.unavailable ?? "unavailable"
        },
        propertyNamesResolved: names.size,
        scope: "native_tactic_analysis_binding_read_not_match_engine_acceptance",
        note: "读取游戏原生战术评估/复杂度绑定；字段名由属性注册表映射，值是游戏当前值，不保证与界面星级完全一致。"
      };
    }),
    opposition: async args => client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle },
        TeamRequestingReport: { source: team.handle } };
      const visuals = await scope.subscribeOptional(team.handle, "OppositionReportVisuals", contexts);
      const report = await scope.subscribeOptional(team.handle, "OppositionReport", contexts);
      const names = await propertyNames();
      const decode = decoder(names);
      return {
        ok: true,
        visuals: visuals.handle ? decode(visuals.read?.value ?? null, 0) : null,
        report: report.handle ? decode(report.read?.value ?? null, 0) : null,
        missing: { visuals: visuals.handle ? null : visuals.unavailable ?? "unavailable",
          report: report.handle ? null : report.unavailable ?? "unavailable" },
        boundary: "对手报告的正文/强弱点若只在战术界面面板绑定中提供，本工具不会打开面板或模拟输入；此处返回球队级原生观察数据与元数据。",
        scope: "team_opposition_report_visuals_read_not_match_engine_acceptance"
      };
    })
};
}
