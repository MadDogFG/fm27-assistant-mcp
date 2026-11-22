import { createLiveClient, clean } from "./live-client.mjs";

// 数据中心比赛分析报告与 TransferRoom 广告只读工具组（MAT-R24 / MAT-R27 / REC-R07）
export function createDatahubAndTransferRoomTools(call) {
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

  // MAT-R24 / MAT-R27: 读取数据中心近五场分析统计与最近一场详细分析报告
  async function getDatahubAnalysis({ analysisId = 0 } = {}) {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const ctx = {
        human: { source: "human" }, Human: { source: "human" },
        team: { source: team.handle }, Team: { source: team.handle },
        TeamRequestingReport: { source: team.handle },
        ID: analysisId,
      };
      const out = {};
      for (const name of [
        "CanViewDataHub",
        "LastFiveMatchAnalysisProCount",
        "LastFiveMatchAnalysisConCount",
        "DataHubLastMatchFixtureDropdown",
        "LastMatchAnalysis",
      ]) {
        const sub = await scope.subscribeOptional({ source: team.handle }, name, ctx, 1200);
        out[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      }
      return { ok: true, readOnly: true, analysisId, dataHub: out };
    });
  }

  // REC-R07: 读取俱乐部 TransferRoom 已发布广告、应答及被推荐球员列表
  async function getTransferRoomAdverts() {
    const idMap = await getPropertyMap();
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const ctx = { human: { source: "human" }, club: { source: club.handle }, AdvertTransferType: 0 };
      const trSub = await scope.subscribeOptional({ source: club.handle }, "TransferRoom", ctx, 1500);
      if (!trSub.handle) {
        return { ok: true, readOnly: true, available: false, unavailable: trSub.unavailable || "no_transfer_room" };
      }
      const data = {};
      for (const name of [
        "HumanAdvertsTotalCount",
        "HumanAdvertsList",
        "HumanAdvertsResponsesTotalCount",
        "HumanAdvertsResponsesList",
        "TransferRoomOfferedPlayers",
      ]) {
        const sub = await scope.subscribeOptional({ source: trSub.handle }, name, ctx, 1200);
        data[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      }
      return {
        ok: true,
        readOnly: true,
        available: true,
        transferRoomIdentity: trSub.read?.value?.identity || null,
        transferRoom: data,
      };
    });
  }

  // REC-O11a/c: 管理 TransferRoom 招聘广告（选中、撤销、取消或提交非空广告草稿）
  async function manageTransferRoomAdvert({ action = "select", advertIndex = 0, draft = null, operationId } = {}) {
    if (!["select", "delete", "cancel", "confirm"].includes(action)) {
      throw new Error(`未知 TransferRoom 广告动作: ${action}（支持 select/delete/cancel/confirm）`);
    }
    if (action === "confirm" && (!draft || typeof draft !== "object")) {
      throw new Error("为防止原生空草稿崩溃，confirm 必须提供非空有效 draft 对象。");
    }
    const id = operationId || `tr_advert_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const ctx = { human: { source: "human" }, club: { source: club.handle }, AdvertTransferType: 0 };
      const trSub = await scope.subscribeOptional({ source: club.handle }, "TransferRoom", ctx, 1500);
      if (!trSub.handle) throw new Error("当前俱乐部未提供 TransferRoom 对象。");
      const listSub = await scope.subscribeOptional({ source: trSub.handle }, "HumanAdvertsList", ctx, 1000);
      const total = listSub.read?.value?.count ?? 0;
      if ((action === "select" || action === "delete") && (!Number.isInteger(advertIndex) || advertIndex < 0 || advertIndex >= total)) {
        throw new Error(`TransferRoom 广告索引越界: advertIndex=${advertIndex}, total=${total}`);
      }
      const eventMap = {
        select: "EventFmxTransferRoomSelectAdvert",
        delete: "EventFmxTransferRoomDeleteAdvert",
        cancel: "EventFmxTransferRoomAddAdvertCancel",
        confirm: "EventFmxTransferRoomAddAdvertConfirm",
      };
      const eventName = eventMap[action];
      const payload = (action === "select" || action === "delete") ? advertIndex : action === "confirm" ? draft : null;
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(trSub.handle)}&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      return { ok: true, operationId: id, action, eventName, beforeTotal: total, dispatch: send };
    });
  }

  return { getDatahubAnalysis, getTransferRoomAdverts, manageTransferRoomAdvert };
}
