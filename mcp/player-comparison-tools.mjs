import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 多球员属性、体能、身价、薪资与生涯状态专用横向比较工具组（REC-R20）
export function createPlayerComparisonTools(call) {
  const client = createLiveClient(call);
  const stripTags = text => clean(text).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();

  async function comparePlayers({ playerIndices = [0, 1] } = {}) {
    if (!Array.isArray(playerIndices) || playerIndices.length < 2 || playerIndices.length > 4) {
      throw new Error("playerIndices 必须包含 2 到 4 个球员索引。");
    }

    const propNames = [
      "Name",
      "Age",
      "PositionString",
      "NationalityText",
      "Condition",
      "Morale",
      "MatchSharpness",
      "Height",
      "Weight",
      "Wage",
      "Value",
      "BiographyCareerStatsString",
      "AwardsCount",
      "AskingPrice",
    ];

    const profiles = [];
    for (const idx of playerIndices) {
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`无效球员索引: ${idx}`);
      const row = await client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const baseCtx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const players = await scope.subscribeOptional({ source: team.handle }, "Players", baseCtx, 1500);
        const items = players.read?.value?.items || [];
        if (idx >= items.length) {
          throw new Error(`球员索引越界: ${idx} (一线队共 ${items.length} 人)`);
        }
        const pRef = { source: players.handle, path: String(idx) };
        const pCtx = { ...baseCtx, Person: pRef };
        const fields = {};
        for (const name of propNames) {
          const sub = await scope.subscribeOptional(pRef, name, pCtx, 700);
          if (sub.handle) {
            const val = sub.read?.value;
            fields[name] = val?.kind === "scalar"
              ? (val.type === "System.String" ? stripTags(val.value) : val.value)
              : val;
          } else {
            fields[name] = null;
          }
        }
        return { index: idx, identity: items[idx]?.identity || null, ...fields };
      });
      profiles.push(row);
    }

    // 生成两两或多项数值差值比较矩阵（针对 Condition / Morale / Age / Wage / Value / AwardsCount）
    const numericKeys = ["Age", "Condition", "Morale", "MatchSharpness", "Height", "Weight", "AwardsCount"];
    const comparison = {};
    for (const key of numericKeys) {
      const vals = profiles.map(p => ({ index: p.index, name: p.Name, value: p[key] !== null ? Number(p[key]) : null }));
      const valid = vals.filter(v => v.value !== null && !Number.isNaN(v.value));
      comparison[key] = {
        values: vals,
        leader: valid.length ? valid.reduce((a, b) => (b.value > a.value ? b : a)) : null,
      };
    }

    return { ok: true, readOnly: true, count: profiles.length, profiles, comparison };
  }

  return { comparePlayers };
}
