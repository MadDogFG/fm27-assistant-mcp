import { createLiveClient, scalar, clean } from "./live-client.mjs";

// 清理 FM 原生富文本超链接标记与零宽字符
const cleanText = v => clean(v).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

// 位置中英文同义词映射表，支持模糊过滤
const POSITION_SYNONYMS = {
  gk: ["门将", "守门员", "gk"],
  dc: ["中卫", "后卫 (中)", "后卫(中)", "中后卫", "dc", "cb"],
  cb: ["中卫", "后卫 (中)", "后卫(中)", "中后卫", "dc", "cb"],
  dl: ["左后卫", "后卫 (左)", "后卫(左)", "边后卫 (左)", "dl", "lb"],
  dr: ["右后卫", "后卫 (右)", "后卫(右)", "边后卫 (右)", "dr", "rb"],
  def: ["后卫", "边后卫", "中卫", "def", "cb", "lb", "rb", "wb"],
  wb: ["边后卫", "翼卫", "wb"],
  dm: ["后腰", "防守型中场", "dm", "cdm"],
  mc: ["中场 (中)", "中场(中)", "中前卫", "中场", "mc", "cm"],
  mid: ["中场", "后腰", "前腰", "mid"],
  am: ["前腰", "进攻型中场", "am", "cam"],
  aml: ["左边锋", "进攻型中场 (左)", "边锋 (左)", "aml", "lw"],
  amr: ["右边锋", "进攻型中场 (右)", "边锋 (右)", "amr", "rw"],
  winger: ["边锋", "进攻型中场 (左)", "进攻型中场 (右)", "中场 (左)", "中场 (右)", "winger", "lw", "rw"],
  st: ["前锋", "中锋", "射手", "st", "cf", "fw"]
};

function matchesPosition(posText, query) {
  if (!query) return true;
  const normalizedPos = cleanText(posText).toLowerCase();
  const q = cleanText(query).toLowerCase();
  if (normalizedPos.includes(q)) return true;
  const syns = POSITION_SYNONYMS[q];
  if (syns) return syns.some(s => normalizedPos.includes(s.toLowerCase()));
  return false;
}

// 生成结果列表头部签名，用于判定全局搜索是否真正完成了新查询刷新（Review #37）
function searchListSignature(listVal) {
  const count = listVal?.count ?? listVal?.items?.length ?? 0;
  const headIds = (listVal?.items || []).slice(0, 5).map(it => it?.identity || "").join(",");
  return `${count}|${headIds}`;
}

// 保存的球员搜索与过滤器管理（REC-O29a/b/c）+ 多条件数据库搜索（Review #37）
export function createPlayerSearchFilterTools(call) {
  const client = createLiveClient(call);

  // 多条件数据库球员搜索：
  // - 提供 name 时通过 game.Search 检索，执行前后保护并还原玩家原有搜索词（若玩家中途改词则绝不覆盖），严格校验结果已刷新，支持 offset 续查
  // - 未提供 name 时基于 HumanPersonSearch.PersonList 并发扫描与多条件筛选，支持 offset 续查
  async function searchPlayers({
    searchType = 1,
    name = "",
    position = "",
    minAge,
    maxAge,
    nationality = "",
    club = "",
    freeAgentOnly = false,
    minHeight,
    maxHeight,
    sortBy = "default",
    offset = 0,
    scanLimit = 150,
    limit = 15
  } = {}) {
    const safeLimit = Math.max(1, Math.min(40, Number(limit) || 15));
    const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);
    const safeScan = Math.max(1, Math.min(350, Number(scanLimit) || 150));
    const nameRaw = cleanText(name);
    const nameQ = nameRaw.toLowerCase();
    const posQ = cleanText(position);
    const natQ = cleanText(nationality).toLowerCase();
    const clubQ = cleanText(club).toLowerCase();
    const needHeight = Number.isFinite(Number(minHeight)) || Number.isFinite(Number(maxHeight)) || sortBy === "height_desc";
    const needFullScan = sortBy !== "default";

    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team");
      const ctx = team.handle
        ? { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle }, Type: searchType, type: searchType }
        : { human: { source: "human" }, Human: { source: "human" }, Type: searchType, type: searchType };

      // 通用单人资料解析与多条件过滤辅助函数
      async function inspectAndFilter(pRef, searchIndex, extraMeta = {}) {
        const pCtx = { ...ctx, Person: pRef };
        const tasks = [
          scope.readAndRelease(pRef, "Name", pCtx, 600),
          scope.readAndRelease(pRef, "Age", pCtx, 600),
          scope.readAndRelease(pRef, "BestPositionShortString", pCtx, 600),
          scope.readAndRelease(pRef, "NationalityText", pCtx, 600),
          scope.subscribeOptional(pRef, "Club", pCtx, 600)
        ];
        if (needHeight) tasks.push(scope.readAndRelease(pRef, "Height", pCtx, 600));
        const res = await Promise.all(tasks);
        const [nameR, ageR, posR, natR, clubSub] = res;
        const heightR = needHeight ? res[5] : null;

        const pName = cleanText(nameR.scalar || "");
        const pAge = Number.parseInt(ageR.scalar, 10);
        const pPos = cleanText(posR.scalar || "");
        const pNat = cleanText(natR.scalar || "");
        // 仅当 Club 订阅明确返回 SI.Bindable.NullReference 时才认定为自由球员；订阅未就绪记为未知（null）
        const clubResolved = Boolean(clubSub.handle && clubSub.read?.value !== null && clubSub.read?.value !== undefined);
        const isExplicitFreeAgent = clubResolved && clubSub.read.value.type === "SI.Bindable.NullReference";
        const freeAgent = isExplicitFreeAgent ? true : (clubResolved ? false : null);
        const clubStatus = isExplicitFreeAgent ? "free_agent" : (clubResolved ? "contracted" : "unavailable");
        const pHeight = heightR?.ok ? Number.parseInt(heightR.scalar, 10) : null;

        let pass = Boolean(pName);
        if (pass && posQ && !matchesPosition(pPos, posQ)) pass = false;
        if (pass && Number.isFinite(Number(minAge)) && (!Number.isFinite(pAge) || pAge < Number(minAge))) pass = false;
        if (pass && Number.isFinite(Number(maxAge)) && (!Number.isFinite(pAge) || pAge > Number(maxAge))) pass = false;
        if (pass && natQ && !pNat.toLowerCase().includes(natQ)) pass = false;
        if (pass && freeAgentOnly && freeAgent !== true) pass = false;
        if (pass && Number.isFinite(Number(minHeight)) && (!Number.isFinite(pHeight) || pHeight < Number(minHeight))) pass = false;
        if (pass && Number.isFinite(Number(maxHeight)) && (!Number.isFinite(pHeight) || pHeight > Number(maxHeight))) pass = false;

        let clubName = isExplicitFreeAgent ? "自由球员" : null;
        if (pass && clubResolved && !isExplicitFreeAgent && clubSub.handle) {
          const cn = await scope.readAndRelease(clubSub.handle, "Name", pCtx, 500);
          clubName = cleanText(cn.scalar || "") || "有约在身";
        }
        if (clubSub.handle) await scope.release(clubSub.handle).catch(() => {});

        if (pass && clubQ && !(clubName || "").toLowerCase().includes(clubQ)) pass = false;
        if (!pass) return null;

        return {
          searchIndex,
          ...extraMeta,
          name: pName,
          age: Number.isFinite(pAge) ? pAge : null,
          position: pPos || null,
          nationality: pNat || null,
          club: clubName,
          clubStatus,
          freeAgent,
          ...(Number.isFinite(pHeight) ? { heightCm: pHeight } : {})
        };
      }

      // 优先路径：提供姓名关键词时，走 game.Search 全局原生搜索（Review #37：防污染玩家搜索词 + 防旧结果冒充 + 真实 scanned 与续查）
      if (nameQ) {
        const gs = await scope.subscribeOptional("game", "Search", { human: { source: "human" } }, 1200);
        if (gs.handle) {
          const sName = await scope.subscribeOptional(gs.handle, "Name", {}, 800);
          const sList = await scope.subscribeOptional(gs.handle, "PersonList", {}, 800);
          if (sName.handle && sList.handle) {
            const sDone = await scope.subscribeOptional(gs.handle, "SearchIsFinished", {}, 600);
            const beforeSearchName = cleanText(scalar(sName.read?.value) ?? "");
            const beforeListSig = searchListSignature((await scope.ready(sList.handle)).value);
            const sameQueryAsBefore = beforeSearchName.toLowerCase() === nameQ;
            let searchRestoreStatus = { status: "not_needed" };
            let wroteSearchName = false;

            try {
              if (!sameQueryAsBefore) {
                await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(nameRaw)
                });
                wroteSearchName = true;
              }

              // 严格等待游戏搜索完成并确认结果已刷新（列表签名变化或原本即相同查询词且 SearchIsFinished=True）
              let listVal = null;
              let searchRefreshed = sameQueryAsBefore;
              let interruptedByPlayer = false;
              let observedPlayerQuery = null;

              for (let attempt = 0; attempt < 8; attempt++) {
                await new Promise(r => setTimeout(r, attempt === 0 ? (sameQueryAsBefore ? 50 : 350) : 180));
                const curNameVal = cleanText(scalar((await scope.ready(sName.handle, undefined, 800)).value) ?? "");
                if (curNameVal.toLowerCase() !== nameQ) {
                  interruptedByPlayer = true;
                  observedPlayerQuery = curNameVal;
                  break;
                }
                listVal = (await scope.ready(sList.handle, undefined, 1000)).value;
                const doneVal = sDone.handle ? String(scalar((await scope.ready(sDone.handle, undefined, 800)).value) ?? "") : "True";
                const curSig = searchListSignature(listVal);
                const sigChanged = curSig !== beforeListSig;
                if (doneVal.toLowerCase() === "true" && (sameQueryAsBefore || sigChanged || (listVal?.count === 0 && attempt >= 1))) {
                  searchRefreshed = true;
                  break;
                }
              }

              if (interruptedByPlayer) {
                return {
                  ok: false,
                  status: "search_interrupted_by_player",
                  requestedName: nameRaw,
                  observedSearchName: observedPlayerQuery,
                  error: `搜索期间游戏搜索框关键词已被修改为 "${observedPlayerQuery}"，已中止并保留玩家当前搜索。`
                };
              }
              if (!searchRefreshed) {
                return {
                  ok: false,
                  status: "search_not_ready",
                  requestedName: nameRaw,
                  error: `全局搜索 "${nameRaw}" 未确认刷新完成（结果列表仍与旧搜索完全一致或未结束），已拒绝将旧结果冒充为本次命中。`
                };
              }

              const totalHits = listVal?.count ?? (listVal?.items?.length || 0);
              const scanStart = Math.min(totalHits, safeOffset);
              const maxToInspect = Math.min(totalHits, scanStart + Math.min(safeScan, Math.max(safeLimit * 2, 40)));
              const matched = [];
              let actualScanned = 0;
              let lastInspectedIndex = scanStart;

              for (let i = scanStart; i < maxToInspect; i++) {
                // 检查玩家是否在中途修改了搜索框
                if (i > scanStart && (i - scanStart) % 10 === 0) {
                  const midName = cleanText(scalar((await scope.ready(sName.handle, undefined, 600)).value) ?? "");
                  if (midName.toLowerCase() !== nameQ) {
                    return {
                      ok: false,
                      status: "search_interrupted_by_player",
                      requestedName: nameRaw,
                      observedSearchName: midName,
                      error: `扫描期间搜索框已被玩家改为 "${midName}"，已停止并返回失败以防混入新搜索结果。`
                    };
                  }
                }
                actualScanned++;
                lastInspectedIndex = i + 1;
                const rowSub = await scope.subscribeOptional({ source: sList.handle, path: String(i) }, "RowData", ctx, 700);
                if (!rowSub.handle || rowSub.read?.value?.type !== "FM.UI.PersonReference") {
                  if (rowSub.handle) await scope.release(rowSub.handle).catch(() => {});
                  continue;
                }
                const descR = await scope.readAndRelease({ source: sList.handle, path: String(i) }, "Description", {}, 400);
                const row = await inspectAndFilter(
                  { source: rowSub.handle },
                  i,
                  {
                    personIdentity: rowSub.read?.value?.identity || null,
                    summary: cleanText(descR.scalar || "") || null
                  }
                );
                await scope.release(rowSub.handle).catch(() => {});
                if (row) matched.push(row);
                if (!needFullScan && matched.length >= safeLimit) break;
              }

              if (sortBy === "age_asc") matched.sort((a, b) => (a.age ?? 99) - (b.age ?? 99));
              else if (sortBy === "age_desc") matched.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
              else if (sortBy === "height_desc") matched.sort((a, b) => (b.heightCm ?? 0) - (a.heightCm ?? 0));
              const players = matched.slice(0, safeLimit);
              const partialScan = lastInspectedIndex < totalHits;

              // 读取结束后在 return 前先恢复原搜索词，以便把恢复状态写入响应
              if (wroteSearchName) {
                try {
                  const currentNameNow = cleanText(scalar((await scope.ready(sName.handle, undefined, 600)).value) ?? "");
                  if (currentNameNow.toLowerCase() !== nameQ) {
                    searchRestoreStatus = { status: "preserved_player_search", currentSearchName: currentNameNow };
                  } else {
                    await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(beforeSearchName)
                    });
                    wroteSearchName = false;
                    searchRestoreStatus = { status: "restored", restoredSearchName: beforeSearchName };
                  }
                } catch (restoreErr) {
                  searchRestoreStatus = { status: "restore_failed", error: String(restoreErr?.message || restoreErr) };
                }
              }

              return {
                ok: true,
                readOnly: true,
                searchMode: "global_database_search",
                totalInDatabase: totalHits,
                scanStart,
                scanned: actualScanned,
                partialScan,
                nextOffset: partialScan ? lastInspectedIndex : null,
                matchedCount: matched.length,
                returnedCount: players.length,
                searchBoxRestore: searchRestoreStatus,
                filters: {
                  name: nameRaw,
                  position: posQ || null,
                  minAge: minAge ?? null,
                  maxAge: maxAge ?? null,
                  nationality: natQ || null,
                  club: clubQ || null,
                  freeAgentOnly: Boolean(freeAgentOnly),
                  minHeight: minHeight ?? null,
                  maxHeight: maxHeight ?? null,
                  sortBy
                },
                players
              };
            } finally {
              if (wroteSearchName) {
                try {
                  const cur = cleanText(scalar((await scope.ready(sName.handle, undefined, 500)).value) ?? "");
                  if (cur.toLowerCase() === nameQ) {
                    await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(beforeSearchName)
                    });
                  }
                } catch {}
              }
              if (sDone.handle) await scope.release(sDone.handle).catch(() => {});
            }
          }
        }
      }

      const personSearch = await scope.subscribeOptional("human", "HumanPersonSearch", ctx, 1500);
      if (!personSearch.handle) {
        return { ok: false, error: "当前存档未开放 HumanPersonSearch 球员搜索数据库。" };
      }
      const pl = await scope.subscribeOptional(personSearch.handle, "PersonList", ctx, 1500);
      const totalInDatabase = pl.read?.value?.count ?? (pl.read?.value?.items?.length || 0);
      const scanStart = Math.min(totalInDatabase, safeOffset);
      const toScan = Math.min(totalInDatabase, scanStart + safeScan);

      const matched = [];
      let scanned = 0;
      let lastScanned = scanStart;
      const batchSize = 10;

      for (let start = scanStart; start < toScan; start += batchSize) {
        const end = Math.min(toScan, start + batchSize);
        const batchIndices = [];
        for (let i = start; i < end; i++) batchIndices.push(i);

        const batchRows = await Promise.all(batchIndices.map(async idx => {
          const pRef = { source: pl.handle, path: String(idx) };
          const row = await inspectAndFilter(pRef, idx, { personIdentity: pl.read?.value?.items?.[idx]?.identity || null });
          if (row && nameQ && !row.name.toLowerCase().includes(nameQ)) return null;
          return row;
        }));

        scanned += batchIndices.length;
        lastScanned = end;
        for (const r of batchRows) {
          if (r) matched.push(r);
        }
        if (!needFullScan && matched.length >= safeLimit) break;
      }

      if (sortBy === "age_asc") matched.sort((a, b) => (a.age ?? 99) - (b.age ?? 99));
      else if (sortBy === "age_desc") matched.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
      else if (sortBy === "height_desc") matched.sort((a, b) => (b.heightCm ?? 0) - (a.heightCm ?? 0));

      const players = matched.slice(0, safeLimit);
      const partialScan = lastScanned < totalInDatabase;
      return {
        ok: true,
        readOnly: true,
        searchMode: "scouting_pool_scan",
        totalInDatabase,
        scanStart,
        scanned,
        partialScan,
        nextOffset: partialScan ? lastScanned : null,
        matchedCount: matched.length,
        returnedCount: players.length,
        filters: {
          name: nameQ || null,
          position: posQ || null,
          minAge: minAge ?? null,
          maxAge: maxAge ?? null,
          nationality: natQ || null,
          club: clubQ || null,
          freeAgentOnly: Boolean(freeAgentOnly),
          minHeight: minHeight ?? null,
          maxHeight: maxHeight ?? null,
          sortBy
        },
        players
      };
    });
  }

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

  return { searchPlayers, getSearchFilterOptions, managePlayerSearchFilter };
}
