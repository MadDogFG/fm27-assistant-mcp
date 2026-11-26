import { createLiveClient, scalar } from "./live-client.mjs";

// 收件箱消息标记（MGR-O04a~d）、日期/数值型待办输入（MGR-O06c/d）与承诺履约跟进（MGR-O12a/c）
export function createInboxFlagsAndPromisesTools(call) {
  const client = createLiveClient(call);

  // 在完整收件箱中严格按 expectedNewsIdentity 定位消息，避免未读/完整下标错位或新消息插入导致选错信
  async function locateMessageByIdentity(scope, expectedNewsIdentity, hintIndex = null) {
    if (typeof expectedNewsIdentity !== "string" || !expectedNewsIdentity.trim()) {
      throw new Error("必须提供原消息身份 expectedNewsIdentity（请先从 get_inbox 读取 targetIdentity），以防未读/完整列表下标错位误操作他信。");
    }
    const team = await scope.subscribeOptional("human", "Team");
    const ctx = {
      human: { source: "human" }, Human: { source: "human" },
      ...(team.handle ? { team: { source: team.handle }, Team: { source: team.handle } } : {}),
      StringType: "", PortalMessagesTab: 0
    };
    const inbox = await scope.subscribe("human", "HumanPortalFilteredMessages", ctx);
    const items = inbox.read?.value?.items || [];
    const count = inbox.read?.value?.count ?? items.length;

    // 优先检查提示下标，再线性按身份定位（兼容调用方从 unreadOnly=true 列表拿到下标但实际应作用于完整列表的场景）
    let resolvedIndex = -1;
    if (Number.isInteger(hintIndex) && hintIndex >= 0 && hintIndex < count) {
      const hintRow = items[hintIndex] ?? (await scope.ready(inbox.handle, String(hintIndex))).value;
      if (hintRow?.identity === expectedNewsIdentity) resolvedIndex = hintIndex;
    }
    if (resolvedIndex < 0) {
      const scanCap = Math.min(count, Math.max(items.length, 64));
      for (let i = 0; i < scanCap; i++) {
        const row = items[i] ?? (await scope.ready(inbox.handle, String(i))).value;
        if (row?.identity === expectedNewsIdentity) {
          resolvedIndex = i;
          break;
        }
      }
    }
    if (resolvedIndex < 0) {
      return { found: false, inbox, ctx, count, resolvedIndex: -1 };
    }
    return { found: true, inbox, ctx, count, resolvedIndex, newsRef: { source: inbox.handle, path: String(resolvedIndex) } };
  }

  // MGR-O04a/b/c/d: 管理消息标记（仅 important 具备原生属性写入与读回校验；keep/reminder/archive 缺失区分原生协议时安全门控零派发）
  async function manageInboxMessageFlags({ index, expectedNewsIdentity, flag, value = true, reminderDays, operationId } = {}) {
    if (!flag || !["important", "keep", "reminder", "archive"].includes(flag)) {
      throw new Error(`必须明确指定消息标记类型 flag（支持 important；keep/reminder/archive 暂未开放无区分回退）。当前: ${flag}`);
    }
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      throw new Error("index 必须为非负整数。");
    }
    if (!expectedNewsIdentity || typeof expectedNewsIdentity !== "string") {
      throw new Error("必须提供 expectedNewsIdentity（取自 get_inbox 返回的 targetIdentity），严禁仅凭相对下标盲写。");
    }

    // Review #18: keep/reminder/archive 目前无独立原生事件区分开关与提醒天数，严禁回退发送无区分 EventFmxNewsResponseAction(index)
    if (flag !== "important") {
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        flag,
        expectedNewsIdentity,
        reason: `当前版本尚未恢复消息 "${flag}" 标记的原生独立事件协议（无法将开关状态或提醒天数 ${reminderDays ?? ""} 可靠送入游戏），已拒绝发送无区分事件。`,
        zeroDispatches: true
      };
    }

    const id = operationId || `msg_flag_${flag}_${Date.now()}`;
    return client.scope(async scope => {
      const located = await locateMessageByIdentity(scope, expectedNewsIdentity, index);
      if (!located.found) {
        return {
          ok: false,
          blocked: true,
          reason: `在完整收件箱（共 ${located.count} 封）中未找到身份为 "${expectedNewsIdentity}" 的消息（可能已被删除或滑出窗口），已停止且零派发。`,
          expectedNewsIdentity,
          zeroDispatches: true
        };
      }
      const imp = await scope.subscribeOptional(located.newsRef, "NewsItemIsImportant", located.ctx, 800);
      if (!imp.handle) {
        return {
          ok: false,
          blocked: true,
          reason: "该消息当前未暴露 NewsItemIsImportant 属性通道，已中止且未发送无区分回退事件。",
          resolvedIndex: located.resolvedIndex,
          expectedNewsIdentity,
          zeroDispatches: true
        };
      }
      // 写入前再次核验该下标身份未被新邮件挤占
      const verifyBefore = (await scope.ready(located.inbox.handle, String(located.resolvedIndex))).value;
      if (verifyBefore?.identity && verifyBefore.identity !== expectedNewsIdentity) {
        return {
          ok: false,
          blocked: true,
          reason: "写入前收件箱列表已变动，目标下标身份不再匹配，已中止且零派发。",
          expectedNewsIdentity,
          observedIdentity: verifyBefore.identity,
          zeroDispatches: true
        };
      }
      const beforeVal = scalar(imp.read?.value);
      const targetBool = Boolean(value);
      const upd = await call(
        `/api/v1/internal/update?handle=${encodeURIComponent(imp.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetBool) }
      );
      await new Promise(r => setTimeout(r, 120));
      const afterRead = await scope.ready(imp.handle, undefined, 1000).catch(() => null);
      const afterScalar = scalar(afterRead?.value);
      const afterBool = afterScalar === "True" ? true : (afterScalar === "False" ? false : null);
      return {
        ok: true,
        operationId: id,
        resolvedIndex: located.resolvedIndex,
        newsIdentity: expectedNewsIdentity,
        flag,
        beforeValue: beforeVal === "True" ? true : (beforeVal === "False" ? false : null),
        value: targetBool,
        afterValue: afterBool,
        verified: afterBool === targetBool,
        update: upd
      };
    });
  }

  // MGR-O06c/d: 日期或数值型消息待办输入（先核验消息身份与可回应状态；无绑定特定消息的原生通道时明确拦截，零误派发）
  async function submitMessageTypedInput({ index, expectedNewsIdentity, inputKind, numericValue, dateText, operationId } = {}) {
    if (!["date", "numeric"].includes(inputKind)) {
      throw new Error(`必须指定输入类型 inputKind（支持 date/numeric）。当前: ${inputKind}`);
    }
    if (!expectedNewsIdentity || typeof expectedNewsIdentity !== "string") {
      throw new Error("必须提供目标消息身份 expectedNewsIdentity，禁止不绑定消息直接向 human 派发数值/日期。");
    }
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      throw new Error("index 必须为非负整数。");
    }
    if (inputKind === "numeric" && (typeof numericValue !== "number" || !Number.isFinite(numericValue))) {
      throw new Error("numeric 输入必须提供有限数值 numericValue。");
    }
    if (inputKind === "date" && !String(dateText || "").trim()) {
      throw new Error("date 输入必须提供非空日期文本 dateText。");
    }
    return client.scope(async scope => {
      const located = await locateMessageByIdentity(scope, expectedNewsIdentity, index);
      if (!located.found) {
        return {
          ok: false,
          blocked: true,
          reason: `完整收件箱中未定位到目标消息 "${expectedNewsIdentity}"，已拦截且零派发。`,
          expectedNewsIdentity,
          zeroDispatches: true
        };
      }
      const [canR, hasR] = await Promise.all([
        scope.subscribeOptional(located.newsRef, "CanRespond", located.ctx, 700),
        scope.subscribeOptional(located.newsRef, "NewsHasResponded", located.ctx, 700)
      ]);
      const canRespond = scalar(canR.read?.value) === "True";
      const hasResponded = scalar(hasR.read?.value) === "True";
      if (!canRespond || hasResponded) {
        return {
          ok: false,
          blocked: true,
          reason: !canRespond ? "目标消息当前不可回应（CanRespond!=True），已拦截且零派发。" : "目标消息已完成回应，已拦截且零派发。",
          resolvedIndex: located.resolvedIndex,
          newsIdentity: expectedNewsIdentity,
          canRespond,
          hasResponded,
          zeroDispatches: true
        };
      }
      // Review #19: 原生 EventFmxNewsResponseAction(source=human) 无法将日期/数值绑定到指定消息，两封待办会产生相同载荷；
      // 在专用消息输入通道未恢复前严格阻断并交给常规回应或玩家处理
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        resolvedIndex: located.resolvedIndex,
        newsIdentity: expectedNewsIdentity,
        inputKind,
        requestedValue: inputKind === "numeric" ? numericValue : String(dateText).trim(),
        reason: "原生日期/数值消息待办尚未恢复绑定具体 NewsItemReference 身份与输入范围校验的静默通道，为防止误提交到另一封待办消息，已阻断派发；请使用 get_news_response_actions 或在游戏内该消息中提交。",
        zeroDispatches: true
      };
    });
  }

  // MGR-O12a/c: 承诺履约与更衣室不满处理（read 模式只读核查；未区分 resolve/follow_up 与球员的写派发安全门控）
  async function managePromiseOrHappiness({ action = "read", promiseIndex, expectedPromiseIdentity, squadIndex, operationId } = {}) {
    if (!["read", "resolve", "follow_up"].includes(action)) {
      throw new Error(`未知承诺处理动作: ${action}（支持 read/resolve/follow_up）`);
    }
    if (promiseIndex !== undefined && (!Number.isInteger(promiseIndex) || promiseIndex < 0)) {
      throw new Error("promiseIndex 必须为非负整数。");
    }
    if (action === "read") {
      return client.scope(async scope => {
        const list = await scope.subscribeOptional("human", "HumanActivePromisesMadeList", {}, 1200);
        const items = (list.read?.value?.items || []).map((it, idx) => ({
          index: idx,
          identity: it?.identity || null,
          type: it?.type || null
        }));
        return {
          ok: true,
          readOnly: true,
          available: Boolean(list.handle),
          total: list.read?.value?.count ?? items.length,
          promises: items
        };
      });
    }
    // Review #21: EventFmxSpeakToDropdownActionComplete 仅接收裸整数无法区分 resolve / follow_up 或绑定球员/承诺身份
    return {
      ok: false,
      blocked: true,
      unsupportedBranch: true,
      operationId: operationId || null,
      action,
      promiseIndex: promiseIndex ?? null,
      expectedPromiseIdentity: expectedPromiseIdentity ?? null,
      squadIndex: squadIndex ?? null,
      reason: "当前版本尚未恢复区分 resolve/follow_up 与具体承诺/球员身份的原生履约跟进协议（已停用无区分事件派发）。请先用 get_manager_promises / get_squad_happiness_issues 查看详情，再由玩家在游戏内对话处理。",
      zeroDispatches: true
    };
  }

  return { manageInboxMessageFlags, submitMessageTypedInput, managePromiseOrHappiness };
}
