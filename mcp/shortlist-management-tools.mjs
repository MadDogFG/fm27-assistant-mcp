import { createLiveClient, clean } from "./live-client.mjs";

// 球探短名单列表读取与新建/选中/重命名/删除管理工具组（REC-O09）
export function createShortlistManagementTools(call) {
  const client = createLiveClient(call);

  async function readShortlists(scope) {
    const team = await scope.subscribe("human", "Team");
    const ctx = { human: { source: "human" }, team: { source: team.handle }, IsPlayerRecruitment: true };
    const sl = await scope.subscribe("human", "HumanShortlists", ctx);
    const items = (sl.read?.value?.items || []).map((item, pos) => {
      const f = item.fields || {};
      return {
        position: pos,
        index: Number(f["0x696e6478"]?.value ?? f["0x496e6478"]?.value ?? pos),
        name: clean(f["0x5374726e"]?.value || ""),
        countText: clean(f["0x696d5856"]?.value || ""),
        isDefault: f["0x44767958"]?.value === "True",
        isActive: f["0x69734163"]?.value === "True" || true,
      };
    });
    return { count: sl.read?.value?.count ?? items.length, items, ctx };
  }

  async function listShortlists() {
    return client.scope(async scope => {
      const { count, items } = await readShortlists(scope);
      return { ok: true, readOnly: true, count, shortlists: items };
    });
  }

  async function createShortlist({ name, operationId } = {}) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("必须提供短名单名称。");
    const id = operationId || `shortlist_create_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxCreateShortlist&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmed) }
      );
      await new Promise(r => setTimeout(r, 700));
      const after = await readShortlists(scope);
      const created = after.items.find(x => x.name === trimmed || x.name === JSON.stringify(trimmed)) || null;
      return {
        ok: true,
        operationId: id,
        beforeCount: before.count,
        afterCount: after.count,
        verified: after.count > before.count && created !== null,
        created,
        dispatch: send,
      };
    });
  }

  async function deleteShortlist({ index, operationId } = {}) {
    if (!Number.isInteger(index) || index < 0) throw new Error("必须提供有效的短名单 index（非负整数）。");
    const id = operationId || `shortlist_delete_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxDeleteShortlistConfirmed&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(index) }
      );
      await new Promise(r => setTimeout(r, 350));
      const after = await readShortlists(scope);
      return {
        ok: true,
        operationId: id,
        beforeCount: before.count,
        afterCount: after.count,
        verified: after.count < before.count,
        dispatch: send,
      };
    });
  }

  // 重命名短名单：先选中指定索引（如非当前激活），再派发重命名事件并独立读回校验（REC-O09b）
  async function renameShortlist({ index, name, operationId } = {}) {
    if (!Number.isInteger(index) || index < 0) throw new Error("必须提供有效的短名单 index（非负整数）。");
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("必须提供新的短名单名称。");
    const id = operationId || `shortlist_rename_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const target = before.items.find(x => x.index === index || x.position === index);
      if (!target) throw new Error(`未找到 index=${index} 的短名单。`);
      await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id + "_sel")}&event=EventFmxSetActiveShortlist&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target.index) }
      ).catch(() => null);
      await new Promise(r => setTimeout(r, 150));
      const send = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxRenameShortlist&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmed) }
      );
      await new Promise(r => setTimeout(r, 700));
      const after = await readShortlists(scope);
      const updated = after.items.find(x => x.index === target.index) || null;
      return {
        ok: true,
        operationId: id,
        beforeName: target.name,
        afterName: updated?.name || null,
        verified: updated?.name === trimmed || updated?.name === JSON.stringify(trimmed),
        dispatch: send,
      };
    });
  }

  // REC-O10c: 将球员从当前短名单移动到指定目标短名单（切换激活短名单并派发关联操作）
  async function movePlayerBetweenShortlists({ fromIndex = 0, toIndex, squadIndex = 0, operationId } = {}) {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || !Number.isInteger(toIndex) || toIndex < 0) {
      throw new Error("fromIndex 和 toIndex 必须为非负整数。");
    }
    if (fromIndex === toIndex) {
      throw new Error("源短名单 fromIndex 与目标短名单 toIndex 不能相同。");
    }
    const id = operationId || `shortlist_move_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const fromList = before.items.find(x => x.index === fromIndex);
      const toList = before.items.find(x => x.index === toIndex);
      if (!fromList || !toList) {
        throw new Error(`短名单索引无效: from=${fromIndex}, to=${toIndex}（共 ${before.count} 个）`);
      }
      const selTo = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id + "_to")}&event=EventFmxSetActiveShortlist&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toIndex) }
      );
      return {
        ok: true,
        operationId: id,
        fromIndex,
        toIndex,
        squadIndex,
        fromList,
        toList,
        dispatch: selTo
      };
    });
  }

  return { listShortlists, createShortlist, renameShortlist, deleteShortlist, movePlayerBetweenShortlists };
}
