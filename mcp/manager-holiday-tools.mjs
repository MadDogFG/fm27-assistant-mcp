import { createLiveClient, scalar } from "./live-client.mjs";

// 经理假期管理（MGR-O15d 设置假期、MGR-O15e 结束假期）
export function createManagerHolidayTools(call) {
  const client = createLiveClient(call);

  async function readHolidaySnapshot(scope) {
    const isOnHoliday = await scope.subscribeOptional("human", "IsOnHoliday");
    const returnText = await scope.subscribeOptional("human", "ReturnFromHolidayDateText");
    const go = await scope.subscribeOptional("human", "GoOnHoliday");
    let details = {};
    if (go.handle) {
      const [canGo, errMsg, canConfirm, rType, rDays, rStr, dd] = await Promise.all([
        scope.subscribeOptional(go.handle, "CanGoOnHoliday"),
        scope.subscribeOptional(go.handle, "CanGoOnHolidayErrorMessage"),
        scope.subscribeOptional(go.handle, "CanConfirm"),
        scope.subscribeOptional(go.handle, "ReturnDateType"),
        scope.subscribeOptional(go.handle, "ReturnNumberDays"),
        scope.subscribeOptional(go.handle, "ReturnDateString"),
        scope.subscribeOptional(go.handle, "ReturnDateDropdown")
      ]);
      details = {
        goOnHolidayHandle: go.handle,
        canGoOnHoliday: scalar(canGo.read?.value),
        canGoOnHolidayError: scalar(errMsg.read?.value),
        canConfirm: scalar(canConfirm.read?.value),
        returnDateType: scalar(rType.read?.value),
        returnNumberDays: scalar(rDays.read?.value),
        returnDateString: scalar(rStr.read?.value),
        returnDateDropdown: dd.read?.value ?? null
      };
    }
    return {
      isOnHoliday: scalar(isOnHoliday.read?.value) === "True",
      isOnHolidayRaw: scalar(isOnHoliday.read?.value),
      returnFromHolidayDateText: scalar(returnText.read?.value),
      ...details
    };
  }

  // 只读获取当前经理休假状态与度假配置草稿
  async function getHolidayStatus() {
    return client.scope(async scope => {
      const snapshot = await readHolidaySnapshot(scope);
      return { ok: true, ...snapshot };
    });
  }

  // 执行开始休假（go）或结束休假（return）
  async function manageHoliday({
    action = "go",
    returnDateType,
    returnNumberDays,
    useCurrentTactics,
    useTeamSelection,
    applyForJobs,
    operationId
  } = {}) {
    if (action !== "go" && action !== "return") {
      throw new Error(`未知假期操作: ${action}（支持 go / return）`);
    }
    const id = operationId || `holiday_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readHolidaySnapshot(scope);
      if (action === "return") {
        if (!before.isOnHoliday) {
          return { ok: true, skipped: true, reason: "当前并未处于休假状态。", before, after: before };
        }
        const dispatch = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxReturnFromHoliday&source=human&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
        );
        let after = await readHolidaySnapshot(scope);
        for (let i = 0; i < 6 && after.isOnHoliday; i++) {
          await new Promise(r => setTimeout(r, 250));
          after = await readHolidaySnapshot(scope);
        }
        return {
          ok: true,
          operationId: id,
          action,
          eventName: "EventFmxReturnFromHoliday",
          dispatch,
          before,
          after,
          verified: after.isOnHoliday === false
        };
      }

      // action === "go": CanGoOnHoliday 在原生层为错误枚举码（"0" 表示无错误允许休假），或存在 ErrorMessage / CanConfirm === "False" 时拦截
      const blockedByCode = before.canGoOnHoliday !== undefined && before.canGoOnHoliday !== null && before.canGoOnHoliday !== "0" && before.canGoOnHoliday !== "True";
      if (blockedByCode || before.canConfirm === "False" || Boolean(before.canGoOnHolidayError)) {
        return {
          ok: false,
          operationId: id,
          action,
          blocked: true,
          error: before.canGoOnHolidayError || `当前状态不允许开始休假 (code=${before.canGoOnHoliday})。`,
          before
        };
      }
      if (!before.goOnHolidayHandle) {
        throw new Error("未找到 GoOnHoliday 上下文对象。");
      }

      // 若调用方指定了假期天数/模式/战术策略等参数，先写回 GoOnHoliday 子属性
      const updates = [];
      const propUpdates = [
        ["ReturnDateType", returnDateType],
        ["ReturnNumberDays", returnNumberDays],
        ["UseCurrentTactics", useCurrentTactics],
        ["UseTeamSelection", useTeamSelection],
        ["ApplyForJobs", applyForJobs]
      ];
      for (const [propName, val] of propUpdates) {
        if (val === undefined) continue;
        const sub = await scope.subscribeOptional(before.goOnHolidayHandle, propName);
        if (sub.handle) {
          const upd = await call(
            `/api/v1/internal/update?handle=${encodeURIComponent(sub.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) }
          );
          updates.push({ propName, value: val, result: upd });
        }
      }
      // 等待游戏主线程将 ReturnDateType 等设置真正应用到度假会话，再触发 EventFmxGoOnHoliday
      if (updates.length) await new Promise(r => setTimeout(r, 300));

      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxGoOnHoliday&source=${encodeURIComponent(before.goOnHolidayHandle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
      );
      await new Promise(r => setTimeout(r, 250));
      const after = await readHolidaySnapshot(scope);
      const compactSnap = s => ({ isOnHoliday: s.isOnHoliday, returnFromHolidayDateText: s.returnFromHolidayDateText, returnDateType: s.returnDateType, returnDateString: s.returnDateString });
      return {
        ok: true,
        operationId: id,
        action,
        eventName: "EventFmxGoOnHoliday",
        updatesCount: updates.length,
        before: compactSnap(before),
        after: compactSnap(after),
        verified: after.isOnHoliday === true
      };
    });
  }

  return { getHolidayStatus, manageHoliday };
}
