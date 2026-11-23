import { createLiveClient, clean, scalar } from "./live-client.mjs";

/**
 * live-query-tools.mjs — 通用只读实时节点自省与结构化查询工具（live_describe / live_query）
 * 纯网关侧实现，严格只读，自动管理与即时释放订阅句柄，绝不修改游戏状态。
 */

// 4字节打包十六进制键解码为可读 ASCII（如 0x4d617856 -> "MaxV"）
export function hexToAscii(key) {
  if (typeof key !== "string" || !/^0x[0-9a-f]{8}$/i.test(key)) return key;
  try {
    const str = Buffer.from(key.slice(2), "hex").toString("latin1");
    return /^[\x20-\x7e]{2,4}$/.test(str) ? str : key;
  } catch {
    return key;
  }
}

const KNOWN_HEX_ALIASES = {
  "0x71764a36": "label",
  "0x7074766c": "value",
  "0x5374726e": "text",
  "0x69642020": "id",
  "0x6e616d65": "name",
  "0x7469746c": "title",
  "0x696e6478": "index",
  "0x34453354": "children",
  "0x526f7744": "rowData",
};

export function createLiveQueryTools(call) {
  const client = createLiveClient(call);

  function decodeNode(val, raw = false, depth = 0) {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return typeof val === "string" ? clean(val) : val;
    if (!raw && val.kind === "scalar") {
      return val.type === "System.String" ? clean(val.value) : val.value;
    }
    if (Array.isArray(val)) return val.map(v => decodeNode(v, raw, depth + 1));
    if (!raw && val.kind === "list" && Array.isArray(val.items)) {
      if (depth > 1) return { count: val.count ?? val.items.length, note: "嵌套列表已摘要，传 raw: true 查看全量" };
      return val.items.slice(0, 15).map(v => decodeNode(v, raw, depth + 1));
    }
    if (!raw && val.kind === "record" && val.fields) {
      const out = {};
      for (const [k, v] of Object.entries(val.fields)) {
        const key = KNOWN_HEX_ALIASES[k] || hexToAscii(k);
        out[key] = decodeNode(v, raw, depth + 1);
      }
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const key = KNOWN_HEX_ALIASES[k] || hexToAscii(k);
      out[key] = decodeNode(v, raw, depth + 1);
    }
    return out;
  }

  // 解析节点表达式（支持 "team", "club", "team.Players", { source: "team", path: "Players/19" } 等）
  async function resolveNode(scope, nodeSpec, userContexts = {}) {
    let source = "human";
    let pathStr = "";
    if (typeof nodeSpec === "string") {
      const normalized = nodeSpec.replace(/\[(\d+)\]/g, ".$1");
      const parts = normalized.split(".").filter(Boolean);
      source = parts[0] || "human";
      pathStr = parts.slice(1).join("/");
    } else if (nodeSpec && typeof nodeSpec === "object") {
      source = nodeSpec.source || "human";
      pathStr = nodeSpec.path || "";
    }

    const human = { source: "human" };
    const clubSub = await scope.subscribeOptional("human", "Club", { human }, 1500);
    const teamSub = await scope.subscribeOptional("human", "Team", { human }, 1500);
    const contexts = {
      human, Human: human,
      ...(clubSub.handle ? { club: { source: clubSub.handle }, Club: { source: clubSub.handle } } : {}),
      ...(teamSub.handle ? { team: { source: teamSub.handle }, Team: { source: teamSub.handle } } : {}),
      InPossession: true,
      ...userContexts
    };

    let currentRef;
    let currentValue = null;
    if (source === "human") currentRef = "human";
    else if (source === "club") {
      if (!clubSub.handle) throw new Error("当前无法获取 Club 节点（可能未加载存档）。");
      currentRef = clubSub.handle;
      currentValue = clubSub.read?.value ?? null;
    } else if (source === "team") {
      if (!teamSub.handle) throw new Error("当前无法获取 Team 节点（可能未加载存档）。");
      currentRef = teamSub.handle;
      currentValue = teamSub.read?.value ?? null;
    } else if (source === "training") {
      if (!teamSub.handle) throw new Error("当前无法获取 Team 节点。");
      const tr = await scope.subscribe(teamSub.handle, "TeamTraining", contexts);
      currentRef = tr.handle;
      currentValue = tr.read?.value ?? null;
    } else if (source === "tactic") {
      const { tactic } = await scope.tactic();
      currentRef = tactic.handle;
      currentValue = tactic.read?.value ?? null;
    } else if (source === "match") {
      currentRef = "match";
    } else {
      currentRef = source;
    }

    const segments = pathStr ? String(pathStr).split("/").filter(Boolean) : [];
    for (const seg of segments) {
      if (/^\d+$/.test(seg)) {
        const nextRef = typeof currentRef === "string" ? { source: currentRef, path: seg } : { source: currentRef.source, path: `${currentRef.path}/${seg}` };
        currentRef = nextRef;
        // 如果是列表元素，更新 Person/Team 上下文推断
        if (currentValue?.kind === "list" && Array.isArray(currentValue.items)) {
          const item = currentValue.items[Number(seg)];
          currentValue = item ?? null;
          if (item?.type === "FM.UI.PersonReference") contexts.Person = nextRef;
          else if (item?.type === "FM.UI.TeamReference") { contexts.team = nextRef; contexts.Team = nextRef; }
        }
      } else {
        const sub = await scope.subscribe(currentRef, seg, contexts);
        currentRef = sub.handle;
        currentValue = sub.read?.value ?? null;
        if (currentValue?.type === "FM.UI.PersonReference") contexts.Person = { source: sub.handle };
      }
    }

    return { ref: currentRef, value: currentValue, contexts, teamHandle: teamSub.handle, clubHandle: clubSub.handle };
  }

  // 读取单个节点上的单个字段（支持点号导航与对球员自动探测 LoanContract / FullContract）
  async function readField(scope, targetRef, fieldName, contexts, resolveRefs, raw, propNamesCache) {
    try {
      if (fieldName.includes(".")) {
        const [childProp, subProp] = fieldName.split(".", 2);
        const childSub = await scope.subscribeOptional(targetRef, childProp, contexts, 1000);
        if (!childSub.handle) return { error: `子节点 ${childProp} 不可用（${childSub.unavailable || "no_handle"}）` };
        const res = await scope.readAndRelease(childSub.handle, subProp, contexts, 1000);
        await scope.release(childSub.handle);
        if (!res.ok) return { error: res.unavailable || `属性 ${subProp} 不可用` };
        if (resolveRefs && res.value?.kind === "reference" && res.value?.identity) {
          const name = await scope.resolveRefName(childSub.handle, contexts, 400).catch(() => null);
          return name || { identity: res.value.identity, unresolved: true };
        }
        return decodeNode(res.value, raw);
      }

      let sub = await scope.subscribeOptional(targetRef, fieldName, contexts, 1200);
      // 若在当前球员节点找不到，且当前是 PersonReference 或列表项，尝试常见子对象 LoanContract / FullContract
      if (!sub.handle && /当前引用不提供/.test(sub.unavailable || "")) {
        const fallbackParents = ["LoanContract", "FullContract", "ClubCoachReport"];
        for (const p of fallbackParents) {
          const pSub = await scope.subscribeOptional(targetRef, p, contexts, 600);
          if (pSub.handle) {
            const sub2 = await scope.subscribeOptional(pSub.handle, fieldName, contexts, 800);
            if (sub2.handle) {
              const val2 = sub2.read?.value ?? null;
              await scope.release(sub2.handle);
              await scope.release(pSub.handle);
              return decodeNode(val2, raw);
            }
            await scope.release(pSub.handle);
          }
        }
      }

      if (!sub.handle) {
        let hint = "";
        if (/当前引用不提供/.test(sub.unavailable || "") && propNamesCache?.length) {
          const lower = fieldName.toLowerCase();
          const similar = propNamesCache.filter(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase().slice(0, 4))).slice(0, 5);
          if (similar.length) hint = `；相近可用属性：${similar.join(", ")}`;
        }
        return { error: (sub.unavailable || "unavailable") + hint };
      }

      const val = sub.read?.value ?? null;
      if (resolveRefs && val?.kind === "reference" && val?.identity) {
        const resolvedName = await scope.resolveRefName(sub.handle, contexts, 500);
        await scope.release(sub.handle);
        return resolvedName || { type: val.type, identity: val.identity, unresolved: true };
      }
      await scope.release(sub.handle);
      return decodeNode(val, raw);
    } catch (err) {
      return { error: String(err.message || err) };
    }
  }

  function matchWhere(row, conditions) {
    if (!Array.isArray(conditions) || !conditions.length) return true;
    for (const cond of conditions) {
      const val = row[cond.field];
      const target = cond.value;
      const op = cond.op || "eq";
      if (val && typeof val === "object" && val.error) return false;
      const numVal = Number(val);
      const numTarget = Number(target);
      const bothNum = val !== null && val !== "" && !Number.isNaN(numVal) && !Number.isNaN(numTarget);
      if (op === "eq" && String(val) !== String(target)) return false;
      if (op === "neq" && String(val) === String(target)) return false;
      if (op === "gt" && !(bothNum ? numVal > numTarget : String(val) > String(target))) return false;
      if (op === "gte" && !(bothNum ? numVal >= numTarget : String(val) >= String(target))) return false;
      if (op === "lt" && !(bothNum ? numVal < numTarget : String(val) < String(target))) return false;
      if (op === "lte" && !(bothNum ? numVal <= numTarget : String(val) <= String(target))) return false;
      if (op === "contains" && !String(val ?? "").toLowerCase().includes(String(target ?? "").toLowerCase())) return false;
      if (op === "in" && (!Array.isArray(target) || !target.map(String).includes(String(val)))) return false;
    }
    return true;
  }

  // 瞬态实时通道错误自动退避重试（解决游戏数据尚未就绪或短句柄过期导致的偶发失败）
  async function withTransientRetry(fn, maxAttempts = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (attempt < maxAttempts && /游戏数据未就绪|Unknown or expired channel handle|Value is not a game data reference/i.test(msg)) {
          await new Promise(resolve => setTimeout(resolve, attempt * 220));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  // 1. live_describe：探索节点上可用属性及所需上下文，无需盲猜
  async function describe({ node = "team", filter = "", limit = 100, contexts: userContexts = {} } = {}) {
    return withTransientRetry(() => client.scope(async scope => {
      const resolved = await resolveNode(scope, node, userContexts);
      let inspectTarget = resolved.ref;
      // 如果当前节点是列表集合（如 team.Players），自动取第 0 个元素探测单条记录的可用属性
      let inspectedSample = null;
      if (resolved.value?.kind === "list" && resolved.value.items?.length > 0) {
        inspectTarget = typeof resolved.ref === "string"
          ? { source: resolved.ref, path: "0" }
          : { source: resolved.ref.source, path: `${resolved.ref.path}/0` };
        inspectedSample = "list_item[0]";
      }
      const props = await scope.properties(inspectTarget, filter || "");
      const max = Math.max(1, Math.min(300, Number(limit) || 100));
      const mapped = props.slice(0, max).map(p => ({
        name: p.name.split(":")[0],
        id: p.id,
        contexts: (p.contexts || []).map(c => c.name.split(":")[0])
      }));
      return {
        ok: true,
        readOnly: true,
        node,
        ...(inspectedSample ? { inspectedSample } : {}),
        totalProperties: props.length,
        returned: mapped.length,
        truncated: props.length > mapped.length,
        properties: mapped
      };
    }));
  }

  // 2. live_query：结构化只读查询任意节点/列表的属性，支持过滤、排序、引用解析、分批防超时与 hex 解码
  async function query({
    node = "team",
    select = [],
    where = [],
    orderBy = null,
    limit = 30,
    offset = 0,
    resolveRefs = true,
    raw = false,
    contexts: userContexts = {}
  } = {}) {
    if (!Array.isArray(select) || !select.length) {
      throw new Error("必须提供 select 属性名数组（可先用 live_describe 查看可用属性）。");
    }
    return withTransientRetry(() => client.scope(async scope => {
      const resolved = await resolveNode(scope, node, userContexts);
      const isList = resolved.value?.kind === "list" && Array.isArray(resolved.value.items);

      // 场景 A：单节点直接查询（如 club / team / Players/19），超过 6 个字段时自动按批次释放句柄防超时
      if (!isList) {
        const metaProps = await scope.properties(resolved.ref, "").catch(() => []);
        const propNamesCache = metaProps.map(p => p.name.split(":")[0]);
        const record = {};
        const batchSize = 6;
        for (let b = 0; b < select.length; b += batchSize) {
          const chunk = select.slice(b, b + batchSize);
          for (const field of chunk) {
            record[field] = await readField(scope, resolved.ref, field, resolved.contexts, resolveRefs, raw, propNamesCache);
          }
          if (b + batchSize < select.length) {
            await new Promise(resolve => setTimeout(resolve, 40));
          }
        }
        return { ok: true, readOnly: true, mode: "record", node, data: record };
      }

      // 场景 B：列表集合查询（如 team.Players）
      const total = resolved.value.items.length;
      const start = Math.max(0, Number(offset) || 0);
      const maxRows = Math.max(1, Math.min(50, Number(limit) || 30));
      const needFullScan = (Array.isArray(where) && where.length > 0) || Boolean(orderBy?.field);
      const scanStart = needFullScan ? 0 : start;
      const scanEnd = needFullScan ? Math.min(total, 50) : Math.min(total, start + maxRows);

      let propNamesCache = null;
      if (total > 0) {
        const sampleRef = typeof resolved.ref === "string"
          ? { source: resolved.ref, path: "0" }
          : { source: resolved.ref.source, path: `${resolved.ref.path}/0` };
        const metaProps = await scope.properties(sampleRef, "").catch(() => []);
        propNamesCache = metaProps.map(p => p.name.split(":")[0]);
      }

      const rows = [];
      for (let i = scanStart; i < scanEnd; i++) {
        const item = resolved.value.items[i];
        const itemRef = typeof resolved.ref === "string"
          ? { source: resolved.ref, path: String(i) }
          : { source: resolved.ref.source, path: `${resolved.ref.path}/${i}` };
        const itemCtx = { ...resolved.contexts };
        if (item?.type === "FM.UI.PersonReference") itemCtx.Person = itemRef;
        else if (item?.type === "FM.UI.TeamReference") { itemCtx.team = itemRef; itemCtx.Team = itemRef; }

        const row = { index: i };
        for (const field of select) {
          row[field] = await readField(scope, itemRef, field, itemCtx, resolveRefs, raw, propNamesCache);
        }
        if (matchWhere(row, where)) rows.push(row);
      }

      if (orderBy?.field) {
        const f = orderBy.field;
        const asc = String(orderBy.dir || "asc").toLowerCase() !== "desc";
        rows.sort((a, b) => {
          const va = a[f], vb = b[f];
          const na = Number(va), nb = Number(vb);
          if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== null && vb !== null && va !== "") {
            return asc ? na - nb : nb - na;
          }
          return asc ? String(va ?? "").localeCompare(String(vb ?? "")) : String(vb ?? "").localeCompare(String(va ?? ""));
        });
      }

      const paged = needFullScan ? rows.slice(start, start + maxRows) : rows;
      return {
        ok: true,
        readOnly: true,
        mode: "list",
        node,
        total,
        matched: needFullScan ? rows.length : total,
        offset: start,
        returned: paged.length,
        rows: paged
      };
    }));
  }

  return { describe, query };
}
