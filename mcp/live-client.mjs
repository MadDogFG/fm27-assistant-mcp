const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const clean = text => String(text ?? "")
  .replace(/[\u200b-\u200d\ufeff]/g, "")
  .replace(/\u0001[^\u0002]*\u0002/g, "")
  .replace(/\u0001/g, "")
  .trim();
export const scalar = value => {
  if (value?.kind !== "scalar") return null;
  return typeof value.value === "string" ? clean(value.value) : value.value;
};

export function createLiveClient(call) {
  async function api(route, args = {}, post = false) {
    const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
    let result;
    try { result = await call(`${route}?${query}`, { method: post ? "POST" : "GET" }); }
    catch (error) {
      const journaledNews = route === "/api/v1/news/open-press-conference" || route === "/api/v1/news/set-unread-state";
      if (!post || !args.id) throw error;
      if (!(journaledNews || route.startsWith("/api/v1/commands/") || route === "/api/v1/game/request-continue" || route.startsWith("/api/v1/match/") || route.startsWith("/api/v1/contracts/") || route.startsWith("/api/v1/administration/") || route.startsWith("/api/v1/squad/") || route.startsWith("/api/v1/communication/") || route.startsWith("/api/v1/induction/") || route.startsWith("/api/v1/board/") || route.startsWith("/api/v1/friendlies/") || route.startsWith("/api/v1/registration/") || route.startsWith("/api/v1/medical/") || route.startsWith("/api/v1/training-management/") || route.startsWith("/api/v1/player-availability/") || route.startsWith("/api/v1/player-training-menu/") || route.startsWith("/api/v1/player-management/") || route.startsWith("/api/v1/setpiece-takers/") || route.startsWith("/api/v1/set-piece/") || route.startsWith("/api/v1/conversations/") || route.startsWith("/api/v1/opposition/") || route.startsWith("/api/v1/tactic-slots/") || route.startsWith("/api/v1/tactics/") || route === "/api/v1/news/mark-all-read" || route.startsWith("/api/v1/transfers/") || route.startsWith("/api/v1/team-training/") || route.startsWith("/api/v1/training-schedule/") || route.startsWith("/api/v1/match-preparation/") || route.startsWith("/api/v1/recruitment/") || route === "/api/v1/news/execute" || route === "/api/v1/news/set-read-state" || route === "/api/v1/negotiations/execute" || route === "/api/v1/actions/execute" || route === "/api/v1/training/execute")) throw error;
      const timeout = error.timeoutReceipt;
      if (timeout?.ok === false && timeout.status === "cancelled_before_execution" && timeout.retrySafe === true) {
        return { ok: false, operationId: args.id, status: timeout.status, verified: false, retrySafe: true,
          nextAction: "请求尚未执行。重新读取当前游戏状态，再决定是否重试。" };
      }
      const status = timeout?.ok === false && timeout.status === "execution_result_unknown"
        ? timeout.status : "transport_result_unknown";
      return { ok: false, operationId: args.id, status, verified: false,
        retrySafe: false, error: String(error.message || error), nextAction: "查询 operation_status；不要自动重发操作。" };
    }
    if (result?.ok === false && !result.operationId) throw new Error(result.error || JSON.stringify(result));
    return result;
  }

  async function ready(handle, path, timeoutMs = 7000) {
    const until = Date.now() + timeoutMs;
    do {
      const result = await api("/api/v1/live/read", { handle, path, depth: 6 });
      if (result.status === "ready") return result;
      await sleep(60);
    } while (Date.now() < until);
    throw new Error("游戏数据未就绪，尚未执行操作。");
  }

  async function finish(receipt) {
    const until = Date.now() + 10000;
    while (receipt.status === "pending" && Date.now() < until) {
      await sleep(80);
      try { receipt = await api("/api/v1/commands/status", { id: receipt.operationId }); }
      catch (error) { return { ...receipt, retrySafe: false, verificationError: String(error.message || error),
        nextAction: "保留 operationId 查询状态；不要自动重发。" }; }
    }
    return receipt;
  }

  async function scope(action) {
    const handles = [];
    const ids = new Map();
    const descriptor = source => typeof source === "string" ? { source } : source;
    async function properties(source, filter = "") {
      return (await api("/api/v1/live/properties", { ...descriptor(source), filter })).properties;
    }
    async function release(handle) {
      if (!handle) return;
      const idx = handles.lastIndexOf(handle);
      if (idx >= 0) handles.splice(idx, 1);
      try { await api("/api/v1/live/close", { handle }, true); } catch { /* ignore */ }
    }
    async function subscribe(source, name, knownContexts = {}, timeoutMs = 7000) {
      const metadata = (await properties(source, name)).find(p => p.name.split(":")[0] === name);
      if (!metadata) throw new Error(`当前引用不提供 ${name}`);
      const contexts = {};
      for (const context of metadata.contexts || []) {
        const key = context.name.split(":")[0];
        if (!Object.hasOwn(knownContexts, key)) throw new Error(`${name} 缺少上下文 ${key}`);
        contexts[key] = knownContexts[key];
      }
      if (handles.length >= 110) {
        // 安全水位保护：保留最初几个根上下文句柄（如 human/Team/Club），清理中间临时句柄防止撞 128 上限
        const victim = handles.splice(4, 1)[0];
        if (victim) { try { await api("/api/v1/live/close", { handle: victim }, true); } catch {} }
      }
      const opened = await api("/api/v1/live/open", { ...descriptor(source), property: metadata.id, contexts }, true);
      handles.push(opened.handle);
      try {
        const res = { handle: opened.handle, read: await ready(opened.handle, undefined, timeoutMs), metadata, contexts, reference: opened.reference };
        if (source === "human" && name === "Team" && res.read?.value?.type === "FM.UI.PersonReference") {
          try {
            const club = await subscribe("human", "Club", { human: { source: "human" } }, timeoutMs);
            const mainTeam = await subscribe(club.handle, "MainTeam", { human: { source: "human" }, club: { source: club.handle } }, timeoutMs);
            if (mainTeam.read?.value?.type === "FM.UI.TeamReference") return mainTeam;
          } catch {}
        }
        return res;
      } catch (error) {
        await release(opened.handle);
        throw new Error(`${name}: ${error.message || error}`, { cause: error });
      }
    }
    async function readAndRelease(source, name, knownContexts = {}, timeoutMs = 1500) {
      const sub = await subscribeOptional(source, name, knownContexts, timeoutMs);
      const val = sub.handle ? (sub.read?.value ?? null) : null;
      const unavail = sub.unavailable;
      if (sub.handle) await release(sub.handle);
      return { ok: !unavail, value: val, scalar: scalar(val), unavailable: unavail };
    }
    // 对任意 ClubReference / TeamReference / PersonReference / CompetitionReference 解析出可读 Name
    async function resolveRefName(source, knownContexts = {}, timeoutMs = 500) {
      if (!source) return null;
      const r = await readAndRelease(source, "Name", knownContexts, timeoutMs);
      if (r.scalar) return r.scalar;
      const r2 = await readAndRelease(source, "ShortName", knownContexts, timeoutMs);
      return r2.scalar || null;
    }
    // 批量解析列表内每个 Reference 元素的 Name 并释放列表句柄
    async function resolveRefList(source, propName, knownContexts = {}, maxItems = 12) {
      const sub = await subscribeOptional(source, propName, knownContexts, 1200);
      if (!sub.handle || sub.read?.value?.kind !== "list") {
        if (sub.handle) await release(sub.handle);
        return sub.read?.value ?? null;
      }
      const items = sub.read.value.items || [];
      const out = [];
      for (let i = 0; i < Math.min(maxItems, items.length); i++) {
        const refDesc = { source: sub.handle, path: String(i) };
        const name = await resolveRefName(refDesc, knownContexts, 500);
        out.push({
          index: i,
          type: items[i]?.type ?? null,
          identity: items[i]?.identity ?? null,
          ...(name ? { name } : {})
        });
      }
      await release(sub.handle);
      return { count: sub.read.value.count ?? items.length, truncated: items.length > maxItems, items: out };
    }
    // Some panel/session bindings never become ready when the game has no such session. A short
    // timeout and early bail-out matters: repeatedly polling such a channel while holding a raw
    // native reference has crashed FM (2026-11-20, ProposedAffiliateClubs). Callers should pass a
    // small timeout (e.g. 1500) for optional session-bound reads and stop before touching children.
    async function subscribeOptional(source, name, knownContexts = {}, timeoutMs = 2500) {
      try { return { ...await subscribe(source, name, knownContexts, timeoutMs), unavailable: null }; }
      catch (error) {
        const message = String(error.message || error);
        if (!/游戏数据未就绪|当前引用不提供|缺少上下文/.test(message)) throw error;
        return { handle: null, read: { value: null }, metadata: null, contexts: {}, reference: null, unavailable: message };
      }
    }
    async function propertyId(name) {
      if (!ids.has(name)) {
        const result = await api("/api/v1/internal/registry", { kind: "properties", filter: name });
        const matches = result.items.filter(p => p.name === name);
        if (matches.length !== 1) throw new Error(`无法唯一解析属性 ${name}`);
        ids.set(name, `0x${matches[0].id.toString(16).padStart(8, "0")}`);
      }
      return ids.get(name);
    }
    async function tactic() {
      const match = await api("/api/v1/match/state");
      const team = await subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const useMatch = match.inMatch && !match.pastMatch && !match.replay && !match.finished && !match.spectating;
      const contexts = { Boolean: true, human, Human: human, team: teamRef, Team: teamRef };
      const current = await subscribe(useMatch ? "match" : team.handle, "Tactic", contexts);
      return { team, tactic: current, match, contexts };
    }
    try { return await action({ api, ready, finish, properties, subscribe, subscribeOptional, release, readAndRelease, resolveRefName, resolveRefList, propertyId, tactic }); }
    finally {
      for (const handle of handles.reverse()) {
        try { await api("/api/v1/live/close", { handle }, true); } catch { /* session or connection ended */ }
      }
    }
  }
  return { api, ready, finish, scope };
}
