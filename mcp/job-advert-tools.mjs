import { createLiveClient, clean } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 俱乐部职员招聘广告只读与撤销管理工具组（CLB-O13b）
export function createJobAdvertTools(call) {
  const client = createLiveClient(call);
  const { getPropertyMap } = createPropertyRegistryCache(call);

  const stripTags = text => clean(text).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").trim();

  function decodeValue(val, idMap) {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val;
    if (val.kind === "scalar") return val.type === "System.String" ? stripTags(val.value) : val.value;
    if (val.kind === "list" && Array.isArray(val.items)) {
      return { count: val.count, items: val.items.map(x => decodeValue(x, idMap)) };
    }
    if (val.kind === "record" && val.fields) {
      const out = {};
      for (const [k, v] of Object.entries(val.fields)) {
        const name = k.startsWith("0x") ? (idMap.get(Number.parseInt(k, 16)) || k) : k;
        out[name] = decodeValue(v, idMap);
      }
      return out;
    }
    return val;
  }

  async function readAdverts(scope, idMap) {
    const team = await scope.subscribe("human", "Team");
    const club = await scope.subscribe("human", "Club");
    const ctx = {
      human: { source: "human" }, Human: { source: "human" },
      team: { source: team.handle }, Team: { source: team.handle },
      club: { source: club.handle }, Club: { source: club.handle },
    };
    const myTeamId = team.read?.value?.identity || null;
    const adverts = await scope.subscribeOptional("human", "HumanJobCentreCurrentAdverts", ctx, 1200);
    const vacancies = await scope.subscribeOptional({ source: club.handle }, "CoachingVacancies", ctx, 1200);
    const medVac = await scope.subscribeOptional({ source: club.handle }, "MedicalVacancies", ctx, 1200);
    const scoutVac = await scope.subscribeOptional({ source: club.handle }, "ScoutingVacancies", ctx, 1200);
    const appliedCount = await scope.subscribeOptional("human", "ManagerAppliedJobsCount", ctx, 1200);
    const rawItems = adverts.handle ? (adverts.read?.value?.items || []) : [];
    const clubAdverts = [];
    const marketAdverts = [];
    rawItems.forEach((item, idx) => {
      const decoded = decodeValue(item, idMap);
      const tId = item?.fields?.["0x5465616d"]?.identity || null;
      if (!myTeamId || tId === myTeamId) {
        clubAdverts.push({ index: idx, teamIdentity: tId, data: decoded });
      }
      if (marketAdverts.length < 100) {
        marketAdverts.push({ index: idx, teamIdentity: tId, data: decoded });
      }
    });
    return {
      advertsHandle: adverts.handle || null,
      myTeamIdentity: myTeamId,
      totalMarketAdverts: rawItems.length,
      clubAdverts,
      marketAdverts,
      coachingVacancies: vacancies.handle ? decodeValue(vacancies.read?.value, idMap) : { unavailable: vacancies.unavailable || "no_handle" },
      medicalVacancies: medVac.handle ? decodeValue(medVac.read?.value, idMap) : { unavailable: medVac.unavailable || "no_handle" },
      scoutingVacancies: scoutVac.handle ? decodeValue(scoutVac.read?.value, idMap) : { unavailable: scoutVac.unavailable || "no_handle" },
      managerAppliedJobsCount: appliedCount.handle ? decodeValue(appliedCount.read?.value, idMap) : null,
    };
  }

  async function listJobAdverts() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const data = await readAdverts(scope, idMap);
      return { ok: true, readOnly: true, ...data };
    });
  }

  async function removeJobAdvert({ index, operationId } = {}) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("必须提供有效的招聘广告 index（非负整数）。");
    }
    const id = operationId || `job_advert_remove_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const before = await readAdverts(scope, idMap);
      const target = before.clubAdverts.find(a => a.index === index);
      if (!target) {
        throw new Error(`未在本俱乐部当前招聘广告中找到 index=${index} 的条目（当前本队广告数: ${before.clubAdverts.length}）。`);
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxRemoveJobAdvert&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(index) }
      );
      await new Promise(r => setTimeout(r, 350));
      const after = await readAdverts(scope, idMap);
      return {
        ok: true,
        operationId: id,
        beforeCount: before.clubAdverts.length,
        afterCount: after.clubAdverts.length,
        verified: after.clubAdverts.length < before.clubAdverts.length,
        dispatch: send,
      };
    });
  }

  // MGR-O14a / MGR-O14b: 对工作中心空缺职位发起申请或表达兴趣
  async function submitJobAction(eventName, { index, operationId } = {}) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("必须提供有效的工作中心广告 index（非负整数）。");
    }
    const id = operationId || `${eventName}_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const data = await readAdverts(scope, idMap);
      if (!data.advertsHandle || index >= data.totalMarketAdverts) {
        throw new Error(`工作中心广告索引越界: index=${index}, total=${data.totalMarketAdverts}`);
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ $value: { source: data.advertsHandle, path: `${index}/0x5465616d` } }),
        }
      );
      return { ok: true, operationId: id, index, eventName, dispatch: send };
    });
  }

  // CLB-O14b: 邀请职员应聘者面试（EventFmxOfferJobInterview）
  async function offerStaffInterview({ candidateIndex = 0, operationId } = {}) {
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
      throw new Error("candidateIndex 必须为非负整数。");
    }
    const id = operationId || `staff_interview_${Date.now()}`;
    const send = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxOfferJobInterview&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidateIndex) }
    );
    return { ok: true, operationId: id, candidateIndex, eventName: "EventFmxOfferJobInterview", dispatch: send };
  }

  // CLB-O15: 执行职员合同与任用决定（EventFmxMakeContractDecision）
  async function makeStaffContractDecision({ decisionIndex = 0, operationId } = {}) {
    if (!Number.isInteger(decisionIndex) || decisionIndex < 0) {
      throw new Error("decisionIndex 必须为非负整数。");
    }
    const id = operationId || `staff_contract_dec_${Date.now()}`;
    const send = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxMakeContractDecision&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionIndex) }
    );
    return { ok: true, operationId: id, decisionIndex, eventName: "EventFmxMakeContractDecision", dispatch: send };
  }

  // CLB-O13a: 发布俱乐部职员空缺招聘广告
  async function postJobAdvert({ roleId = 0, department = "coaching", operationId } = {}) {
    if (!["coaching", "medical", "scouting"].includes(department)) {
      throw new Error(`未知部门: ${department}（支持 coaching/medical/scouting）`);
    }
    const id = operationId || `post_advert_${department}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxManagerStaffChanges&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleId) }
      );
      return { ok: true, operationId: id, department, roleId, eventName: "EventFmxManagerStaffChanges", dispatch: send };
    });
  }

  // CLB-O14a/c: 审阅应聘者名单或选定拟聘职员
  async function reviewOrSelectApplicant({ action = "review", candidateIndex = 0, operationId } = {}) {
    if (!["review", "select"].includes(action)) {
      throw new Error(`未知应聘处理动作: ${action}（支持 review/select）`);
    }
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
      throw new Error("candidateIndex 必须为非负整数。");
    }
    const id = operationId || `applicant_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const candInfo = await scope.subscribeOptional({ source: club.handle }, "DebugJobCandidatesInfo", { human: { source: "human" }, club: { source: club.handle } }, 800);
      if (action === "review") {
        return { ok: true, readOnly: true, candidatesInfo: candInfo.read?.value ?? null };
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxTransferActivityPersonSelectionStaff&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidateIndex) }
      );
      return { ok: true, operationId: id, action, candidateIndex, eventName: "EventFmxTransferActivityPersonSelectionStaff", dispatch: send };
    });
  }

  // CLB-O15c/d: 职员晋升或调岗
  async function promoteOrReassignStaff({ action = "promote", staffIndex = 0, targetRoleId = 0, operationId } = {}) {
    if (!["promote", "reassign"].includes(action)) {
      throw new Error(`未知职员岗位调整动作: ${action}（支持 promote/reassign）`);
    }
    if (!Number.isInteger(staffIndex) || staffIndex < 0) {
      throw new Error("staffIndex 必须为非负整数。");
    }
    const id = operationId || `staff_${action}_${Date.now()}`;
    const send = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxManagerStaffChanges&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(staffIndex) }
    );
    return { ok: true, operationId: id, action, staffIndex, targetRoleId, eventName: "EventFmxManagerStaffChanges", dispatch: send };
  }

  return {
    listJobAdverts,
    removeJobAdvert,
    applyForJob: args => submitJobAction("EventFmxApplyForJob", args),
    declareInterestInJob: args => submitJobAction("EventFmxDeclareInterestInJob", args),
    offerStaffInterview,
    makeStaffContractDecision,
    postJobAdvert,
    reviewOrSelectApplicant,
    promoteOrReassignStaff,
  };
}
