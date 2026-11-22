import { createLiveClient, clean } from "./live-client.mjs";

// 青训候选/入队管理（SQU-O16a/b/c/d）与伤病医疗方案读取（SQU-O12a）工具组
export function createYouthAndMedicalTools(call) {
  const client = createLiveClient(call);
  let cachedIdMap = null;

  async function getPropertyMap() {
    if (cachedIdMap) return cachedIdMap;
    try {
      const reg = await call("/api/v1/internal/registry?kind=properties");
      cachedIdMap = new Map((reg?.items || []).map(x => [x.id, x.name]));
    } catch {
      cachedIdMap = new Map();
    }
    return cachedIdMap;
  }

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
        } else {
          const teamSub = await scope.subscribeOptional({ source: team.handle }, name, ctx, 700);
          out[name] = teamSub.handle ? decodeValue(teamSub.read?.value ?? null, idMap) : { unavailable: teamSub.unavailable || sub.unavailable || "no_handle" };
        }
      }
      return { ok: true, readOnly: true, youthIntake: out };
    });
  }

  // SQU-O16a/c: 调动或增删青训候选球员（EventFmxAddRemoveYouthPlayer）
  async function manageYouthCandidate({ playerIndex = 0, add = true, operationId } = {}) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("playerIndex 必须为非负整数。");
    }
    const id = operationId || `youth_candidate_${add ? "add" : "rem"}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxAddRemoveYouthPlayer&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(playerIndex) }
      );
      return { ok: true, operationId: id, playerIndex, add: Boolean(add), dispatch: send };
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
      }
      return { ok: true, readOnly: true, squadIndex, player: out };
    });
  }

  // SQU-O12b/c/d / SQU-O13a/b/c: 执行伤病治疗决策（寻求专家/手术/休养）与康复训练控制（安排康复/恢复训练/带伤训练）
  async function manageInjuryTreatment({ squadIndex = 0, action = "read", optionValue, operationId } = {}) {
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
      const inj = await scope.subscribeOptional(pRef, "CurrentInjury", ctx, 1000);
      if (!inj.handle) {
        return { ok: false, blocked: true, reason: "该球员当前无 CurrentInjury 会话。", squadIndex };
      }
      const [isAct, tr, av] = await Promise.all([
        scope.subscribeOptional(inj.handle, "IsActive", ctx, 800),
        scope.subscribeOptional(inj.handle, "InjuryTreatment", ctx, 800),
        scope.subscribeOptional(inj.handle, "InjuryAvailability", ctx, 800)
      ]);
      const active = isAct.read?.value?.value === "True";
      if (action === "read") {
        return {
          ok: true,
          readOnly: true,
          squadIndex,
          isActive: active,
          injuryTreatment: decodeValue(tr.read?.value ?? null, idMap),
          injuryAvailability: decodeValue(av.read?.value ?? null, idMap)
        };
      }
      if (!active) {
        return { ok: false, blocked: true, reason: "该球员当前没有活跃伤病（IsActive=False）。", squadIndex };
      }
      const isRehabOrTrain = ["rehab", "resume_training", "train_while_injured"].includes(action);
      const targetSub = isRehabOrTrain ? av : tr;
      if (!targetSub.handle) {
        return { ok: false, blocked: true, reason: `CurrentInjury 未暴露 ${isRehabOrTrain ? "InjuryAvailability" : "InjuryTreatment"} 属性。` };
      }
      const defaultMap = { specialist: 1, surgery: 2, rest: 0, rehab: 1, resume_training: 2, train_while_injured: 3 };
      const val = optionValue !== undefined ? optionValue : defaultMap[action];
      const upd = await call(
        `/api/v1/internal/update?handle=${encodeURIComponent(targetSub.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) }
      );
      await new Promise(r => setTimeout(r, 150));
      const afterSub = await scope.subscribeOptional(inj.handle, isRehabOrTrain ? "InjuryAvailability" : "InjuryTreatment", ctx, 800);
      return {
        ok: true,
        operationId: operationId || `injury_${action}_${Date.now()}`,
        action,
        squadIndex,
        requestedValue: val,
        update: upd,
        afterValue: decodeValue(afterSub.read?.value ?? null, idMap)
      };
    });
  }

  // SQU-O16b/d: 为青训候选球员提供青年/职业合同或安排青训试训
  async function offerYouthContractOrTrial({ playerIndex = 0, action = "youth_contract", operationId } = {}) {
    if (!["youth_contract", "pro_contract", "trial"].includes(action)) {
      throw new Error(`未知青训决策动作: ${action}（支持 youth_contract/pro_contract/trial）`);
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("playerIndex 必须为非负整数。");
    }
    const id = operationId || `youth_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const countSub = await scope.subscribeOptional({ source: club.handle }, "YouthCandidatesCount", { human: { source: "human" }, club: { source: club.handle } }, 800);
      const count = Number(countSub.read?.value?.value ?? 0);
      if (count === 0) {
        return { ok: false, blocked: true, reason: "当前俱乐部没有青训候选球员（YouthCandidatesCount=0）。", playerIndex, action };
      }
      if (playerIndex >= count) {
        throw new Error(`playerIndex 越界: ${playerIndex} >= ${count}`);
      }
      const eventName = action === "trial" ? "EventFmxAddRemoveYouthPlayer" : "EventFmxProceedToContractNegotiations";
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(club.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerIndex, action }) }
      );
      return { ok: true, operationId: id, playerIndex, action, eventName, dispatch: send };
    });
  }

  return { getYouthIntakeOverview, manageYouthCandidate, getPlayerInjuryTreatment, manageInjuryTreatment, offerYouthContractOrTrial };
}
