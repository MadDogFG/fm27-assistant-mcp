const clean = text => String(text ?? "").replace(/[\u200b-\u200d\ufeff]/g, "");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createInboxTools(call) {
  return async args => {
    const limit = args.limit ?? 10;
    const skip = args.skip ?? 0;
    const scanFrom = args.scanFrom ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(skip) || skip < 0)
      throw new Error("limit 必须为 1..20，skip 必须为非负整数。");
    if (!Number.isSafeInteger(scanFrom) || scanFrom < 0) throw new Error("scanFrom 必须为非负整数。");
    const handles = [];
    let team;
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
    async function subscribe(source, name, path = "") {
      const properties = await api("properties", { source, path, filter: name });
      const property = properties.properties.find(item => item.name.split(":")[0] === name);
      if (!property) throw new Error(`游戏不支持消息属性 ${name}`);
      const defs = defaults();
      const contexts = {};
      for (const item of property.contexts) {
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
    try {
      team = (await subscribe("human", "Team")).handle;
      const before = await subscribe("human", "NumberUnreadMessages");
      const list = await subscribe("human", (args.unreadOnly ?? true) ? "HumanPortalUnreadMessages" : "HumanPortalFilteredMessages");
      const count = list.value?.count ?? 0;
      const readRow = async index => {
        const current = await api("read", { handle: list.handle, path: String(index), depth: 0 });
        if (current.status !== "ready" || current.epoch !== list.epoch || current.value?.kind !== "reference" ||
          current.value.type !== "FM.UI.NewsItemReference" || !current.value.identity)
          throw new Error("收件箱已变化，无法确认该条消息的身份。");
        return current.value;
      };
      const fields = { title: "NewsTitleString", body: "NewsBodyString", isRead: "NewsItemHasBeenRead",
        important: "NewsItemIsImportant", canRespond: "CanRespond", hasResponded: "NewsHasResponded" };
      const buildMessage = async (index, keys = Object.keys(fields), previous = null) => {
        const row = list.value?.items?.[index];
        const message = previous || { index, targetIdentity: row?.identity || (await readRow(index)).identity };
        for (const field of keys) {
          const value = (await subscribe(list.handle, fields[field], String(index))).value;
          message[field] = value?.type === "System.Boolean" ? value.value === "True"
            : (value?.type === "System.String" ? clean(value.value) : value?.value ?? null);
        }
        return message;
      };
      const messages = [];
      for (let i = 0; i < Math.min(count, limit); i++) {
        messages.push(await buildMessage(i));
      }
      return { ok: true, total: count, unreadCount: before.value?.value, items: messages, messages };
    } finally {
      for (const handle of handles) {
        try { await api("close", { handle }, true); } catch {}
      }
    }
  };
}
