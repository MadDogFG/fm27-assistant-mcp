import { createLiveClient, clean, scalar } from "./live-client.mjs";

const stripRichText = v => clean(v).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

// 多球员横向比较工具（Review #40）：
// - 同时支持本队球员（playerIndices / { squadIndex }）与外部可见引援目标（{ source, path } 或 { playerName, club }）混合比较
// - 补读核心技战体属性（保留球探区间如 "10-13" 或 null 未知）、持球/无球最佳角色与球探认知度
// - 客观字段（年龄/身高/体重）仅报差值与范围，不再把最老或最重者标成 leader
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

  async function resolveExternalByName(scope, { playerName, club = "" }) {
    const query = stripRichText(playerName);
    if (!query) throw new Error("外部比较目标缺少 playerName。");
    const gs = await scope.subscribeOptional("game", "Search", { human: { source: "human" } }, 1200);
    if (!gs.handle) throw new Error(`无法通过 game.Search 定位外部球员 "${query}"。`);
    const sName = await scope.subscribeOptional(gs.handle, "Name", {}, 800);
    const sList = await scope.subscribeOptional(gs.handle, "PersonList", {}, 800);
    if (!sName.handle || !sList.handle) throw new Error("游戏搜索输入框或结果列表不可用。");
    const beforeName = stripRichText(scalar(sName.read?.value) ?? "");
    const beforeFirstId = (await scope.ready(sList.handle)).value?.items?.[0]?.identity || "";
    const sameQuery = beforeName.toLowerCase() === query.toLowerCase();
    let wrote = false;
    try {
      if (!sameQuery) {
        await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query)
        });
        wrote = true;
      }
      let listVal = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 0 ? (sameQuery ? 50 : 350) : 180));
        listVal = (await scope.ready(sList.handle)).value;
        const curFirstId = listVal?.items?.[0]?.identity || "";
        if (sameQuery || curFirstId !== beforeFirstId || (listVal?.count === 0 && attempt >= 1)) break;
      }
      const total = listVal?.count ?? 0;
      const clubQ = stripRichText(club).toLowerCase();
      for (let i = 0; i < Math.min(total, 8); i++) {
        const rowSub = await scope.subscribeOptional({ source: sList.handle, path: String(i) }, "RowData", { human: { source: "human" } }, 700);
        if (!rowSub.handle || rowSub.read?.value?.type !== "FM.UI.PersonReference") {
          if (rowSub.handle) await scope.release(rowSub.handle).catch(() => {});
          continue;
        }
        if (clubQ) {
          const cSub = await scope.subscribeOptional({ source: rowSub.handle }, "Club", { human: { source: "human" } }, 500);
          let cName = "";
          if (cSub.handle && cSub.read?.value?.type !== "SI.Bindable.NullReference") {
            cName = stripRichText((await scope.readAndRelease(cSub.handle, "Name", {}, 400)).scalar || "");
          }
          if (cSub.handle) await scope.release(cSub.handle).catch(() => {});
          if (!cName.toLowerCase().includes(clubQ)) {
            await scope.release(rowSub.handle).catch(() => {});
            continue;
          }
        }
        return { pRef: { source: rowSub.handle }, identity: rowSub.read.value.identity || null, targetType: "external_by_name" };
      }
      throw new Error(`未在全库中定位到外部球员 "${query}"${club ? `（俱乐部：${club}）` : ""}。`);
    } finally {
      if (wrote) {
        try {
          const cur = stripRichText(scalar((await scope.ready(sName.handle, undefined, 500)).value) ?? "");
          if (cur.toLowerCase() === query.toLowerCase()) {
            await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(beforeName)
            });
          }
        } catch {}
      }
    }
  }

  async function readProfile(scope, pRef, baseCtx, meta, includeCoreAttributes) {
    const pCtx = { ...baseCtx, Person: pRef, InPossession: true };
    const propNames = [
      "Name", "Age", "PositionString", "BestPositionShortString", "NationalityText",
      "Condition", "Morale", "MatchSharpness", "Height", "Weight",
      "Wage", "Value", "AskingPrice", "AwardsCount",
      "BestRoleForPosition", "BestOOPRoleForPosition", "ScoutingKnowledgeLevel"
    ];
    const fields = {};
    for (const name of propNames) {
      const r = await scope.readAndRelease(pRef, name, pCtx, 650);
      fields[name] = r.ok ? (r.scalar ?? r.value) : null;
    }
    if (!fields.PositionString) {
      fields.PositionString = fields.BestPositionShortString || null;
    }
    if (!fields.PositionString) {
      const reportSub = await scope.subscribeOptional(pRef, "ClubCoachReport", pCtx, 700);
      if (reportSub.handle) {
        const sp = await scope.readAndRelease(reportSub.handle, "ScoutedPositionList", pCtx, 700);
        fields.PositionString = extractPosList(sp.value);
        await scope.release(reportSub.handle);
      }
    }
    // 读取所属俱乐部（区分自由球员/有约/未知）
    const clubSub = await scope.subscribeOptional(pRef, "Club", pCtx, 500);
    if (clubSub.handle && clubSub.read?.value) {
      if (clubSub.read.value.type === "SI.Bindable.NullReference") {
        fields.Club = "自由球员";
        fields.clubStatus = "free_agent";
      } else {
        fields.Club = await scope.resolveRefName(clubSub.handle, pCtx, 450) || "有约在身";
        fields.clubStatus = "contracted";
      }
      await scope.release(clubSub.handle).catch(() => {});
    } else {
      fields.Club = null;
      fields.clubStatus = "unavailable";
    }

    let coreAttributes = null;
    if (includeCoreAttributes) {
      const coreList = ["Pace", "Acceleration", "Stamina", "Strength", "Technique", "Passing", "Dribbling", "Finishing", "Tackling", "Marking", "Decisions", "Vision", "WorkRate", "Positioning"];
      const metaProps = await scope.properties(pRef, "").catch(() => []);
      const propSet = new Set(metaProps.map(p => p.name.split(":")[0]));
      coreAttributes = {};
      for (const base of coreList) {
        const matched = [base, `Attribute${base}`, `PlayerAttribute${base}`].find(c => propSet.has(c));
        if (!matched) continue;
        const r = await scope.readAndRelease(pRef, matched, pCtx, 450);
        // 保留球探知识区间（如 "10-13"）或未知 null，绝不把区间强行压成单值
        coreAttributes[base] = r.ok && r.scalar !== null && String(r.scalar).trim() !== "" ? stripRichText(r.scalar) : null;
      }
    }

    return {
      ...meta,
      ...fields,
      ...(coreAttributes ? { coreAttributes } : {})
    };
  }

  async function comparePlayers({ playerIndices, targets, includeCoreAttributes = true } = {}) {
    // 兼容旧版 playerIndices 与新版混合 targets（支持本队 + 外部引援目标同台比较）
    let resolvedTargets = [];
    if (Array.isArray(targets) && targets.length > 0) {
      resolvedTargets = targets;
    } else if (Array.isArray(playerIndices) && playerIndices.length > 0) {
      resolvedTargets = playerIndices.map(idx => ({ squadIndex: idx }));
    } else {
      throw new Error("请提供 2 到 4 个比较对象（playerIndices 或 targets，支持本队 squadIndex 与外部 { source, path } / { playerName } 混合比较）。");
    }
    if (resolvedTargets.length < 2 || resolvedTargets.length > 4) {
      throw new Error("比较对象数量必须为 2 到 4 名球员。");
    }

    const profiles = [];
    for (const t of resolvedTargets) {
      const row = await client.scope(async scope => {
        const team = await scope.subscribeOptional("human", "Team");
        const baseCtx = {
          human: { source: "human" }, Human: { source: "human" },
          ...(team.handle ? { team: { source: team.handle }, Team: { source: team.handle } } : {})
        };
        if (t?.source) {
          const pRef = { source: t.source, path: t.path || "" };
          return readProfile(scope, pRef, baseCtx, { targetType: "external_reference", source: t.source, path: t.path || "", identity: t.personIdentity || null }, includeCoreAttributes);
        }
        if (t?.playerName) {
          const found = await resolveExternalByName(scope, t);
          return readProfile(scope, found.pRef, baseCtx, { targetType: found.targetType, identity: found.identity }, includeCoreAttributes);
        }
        const idx = Number.isInteger(t?.squadIndex) ? t.squadIndex : t?.playerIndex;
        if (!Number.isInteger(idx) || idx < 0) throw new Error(`无效球员比较目标: ${JSON.stringify(t)}`);
        if (!team.handle) throw new Error("当前未执教球队，无法按 squadIndex 读取本队球员。");
        const players = await scope.subscribeOptional({ source: team.handle }, "Players", baseCtx, 1500);
        const items = players.read?.value?.items || [];
        const total = players.read?.value?.count ?? items.length;
        if (idx >= total) throw new Error(`球员索引越界: ${idx} (一线队共 ${total} 人)`);
        const pRef = { source: players.handle, path: String(idx) };
        return readProfile(scope, pRef, baseCtx, { targetType: "own_squad", index: idx, identity: items[idx]?.identity || null }, includeCoreAttributes);
      });
      profiles.push(row);
    }

    // 区分“越高越优指标”（输出 leader）与“客观特征指标”（仅输出差值 delta/range，不给最老或最重者标 leader）（Review #40）
    const higherIsBetterKeys = ["Condition", "Morale", "MatchSharpness", "AwardsCount"];
    const objectiveKeys = ["Age", "Height", "Weight"];
    const parseNum = v => {
      if (v === null || v === undefined || v === "") return null;
      const m = String(v).match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };

    const comparison = {};
    for (const key of higherIsBetterKeys) {
      const vals = profiles.map((p, i) => ({ slot: i, index: p.index ?? null, name: p.Name, value: parseNum(p[key]) }));
      const valid = vals.filter(v => v.value !== null);
      comparison[key] = {
        metricKind: "higher_is_better",
        values: vals,
        leader: valid.length ? valid.reduce((a, b) => (b.value > a.value ? b : a)) : null
      };
    }
    for (const key of objectiveKeys) {
      const vals = profiles.map((p, i) => ({ slot: i, index: p.index ?? null, name: p.Name, value: parseNum(p[key]) }));
      const valid = vals.filter(v => v.value !== null);
      const minV = valid.length ? Math.min(...valid.map(v => v.value)) : null;
      const maxV = valid.length ? Math.max(...valid.map(v => v.value)) : null;
      comparison[key] = {
        metricKind: "objective_profile_delta",
        values: vals,
        min: minV,
        max: maxV,
        delta: minV !== null && maxV !== null ? Number((maxV - minV).toFixed(2)) : null
      };
    }

    const roleComparison = profiles.map((p, i) => ({
      slot: i,
      name: p.Name,
      targetType: p.targetType,
      club: p.Club,
      position: p.PositionString,
      bestInPossessionRole: p.BestRoleForPosition || null,
      bestOutOfPossessionRole: p.BestOOPRoleForPosition || null,
      scoutingKnowledge: p.ScoutingKnowledgeLevel || null
    }));

    return { ok: true, readOnly: true, count: profiles.length, profiles, roleComparison, comparison };
  }

  return { comparePlayers };
}
