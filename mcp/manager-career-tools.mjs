import { createLiveClient, scalar } from "./live-client.mjs";

// 经理职业生涯与求职管理（MGR-O14c/d 面试/接受职位、MGR-O15a/b/c 本人合同/续约/辞职）与新闻关注（MGR-O23a/c）
export function createManagerCareerTools(call) {
  const client = createLiveClient(call);

  // 只读读取经理本人职务、合同与可面试/可接受职位状态
  async function getManagerCareerStatus() {
    return client.scope(async scope => {
      const [jobStr, appliedCnt, availCnt, clubJob] = await Promise.all([
        scope.subscribeOptional("human", "JobString"),
        scope.subscribeOptional("human", "ManagerAppliedJobsCount"),
        scope.subscribeOptional("human", "ManagerAvailableJobsCount"),
        scope.subscribeOptional("human", "PrimaryClubJob")
      ]);
      return {
        ok: true,
        readOnly: true,
        currentJob: scalar(jobStr.read?.value),
        appliedJobsCount: scalar(appliedCnt.read?.value),
        availableJobsCount: scalar(availCnt.read?.value),
        hasPrimaryClubJob: Boolean(clubJob.handle && clubJob.read?.value)
      };
    });
  }

  // MGR-O14c/d / MGR-O15a/b/c: 处理面试/接受职位、本人合同/续约/辞职
  async function manageManagerCareer({
    action = "contract_read",
    jobIndex = 0,
    acceptResignConfirmation = false,
    operationId
  } = {}) {
    const valid = ["contract_read", "attend_interview", "accept_job", "negotiate_contract", "renew_contract", "resign"];
    if (!valid.includes(action)) {
      throw new Error(`未知经理生涯动作: ${action}（支持 ${valid.join("/")}）`);
    }
    if (action === "resign" && acceptResignConfirmation !== true) {
      throw new Error("辞职（resign）为不可逆高危操作，必须显式传入 acceptResignConfirmation: true。");
    }
    const id = operationId || `mgr_career_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const clubJob = await scope.subscribeOptional("human", "PrimaryClubJob");
      if (action === "contract_read") {
        return { ok: true, readOnly: true, hasPrimaryClubJob: Boolean(clubJob.handle), clubJob: clubJob.read?.value ?? null };
      }
      const eventMap = {
        attend_interview: "EventFmxOfferJobInterview",
        accept_job: "EventFmxMakeContractDecision",
        negotiate_contract: "EventFmxProceedToContractNegotiations",
        renew_contract: "EventFmxMakeContractDecision",
        resign: "EventFmxManagerStaffChanges"
      };
      const eventName = eventMap[action];
      const payload = action === "resign" ? 3 : (action === "attend_interview" || action === "accept_job" ? jobIndex : 0);
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return { ok: true, operationId: id, action, eventName, dispatch };
    });
  }

  // MGR-O23a/c: 关注球队或关注赛事/新闻来源
  async function manageNewsFollow({ targetType = "club", targetIndex = 0, follow = true, operationId } = {}) {
    if (!["club", "competition", "media_source"].includes(targetType)) {
      throw new Error(`未知关注目标类型: ${targetType}（支持 club/competition/media_source）`);
    }
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
      throw new Error("targetIndex 必须为非负整数。");
    }
    const id = operationId || `follow_${targetType}_${Date.now()}`;
    const dispatch = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSpeakToQuickActionComplete&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetIndex) }
    );
    return { ok: true, operationId: id, targetType, targetIndex, follow: Boolean(follow), dispatch };
  }

  return { getManagerCareerStatus, manageManagerCareer, manageNewsFollow };
}
