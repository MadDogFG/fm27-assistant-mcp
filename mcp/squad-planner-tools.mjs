import { createLiveClient, clean } from "./live-client.mjs";

// 阵容规划器读取与采用助教排序管理工具组（SQU-O10d）
export function createSquadPlannerTools(call) {
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

      return {
        ok: true,
        readOnly: true,
        plannerIdentity: sp.read?.value?.identity || null,
        available: avail.handle ? decodeValue(avail.read?.value, idMap) : null,
        currentPlan: cp.handle ? decodeValue(cp.read?.value, idMap) : { unavailable: cp.unavailable },
        askAssistantOptions: ask.handle ? decodeValue(ask.read?.value, idMap) : { unavailable: ask.unavailable },
        overviewIssues: issues.handle ? decodeValue(issues.read?.value, idMap) : { unavailable: issues.unavailable },
      };
    });
  }

  async function askAssistant({ optionValue = 3, operationId } = {}) {
    if (!Number.isInteger(optionValue) || optionValue < 0 || optionValue > 3) {
      throw new Error("optionValue 必须为 0~3 之间的整数。");
    }
    const id = operationId || `sp_ask_${Date.now()}`;
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, team: { source: team.handle },
        SquadPlanType: 0, Judge: 0, TacticIndex: 0, PositionIndex: 0, ShowAllPositions: false,
      };
      const sp = await scope.subscribe("human", "SquadPlanner", ctx);
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSquadPlannerAskAssistant&source=${encodeURIComponent(sp.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(optionValue) }
      );
      await new Promise(r => setTimeout(r, 350));
      const cpAfter = await scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200);
      return {
        ok: true,
        operationId: id,
        optionValue,
        dispatch: send,
        currentPlanAfter: cpAfter.handle ? decodeValue(cpAfter.read?.value, idMap) : null,
      };
    });
  }

  // SQU-O10b / SQU-O10c: 在阵容规划器中移动或移除球员
  async function editPlannerPlayer({ action = "remove", playerIndex = 0, targetPosition = 0, squadPlanType = 0, tacticIndex = 0, operationId } = {}) {
    if (!["move", "remove"].includes(action)) throw new Error(`未知规划器动作: ${action}（支持 move/remove）`);
    if (!Number.isInteger(playerIndex) || playerIndex < 0) throw new Error("playerIndex 必须为非负整数。");
    const id = operationId || `sp_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, team: { source: team.handle },
        SquadPlanType: squadPlanType, Judge: 0, TacticIndex: tacticIndex, PositionIndex: 0, ShowAllPositions: false,
      };
      const sp = await scope.subscribe("human", "SquadPlanner", ctx);
      const cp = await scope.subscribeOptional({ source: sp.handle }, "CurrentPlan", ctx, 1200);
      const eventName = action === "move" ? "EventFmxSquadPlannerMovePlayer" : "EventFmxSquadPlannerRemovePlayer";
      const payload = action === "move"
        ? { playerIndex, targetPosition }
        : (cp.handle ? { $value: { source: cp.handle, path: `0x37372020/${playerIndex}` } } : playerIndex);
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(sp.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return {
        ok: true,
        operationId: id,
        action,
        eventName,
        beforePlayersCount: cp.handle ? (cp.read?.value?.fields?.["0x506c7973"]?.count ?? cp.read?.value?.count ?? null) : null,
        dispatch: send,
      };
    });
  }

  return { readSquadPlanner, askAssistant, editPlannerPlayer };
}
