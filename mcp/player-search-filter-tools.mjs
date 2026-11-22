import { createLiveClient, scalar } from "./live-client.mjs";

// 保存的球员搜索与过滤器管理（REC-O29a 保存、REC-O29b 重用、REC-O29c 删除/重置）
export function createPlayerSearchFilterTools(call) {
  const client = createLiveClient(call);

  // 只读读取当前球员搜索数据库、原生筛选、分页列表与可选过滤器状态（REC-R01 / REC-O29）
  async function getSearchFilterOptions({ searchType = 1, skip = 0, limit = 10 } = {}) {
    return client.scope(async scope => {
      const manageList = await scope.subscribeOptional("human", "HumanPlayerSearchManageOptionsList");
      const canView = await scope.subscribeOptional("human", "CanViewPlayerSearch");
      const team = await scope.subscribeOptional("human", "Team");
      const ctx = team.handle
        ? { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle }, Type: searchType, type: searchType }
        : { human: { source: "human" }, Human: { source: "human" }, Type: searchType, type: searchType };
      const personSearch = await scope.subscribeOptional("human", "HumanPersonSearch", ctx, 1200);
      let database = null;
      if (personSearch.handle) {
        const [pl, qf, sf, ef, il] = await Promise.all([
          scope.subscribeOptional(personSearch.handle, "PersonList", ctx, 1000),
          scope.subscribeOptional(personSearch.handle, "QuickFilterList", ctx, 800),
          scope.subscribeOptional(personSearch.handle, "SortFields", ctx, 800),
          scope.subscribeOptional(personSearch.handle, "EditFilterString", ctx, 800),
          scope.subscribeOptional(personSearch.handle, "PlayerInterestLevelList", ctx, 800)
        ]);
        const allItems = pl.read?.value?.items || [];
        const totalCount = pl.read?.value?.count ?? allItems.length;
        database = {
          totalCount,
          skip,
          limit,
          items: allItems.slice(skip, skip + limit),
          editFilterString: scalar(ef.read?.value),
          quickFilters: qf.read?.value ?? null,
          sortFields: sf.read?.value ?? null,
          interestLevels: il.read?.value ?? null
        };
      }
      return {
        ok: true,
        readOnly: true,
        canViewPlayerSearch: scalar(canView.read?.value),
        manageOptions: manageList.read?.value ?? null,
        personSearchAvailable: Boolean(personSearch.handle && personSearch.read?.value),
        database
      };
    });
  }

  // 执行保存（save）、重用/载入（load）、重置/清除（reset/delete）过滤条件
  async function managePlayerSearchFilter({
    action = "save",
    scopeKind = "filter",
    name = "",
    operationId
  } = {}) {
    if (!["save", "load", "reset", "delete"].includes(action)) {
      throw new Error(`未知搜索过滤操作: ${action}（支持 save/load/reset/delete）`);
    }
    if (!["filter", "attributes", "conditions"].includes(scopeKind)) {
      throw new Error(`未知过滤范围: ${scopeKind}（支持 filter/attributes/conditions）`);
    }
    if (action === "save" && !String(name).trim()) {
      throw new Error("save 必须提供保存的搜索名称 name。");
    }
    const id = operationId || `search_filter_${action}_${Date.now()}`;
    const trimmedName = String(name || "").trim();

    if (action === "reset" || action === "delete") {
      const eventName = action === "reset" ? "EventFmxSearchReset" : "EventFmxResetFilter";
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmedName || null) }
      );
      return { ok: true, operationId: id, action, eventName, name: trimmedName || null, dispatch };
    }

    const eventMap = {
      save: {
        filter: "EventFmxFilterStoreFilter",
        attributes: "EventFmxFilterStoreAttributes",
        conditions: "EventFmxFilterStoreConditions"
      },
      load: {
        filter: "EventFmxFilterRestoreFilter",
        attributes: "EventFmxFilterRestoreAttributes",
        conditions: "EventFmxFilterRestoreConditions"
      }
    };
    const eventName = eventMap[action][scopeKind];

    // 若为 save，先同步设置搜索名称事件（EventFmxSearchSetName）
    let setNameDispatch = null;
    if (action === "save" && trimmedName) {
      setNameDispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id + "_name")}&event=EventFmxSearchSetName&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmedName) }
      );
    }

    const dispatch = await call(
      `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmedName || null) }
    );
    return {
      ok: true,
      operationId: id,
      action,
      scopeKind,
      name: trimmedName || null,
      eventName,
      setNameDispatch,
      dispatch
    };
  }

  return { getSearchFilterOptions, managePlayerSearchFilter };
}
