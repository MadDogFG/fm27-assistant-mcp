import { createHash } from "node:crypto";
import { createLiveClient, clean } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 阵容规划器读取、采用助教排序与球员移动/移除管理工具组（SQU-O10b/c/d，Review #32）
export function createSquadPlannerTools(call) {
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

  // 计算规划器当前视图（赛季/战术/位置 + 规划器身份 + 计划内容）的稳定令牌，防切方案后误改
  function computePlanToken({ plannerIdentity, squadPlanType, tacticIndex, positionIndex, currentPlanRaw }) {
    return createHash("sha256")
      .update(JSON.stringify({
        plannerIdentity: plannerIdentity || null,
        squadPlanType,
        tacticIndex,
        positionIndex,
        currentPlan: currentPlanRaw ?? null
      }))
      .digest("hex")
      .slice(0, 24);
  }

  async function readSquadPlanner({ squadPlanType = 0, tacticIndex = 0, positionIndex = 0, showAllPositions = false } = {}) {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        SquadPlanType: squadPlanType,
        Judge: 0,
        TacticIndex: tacticIndex,
        PositionIndex: positionIndex,
        ShowAllPositions: showAllPositions,
      };
      const sp = await scope.subscribe("human", "SquadPlanner", ctx);
      const avail = await scope.subscribeOptional({ source: sp.handle }, "Available", ctx, 1000);
      const cp = await scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200);
      const ask = await scope.subscribeOptional({ source: sp.handle }, "AskAssistantDropdown", ctx, 1200);
      const issues = await scope.subscribeOptional({ source: sp.handle }, "OverviewIssuesDetails", ctx, 1000);

      const plannerIdentity = sp.read?.value?.identity || null;
      const planToken = cp.handle
        ? computePlanToken({ plannerIdentity, squadPlanType, tacticIndex, positionIndex, currentPlanRaw: cp.read?.value })
        : null;

      return {
        ok: true,
        readOnly: true,
        context: { squadPlanType, tacticIndex, positionIndex, showAllPositions },
        plannerIdentity,
        planToken,
        available: avail.handle ? decodeValue(avail.read?.value, idMap) : null,
        currentPlan: cp.handle ? decodeValue(cp.read?.value, idMap) : { unavailable: cp.unavailable },
        askAssistantOptions: ask.handle ? decodeValue(ask.read?.value, idMap) : { unavailable: ask.unavailable },
        overviewIssues: issues.handle ? decodeValue(issues.read?.value, idMap) : { unavailable: issues.unavailable },
      };
    });
  }

  async function askAssistant({
    optionValue,
    squadPlanType = 0,
    tacticIndex = 0,
    positionIndex = 0,
    expectedPlanToken,
    operationId
  } = {}) {
    if (!Number.isInteger(optionValue) || optionValue < 0) {
      throw new Error("必须明确提供非负整数 optionValue（取自 get_squad_planner 返回的 askAssistantOptions）。");
    }
    if (!expectedPlanToken || typeof expectedPlanToken !== "string") {
      throw new Error("必须提供 get_squad_planner 返回的 expectedPlanToken，以绑定此前读取的规划方案。");
    }
    const id = operationId || `sp_ask_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        SquadPlanType: squadPlanType, Judge: 0, TacticIndex: tacticIndex, PositionIndex: positionIndex, ShowAllPositions: false,
      };
      const sp = await scope.subscribe("human", "SquadPlanner", ctx);
      const [cp, ask] = await Promise.all([
        scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200),
        scope.subscribeOptional({ source: sp.handle }, "AskAssistantDropdown", ctx, 1200)
      ]);
      if (!cp.handle) {
        return { ok: false, blocked: true, reason: "当前规划器未暴露 CurrentPlan，已中止且零派发。", zeroDispatches: true };
      }
      const liveToken = computePlanToken({
        plannerIdentity: sp.read?.value?.identity || null,
        squadPlanType,
        tacticIndex,
        positionIndex,
        currentPlanRaw: cp.read?.value
      });
      if (liveToken !== expectedPlanToken) {
        return {
          ok: false,
          blocked: true,
          reason: "阵容规划器方案（赛季/战术/位置或成员）已变化，拒绝向新方案发送助教排序。",
          expectedPlanToken,
          currentPlanToken: liveToken,
          zeroDispatches: true
        };
      }
      // 校验 optionValue 是否属于当前游戏暴露的 AskAssistantDropdown 合法选项
      const askItems = ask.read?.value?.items;
      if (Array.isArray(askItems) && askItems.length > 0) {
        const validVals = new Set(askItems.map((it, idx) => Number(it?.fields?.["0x7074766c"]?.value ?? idx)));
        if (!validVals.has(optionValue)) {
          return {
            ok: false,
            blocked: true,
            reason: `optionValue=${optionValue} 不在当前 AskAssistantDropdown 合法选项中（可选：${[...validVals].join(", ")}），已拒绝派发。`,
            zeroDispatches: true
          };
        }
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSquadPlannerAskAssistant&source=${encodeURIComponent(sp.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(optionValue) }
      );
      await new Promise(r => setTimeout(r, 350));
      const cpAfter = await scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200);
      return {
        ok: true,
        operationId: id,
        context: { squadPlanType, tacticIndex, positionIndex },
        optionValue,
        dispatch: send,
        currentPlanAfter: cpAfter.handle ? decodeValue(cpAfter.read?.value, idMap) : null,
      };
    });
  }

  // SQU-O10b / SQU-O10c (Review #32): 强制要求显式 action / playerIndex / expectedPlanToken，严禁空参默认移除第 0 人或退回裸 index
  async function editPlannerPlayer({
    action,
    playerIndex,
    targetPosition,
    squadPlanType = 0,
    tacticIndex = 0,
    positionIndex = 0,
    expectedPlanToken,
    operationId
  } = {}) {
    if (!["move", "remove"].includes(action)) {
      throw new Error(`必须明确指定规划器动作 action（支持 move/remove），严禁省略参数默认移除。当前: ${action}`);
    }
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error("必须提供有效的非负整数 playerIndex。");
    }
    if (action === "move" && (!Number.isInteger(targetPosition) || targetPosition < 0)) {
      throw new Error("move 动作必须提供有效的非负整数 targetPosition。");
    }
    if (!expectedPlanToken || typeof expectedPlanToken !== "string") {
      throw new Error("必须先调用 get_squad_planner 获取并传入 expectedPlanToken，以绑定原规划方案防止误改。");
    }
    const id = operationId || `sp_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        SquadPlanType: squadPlanType, Judge: 0, TacticIndex: tacticIndex, PositionIndex: positionIndex, ShowAllPositions: false,
      };
      const sp = await scope.subscribe("human", "SquadPlanner", ctx);
      const cp = await scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200);
      if (!cp.handle) {
        return {
          ok: false,
          blocked: true,
          reason: "无法读取当前阵容规划 CurrentPlan，严禁退回裸下标发送移除/移动事件，已阻断且零派发。",
          zeroDispatches: true
        };
      }
      const liveToken = computePlanToken({
        plannerIdentity: sp.read?.value?.identity || null,
        squadPlanType,
        tacticIndex,
        positionIndex,
        currentPlanRaw: cp.read?.value
      });
      if (liveToken !== expectedPlanToken) {
        return {
          ok: false,
          blocked: true,
          reason: "阵容规划器方案已变化（可能已切换赛季/战术/位置或成员已变更），已拒绝修改旧方案且零派发。",
          expectedPlanToken,
          currentPlanToken: liveToken,
          zeroDispatches: true
        };
      }
      const playersList = cp.read?.value?.fields?.["0x37372020"]?.items || cp.read?.value?.fields?.["0x506c7973"]?.items || cp.read?.value?.items || null;
      const beforeCount = cp.read?.value?.fields?.["0x37372020"]?.count ?? cp.read?.value?.fields?.["0x506c7973"]?.count ?? cp.read?.value?.count ?? (Array.isArray(playersList) ? playersList.length : null);
      if (beforeCount !== null && playerIndex >= beforeCount) {
        throw new Error(`playerIndex 越界: ${playerIndex} >= ${beforeCount}`);
      }
      const eventName = action === "move" ? "EventFmxSquadPlannerMovePlayer" : "EventFmxSquadPlannerRemovePlayer";
      const payload = action === "move"
        ? { playerIndex, targetPosition }
        : { $value: { source: cp.handle, path: `0x37372020/${playerIndex}` } };
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(sp.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return {
        ok: true,
        operationId: id,
        context: { squadPlanType, tacticIndex, positionIndex },
        action,
        eventName,
        playerIndex,
        beforePlayersCount: beforeCount,
        dispatch: send,
      };
    });
  }

  return { readSquadPlanner, askAssistant, editPlannerPlayer };
}
