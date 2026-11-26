const clean = text => String(text ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// 实时读取收件箱（Review #15 + Token 优化）：完整支持 unreadOnly / importantOnly / pendingOnly / subject / skip / scanFrom / includeBody / bodyMaxChars 与 nextScanFrom 续页游标
export function createInboxTools(call) {
  return async (args = {}) => {
    const limit = args.limit ?? 10;
    const skip = args.skip ?? 0;
    const scanFrom = args.scanFrom ?? 0;
    const unreadOnly = args.unreadOnly ?? true;
    const importantOnly = Boolean(args.importantOnly);
    const pendingOnly = Boolean(args.pendingOnly);
    const includeBody = args.includeBody !== false;
    const bodyMaxChars = Number.isInteger(args.bodyMaxChars) && args.bodyMaxChars > 0 ? args.bodyMaxChars : 0;
    const subjectFilter = typeof args.subject === "string" ? clean(args.subject).toLowerCase() : "";
    const hasFilter = importantOnly || pendingOnly || Boolean(subjectFilter);

    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(skip) || skip < 0)
      throw new Error("limit 必须为 1..20，skip 必须为非负整数。");
    if (!Number.isSafeInteger(scanFrom) || scanFrom < 0) throw new Error("scanFrom 必须为非负整数。");

    const handles = [];
    let team = null;
    const defaults = () => ({
      human: { source: "human" },
      Human: { source: "human" },
      ...(team ? { team: { source: team }, Team: { source: team } } : {}),
      StringType: "",
      PortalMessagesTab: 0
    });

    async function api(route, params, post = false) {
      const query = new URLSearchParams(Object.entries(params).map(([key, value]) =>
        [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
      const result = await call(`/api/v1/live/${route}?${query}`, { method: post ? "POST" : "GET" });
      if (result?.ok === false) throw new Error(result.error || JSON.stringify(result));
      return result;
    }

    async function closeHandle(h) {
      if (!h) return;
      const pos = handles.lastIndexOf(h);
      if (pos >= 0) handles.splice(pos, 1);
      try { await api("close", { handle: h }, true); } catch {}
    }

    async function subscribe(source, name, path = "") {
      const properties = await api("properties", { source, path, filter: name });
      const property = properties.properties.find(item => item.name.split(":")[0] === name);
      if (!property) throw new Error(`游戏不支持消息属性 ${name}`);
      const defs = defaults();
      const contexts = {};
      for (const item of property.contexts || []) {
        const key = item.name.split(":")[0];
        if (key in defs && defs[key] !== undefined) {
          contexts[key] = defs[key];
        }
      }
      const opened = await api("open", { source, path, property: property.id, contexts }, true);
      handles.push(opened.handle);
      const deadline = Date.now() + 6000;
      do {
        const result = await api("read", { handle: opened.handle, depth: 2 });
        if (result.status === "ready") return { handle: opened.handle, ...result };
        await pause(50);
      } while (Date.now() < deadline);
      throw new Error(`消息属性 ${name} 未返回。`);
    }

    // 读完即关闭单字段临时句柄，防止扫描超过 20 封信时触碰原生 128 订阅句柄上限
    async function readFieldValue(source, name, path) {
      const sub = await subscribe(source, name, path);
      const val = sub.value;
      await closeHandle(sub.handle);
      return val;
    }

    const parseFieldVal = value =>
      value?.type === "System.Boolean" ? value.value === "True"
        : (value?.type === "System.String" ? clean(value.value) : value?.value ?? null);

    try {
      // 失业经理场景下 Team 可能不可用，宽容降级
      try {
        team = (await subscribe("human", "Team")).handle;
      } catch {
        team = null;
      }
      const before = await subscribe("human", "NumberUnreadMessages");
      const listProp = unreadOnly ? "HumanPortalUnreadMessages" : "HumanPortalFilteredMessages";
      const list = await subscribe("human", listProp);
      const count = list.value?.count ?? (list.value?.items?.length || 0);
      const listEpoch = list.epoch ?? null;
      const headIdentityBefore = list.value?.items?.[0]?.identity || null;

      const readRowIdentity = async index => {
        const cached = list.value?.items?.[index];
        if (cached?.identity) return cached.identity;
        const current = await api("read", { handle: list.handle, path: String(index), depth: 0 });
        if (current.status !== "ready" || (listEpoch !== null && current.epoch !== undefined && current.epoch !== listEpoch) ||
          current.value?.kind !== "reference" || current.value.type !== "FM.UI.NewsItemReference" || !current.value.identity) {
          const err = new Error("收件箱在翻页扫描期间发生变动（如新邮件到达），当前游标已失效，请从 scanFrom=0 重新读取。");
          err.cursorInvalidated = true;
          throw err;
        }
        return current.value.identity;
      };

      const fields = {
        title: "NewsTitleString",
        body: "NewsBodyString",
        isRead: "NewsItemHasBeenRead",
        important: "NewsItemIsImportant",
        canRespond: "CanRespond",
        hasResponded: "NewsHasResponded"
      };

      const hydrateMessage = async (index, partial) => {
        const msg = { ...partial };
        const pendingEntries = Object.entries(fields).filter(([k]) => {
          if (Object.hasOwn(msg, k)) return false;
          if (k === "body" && !includeBody) return false;
          return true;
        });
        // 单封邮件的多个只读字段并发拉取并即读即关，兼顾速度与句柄上限安全（并发 <= 6）
        const values = await Promise.all(
          pendingEntries.map(([, propName]) => readFieldValue(list.handle, propName, String(index)))
        );
        pendingEntries.forEach(([k], idx) => {
          let val = parseFieldVal(values[idx]);
          if (k === "body" && bodyMaxChars > 0 && typeof val === "string" && val.length > bodyMaxChars) {
            val = `${val.slice(0, bodyMaxChars)}…`;
          }
          msg[k] = val;
        });
        return msg;
      };

      const messages = [];
      let matchedTotalInWindow = 0;
      let cursorInvalidated = false;
      let cursorNote = null;
      let scannedEnd = Math.min(scanFrom, count);

      if (!hasFilter) {
        // 无筛选：直接从 scanFrom + skip 起读取最多 limit 条
        const startIdx = Math.min(count, scanFrom + skip);
        const endIdx = Math.min(count, startIdx + limit);
        for (let i = startIdx; i < endIdx; i++) {
          let targetIdentity;
          try {
            targetIdentity = await readRowIdentity(i);
          } catch (err) {
            if (err.cursorInvalidated) {
              cursorInvalidated = true;
              cursorNote = err.message;
              break;
            }
            throw err;
          }
          messages.push(await hydrateMessage(i, { index: i, targetIdentity, listType: unreadOnly ? "unread" : "all" }));
          scannedEnd = i + 1;
        }
        matchedTotalInWindow = messages.length;
      } else {
        // 有筛选：从 scanFrom 起分步轻量扫描（先只读过滤所需字段，命中后再读正文 body），单次最多扫 60 封防超时
        const maxScanWindow = 60;
        const hardEnd = Math.min(count, scanFrom + maxScanWindow);
        for (let i = scanFrom; i < hardEnd; i++) {
          let targetIdentity;
          try {
            targetIdentity = await readRowIdentity(i);
          } catch (err) {
            if (err.cursorInvalidated) {
              cursorInvalidated = true;
              cursorNote = err.message;
              break;
            }
            throw err;
          }
          const partial = { index: i, targetIdentity, listType: unreadOnly ? "unread" : "all" };
          let pass = true;

          if (importantOnly) {
            partial.important = parseFieldVal(await readFieldValue(list.handle, fields.important, String(i)));
            if (partial.important !== true) pass = false;
          }
          if (pass && pendingOnly) {
            partial.canRespond = parseFieldVal(await readFieldValue(list.handle, fields.canRespond, String(i)));
            partial.hasResponded = parseFieldVal(await readFieldValue(list.handle, fields.hasResponded, String(i)));
            if (!(partial.canRespond === true && partial.hasResponded !== true)) pass = false;
          }
          if (pass && subjectFilter) {
            partial.title = parseFieldVal(await readFieldValue(list.handle, fields.title, String(i)));
            if (!String(partial.title || "").toLowerCase().includes(subjectFilter)) pass = false;
          }

          scannedEnd = i + 1;
          if (!pass) continue;

          matchedTotalInWindow++;
          if (matchedTotalInWindow <= skip) continue;
          messages.push(await hydrateMessage(i, partial));
          if (messages.length >= limit) break;
        }
      }

      // 扫描结束复核队首消息身份是否因新邮件到达而漂移
      if (!cursorInvalidated && headIdentityBefore && count > 0) {
        const afterHead = await api("read", { handle: list.handle, path: "0", depth: 0 }).catch(() => null);
        const headIdentityAfter = afterHead?.value?.identity || null;
        if (headIdentityAfter && headIdentityAfter !== headIdentityBefore) {
          cursorInvalidated = true;
          cursorNote = "读取期间有新邮件插入收件箱队首，后续翻页游标已失效，建议从 scanFrom=0 重新读取以防漏信。";
        }
      }

      const hasMore = scannedEnd < count;
      const nextScanFrom = hasMore && !cursorInvalidated ? scannedEnd : null;

      return {
        ok: true,
        readOnly: true,
        listType: unreadOnly ? "unread" : "all",
        unreadOnly,
        total: count,
        unreadCount: before.value?.value ?? null,
        scanStart: scanFrom,
        scannedCount: Math.max(0, scannedEnd - scanFrom),
        scannedEnd,
        matchedInWindow: matchedTotalInWindow,
        returnedCount: messages.length,
        hasMore,
        nextScanFrom,
        cursorInvalidated,
        ...(cursorNote ? { note: cursorNote } : {}),
        ...(unreadOnly ? { indexScopeNote: "当前 index 为未读列表相对下标；跨工具写操作（如标读/标重要）请始终携带 targetIdentity，或在 unreadOnly:false 下使用完整收件箱下标。" } : {}),
        items: messages,
        messages
      };
    } finally {
      for (const handle of [...handles].reverse()) {
        try { await api("close", { handle }, true); } catch {}
      }
    }
  };
}
