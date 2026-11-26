import { createLiveClient, clean } from "./live-client.mjs";
import { createPropertyRegistryCache } from "./core/property-registry.mjs";

// 数据中心比赛分析报告与 TransferRoom 广告工具组（MAT-R24 / MAT-R27 / REC-R07 / REC-O11，Review #39/#46）
export function createDatahubAndTransferRoomTools(call) {
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

  function extractAdvertIdentity(item, index) {
    return item?.identity || item?.fields?.["0x69642020"]?.value || `advert_idx:${index}`;
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

  // REC-R07: 读取俱乐部 TransferRoom 已发布广告、应答及被推荐球员列表（附每条广告的稳定身份标识）
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
      let advertIdentities = [];
      for (const name of [
        "HumanAdvertsTotalCount",
        "HumanAdvertsList",
        "HumanAdvertsResponsesTotalCount",
        "HumanAdvertsResponsesList",
        "TransferRoomOfferedPlayers",
      ]) {
        const sub = await scope.subscribeOptional({ source: trSub.handle }, name, ctx, 1200);
        if (name === "HumanAdvertsList" && sub.handle && Array.isArray(sub.read?.value?.items)) {
          advertIdentities = sub.read.value.items.map((it, idx) => ({ index: idx, identity: extractAdvertIdentity(it, idx) }));
        }
        data[name] = sub.handle ? decodeValue(sub.read?.value ?? null, idMap) : { unavailable: sub.unavailable || "no_handle" };
      }
      return {
        ok: true,
        readOnly: true,
        available: true,
        clubIdentity: club.read?.value?.identity || null,
        transferRoomIdentity: trSub.read?.value?.identity || null,
        advertIdentities,
        transferRoom: data,
      };
    });
  }

  // REC-O11a/c (Review #39): 严格校验非空原生草稿与广告/俱乐部身份；禁止空对象 `{}`、缺必填项或错俱乐部/过期广告派发
  async function manageTransferRoomAdvert({
    action,
    advertIndex,
    expectedAdvertIdentity,
    expectedTransferRoomIdentity,
    draft = null,
    operationId
  } = {}) {
    if (!["select", "delete", "cancel", "confirm"].includes(action)) {
      throw new Error(`必须明确指定 TransferRoom 广告动作 action（支持 select/delete/cancel/confirm）。当前: ${action}`);
    }
    if (action === "confirm") {
      if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.keys(draft).length === 0) {
        throw new Error("为防止原生空草稿风险，confirm 必须提供非空有效原生 draft 对象（严禁传入 null、数组或空对象 {}）。");
      }
      // 必须来源于原生 $value/$reference 或包含明确的原生草稿结构字段，禁止伪造空壳对象
      const hasNativeRef = Boolean(draft.$value || draft.$reference);
      const hasNativeFields = Object.keys(draft).some(k => /^0x[0-9a-f]{8}$/i.test(k) || ["position", "transferType", "budget", "ageRange", "advertType"].includes(k));
      if (!hasNativeRef && !hasNativeFields) {
        throw new Error("confirm 的 draft 缺少原生草稿引用（$value/$reference）或必需业务字段，已拦截且零派发。");
      }
      if (!expectedTransferRoomIdentity || typeof expectedTransferRoomIdentity !== "string") {
        throw new Error("confirm 必须提供 get_transfer_room_adverts 返回的 expectedTransferRoomIdentity，以防错俱乐部或过期会话提交。");
      }
    }
    if (action === "select" || action === "delete") {
      if (!Number.isInteger(advertIndex) || advertIndex < 0) {
        throw new Error(`${action} 必须提供有效的非负整数 advertIndex。`);
      }
      if (action === "delete" && (!expectedAdvertIdentity || typeof expectedAdvertIdentity !== "string")) {
        throw new Error("删除 TransferRoom 广告必须提供 get_transfer_room_adverts 返回的 expectedAdvertIdentity，防止列表变化后误删他项。");
      }
    }

    const id = operationId || `tr_advert_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const ctx = { human: { source: "human" }, club: { source: club.handle }, AdvertTransferType: 0 };
      const trSub = await scope.subscribeOptional({ source: club.handle }, "TransferRoom", ctx, 1500);
      if (!trSub.handle) throw new Error("当前俱乐部未提供 TransferRoom 对象。");
      const liveTrIdentity = trSub.read?.value?.identity || null;
      if (expectedTransferRoomIdentity && liveTrIdentity !== expectedTransferRoomIdentity) {
        return {
          ok: false,
          blocked: true,
          reason: "TransferRoom 会话或所属俱乐部身份已变化，已拒绝提交且零派发。",
          expectedTransferRoomIdentity,
          observedTransferRoomIdentity: liveTrIdentity,
          zeroDispatches: true
        };
      }
      const listSub = await scope.subscribeOptional({ source: trSub.handle }, "HumanAdvertsList", ctx, 1000);
      const items = listSub.read?.value?.items || [];
      const total = listSub.read?.value?.count ?? items.length;
      if (action === "select" || action === "delete") {
        if (advertIndex >= total) {
          throw new Error(`TransferRoom 广告索引越界: advertIndex=${advertIndex}, total=${total}`);
        }
        const observedId = extractAdvertIdentity(items[advertIndex], advertIndex);
        if (expectedAdvertIdentity && observedId !== expectedAdvertIdentity) {
          return {
            ok: false,
            blocked: true,
            reason: "TransferRoom 广告列表已变化，目标下标身份与 expectedAdvertIdentity 不符，已中止且零派发。",
            expectedAdvertIdentity,
            observedAdvertIdentity: observedId,
            zeroDispatches: true
          };
        }
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
      return {
        ok: true,
        operationId: id,
        action,
        eventName,
        transferRoomIdentity: liveTrIdentity,
        beforeTotal: total,
        dispatch: send
      };
    });
  }

  return { getDatahubAnalysis, getTransferRoomAdverts, manageTransferRoomAdvert };
}
