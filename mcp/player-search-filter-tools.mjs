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

// 保存的球员搜索与过滤器管理（REC-O29a 保存、REC-O29b 重用、REC-O29c 删除/重置）+ 多条件数据库搜索
export function createPlayerSearchFilterTools(call) {
  const client = createLiveClient(call);

  // 多条件数据库球员搜索：
  // - 当提供 name 时优先走全库原生 game.Search (FM.UI.SearchReference) + RowData 毫秒级直达全库任意球员；
  // - 未提供 name 时基于 HumanPersonSearch.PersonList 并发扫描与多条件筛选
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
    scanLimit = 150,
    limit = 15
  } = {}) {
    const safeLimit = Math.max(1, Math.min(40, Number(limit) || 15));
    const safeScan = Math.max(1, Math.min(350, Number(scanLimit) || 150));
    const nameQ = cleanText(name).toLowerCase();
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
        const isFreeAgent = !clubSub.handle || clubSub.read?.value?.type === "SI.Bindable.NullReference";
        const pHeight = heightR?.ok ? Number.parseInt(heightR.scalar, 10) : null;

        let pass = Boolean(pName);
        if (pass && posQ && !matchesPosition(pPos, posQ)) pass = false;
        if (pass && Number.isFinite(Number(minAge)) && (!Number.isFinite(pAge) || pAge < Number(minAge))) pass = false;
        if (pass && Number.isFinite(Number(maxAge)) && (!Number.isFinite(pAge) || pAge > Number(maxAge))) pass = false;
        if (pass && natQ && !pNat.toLowerCase().includes(natQ)) pass = false;
        if (pass && freeAgentOnly && !isFreeAgent) pass = false;
        if (pass && Number.isFinite(Number(minHeight)) && (!Number.isFinite(pHeight) || pHeight < Number(minHeight))) pass = false;
        if (pass && Number.isFinite(Number(maxHeight)) && (!Number.isFinite(pHeight) || pHeight > Number(maxHeight))) pass = false;

        let clubName = isFreeAgent ? "自由球员" : null;
        if (pass && !isFreeAgent && clubSub.handle) {
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
          freeAgent: isFreeAgent,
          ...(Number.isFinite(pHeight) ? { heightCm: pHeight } : {})
        };
      }

      // 优先路径：提供姓名关键词时，走 game.Search 全局原生搜索，毫秒级直达全库任意球员
      if (nameQ) {
        const gs = await scope.subscribeOptional("game", "Search", { human: { source: "human" } }, 1200);
        if (gs.handle) {
          const sName = await scope.subscribeOptional(gs.handle, "Name", {}, 800);
          const sList = await scope.subscribeOptional(gs.handle, "PersonList", {}, 800);
          if (sName.handle && sList.handle) {
            await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cleanText(name))
            });
            // 等待游戏搜索引擎返回结果
            let listVal = null;
            for (let attempt = 0; attempt < 6; attempt++) {
              await new Promise(r => setTimeout(r, attempt === 0 ? 450 : 200));
              listVal = (await scope.ready(sList.handle)).value;
              if ((listVal?.count || 0) > 0) break;
            }
            const totalHits = listVal?.count || 0;
            const toInspect = Math.min(totalHits, safeLimit * 2, 40);
            const matched = [];
            for (let i = 0; i < toInspect; i++) {
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
            return {
              ok: true,
              readOnly: true,
              searchMode: "global_database_search",
              totalInDatabase: totalHits,
              scanned: toInspect,
              matchedCount: matched.length,
              returnedCount: players.length,
              filters: {
                name: cleanText(name),
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
          }
        }
      }

      const personSearch = await scope.subscribeOptional("human", "HumanPersonSearch", ctx, 1500);
      if (!personSearch.handle) {
        return { ok: false, error: "当前存档未开放 HumanPersonSearch 球员搜索数据库。" };
      }
      const pl = await scope.subscribeOptional(personSearch.handle, "PersonList", ctx, 1500);
      const totalInDatabase = pl.read?.value?.count ?? (pl.read?.value?.items?.length || 0);
      const toScan = Math.min(totalInDatabase, safeScan);

      const matched = [];
      let scanned = 0;
      const batchSize = 10;

      for (let start = 0; start < toScan; start += batchSize) {
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
        for (const r of batchRows) {
          if (r) matched.push(r);
        }
        // 不要求全局排序时，命中数量足够即可提前终止扫描提速
        if (!needFullScan && matched.length >= safeLimit) break;
      }

      if (sortBy === "age_asc") matched.sort((a, b) => (a.age ?? 99) - (b.age ?? 99));
      else if (sortBy === "age_desc") matched.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
      else if (sortBy === "height_desc") matched.sort((a, b) => (b.heightCm ?? 0) - (a.heightCm ?? 0));

      const players = matched.slice(0, safeLimit);
      return {
        ok: true,
        readOnly: true,
        searchMode: "scouting_pool_scan",
        totalInDatabase,
        scanned,
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

  return { searchPlayers, getSearchFilterOptions, managePlayerSearchFilter };
}
