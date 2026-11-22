import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 多球员属性、体能、身价、薪资与生涯状态专用横向比较工具组
export function createPlayerComparisonTools(call) {
  const client = createLiveClient(call);

  function extractPosList(val) {
    if (!val) return null;
    if (val.kind === "scalar") return clean(val.value) || null;
    if (val.kind === "list" && Array.isArray(val.items) && val.items.length) {
      const names = val.items
        .map(it => {
          if (it?.kind === "scalar") return clean(it.value);
          const f = it?.fields || {};
          return clean(f["0x71764a36"]?.value || f["0x5374726e"]?.value || f["0x6e616d65"]?.value || "");
        })
        .filter(Boolean);
      return names.length ? names.join("/") : null;
    }
    return null;
  }

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
        const pCtx = { ...baseCtx, Person: pRef, InPossession: true };
        const fields = {};
        for (const name of propNames) {
          const r = await scope.readAndRelease(pRef, name, pCtx, 700);
          fields[name] = r.ok ? (r.scalar ?? r.value) : null;
        }
        // PositionString 在部分上下文为空时，兜底从 ClubCoachReport -> ScoutedPositionList 读取
        if (!fields.PositionString) {
          const reportSub = await scope.subscribeOptional(pRef, "ClubCoachReport", pCtx, 700);
          if (reportSub.handle) {
            const sp = await scope.readAndRelease(reportSub.handle, "ScoutedPositionList", pCtx, 700);
            fields.PositionString = extractPosList(sp.value);
            await scope.release(reportSub.handle);
          }
        }
        return { index: idx, identity: items[idx]?.identity || null, ...fields };
      });
      profiles.push(row);
    }

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
