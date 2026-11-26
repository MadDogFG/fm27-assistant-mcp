import { createLiveClient, clean } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 杯赛抽签（MGR-R10 / MGR-O13）与增加/移除联赛（MGR-O24a/b）管理工具组
export function createCupDrawAndLeagueTools(call) {
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

  // MGR-R10: 读取当前杯赛抽签状态与速度配置
  async function getCupDrawState() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const ctx = { human: { source: "human" }, Human: { source: "human" } };
      const out = {};
      for (const prop of ["LiveCupDrawAutoDrawIsRunning", "CupDrawSpeed"]) {
        const sub = await scope.subscribeOptional("human", prop, ctx, 1000);
        out[prop] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      }
      return { ok: true, readOnly: true, drawState: out };
    });
  }

  // MGR-O13: 驱动杯赛抽签流程（必须显式指定 action，禁止空参默认 draw_all）
  async function controlCupDraw({ action, operationId } = {}) {
    const eventMap = {
      open: "EventFmxDrawScreenOpened",
      start: "EventFmxStartDraw",
      next_team: "EventFmxDrawNextTeam",
      next_pot: "EventFmxDrawNextPot",
      draw_all: "EventFmxDrawAllTeams",
      pause: "EventFmxPauseDraw",
    };
    const eventName = eventMap[action];
    if (!eventName) throw new Error(`必须明确指定杯赛抽签动作 action（支持 open/start/next_team/next_pot/draw_all/pause）。当前: ${action}`);
    const id = operationId || `cup_draw_${action}_${Date.now()}`;
    const send = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
    );
    return { ok: true, operationId: id, action, eventName, dispatch: send };
  }

  // MGR-O24a/b: 增加/确认/撤销联赛变更（必须显式指定 action，禁止空参默认 confirm）
  async function managePlayableLeagues({ action, leagueId = null, optionPath = null, operationId } = {}) {
    const eventMap = {
      add: "EventFmxAddLeague",
      confirm: "EventFmxConfirmAddRemoveLeagues",
      undo: "EventFmxUndoAddRemoveLeagues",
    };
    const eventName = eventMap[action];
    if (!eventName) throw new Error(`必须明确指定联赛管理动作 action（支持 add/confirm/undo）。当前: ${action}`);
    if (action === "add" && (leagueId === null || leagueId === undefined) && !optionPath) {
      throw new Error("add 动作必须提供 leagueId 或 optionPath。");
    }
    const id = operationId || `league_manage_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const beforeJoin = await scope.subscribeOptional("game", "JoiningRuleGroupsCount", { Gender: 0 }, 800);
      const beforeJoiningCount = beforeJoin.read?.value?.value ?? null;
      let payload = action === "add" ? leagueId : null;
      let targetSource = "game";
      if (action === "add") {
        const divList = await scope.subscribeOptional("game", "PossibleDivisionLevelsToAdd", {}, 1000);
        if (divList.handle) {
          const leaf = optionPath || "0/0x34453354/0/0x34453354/0/0x34453354/0/0x526f7744";
          payload = { $value: { source: divList.handle, path: String(leaf) } };
        } else {
          targetSource = "human";
        }
      } else if (!beforeJoin.handle) {
        targetSource = "human";
      }
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${targetSource}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      await new Promise(r => setTimeout(r, 300));
      const afterJoin = await scope.subscribeOptional("game", "JoiningRuleGroupsCount", { Gender: 0 }, 800);
      const afterJoiningCount = afterJoin.read?.value?.value ?? null;
      return {
        ok: true,
        operationId: id,
        action,
        eventName,
        beforeJoiningCount,
        afterJoiningCount,
        verified: beforeJoiningCount !== null && afterJoiningCount !== null && beforeJoiningCount !== afterJoiningCount,
        dispatch: send,
      };
    });
  }

  return { getCupDrawState, controlCupDraw, managePlayableLeagues };
}
