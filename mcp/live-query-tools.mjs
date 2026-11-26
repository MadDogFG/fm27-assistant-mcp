import { createLiveClient, clean, scalar } from "./live-client.mjs";

/**
 * live-query-tools.mjs — 通用只读实时节点自省与结构化查询工具（live_describe / live_query）
 * 修复 Review #47 与对话权限边界补充检查：
 * - 区分原生总数（nativeTotal）、已内联数（inlinedCount）、扫描数（scanned）、命中数（matched）
 * - 支持突破 50 行与 64 内联上限的续扫（scanFrom / scanLimit + nextScanFrom / partialScan）
 * - 自动补读 where / orderBy 引用的隐藏字段，无需强迫放入 select 输出
 * - 屏蔽对玩家独占的发布会问题/对话回复节点的读取
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

// 禁止通过通用只读通道投影属于玩家的发布会题目、问答或对话回复选项
const FORBIDDEN_DIALOGUE_PATH_RE = /(PressConferenceEditSession|ConversationEditSession|DialogueQuestion|PressConferenceQuestion|InterviewQuestion|SpeakTo.*(RequiredActions|OptionalActions|AdviceActions|ExitActions))/i;
const FORBIDDEN_DIALOGUE_FIELD_RE = /^(PressConferenceQuestion|CurrentQuestion|QuestionText|DialogueOptions|ConversationReplies|SpeakTo)$/i;

function assertAllowedLiveTarget(nodeSpec, fields = []) {
  const nodeStr = typeof nodeSpec === "string"
    ? nodeSpec
    : `${nodeSpec?.source || ""}/${nodeSpec?.path || ""}`;
  if (FORBIDDEN_DIALOGUE_PATH_RE.test(nodeStr)) {
    throw new Error("范围边界：live_describe / live_query 禁止读取发布会题目或玩家对话回复节点，请使用专用发布会交接工具。");
  }
  for (const f of fields) {
    if (FORBIDDEN_DIALOGUE_FIELD_RE.test(String(f || "").split(".")[0])) {
      throw new Error(`范围边界：live_query 禁止读取对话/发布会问答字段 "${f}"，对话问题与选项由玩家本人处理。`);
    }
  }
}

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
      if (!clubSub.handle) throw new Error("当前无法获取 Club 节点（可能未加载存档或经理待业）。");
      currentRef = clubSub.handle;
      currentValue = clubSub.read?.value ?? null;
    } else if (source === "team") {
      if (!teamSub.handle) throw new Error("当前无法获取 Team 节点（可能未加载存档或经理待业）。");
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

  // 瞬态实时通道错误自动退避重试
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
    assertAllowedLiveTarget(node);
    return withTransientRetry(() => client.scope(async scope => {
      const resolved = await resolveNode(scope, node, userContexts);
      let inspectTarget = resolved.ref;
      let inspectedSample = null;
      if (resolved.value?.kind === "list" && (resolved.value.count ?? resolved.value.items?.length ?? 0) > 0) {
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

  // 2. live_query (Review #47)：使用原生 count（突破 64 内联与 50 行限制），补读 where/orderBy 隐藏字段并明确区分 nativeTotal/scanned/matched/partialScan
  async function query({
    node = "team",
    select = [],
    where = [],
    orderBy = null,
    limit = 30,
    offset = 0,
    scanFrom = 0,
    scanLimit = 100,
    resolveRefs = true,
    raw = false,
    contexts: userContexts = {}
  } = {}) {
    if (!Array.isArray(select) || !select.length) {
      throw new Error("必须提供 select 属性名数组（可先用 live_describe 查看可用属性）。");
    }
    const extraFields = new Set();
    for (const cond of Array.isArray(where) ? where : []) {
      if (cond?.field && !select.includes(cond.field)) extraFields.add(cond.field);
    }
    if (orderBy?.field && !select.includes(orderBy.field)) extraFields.add(orderBy.field);
    const allFieldsToRead = [...select, ...extraFields];
    assertAllowedLiveTarget(node, allFieldsToRead);

    return withTransientRetry(() => client.scope(async scope => {
      const resolved = await resolveNode(scope, node, userContexts);
      const isList = resolved.value?.kind === "list";

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

      const inlinedItems = Array.isArray(resolved.value.items) ? resolved.value.items : [];
      const nativeTotal = Number.isInteger(resolved.value.count) ? resolved.value.count : inlinedItems.length;
      const inlinedCount = inlinedItems.length;
      const start = Math.max(0, Number(offset) || 0);
      const maxRows = Math.max(1, Math.min(200, Number(limit) || 30));
      const safeScanFrom = Math.max(0, Number(scanFrom) || 0);
      const safeScanLimit = Math.max(1, Math.min(200, Number(scanLimit) || 100));
      const needScanFilterOrSort = (Array.isArray(where) && where.length > 0) || Boolean(orderBy?.field);

      const scanStart = needScanFilterOrSort ? Math.min(nativeTotal, safeScanFrom) : Math.min(nativeTotal, start);
      const scanEnd = needScanFilterOrSort
        ? Math.min(nativeTotal, scanStart + safeScanLimit)
        : Math.min(nativeTotal, scanStart + maxRows);

      let propNamesCache = null;
      if (nativeTotal > 0) {
        const sampleRef = typeof resolved.ref === "string"
          ? { source: resolved.ref, path: "0" }
          : { source: resolved.ref.source, path: `${resolved.ref.path}/0` };
        const metaProps = await scope.properties(sampleRef, "").catch(() => []);
        propNamesCache = metaProps.map(p => p.name.split(":")[0]);
      }

      const matchedFullRows = [];
      let scanned = 0;
      const sampleItemType = inlinedItems[0]?.type || null;

      for (let i = scanStart; i < scanEnd; i++) {
        scanned++;
        const item = i < inlinedItems.length ? inlinedItems[i] : null;
        const itemType = item?.type || sampleItemType;
        const itemRef = typeof resolved.ref === "string"
          ? { source: resolved.ref, path: String(i) }
          : { source: resolved.ref.source, path: `${resolved.ref.path}/${i}` };
        const itemCtx = { ...resolved.contexts };
        if (itemType === "FM.UI.PersonReference") itemCtx.Person = itemRef;
        else if (itemType === "FM.UI.TeamReference") { itemCtx.team = itemRef; itemCtx.Team = itemRef; }

        const evalRow = { index: i };
        for (const field of allFieldsToRead) {
          evalRow[field] = await readField(scope, itemRef, field, itemCtx, resolveRefs, raw, propNamesCache);
        }
        if (matchWhere(evalRow, where)) matchedFullRows.push(evalRow);
      }

      if (orderBy?.field) {
        const f = orderBy.field;
        const asc = String(orderBy.dir || "asc").toLowerCase() !== "desc";
        matchedFullRows.sort((a, b) => {
          const va = a[f], vb = b[f];
          const na = Number(va), nb = Number(vb);
          if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== null && vb !== null && va !== "") {
            return asc ? na - nb : nb - na;
          }
          return asc ? String(va ?? "").localeCompare(String(vb ?? "")) : String(vb ?? "").localeCompare(String(va ?? ""));
        });
      }

      // 剔除未出现在 select 中的过滤/排序辅助字段，保持输出干净
      const projectRow = fullRow => {
        const out = { index: fullRow.index };
        for (const field of select) out[field] = fullRow[field];
        return out;
      };

      const paged = (needScanFilterOrSort ? matchedFullRows.slice(start, start + maxRows) : matchedFullRows).map(projectRow);
      const partialScan = scanStart > 0 || scanEnd < nativeTotal;
      const nextScanFrom = scanEnd < nativeTotal ? scanEnd : null;

      return {
        ok: true,
        readOnly: true,
        mode: "list",
        node,
        nativeTotal,
        total: nativeTotal,
        inlinedCount,
        scanStart,
        scanned,
        partialScan,
        nextScanFrom,
        matched: needScanFilterOrSort ? matchedFullRows.length : nativeTotal,
        offset: start,
        returned: paged.length,
        ...(partialScan && needScanFilterOrSort ? { note: `当前仅扫描了索引 [${scanStart}..${scanEnd - 1}]（共 ${scanned}/${nativeTotal} 行）；如需继续向后筛选请传 scanFrom=${nextScanFrom}。` } : {}),
        rows: paged
      };
    }));
  }

  return { describe, query };
}
