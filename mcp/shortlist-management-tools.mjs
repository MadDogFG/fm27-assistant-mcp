import { createLiveClient, scalar, clean } from "./live-client.mjs";

const stripRichText = v => clean(v).replace(/\u0001[^\u0002]*\u0002/g, "").replace(/\u0001/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

// 球探短名单列表读取、新建/重命名/删除以及外部球员加入/移出候选名单工具组（REC-O09 / REC-O10）
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
        isActive: f["0x69734163"]?.value === "True",
      };
    });
    return { count: sl.read?.value?.count ?? items.length, items, ctx, team };
  }

  // 从 "7 名球员" / "2 players" 等文本中提取人数，提取不到返回 null
  function parseShortlistCount(countText) {
    const m = String(countText || "").match(/(\d+)/);
    return m ? Number.parseInt(m[1], 10) : null;
  }

  // 静默切换游戏当前激活短名单，并等待 HumanPersonSearch(Type=0) 刷新
  async function setActiveShortlist(index, opPrefix) {
    return call(
      `/api/v1/internal/event?id=${encodeURIComponent(`${opPrefix}_${index}_${Date.now()}`)}&event=EventFmxSetActiveShortlist&source=human&apply=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(index) }
    );
  }

  // 读取单个已激活短名单内的球员列表与核心考察属性
  async function readActiveShortlistPlayers(scope, teamHandle, { expectedCount = null, includeAttributes = true, limit = 20 } = {}) {
    const ctx0 = { human: { source: "human" }, Human: { source: "human" }, team: { source: teamHandle }, Team: { source: teamHandle }, Type: 0, type: 0 };
    const ps0 = await scope.subscribeOptional("human", "HumanPersonSearch", ctx0, 1500);
    if (!ps0.handle) throw new Error("候选名单搜索通道（HumanPersonSearch Type=0）暂未就绪。");
    const pl = await scope.subscribeOptional(ps0.handle, "PersonList", ctx0, 1200);
    if (!pl.handle) {
      await scope.release(ps0.handle).catch(() => {});
      throw new Error("无法读取候选名单球员列表（PersonList）。");
    }

    // 切换短名单后等待 PersonList 刷新到预期人数（最多约 900ms）
    let listVal = pl.read?.value || null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const curCount = listVal?.count ?? listVal?.items?.length ?? 0;
      if (expectedCount === null || curCount === expectedCount) break;
      await new Promise(r => setTimeout(r, 150));
      listVal = (await scope.ready(pl.handle, undefined, 1000)).value;
    }

    const total = listVal?.count ?? listVal?.items?.length ?? 0;
    const take = Math.min(total, Math.max(1, Math.min(40, Number(limit) || 20)));
    const coreAttrs = ["Pace", "Acceleration", "Stamina", "Technique", "Passing", "Dribbling", "Finishing", "Tackling", "Decisions", "Vision"];
    const players = [];
    let cachedPropSet = null;

    for (let i = 0; i < take; i++) {
      const pRef = { source: pl.handle, path: String(i) };
      const pCtx = { ...ctx0, Person: pRef };
      const [nameR, ageR, posR, natR, clubSub, valR, wageR] = await Promise.all([
        scope.readAndRelease(pRef, "Name", pCtx, 600),
        scope.readAndRelease(pRef, "Age", pCtx, 500),
        scope.readAndRelease(pRef, "BestPositionShortString", pCtx, 500),
        scope.readAndRelease(pRef, "NationalityText", pCtx, 500),
        scope.subscribeOptional(pRef, "Club", pCtx, 500),
        scope.readAndRelease(pRef, "Value", pCtx, 500),
        scope.readAndRelease(pRef, "Wage", pCtx, 500)
      ]);

      const isFreeAgent = !clubSub.handle || clubSub.read?.value?.type === "SI.Bindable.NullReference";
      let clubName = isFreeAgent ? "自由球员" : null;
      if (!isFreeAgent && clubSub.handle) {
        const cn = await scope.readAndRelease(clubSub.handle, "Name", pCtx, 450);
        clubName = stripRichText(cn.scalar || "") || "有约在身";
      }
      if (clubSub.handle) await scope.release(clubSub.handle).catch(() => {});

      const row = {
        index: i,
        personIdentity: listVal?.items?.[i]?.identity || null,
        name: stripRichText(nameR.scalar || ""),
        age: Number.parseInt(ageR.scalar, 10) || null,
        position: stripRichText(posR.scalar || "") || null,
        nationality: stripRichText(natR.scalar || "") || null,
        club: clubName,
        freeAgent: isFreeAgent,
        value: stripRichText(valR.scalar || "") || null,
        wage: stripRichText(wageR.scalar || "") || null
      };

      if (includeAttributes) {
        if (!cachedPropSet) {
          const metaProps = await scope.properties(pRef, "").catch(() => []);
          cachedPropSet = new Set(metaProps.map(p => p.name.split(":")[0]));
        }
        const attrs = {};
        const attrPairs = coreAttrs.map(base => {
          const matched = [base, `Attribute${base}`, `PlayerAttribute${base}`].find(c => cachedPropSet.has(c));
          return [base, matched];
        }).filter(([, matched]) => Boolean(matched));

        const attrResults = await Promise.all(
          attrPairs.map(([, propName]) => scope.readAndRelease(pRef, propName, pCtx, 500))
        );
        for (let k = 0; k < attrPairs.length; k++) {
          const v = attrResults[k]?.scalar;
          if (v !== null && v !== undefined && String(v).trim() !== "") {
            attrs[attrPairs[k][0]] = stripRichText(v);
          }
        }
        row.attributes = attrs;
      }

      players.push(row);
    }

    await scope.release(pl.handle).catch(() => {});
    await scope.release(ps0.handle).catch(() => {});
    return { total, returnedCount: players.length, players };
  }

  // 支持按 shortlistName / shortlistIndex / allShortlists=true 跨名单直读任意候选名单球员与考察属性，无需玩家在游戏内手动切换
  async function getShortlistPlayers({
    shortlistName = "",
    shortlistIndex,
    allShortlists = false,
    includeAttributes = true,
    restoreActive = true,
    limit = 20
  } = {}) {
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const origActive = before.items.find(x => x.isActive) || before.items[0] || null;
      let currentActiveIndex = origActive?.index ?? null;
      let switched = false;

      let targets = [];
      if (allShortlists) {
        targets = before.items;
      } else if (stripRichText(shortlistName)) {
        const q = stripRichText(shortlistName).toLowerCase();
        const exact = before.items.find(x => x.name.toLowerCase() === q);
        const hit = exact || before.items.find(x => x.name.toLowerCase().includes(q));
        if (!hit) {
          throw new Error(`未找到名称匹配 "${shortlistName}" 的候选名单；当前已有：${before.items.map(x => `${x.index}:${x.name}(${x.countText})`).join(" / ")}`);
        }
        targets = [hit];
      } else if (Number.isInteger(shortlistIndex)) {
        const hit = before.items.find(x => x.index === shortlistIndex || x.position === shortlistIndex);
        if (!hit) {
          throw new Error(`未找到 index=${shortlistIndex} 的候选名单（共 ${before.count} 个）。`);
        }
        targets = [hit];
      } else if (origActive) {
        targets = [origActive];
      }

      const results = [];
      try {
        for (const target of targets) {
          const expectedCount = parseShortlistCount(target.countText);
          if (expectedCount === 0) {
            results.push({ index: target.index, name: target.name, countText: target.countText, total: 0, returnedCount: 0, players: [] });
            continue;
          }
          if (currentActiveIndex !== target.index) {
            await setActiveShortlist(target.index, "shortlist_read_switch");
            switched = true;
            currentActiveIndex = target.index;
            await new Promise(r => setTimeout(r, 250));
          }
          const data = await readActiveShortlistPlayers(scope, before.team.handle, { expectedCount, includeAttributes, limit });
          results.push({ index: target.index, name: target.name, countText: target.countText, ...data });
        }
      } finally {
        if (switched && restoreActive && origActive && currentActiveIndex !== origActive.index) {
          await setActiveShortlist(origActive.index, "shortlist_read_restore").catch(() => {});
        }
      }

      if (!allShortlists && results.length === 1) {
        return {
          ok: true,
          shortlist: { index: results[0].index, name: results[0].name, countText: results[0].countText },
          total: results[0].total,
          returnedCount: results[0].returnedCount,
          players: results[0].players,
          allShortlists: before.items.map(x => ({ index: x.index, name: x.name, countText: x.countText, isActive: x.isActive }))
        };
      }
      return {
        ok: true,
        shortlistCount: results.length,
        shortlists: results
      };
    });
  }

  // 通过全库原生 game.Search 按姓名定位外部球员，返回持有 FM.UI.PersonReference 的句柄与基本信息
  async function resolveExternalPlayerByName(scope, { playerName, personIdentity = "", club = "" }) {
    const queryName = stripRichText(playerName);
    if (!queryName) throw new Error("必须提供球员姓名 playerName。");
    const gs = await scope.subscribeOptional("game", "Search", { human: { source: "human" } }, 1500);
    if (!gs.handle) throw new Error("游戏全局搜索通道暂未就绪。");
    const sName = await scope.subscribeOptional(gs.handle, "Name", {}, 800);
    const sList = await scope.subscribeOptional(gs.handle, "PersonList", {}, 800);
    if (!sName.handle || !sList.handle) throw new Error("游戏搜索输入框或结果列表不可用。");
    const sDone = await scope.subscribeOptional(gs.handle, "SearchIsFinished", {}, 600);
    const beforeFirstId = (await scope.ready(sList.handle)).value?.items?.[0]?.identity || "";

    await call(`/api/v1/internal/update?handle=${encodeURIComponent(sName.handle)}&apply=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queryName)
    });

    let listVal = null;
    for (let attempt = 0; attempt < 7; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 450 : 200));
      listVal = (await scope.ready(sList.handle)).value;
      const doneVal = sDone.handle ? String(scalar((await scope.ready(sDone.handle)).value) ?? "") : "True";
      const curFirstId = listVal?.items?.[0]?.identity || "";
      if (doneVal.toLowerCase() === "true" && (curFirstId !== beforeFirstId || attempt >= 2)) break;
    }
    if (sDone.handle) await scope.release(sDone.handle).catch(() => {});

    const totalHits = listVal?.count || 0;
    if (totalHits === 0) throw new Error(`全库未搜到名为 "${queryName}" 的球员。`);

    const clubQ = stripRichText(club).toLowerCase();
    const maxScan = Math.min(totalHits, 12);
    let fallbackMatch = null;
    for (let i = 0; i < maxScan; i++) {
      const rowSub = await scope.subscribeOptional({ source: sList.handle, path: String(i) }, "RowData", { human: { source: "human" } }, 700);
      if (!rowSub.handle || rowSub.read?.value?.type !== "FM.UI.PersonReference") {
        if (rowSub.handle) await scope.release(rowSub.handle).catch(() => {});
        continue;
      }
      const identity = rowSub.read?.value?.identity || "";
      const nameR = await scope.readAndRelease({ source: rowSub.handle }, "Name", { human: { source: "human" } }, 600);
      const pName = stripRichText(nameR.scalar || "");
      let pClub = "";
      if (clubQ) {
        const clubSub = await scope.subscribeOptional({ source: rowSub.handle }, "Club", { human: { source: "human" } }, 500);
        if (clubSub.handle && clubSub.read?.value?.type !== "SI.Bindable.NullReference") {
          const cn = await scope.readAndRelease(clubSub.handle, "Name", { human: { source: "human" } }, 500);
          pClub = stripRichText(cn.scalar || "");
        }
        if (clubSub.handle) await scope.release(clubSub.handle).catch(() => {});
      }

      const exactIdentity = personIdentity && identity === personIdentity;
      const clubMatched = !clubQ || pClub.toLowerCase().includes(clubQ);
      if (exactIdentity || (!personIdentity && clubMatched && pName)) {
        if (fallbackMatch) await scope.release(fallbackMatch.handle).catch(() => {});
        return { handle: rowSub.handle, identity, name: pName || queryName, club: pClub || null };
      }
      if (!fallbackMatch && !personIdentity && !clubQ) {
        fallbackMatch = { handle: rowSub.handle, identity, name: pName || queryName, club: pClub || null };
      } else {
        await scope.release(rowSub.handle).catch(() => {});
      }
    }

    if (fallbackMatch) return fallbackMatch;
    throw new Error(`未匹配到符合条件的球员 "${queryName}"${club ? `（俱乐部筛选：${club}）` : ""}${personIdentity ? `（身份：${personIdentity}）` : ""}。`);
  }

  // 展平原生 DoAction 菜单树，同时保留每条路径上每一级的完整中文标签
  async function flattenActionMenu(scope, itemsValue) {
    const keys = Object.fromEntries(
      await Promise.all(["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"].map(async name => [name, await scope.propertyId(name)]))
    );
    const entries = [];
    function visit(list, path = [], labels = [], disabled = false) {
      if (list?.kind !== "list") return;
      for (const [index, outer] of (list.items || []).entries()) {
        const fields = (outer?.fields?.[keys.RowData] || outer)?.fields || {};
        const blocked = disabled || scalar(outer?.fields?.[keys.Disabled]) === "True" || scalar(fields[keys.Disabled]) === "True";
        const label = stripRichText(scalar(fields[keys.Text]) ?? scalar(outer?.fields?.[keys.Text]) ?? "");
        const entry = [...path, index];
        const pathLabels = label ? [...labels, label] : [...labels];
        const childList = outer?.fields?.[keys.ChildList] || fields[keys.ChildList];
        const hasChildren = childList?.kind === "list" && (childList.items?.length || 0) > 0;
        const executableLeaf = !hasChildren && scalar(fields[keys.Event]) === "44" && Boolean(fields[keys.ActionData]);
        entries.push({ entry, label, pathLabels, fullPath: pathLabels.join(" > "), disabled: blocked, executableLeaf });
        visit(childList, entry, pathLabels, blocked);
      }
    }
    visit(itemsValue);
    return entries;
  }

  // 根据目标候选名单名与关注时长从菜单树叶节点中精准挑出目标项
  function pickShortlistMenuLeaf(entries, { targetListName = "", duration = "" } = {}) {
    const leaves = entries.filter(e => e.executableLeaf && !e.disabled);
    if (!leaves.length) return null;

    let pool = leaves;
    const listQ = stripRichText(targetListName).toLowerCase();
    if (listQ) {
      const exactList = leaves.filter(e => e.pathLabels.some(l => l.toLowerCase() === listQ));
      const fuzzyList = exactList.length ? exactList : leaves.filter(e => e.fullPath.toLowerCase().includes(listQ));
      if (fuzzyList.length) pool = fuzzyList;
      else return null;
    }

    const durQ = stripRichText(duration).toLowerCase();
    if (durQ) {
      const durHit = pool.find(e => e.fullPath.toLowerCase().includes(durQ));
      if (durHit) return durHit;
    }
    // 默认优先选择“无限期 / Indefinitely”叶节点，其次选池中首个叶节点
    const indefinite = pool.find(e => /无限期|永久|indefinite/i.test(e.fullPath));
    return indefinite || pool[0];
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

  // 将外部搜索到的球员直接加入指定候选名单（支持按名称/索引选名单与时长，走游戏原生 PersonAddPlayersToShortlist 菜单叶节点）
  async function addPlayerToShortlist({
    playerName,
    personIdentity = "",
    club = "",
    shortlistName = "",
    shortlistIndex,
    duration = "无限期",
    previewOnly = false,
    operationId
  } = {}) {
    if (!stripRichText(playerName)) throw new Error("必须提供球员姓名 playerName。");
    const id = operationId || `shortlist_add_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      let targetListName = stripRichText(shortlistName);
      if (!targetListName && Number.isInteger(shortlistIndex)) {
        const matchedList = before.items.find(x => x.index === shortlistIndex || x.position === shortlistIndex);
        if (!matchedList) throw new Error(`未找到 index=${shortlistIndex} 的候选名单（当前共 ${before.count} 个）。`);
        targetListName = matchedList.name;
      }

      const player = await resolveExternalPlayerByName(scope, { playerName, personIdentity, club });
      const contexts = {
        human: { source: "human" },
        Human: { source: "human" },
        team: { source: before.team.handle },
        Team: { source: before.team.handle },
        Records: [{ $reference: { source: player.handle, path: "" } }]
      };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const available = await scope.api("/api/v1/player-management/available", { offered: offered.handle });

      // 优先使用 PersonAddPlayersToShortlist；若球员已在其他候选名单中且指定了目标名单，可自动回退到 PersonMoveToClubShortlistPlayer
      let chosen = available.actions?.find(a => a.name === "PersonAddPlayersToShortlist");
      let usedActionName = "PersonAddPlayersToShortlist";
      if (!chosen && targetListName) {
        chosen = available.actions?.find(a => a.name === "PersonMoveToClubShortlistPlayer");
        usedActionName = "PersonMoveToClubShortlistPlayer";
      }
      if (!chosen) {
        const offeredNames = (available.actions || []).map(a => a.name);
        throw new Error(`游戏当前未向该球员提供加入候选名单菜单（可能该球员已在候选名单中或属于本队球员）。当前可用动作：${offeredNames.join(", ") || "无"}`);
      }

      const actionRef = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: chosen.id } });
      const itemsSub = await scope.subscribe(actionRef.handle, "Items", contexts);
      const entries = await flattenActionMenu(scope, itemsSub.read?.value);
      const selected = pickShortlistMenuLeaf(entries, { targetListName, duration });

      if (previewOnly) {
        return {
          ok: true,
          readOnly: true,
          action: usedActionName,
          player: { name: player.name, identity: player.identity, club: player.club },
          requestedShortlist: targetListName || "(默认)",
          selectedLeaf: selected,
          availableLeaves: entries.filter(e => e.executableLeaf).map(e => ({ entry: e.entry, fullPath: e.fullPath, disabled: e.disabled }))
        };
      }

      if (!selected) {
        const leaves = entries.filter(e => e.executableLeaf).map(e => e.fullPath);
        throw new Error(`未在游戏原生菜单中匹配到目标候选名单 "${targetListName || "(默认)"}"；当前可选叶节点：${leaves.join(" | ") || "无"}`);
      }

      const query = { offered: offered.handle, action: actionRef.handle, items: itemsSub.handle, entry: selected.entry };
      const preview = await scope.api("/api/v1/player-management/preview", query);
      if (preview.disabled || !preview.silentExecutionImplemented) {
        throw new Error(`游戏当前禁用了菜单项 "${selected.fullPath}"，无法执行。`);
      }
      const dispatch = await scope.api(
        "/api/v1/player-management/execute",
        { ...query, id, choiceToken: preview.choiceToken, acceptConfirmation: true },
        true
      );
      await new Promise(r => setTimeout(r, 450));
      const after = await readShortlists(scope);
      return {
        ok: true,
        operationId: id,
        action: usedActionName,
        player: { name: player.name, identity: player.identity, club: player.club },
        selectedEntry: selected.entry,
        selectedPath: selected.fullPath,
        beforeShortlists: before.items.map(x => ({ index: x.index, name: x.name, countText: x.countText })),
        afterShortlists: after.items.map(x => ({ index: x.index, name: x.name, countText: x.countText })),
        dispatch
      };
    });
  }

  // 将指定球员从候选名单中移出（走游戏原生 PersonRemovePlayersFromShortlist 菜单叶节点）
  async function removePlayerFromShortlist({
    playerName,
    personIdentity = "",
    club = "",
    shortlistName = "",
    previewOnly = false,
    operationId
  } = {}) {
    if (!stripRichText(playerName)) throw new Error("必须提供球员姓名 playerName。");
    const id = operationId || `shortlist_remove_${Date.now()}`;
    return client.scope(async scope => {
      const before = await readShortlists(scope);
      const player = await resolveExternalPlayerByName(scope, { playerName, personIdentity, club });
      const contexts = {
        human: { source: "human" },
        Human: { source: "human" },
        team: { source: before.team.handle },
        Team: { source: before.team.handle },
        Records: [{ $reference: { source: player.handle, path: "" } }]
      };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const available = await scope.api("/api/v1/player-management/available", { offered: offered.handle });
      const chosen = available.actions?.find(a => a.name === "PersonRemovePlayersFromShortlist");
      if (!chosen) {
        throw new Error(`游戏当前未向 "${player.name}" 提供移出候选名单菜单（可能该球员当前不在任何候选名单中）。`);
      }

      const actionRef = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: chosen.id } });
      const itemsSub = await scope.subscribe(actionRef.handle, "Items", contexts);
      const entries = await flattenActionMenu(scope, itemsSub.read?.value);
      const selected = pickShortlistMenuLeaf(entries, { targetListName: shortlistName });

      if (previewOnly) {
        return {
          ok: true,
          readOnly: true,
          action: "PersonRemovePlayersFromShortlist",
          player: { name: player.name, identity: player.identity, club: player.club },
          selectedLeaf: selected,
          availableLeaves: entries.filter(e => e.executableLeaf).map(e => ({ entry: e.entry, fullPath: e.fullPath, disabled: e.disabled }))
        };
      }

      if (!selected) throw new Error("未在游戏移出候选名单菜单中找到可执行项。");
      const query = { offered: offered.handle, action: actionRef.handle, items: itemsSub.handle, entry: selected.entry };
      const preview = await scope.api("/api/v1/player-management/preview", query);
      if (preview.disabled || !preview.silentExecutionImplemented) {
        throw new Error(`游戏当前禁用了菜单项 "${selected.fullPath}"，无法执行。`);
      }
      const dispatch = await scope.api(
        "/api/v1/player-management/execute",
        { ...query, id, choiceToken: preview.choiceToken, acceptConfirmation: true },
        true
      );
      await new Promise(r => setTimeout(r, 450));
      const after = await readShortlists(scope);
      return {
        ok: true,
        operationId: id,
        action: "PersonRemovePlayersFromShortlist",
        player: { name: player.name, identity: player.identity, club: player.club },
        selectedEntry: selected.entry,
        selectedPath: selected.fullPath,
        beforeShortlists: before.items.map(x => ({ index: x.index, name: x.name, countText: x.countText })),
        afterShortlists: after.items.map(x => ({ index: x.index, name: x.name, countText: x.countText })),
        dispatch
      };
    });
  }

  return {
    listShortlists,
    getShortlistPlayers,
    createShortlist,
    renameShortlist,
    deleteShortlist,
    movePlayerBetweenShortlists,
    addPlayerToShortlist,
    removePlayerFromShortlist
  };
}
