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

  // 从 Club.DebugJobCandidatesInfo 提取可校验的应聘候选人数组，防止对空列表或错位索引盲发裸整数
  function extractCandidatesList(rawVal, idMap) {
    if (!rawVal) return [];
    if (rawVal.kind === "list" && Array.isArray(rawVal.items)) {
      return rawVal.items.map((item, idx) => ({
        index: idx,
        identity: item?.identity || item?.fields?.["0x50657273"]?.identity || null,
        data: decodeValue(item, idMap)
      }));
    }
    return [];
  }

  async function readVerifiedCandidates(scope, idMap) {
    const club = await scope.subscribe("human", "Club");
    const ctx = { human: { source: "human" }, Human: { source: "human" }, club: { source: club.handle }, Club: { source: club.handle } };
    const candSub = await scope.subscribeOptional({ source: club.handle }, "DebugJobCandidatesInfo", ctx, 800);
    const rawVal = candSub.handle ? (candSub.read?.value ?? null) : null;
    const candidates = extractCandidatesList(rawVal, idMap);
    return { club, candSub, rawVal, candidates };
  }

  function validateCandidateSelection(candidates, index, expectedCandidateIdentity, actionLabel) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`${actionLabel} 必须显式提供非负整数索引。`);
    }
    if (!candidates.length) {
      return {
        ok: false,
        dispatched: false,
        blockedReason: "no_verified_staff_candidates",
        error: `当前游戏未暴露可校验的职员应聘候选人列表（DebugJobCandidatesInfo 为空或不可用），已拦截 ${actionLabel} 零派发以防盲发裸索引。`,
        hint: "请先通过 list_job_adverts 或 review_or_select_applicant({ action: 'review' }) 确认存在真实应聘者后再操作，或在游戏内职员招聘中心完成决策。"
      };
    }
    if (index >= candidates.length) {
      return {
        ok: false,
        dispatched: false,
        blockedReason: "candidate_index_out_of_range",
        availableCandidatesCount: candidates.length,
        error: `索引 ${index} 超出当前应聘候选人列表范围（共 ${candidates.length} 人），已拒绝派发。`
      };
    }
    const target = candidates[index];
    if (expectedCandidateIdentity && target.identity && target.identity !== expectedCandidateIdentity) {
      return {
        ok: false,
        dispatched: false,
        blockedReason: "candidate_identity_mismatch",
        expectedCandidateIdentity,
        actualCandidateIdentity: target.identity,
        error: `候选人身份不匹配：期望 ${expectedCandidateIdentity}，实际 index=${index} 为 ${target.identity}，已拒绝写入。`
      };
    }
    return { ok: true, target };
  }

  // CLB-O14b: 邀请职员应聘者面试（先核验真实候选人列表与身份，杜绝盲发裸整数）
  async function offerStaffInterview({ candidateIndex, expectedCandidateIdentity, operationId } = {}) {
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
      throw new Error("candidateIndex 必须显式提供非负整数。");
    }
    const id = operationId || `staff_interview_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const { candidates } = await readVerifiedCandidates(scope, idMap);
      const check = validateCandidateSelection(candidates, candidateIndex, expectedCandidateIdentity, "offer_staff_interview");
      if (!check.ok) return check;
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxOfferJobInterview&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidateIndex) }
      );
      return {
        ok: true,
        dispatched: true,
        operationId: id,
        candidateIndex,
        candidateIdentity: check.target.identity,
        eventName: "EventFmxOfferJobInterview",
        dispatch: send
      };
    });
  }

  // CLB-O15: 执行职员合同与任用决定（先核验真实候选人列表与身份，杜绝盲发裸整数）
  async function makeStaffContractDecision({ decisionIndex, expectedCandidateIdentity, operationId } = {}) {
    if (!Number.isInteger(decisionIndex) || decisionIndex < 0) {
      throw new Error("decisionIndex 必须显式提供非负整数。");
    }
    const id = operationId || `staff_contract_dec_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const { candidates } = await readVerifiedCandidates(scope, idMap);
      const check = validateCandidateSelection(candidates, decisionIndex, expectedCandidateIdentity, "make_staff_contract_decision");
      if (!check.ok) return check;
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxMakeContractDecision&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionIndex) }
      );
      return {
        ok: true,
        dispatched: true,
        operationId: id,
        decisionIndex,
        candidateIdentity: check.target.identity,
        eventName: "EventFmxMakeContractDecision",
        dispatch: send
      };
    });
  }

  // CLB-O13a: 发布俱乐部职员空缺招聘广告（先核对对应部门真实空缺；未绑定区分部门的原生载荷时安全门控零派发）
  async function postJobAdvert({ roleId, department, operationId } = {}) {
    if (!["coaching", "medical", "scouting"].includes(department)) {
      throw new Error(`必须显式指定合法部门 department（支持 coaching/medical/scouting），当前收到：${department}`);
    }
    if (!Number.isInteger(roleId) || roleId < 0) {
      throw new Error("roleId 必须显式提供非负整数。");
    }
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const adverts = await readAdverts(scope, idMap);
      const vacancyKey = {
        coaching: "coachingVacancies",
        medical: "medicalVacancies",
        scouting: "scoutingVacancies"
      }[department];
      const deptVacancies = adverts[vacancyKey];
      const vacancyItems = Array.isArray(deptVacancies?.items) ? deptVacancies.items : [];
      if (!vacancyItems.length || roleId >= vacancyItems.length) {
        return {
          ok: false,
          dispatched: false,
          blockedReason: "vacancy_not_available_for_department",
          department,
          roleId,
          observedVacancies: deptVacancies,
          error: `部门 ${department} 当前无对应可核验空缺（roleId=${roleId}，空缺项数=${vacancyItems.length}），已拦截零派发，避免丢弃 department 参数盲发 EventFmxManagerStaffChanges。`,
          hint: "请先通过 list_job_adverts 查看俱乐部各部门真实空缺；若需发布新招聘广告建议在游戏内「职员 -> 招聘中心」直接选择对应岗位发布。"
        };
      }
      // 即使读取到空缺项，EventFmxManagerStaffChanges 尚未建立按 department 绑定原生岗位的独立协议，严禁盲发裸 roleId
      return {
        ok: false,
        supported: false,
        dispatched: false,
        blockedReason: "post_job_advert_protocol_not_verified",
        department,
        roleId,
        operationId: operationId || null,
        observedVacanciesCount: vacancyItems.length,
        observedVacancy: vacancyItems[roleId],
        error: "当前构建尚未恢复按部门（coaching/medical/scouting）与岗位精确绑定发布招聘广告的原生事件载荷，为避免丢弃部门信息导致发错岗位，已安全门控零派发。",
        hint: "已返回该部门真实空缺详情供参考，请玩家在游戏内职员招聘中心一键发布对应岗位广告；撤销已有广告可继续使用 remove_job_advert。"
      };
    });
  }

  // CLB-O14a/c: 审阅应聘者名单或选定已核验拟聘职员
  async function reviewOrSelectApplicant({ action = "review", candidateIndex, expectedCandidateIdentity, operationId } = {}) {
    if (!["review", "select"].includes(action)) {
      throw new Error(`未知应聘处理动作: ${action}（支持 review/select）`);
    }
    const id = operationId || `applicant_${action}_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const { club, rawVal, candidates } = await readVerifiedCandidates(scope, idMap);
      if (action === "review") {
        return {
          ok: true,
          readOnly: true,
          candidatesCount: candidates.length,
          candidates,
          candidatesInfo: decodeValue(rawVal, idMap)
        };
      }
      const check = validateCandidateSelection(candidates, candidateIndex, expectedCandidateIdentity, "review_or_select_applicant(select)");
      if (!check.ok) return check;
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxTransferActivityPersonSelectionStaff&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidateIndex) }
      );
      return {
        ok: true,
        dispatched: true,
        operationId: id,
        action,
        candidateIndex,
        candidateIdentity: check.target.identity,
        eventName: "EventFmxTransferActivityPersonSelectionStaff",
        dispatch: send
      };
    });
  }

  // CLB-O15c/d: 职员晋升或调岗（安全门控：EventFmxManagerStaffChanges 不支持区分 promote/reassign 与 targetRoleId）
  async function promoteOrReassignStaff({ action, staffIndex, targetRoleId, operationId } = {}) {
    if (!["promote", "reassign"].includes(action)) {
      throw new Error(`未知职员岗位调整动作: ${action}（支持 promote/reassign）`);
    }
    if (!Number.isInteger(staffIndex) || staffIndex < 0) {
      throw new Error("staffIndex 必须显式提供非负整数。");
    }
    return {
      ok: false,
      supported: false,
      dispatched: false,
      blockedReason: "staff_role_change_protocol_not_verified",
      action,
      staffIndex,
      targetRoleId: Number.isInteger(targetRoleId) ? targetRoleId : null,
      operationId: operationId || null,
      error: "当前构建尚未恢复区分职员晋升（promote）/调岗（reassign）及目标岗位（targetRoleId）的原生协议，已安全门控零派发（不再把两类意图和目标岗位丢弃后盲发同一裸索引事件）。",
      hint: "如需查看职员当前合法管理动作，请先定位该职员引用并调用 get_person_management_actions，或由玩家在游戏内职员合同/岗位界面直接调整。"
    };
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
