import { createLiveClient, scalar } from "./live-client.mjs";

// 工作许可状态读取（REC-R16）、试训延长/结束管理（REC-O13b/c）与交易前置体检/工作许可（REC-O27，Review #38）
export function createWorkPermitAndTrialTools(call) {
  const client = createLiveClient(call);

  // 同时支持外部引援目标（{ source, path }，如来自转会活动/报价/搜索）与本队球员（squadIndex）
  async function resolveTargetPerson(scope, { source, path, squadIndex }) {
    const team = await scope.subscribe("human", "Team");
    const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
    if (source) {
      return {
        targetMode: "external_reference",
        pRef: { source, path: path || "" },
        ctx,
        targetMeta: { source, path: path || "" }
      };
    }
    const idx = squadIndex ?? 0;
    if (!Number.isInteger(idx) || idx < 0) throw new Error("squadIndex 必须为非负整数。");
    const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
    const count = players.read?.value?.count ?? 0;
    if (idx >= count) throw new Error(`squadIndex 越界: ${idx} >= ${count}`);
    return {
      targetMode: "squad_index",
      pRef: { source: players.handle, path: String(idx) },
      ctx,
      targetMeta: { squadIndex: idx, personIdentity: players.read?.value?.items?.[idx]?.identity || null }
    };
  }

  // REC-R16: 读取指定球员（本队或外部拟签目标）的工作许可资格、当前申请状态与未来申请预期反馈
  async function getWorkPermitStatus({ source, path, squadIndex } = {}) {
    return client.scope(async scope => {
      const { targetMode, pRef, ctx, targetMeta } = await resolveTargetPerson(scope, { source, path, squadIndex });
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
      return { ok: true, readOnly: true, targetMode, ...targetMeta, workPermit: out };
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

  // REC-O27a/b (Review #38): 支持从外部引用（{ source, path }）或本队 squadIndex 读取工作许可与体检状态；
  // 写分支不再向 human 发送自组对象 { action, squadIndex }，而是严格检查该目标当前原生菜单是否存在，否则阻断并引导交易待办处理
  async function handleWorkPermitOrMedical({ source, path, squadIndex, action = "read", operationId } = {}) {
    if (!["read", "apply_work_permit", "appeal_work_permit", "medical"].includes(action)) {
      throw new Error(`未知交易前置动作: ${action}（支持 read/apply_work_permit/appeal_work_permit/medical）`);
    }
    return client.scope(async scope => {
      const { targetMode, pRef, ctx, targetMeta } = await resolveTargetPerson(scope, { source, path, squadIndex });
      const [nameR, wpApp, wpAppealCost, wpAppCost, wpSpeak] = await Promise.all([
        scope.readAndRelease(pRef, "Name", ctx, 600),
        scope.subscribeOptional(pRef, "WorkPermitHasCurrentApplication", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitAppealCost", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitApplicationCost", ctx, 700),
        scope.subscribeOptional(pRef, "WorkPermitSpeakTo", ctx, 700)
      ]);
      const summary = {
        playerName: nameR.scalar || null,
        hasCurrentApplication: scalar(wpApp.read?.value) === "True",
        appealCost: scalar(wpAppealCost.read?.value),
        applicationCost: scalar(wpAppCost.read?.value),
        hasWorkPermitSpeakTo: Boolean(wpSpeak.handle && wpSpeak.read?.value)
      };
      if (action === "read") {
        return { ok: true, readOnly: true, targetMode, ...targetMeta, ...summary };
      }
      if (action === "apply_work_permit" || action === "appeal_work_permit") {
        if (!wpSpeak.handle || !wpSpeak.read?.value) {
          return {
            ok: false,
            blocked: true,
            reason: "该目标球员当前未提供 WorkPermitSpeakTo 工作许可交互菜单，已拒绝派发。",
            targetMode,
            ...targetMeta,
            ...summary,
            zeroDispatches: true
          };
        }
      }
      // Review #38: 原生交易前置体检与工作许可申诉通过收件箱待办或 WorkPermitSpeakTo 动作叶执行，
      // 严禁向 EventFmxSpeakToQuickActionComplete 发送未绑定目标与交易阶段的 { action, squadIndex } 自组载荷
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        action,
        targetMode,
        ...targetMeta,
        ...summary,
        reason: action === "medical"
          ? "交易前置体检需绑定具体转会待办消息与当前提供的原生体检回应选项，已拦截无目标校验的直接派发。请先用 get_inbox(pendingOnly:true) + get_news_response_actions 处理该笔交易的体检待办，或在游戏内确认。"
          : "工作许可申请/上诉需通过具体球员的 WorkPermitSpeakTo 原生叶动作或收件箱待办回应执行，已拦截无目标绑定的自组载荷派发。",
        zeroDispatches: true
      };
    });
  }

  return { getWorkPermitStatus, manageTrialLifecycle, handleWorkPermitOrMedical };
}
