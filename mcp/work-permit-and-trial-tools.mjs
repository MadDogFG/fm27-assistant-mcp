import { createLiveClient, scalar } from "./live-client.mjs";

// 工作许可状态读取（REC-R16）与试训延长/结束管理（REC-O13b/c）
export function createWorkPermitAndTrialTools(call) {
  const client = createLiveClient(call);

  // REC-R16: 读取指定球员的工作许可资格、当前申请状态与未来申请预期反馈
  async function getWorkPermitStatus({ squadIndex = 0 } = {}) {
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const pRef = { source: players.handle, path: String(squadIndex) };
      const props = [
        "Name", "RequiresPlayingWorkPermit", "WorkPermitStatus", "WorkPermitChance",
        "WorkPermitHasCurrentApplication", "WorkPermitCurrentApplicationStatus",
        "WorkPermitCurrentApplicationDetails", "WorkPermitFutureApplicationWouldBeGranted",
        "WorkPermitFutureApplicationFeedback"
      ];
      const out = {};
      for (const p of props) {
        const sub = await scope.subscribeOptional(pRef, p, ctx, 700);
        out[p] = sub.handle ? (scalar(sub.read?.value) ?? sub.read?.value ?? null) : null;
      }
      return { ok: true, readOnly: true, squadIndex, workPermit: out };
    });
  }

  // REC-O13b/c: 读取试训状态，并支持延长试训（extend）或结束试训（end）
  async function manageTrialLifecycle({ squadIndex = 0, action = "read", weeks = 1, operationId } = {}) {
    if (!["read", "extend", "end"].includes(action)) {
      throw new Error(`未知试训动作: ${action}（支持 read/extend/end）`);
    }
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const pRef = { source: players.handle, path: String(squadIndex) };
      const [isTrial, tClub, tWeeks] = await Promise.all([
        scope.subscribeOptional(pRef, "IsTrialIn", ctx, 700),
        scope.subscribeOptional(pRef, "TrialClub", ctx, 700),
        scope.subscribeOptional(pRef, "TrialLengthInWeeks", ctx, 700)
      ]);
      const inTrial = scalar(isTrial.read?.value) === "True";
      let trialClubName = null;
      if (tClub.handle && tClub.read?.value?.identity) {
        trialClubName = await scope.resolveRefName(tClub.handle, ctx, 500);
      }
      if (action === "read") {
        return {
          ok: true,
          readOnly: true,
          squadIndex,
          isTrialIn: inTrial,
          trialClub: tClub.read?.value ?? null,
          trialClubName,
          trialLengthInWeeks: scalar(tWeeks.read?.value)
        };
      }
      if (!inTrial) {
        return { ok: false, blocked: true, reason: "该球员当前不在试训期（IsTrialIn=False）。", squadIndex };
      }
      const id = operationId || `trial_${action}_${Date.now()}`;
      if (action === "extend") {
        if (!Number.isInteger(weeks) || weeks < 1) throw new Error("延长试训周数 weeks 必须为正整数。");
        if (!tWeeks.handle) return { ok: false, blocked: true, reason: "未暴露 TrialLengthInWeeks 属性。" };
        const upd = await call(
          `/api/v1/internal/update?handle=${encodeURIComponent(tWeeks.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(weeks) }
        );
        return { ok: true, operationId: id, action, squadIndex, weeks, update: upd };
      }
      // action === "end": 更新 IsTrialIn=false 或通过可用 Actions 结束
      if (isTrial.handle) {
        const upd = await call(
          `/api/v1/internal/update?handle=${encodeURIComponent(isTrial.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(false) }
        );
        return { ok: true, operationId: id, action, squadIndex, update: upd };
      }
      return { ok: false, blocked: true, reason: "未暴露结束试训操作接口。" };
    });
  }

  // REC-O27a/b: 处理交易前置体检或工作许可申请/上诉
  async function handleWorkPermitOrMedical({ squadIndex = 0, action = "read", operationId } = {}) {
    if (!["read", "apply_work_permit", "appeal_work_permit", "medical"].includes(action)) {
      throw new Error(`未知交易前置动作: ${action}（支持 read/apply_work_permit/appeal_work_permit/medical）`);
    }
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const pRef = { source: players.handle, path: String(squadIndex) };
      const [wpApp, wpAppealCost, wpAppCost, wpSpeak] = await Promise.all([
        scope.subscribeOptional(pRef, "WorkPermitHasCurrentApplication", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitAppealCost", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitApplicationCost", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitSpeakTo", ctx, 700)
      ]);
      const summary = {
        hasCurrentApplication: scalar(wpApp.read?.value) === "True",
        appealCost: scalar(wpAppealCost.read?.value),
        applicationCost: scalar(wpAppCost.read?.value),
        hasWorkPermitSpeakTo: Boolean(wpSpeak.handle && wpSpeak.read?.value)
      };
      if (action === "read") {
        return { ok: true, readOnly: true, squadIndex, ...summary };
      }
      if (action === "apply_work_permit" || action === "appeal_work_permit") {
        if (!wpSpeak.handle || !wpSpeak.read?.value) {
          return { ok: false, blocked: true, reason: "该球员当前未提供 WorkPermitSpeakTo 工作许可交互菜单。", squadIndex, ...summary };
        }
      }
      const id = operationId || `pre_deal_${action}_${Date.now()}`;
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSpeakToQuickActionComplete&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, squadIndex }) }
      );
      return { ok: true, operationId: id, action, squadIndex, ...summary, dispatch };
    });
  }

  return { getWorkPermitStatus, manageTrialLifecycle, handleWorkPermitOrMedical };
}
