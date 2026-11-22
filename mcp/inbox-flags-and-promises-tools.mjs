import { createLiveClient, scalar } from "./live-client.mjs";

// 收件箱消息标记（MGR-O04a~d）、日期/数值型待办输入（MGR-O06c/d）与承诺履约跟进（MGR-O12a/c）
export function createInboxFlagsAndPromisesTools(call) {
  const client = createLiveClient(call);

  // MGR-O04a/b/c/d: 管理消息标记（重要/保留/设置提醒/归档）
  async function manageInboxMessageFlags({ index = 0, flag = "important", value = true, reminderDays = 1, operationId } = {}) {
    if (!["important", "keep", "reminder", "archive"].includes(flag)) {
      throw new Error(`未知消息标记类型: ${flag}（支持 important/keep/reminder/archive）`);
    }
    if (!Number.isInteger(index) || index < 0) throw new Error("index 必须为非负整数。");
    const id = operationId || `msg_flag_${flag}_${Date.now()}`;
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        StringType: "", PortalMessagesTab: 0
      };
      const inbox = await scope.subscribe("human", "HumanPortalFilteredMessages", ctx);
      const count = inbox.read?.value?.count ?? 0;
      if (index >= count) throw new Error(`消息 index 越界: ${index} >= ${count}`);
      const newsRef = { source: inbox.handle, path: String(index) };
      if (flag === "important") {
        const imp = await scope.subscribeOptional(newsRef, "NewsItemIsImportant", ctx, 800);
        if (imp.handle) {
          const upd = await call(
            `/api/v1/internal/update?handle=${encodeURIComponent(imp.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Boolean(value)) }
          );
          return { ok: true, operationId: id, index, flag, value: Boolean(value), update: upd };
        }
      }
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxNewsResponseAction&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(index) }
      );
      return { ok: true, operationId: id, index, flag, value: Boolean(value), reminderDays, dispatch };
    });
  }

  // MGR-O06c/d: 执行带日期或数值输入的消息待办
  async function submitMessageTypedInput({ index = 0, inputKind = "numeric", numericValue, dateText, operationId } = {}) {
    if (!["date", "numeric"].includes(inputKind)) {
      throw new Error(`未知输入类型: ${inputKind}（支持 date/numeric）`);
    }
    if (!Number.isInteger(index) || index < 0) throw new Error("index 必须为非负整数。");
    if (inputKind === "numeric" && typeof numericValue !== "number") {
      throw new Error("numeric 输入必须提供 numericValue 数值。");
    }
    if (inputKind === "date" && !String(dateText || "").trim()) {
      throw new Error("date 输入必须提供 dateText 日期文本。");
    }
    const id = operationId || `msg_input_${inputKind}_${Date.now()}`;
    const payload = inputKind === "numeric" ? JSON.stringify(numericValue) : JSON.stringify(dateText);
    const dispatch = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxNewsResponseAction&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }
    );
    return { ok: true, operationId: id, index, inputKind, value: inputKind === "numeric" ? numericValue : String(dateText).trim(), dispatch };
  }

  // MGR-O12a/c: 处理承诺履约问题或后续跟进对话
  async function managePromiseOrHappiness({ action = "resolve", promiseIndex = 0, squadIndex = 0, operationId } = {}) {
    if (!["resolve", "follow_up"].includes(action)) {
      throw new Error(`未知承诺处理动作: ${action}（支持 resolve/follow_up）`);
    }
    if (!Number.isInteger(promiseIndex) || promiseIndex < 0) throw new Error("promiseIndex 必须为非负整数。");
    const id = operationId || `promise_${action}_${Date.now()}`;
    const dispatch = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSpeakToDropdownActionComplete&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(promiseIndex) }
    );
    return { ok: true, operationId: id, action, promiseIndex, squadIndex, dispatch };
  }

  return { manageInboxMessageFlags, submitMessageTypedInput, managePromiseOrHappiness };
}
