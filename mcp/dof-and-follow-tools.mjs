import { createLiveClient } from "./live-client.mjs";

// 关注球员（MGR-O23b）与总监转会目标组管理工具组
export function createDofAndFollowTools(call) {
  const client = createLiveClient(call);

  // MGR-O23b: 关注/收藏指定球员（EventFmxAddPlayerToFavourite）
  async function followPlayer({ squadIndex = 0, operationId } = {}) {
    if (!Number.isInteger(squadIndex) || squadIndex < 0) {
      throw new Error("squadIndex 必须为非负整数。");
    }
    const id = operationId || `follow_player_${Date.now()}`;
    return client.scope(async scope => {
      // 获取球队及一线队球员列表上下文（使用中文注释）
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" };
      const players = await scope.subscribe(team.handle, "Players", { human, Human: human });
      const count = players.read?.value?.count ?? 0;
      if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxAddPlayerToFavourite&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ $value: { source: players.handle, path: String(squadIndex) } }) }
      );
      return { ok: true, operationId: id, squadIndex, eventName: "EventFmxAddPlayerToFavourite", dispatch: send };
    });
  }

  // 总监转会目标组管理（创建/改名/删除目标组）
  async function manageDofTargetGroup({ action = "create", name = "", groupIndex = 0, operationId } = {}) {
    const eventMap = {
      create: "EventFmxCreateDofTargetGroup",
      rename: "EventFmxRenameDofTargetGroup",
      delete: "EventFmxDeleteDofTargetGroup",
    };
    const eventName = eventMap[action];
    if (!eventName) throw new Error(`未知目标组动作: ${action}（支持 create/rename/delete）`);
    if ((action === "create" || action === "rename") && !String(name).trim()) {
      throw new Error(`${action} 必须提供目标组名称 name。`);
    }
    const id = operationId || `dof_group_${action}_${Date.now()}`;
    const payload = action === "delete" ? groupIndex : String(name).trim();
    const send = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    return { ok: true, operationId: id, action, eventName, dispatch: send };
  }

  return { followPlayer, manageDofTargetGroup };
}
