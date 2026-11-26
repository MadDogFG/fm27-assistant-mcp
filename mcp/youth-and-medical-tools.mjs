import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 青训候选/入队管理（SQU-O16a/b/c/d）与伤病医疗方案读取（SQU-O12a / Review #31/#34）工具组
export function createYouthAndMedicalTools(call) {
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

  // 读取俱乐部青训评估、候选人预览与状态（SQU-O16）
  async function getYouthIntakeOverview() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        club: { source: club.handle }, Club: { source: club.handle },
        team: { source: team.handle }, Team: { source: team.handle },
      };
      const props = [
        "YouthIntakeRating", "YouthIntakeGrade", "YouthIntakeStatus",
        "YouthCandidatesCount", "YouthIntakeDescription", "YouthIntakePositionPreviews",
        "YouthCandidatesPreview", "YouthCandidatesRanked", "YouthIntakeLevel", "YouthIntakeFeedbackString",
      ];
      const out = {};
      for (const name of props) {
        const sub = await scope.subscribeOptional({ source: club.handle }, name, ctx, 900);
        if (sub.handle) {
          out[name] = decodeValue(sub.read?.value ?? null, idMap);
          await scope.release(sub.handle);
        } else {
          const teamSub = await scope.subscribeOptional({ source: team.handle }, name, ctx, 700);
          out[name] = teamSub.handle ? decodeValue(teamSub.read?.value ?? null, idMap) : { unavailable: teamSub.unavailable || sub.unavailable || "no_handle" };
          if (teamSub.handle) await scope.release(teamSub.handle);
        }
      }
      return { ok: true, readOnly: true, youthIntake: out };
    });
  }

  // SQU-O16a/c: 调动或增删青训候选球员（要求显式 playerIndex 与真实候选列表身份校验）
  async function manageYouthCandidate({ playerIndex, expectedCandidateIdentity, add = true, operationId } = {}) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("必须提供有效的非负整数 playerIndex。");
    }
    const id = operationId || `youth_candidate_${add ? "add" : "rem"}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const ctx = { human: { source: "human" }, club: { source: club.handle } };
      const listSub = await scope.subscribeOptional({ source: club.handle }, "AllYouthCandidates", ctx, 1000);
      if (!listSub.handle) {
        return { ok: false, blocked: true, status: "candidates_unavailable", reason: "当前俱乐部未暴露 AllYouthCandidates 青训候选列表，已拒绝盲发索引。", zeroDispatches: true };
      }
      const items = listSub.read?.value?.items || [];
      const count = listSub.read?.value?.count ?? items.length;
      if (playerIndex >= count) {
        throw new Error(`playerIndex 越界: ${playerIndex} >= ${count}`);
      }
      const actualId = items[playerIndex]?.identity || null;
      if (expectedCandidateIdentity && actualId !== expectedCandidateIdentity) {
        return {
          ok: false,
          blocked: true,
          reason: "青训候选列表已变化，目标候选身份与 expectedCandidateIdentity 不匹配，已中止且零派发。",
          expectedCandidateIdentity,
          observedCandidateIdentity: actualId,
          zeroDispatches: true
        };
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxAddRemoveYouthPlayer&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(playerIndex) }
      );
      return { ok: true, operationId: id, playerIndex, candidateIdentity: actualId, add: Boolean(add), dispatch: send };
    });
  }

  // SQU-O12a: 读取指定一线队球员伤病与治疗方案信息
  async function getPlayerInjuryTreatment({ squadIndex = 0 } = {}) {
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const pRef = { source: players.handle, path: String(squadIndex) };
      const out = {};
      for (const prop of ["Name", "IsInjured", "InjuryTreatment", "Condition", "Sharpness"]) {
        const sub = await scope.subscribeOptional(pRef, prop, ctx, 800);
        out[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
        if (sub.handle) await scope.release(sub.handle);
      }
      return {
        ok: true,
        readOnly: true,
        squadIndex,
        playerIdentity: players.read?.value?.items?.[squadIndex]?.identity || null,
        player: out
      };
    });
  }

  // SQU-O12b/c/d / SQU-O13a/b/c (Review #31): 读取球员活跃伤情、分列治疗/康复训练/可参赛独立状态与脑震荡复出警示；
  // 严禁使用硬编码 1/2/3 或任意数值覆盖写入未校验的医疗选项，仅在游戏明确提供合法医疗选项时允许校验后操作，否则安全阻断并零写入
  async function manageInjuryTreatment({ squadIndex = 0, action = "read", operationId } = {}) {
    const validActions = ["read", "specialist", "surgery", "rest", "rehab", "resume_training", "train_while_injured"];
    if (!validActions.includes(action)) {
      throw new Error(`未知伤病治疗/康复动作: ${action}（支持 ${validActions.join("/")}）`);
    }
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const players = await scope.subscribe({ source: team.handle }, "Players", ctx);
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const pRef = { source: players.handle, path: String(squadIndex) };
      const playerIdentity = players.read?.value?.items?.[squadIndex]?.identity || null;
      const [nameR, inj] = await Promise.all([
        scope.readAndRelease(pRef, "Name", ctx, 600),
        scope.subscribeOptional(pRef, "CurrentInjury", ctx, 1000)
      ]);
      if (!inj.handle) {
        return {
          ok: false,
          blocked: true,
          reason: "该球员当前无 CurrentInjury 会话。",
          squadIndex,
          playerIdentity,
          playerName: nameR.scalar || null
        };
      }
      const [isAct, tr, av, descSub, nameSub] = await Promise.all([
        scope.subscribeOptional(inj.handle, "IsActive", ctx, 800),
        scope.subscribeOptional(inj.handle, "InjuryTreatment", ctx, 800),
        scope.subscribeOptional(inj.handle, "InjuryAvailability", ctx, 800),
        scope.subscribeOptional(inj.handle, "Description", ctx, 600),
        scope.subscribeOptional(inj.handle, "Name", ctx, 600)
      ]);
      const activeRaw = scalar(isAct.read?.value);
      const active = activeRaw === "True" ? true : (activeRaw === "False" ? false : null);
      const treatmentVal = tr.handle ? decodeValue(tr.read?.value ?? null, idMap) : { unavailable: tr.unavailable || "no_handle" };
      const availabilityVal = av.handle ? decodeValue(av.read?.value ?? null, idMap) : { unavailable: av.unavailable || "no_handle" };
      const injuryName = stripTags(scalar(nameSub.read?.value) || "");
      const injuryDesc = stripTags(scalar(descSub.read?.value) || "");
      const combinedMedicalText = [injuryName, injuryDesc, JSON.stringify(treatmentVal), JSON.stringify(availabilityVal)].join(" ");
      const isConcussion = /脑震荡|concussion/i.test(combinedMedicalText);

      // 将治疗方案、恢复训练状态、可参赛/脑震荡复出许可严格拆分为三个独立状态字段
      const medicalState = {
        injuryIdentity: inj.read?.value?.identity || null,
        injuryName: injuryName || injuryDesc || null,
        injuryDescription: injuryDesc || null,
        isActive: active,
        isConcussionProtocol: isConcussion,
        treatmentStatus: treatmentVal,
        rehabTrainingStatus: availabilityVal,
        matchClearanceStatus: isConcussion
          ? { status: "requires_medical_concussion_clearance", note: "FM27 脑震荡适用专门复出许可流程，不能从单一 InjuryAvailability 推导已获准复训或出场。" }
          : (active === false ? { status: "no_active_injury" } : { status: "unknown_pending_medical_clearance" })
      };

      if (action === "read") {
        return {
          ok: true,
          readOnly: true,
          squadIndex,
          playerIdentity,
          playerName: nameR.scalar || null,
          ...medicalState,
          injuryTreatment: treatmentVal,
          injuryAvailability: availabilityVal
        };
      }
      if (active !== true) {
        return {
          ok: false,
          blocked: true,
          reason: active === null ? "无法确认该球员伤病活跃状态（IsActive 未知），已中止且零写入。" : "该球员当前没有活跃伤病（IsActive=False）。",
          squadIndex,
          playerIdentity,
          ...medicalState,
          zeroWrites: true
        };
      }

      // Review #31: 绝不使用硬编码数字映射或外部裸数值直接覆写 InjuryTreatment / InjuryAvailability
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        squadIndex,
        playerIdentity,
        playerName: nameR.scalar || null,
        requestedAction: action,
        ...medicalState,
        reason: isConcussion
          ? "检测到脑震荡相关伤情，FM27 要求经过专门医疗复出许可流程；且当前接口未读取到该伤情允许的原生治疗/复训候选项，已拒绝硬编码数值写入。请使用 get_medical_report_options 或在游戏内医疗中心由队医确认。"
          : `当前伤病会话未提供 "${action}" 的原生合法医疗候选列表与完整决定流程，已拒绝使用硬编码数值写入 InjuryTreatment/InjuryAvailability。请先通过 get_medical_report_options 查看队医菜单或在游戏内医疗中心确认。`,
        zeroWrites: true
      };
    });
  }

  // SQU-O16b/d (Review #34): 区分“青训计数未就绪”与“确无候选(0)”，且禁止向原生合同/青训事件发送自组 JSON 对象
  async function offerYouthContractOrTrial({ playerIndex, expectedCandidateIdentity, action = "youth_contract", operationId } = {}) {
    if (!["youth_contract", "pro_contract", "trial"].includes(action)) {
      throw new Error(`未知青训决策动作: ${action}（支持 youth_contract/pro_contract/trial）`);
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("必须提供有效的非负整数 playerIndex。");
    }
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const ctx = { human: { source: "human" }, club: { source: club.handle } };
      const [countSub, listSub] = await Promise.all([
        scope.subscribeOptional({ source: club.handle }, "YouthCandidatesCount", ctx, 800),
        scope.subscribeOptional({ source: club.handle }, "AllYouthCandidates", ctx, 900)
      ]);
      if (!countSub.handle && !listSub.handle) {
        return {
          ok: false,
          blocked: true,
          status: "unavailable",
          reason: "青训候选数据通道（YouthCandidatesCount / AllYouthCandidates）暂未就绪，无法确认候选范围（不等同于无青训候选），已阻断且零派发。",
          playerIndex,
          action,
          zeroDispatches: true
        };
      }
      const items = listSub.read?.value?.items || [];
      const count = countSub.handle ? Number(scalar(countSub.read?.value)) : items.length;
      if (!Number.isFinite(count) || count === 0) {
        return {
          ok: false,
          blocked: true,
          status: "no_youth_candidates",
          reason: "当前俱乐部确无青训候选球员（YouthCandidatesCount=0）。",
          playerIndex,
          action,
          zeroDispatches: true
        };
      }
      if (playerIndex >= count) {
        throw new Error(`playerIndex 越界: ${playerIndex} >= ${count}`);
      }
      const candidateIdentity = items[playerIndex]?.identity || null;
      if (expectedCandidateIdentity && candidateIdentity && candidateIdentity !== expectedCandidateIdentity) {
        return {
          ok: false,
          blocked: true,
          reason: "青训候选列表已变化，目标候选身份与 expectedCandidateIdentity 不符，已阻断且零派发。",
          expectedCandidateIdentity,
          observedCandidateIdentity: candidateIdentity,
          zeroDispatches: true
        };
      }
      // 原实现向 EventFmxProceedToContractNegotiations / EventFmxAddRemoveYouthPlayer 发送了自组对象 { playerIndex, action }，
      // 缺少绑定真实 PersonReference 的草稿入口；引导使用通用人员动作菜单（open_contract_draft / execute_player_action）
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        playerIndex,
        candidateIdentity,
        action,
        reason: "青训合同/试训需绑定具体青训候选人的 PersonReference 原生动作菜单（不可向俱乐部事件发送自组 {playerIndex,action} 载荷）。请先用 get_club_facilities_and_youth 获取候选人引用，再通过 get_player_actions + open_contract_draft 准备合同草稿并交玩家确认。",
        zeroDispatches: true
      };
    });
  }

  return { getYouthIntakeOverview, manageYouthCandidate, getPlayerInjuryTreatment, manageInjuryTreatment, offerYouthContractOrTrial };
}
