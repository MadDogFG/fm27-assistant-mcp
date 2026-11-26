import { createLiveClient, scalar } from "./live-client.mjs";

// 经理假期管理（MGR-O15d 设置假期、MGR-O15e 结束假期）
export function createManagerHolidayTools(call) {
  const client = createLiveClient(call);

  function parseTriStateBool(raw) {
    if (raw === "True" || raw === true) return true;
    if (raw === "False" || raw === false) return false;
    return null;
  }

  function valuesMatch(expected, actualRaw) {
    if (actualRaw === null || actualRaw === undefined) return false;
    if (typeof expected === "boolean") {
      return parseTriStateBool(actualRaw) === expected;
    }
    if (typeof expected === "number") {
      const n = Number(actualRaw);
      return Number.isFinite(n) && n === expected;
    }
    return String(actualRaw).trim() === String(expected).trim();
  }

  async function readHolidaySnapshot(scope) {
    const isOnHolidaySub = await scope.subscribeOptional("human", "IsOnHoliday");
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
    const rawHoliday = isOnHolidaySub.handle ? scalar(isOnHolidaySub.read?.value) : null;
    // 严格保留三态：读不到 IsOnHoliday 时为 null（未知），绝不误判为 false（Review #20）
    const isOnHoliday = parseTriStateBool(rawHoliday);
    return {
      isOnHoliday,
      isOnHolidayStatus: isOnHoliday === null ? "unknown" : (isOnHoliday ? "on_holiday" : "active"),
      isOnHolidayRaw: rawHoliday,
      returnFromHolidayDateText: scalar(returnText.read?.value),
      ...details
    };
  }

  // 只读获取当前经理休假状态与度假配置草稿
  async function getHolidayStatus() {
    return client.scope(async scope => {
      const snapshot = await readHolidaySnapshot(scope);
      return { ok: true, readOnly: true, ...snapshot };
    });
  }

  // 执行开始休假（go）或结束休假（return）
  async function manageHoliday({
    action,
    returnDateType,
    returnNumberDays,
    useCurrentTactics,
    useTeamSelection,
    applyForJobs,
    operationId
  } = {}) {
    if (action !== "go" && action !== "return") {
      throw new Error(`必须明确指定假期操作 action（支持 go / return）。当前: ${action}`);
    }
    const id = operationId || `holiday_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readHolidaySnapshot(scope);
      if (action === "return") {
        if (before.isOnHoliday === null) {
          return {
            ok: false,
            operationId: id,
            action,
            status: "state_unknown",
            verified: false,
            error: "无法读取当前 IsOnHoliday 状态（通道未就绪），已中止返岗操作。",
            before
          };
        }
        if (before.isOnHoliday === false) {
          return { ok: true, skipped: true, reason: "当前并未处于休假状态（IsOnHoliday=False）。", before, after: before };
        }
        const dispatch = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxReturnFromHoliday&source=human&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
        );
        let after = await readHolidaySnapshot(scope);
        for (let i = 0; i < 6 && after.isOnHoliday !== false; i++) {
          await new Promise(r => setTimeout(r, 250));
          after = await readHolidaySnapshot(scope);
        }
        const verified = after.isOnHoliday === false;
        return {
          ok: verified,
          operationId: id,
          action,
          status: verified ? "returned" : (after.isOnHoliday === null ? "after_state_unknown" : "still_on_holiday"),
          eventName: "EventFmxReturnFromHoliday",
          dispatch,
          before,
          after,
          verified,
          ...(!verified ? { error: after.isOnHoliday === null ? "返岗派发后无法读回 IsOnHoliday 状态（未知）。" : "返岗派发后经理仍处于休假状态。" } : {})
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

      // 若调用方指定了假期天数/模式/战术策略等条件，必须逐项写入并读回证实；任一项不可写或读回不符即中止，绝不开始休假（Review #20）
      const updates = [];
      const failedConditions = [];
      const propUpdates = [
        ["ReturnDateType", returnDateType],
        ["ReturnNumberDays", returnNumberDays],
        ["UseCurrentTactics", useCurrentTactics],
        ["UseTeamSelection", useTeamSelection],
        ["ApplyForJobs", applyForJobs]
      ];
      for (const [propName, val] of propUpdates) {
        if (val === undefined) continue;
        const sub = await scope.subscribeOptional(before.goOnHolidayHandle, propName, {}, 1000);
        if (!sub.handle) {
          failedConditions.push({ propName, requested: val, reason: sub.unavailable || "property_unavailable" });
          continue;
        }
        let upd;
        try {
          upd = await call(
            `/api/v1/internal/update?handle=${encodeURIComponent(sub.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) }
          );
          if (upd?.ok === false) {
            failedConditions.push({ propName, requested: val, reason: upd.error || "update_rejected" });
            continue;
          }
        } catch (err) {
          failedConditions.push({ propName, requested: val, reason: String(err?.message || err) });
          continue;
        }
        await new Promise(r => setTimeout(r, 120));
        let observedRaw = null;
        let matched = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const check = await scope.ready(sub.handle, undefined, 800).catch(() => null);
          observedRaw = scalar(check?.value);
          if (valuesMatch(val, observedRaw)) {
            matched = true;
            break;
          }
          if (attempt < 2) await new Promise(r => setTimeout(r, 120));
        }
        if (!matched) {
          failedConditions.push({ propName, requested: val, observed: observedRaw, reason: "readback_mismatch" });
        } else {
          updates.push({ propName, requested: val, observed: observedRaw, result: upd });
        }
      }

      if (failedConditions.length > 0) {
        return {
          ok: false,
          operationId: id,
          action,
          blocked: true,
          status: "conditions_not_confirmed",
          failedConditions,
          appliedUpdates: updates,
          error: `休假前置条件未全部写入证实（${failedConditions.map(f => `${f.propName}:${f.reason}`).join("；")}），已中止且未发送 EventFmxGoOnHoliday。`,
          zeroHolidayDispatches: true
        };
      }

      if (updates.length) await new Promise(r => setTimeout(r, 200));

      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxGoOnHoliday&source=${encodeURIComponent(before.goOnHolidayHandle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
      );
      await new Promise(r => setTimeout(r, 250));
      const after = await readHolidaySnapshot(scope);
      const compactSnap = s => ({
        isOnHoliday: s.isOnHoliday,
        isOnHolidayStatus: s.isOnHolidayStatus,
        returnFromHolidayDateText: s.returnFromHolidayDateText,
        returnDateType: s.returnDateType,
        returnNumberDays: s.returnNumberDays,
        returnDateString: s.returnDateString
      });
      const verified = after.isOnHoliday === true;
      return {
        ok: verified,
        operationId: id,
        action,
        status: verified ? "on_holiday" : (after.isOnHoliday === null ? "after_state_unknown" : "not_started"),
        eventName: "EventFmxGoOnHoliday",
        updatesCount: updates.length,
        confirmedConditions: updates.map(u => ({ propName: u.propName, requested: u.requested, observed: u.observed })),
        before: compactSnap(before),
        after: compactSnap(after),
        verified
      };
    });
  }

  return { getHolidayStatus, manageHoliday };
}
