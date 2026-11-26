import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 一行一人紧凑阵容快照（get_squad_snapshot）与全量分页聚合缓存（Review #27/#28/#52/#54）
export function createSquadSnapshotTools(call) {
  const client = createLiveClient(call);
  // 同游戏日期、同球队的短 TTL 只读快照缓存（仅用于连续体检+排阵复用，绝不跨日期缓存，绝不作为写入令牌）
  const fullSnapshotCache = new Map();
  const CACHE_TTL_MS = 20_000;

  function extractPositionText(val) {
    if (!val) return null;
    if (val.kind === "scalar") return clean(val.value) || null;
    if (val.kind === "list" && Array.isArray(val.items) && val.items.length) {
      const names = val.items
        .map(it => {
          if (it?.kind === "scalar") return clean(it.value);
          const f = it?.fields || {};
          return clean(f["0x71764a36"]?.value || f["0x5374726e"]?.value || f["0x6e616d65"]?.value || "");
        })
        .filter(Boolean);
      if (!names.length) return null;
      if (names.length <= 3) return names.join("/");
      return `${names.slice(0, 2).join("/")} 等${names.length}位置`;
    }
    return null;
  }

  function extractAbilityText(val) {
    if (!val) return null;
    if (val.kind === "scalar") return clean(val.value) || null;
    if (val.kind === "record" && val.fields) {
      const f = val.fields;
      const tier = clean(f["0x6150344a"]?.value || f["0x71764a36"]?.value || f["0x5374726e"]?.value || f["0x776e5438"]?.value || "");
      const rangeObj = f["0x57487955"]?.fields || f["0x57487955"];
      const minV = rangeObj?.Min?.value ?? rangeObj?.Min;
      const maxV = rangeObj?.Max?.value ?? rangeObj?.Max;
      if (tier && minV !== undefined) {
        return minV === maxV ? `${tier}(${minV}/20)` : `${tier}(${minV}-${maxV}/20)`;
      }
      return tier || (minV !== undefined ? `${minV}/20` : null);
    }
    return null;
  }

  function extractWageText(val) {
    if (!val) return null;
    if (val.kind === "scalar") return clean(val.value) || null;
    if (val.kind === "record" && val.fields) {
      return clean(val.fields["0x71764a36"]?.value || val.fields["0x5374726e"]?.value || "") || null;
    }
    return null;
  }

  function parseTriBool(raw) {
    if (raw === "True" || raw === true) return true;
    if (raw === "False" || raw === false) return false;
    return null;
  }

  async function getSquadSnapshot({
    offset = 0,
    limit = 30,
    includeContractAndStars = true,
    includeAvailability = true
  } = {}) {
    const start = Math.max(0, Number(offset) || 0);
    const maxCount = Math.max(1, Math.min(50, Number(limit) || 30));

    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team", { human, Human: human });
      const baseCtx = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      const [playersSub, dateR] = await Promise.all([
        scope.subscribeOptional({ source: team.handle }, "Players", baseCtx, 2000),
        scope.readAndRelease("game", "CurrentGameDate", {}, 500)
      ]);
      const allItems = playersSub.read?.value?.items || [];
      const total = playersSub.read?.value?.count ?? allItems.length;
      const teamIdentity = team.read?.value?.identity || null;
      const gameDate = dateR.scalar || null;

      if (!playersSub.handle || total === 0) {
        return {
          ok: true,
          readOnly: true,
          degraded: !playersSub.handle,
          teamIdentity,
          gameDate,
          total: 0,
          offset: start,
          returned: 0,
          truncated: false,
          players: [],
          note: playersSub.handle ? "当前球队名单为空。" : `未能获取球队名单句柄（${playersSub.unavailable || "no_handle"}）`
        };
      }

      const end = Math.min(total, start + maxCount);
      const myTeamName = await scope.resolveRefName(team.handle, baseCtx, 500);
      const rows = [];
      let degradedFields = 0;

      // 缓存预热兜底：仅对短暂超时/空值重试一次，若属性本身不存在则立即跳过避免拖慢耗时
      async function readRetry(ref, prop, ctx, ms) {
        let r = await scope.readAndRelease(ref, prop, ctx, ms);
        if (!r.ok && /当前引用不提供/.test(r.unavailable || "")) return r;
        if (!r.ok || r.scalar === null) {
          await new Promise(resolve => setTimeout(resolve, 60));
          r = await scope.readAndRelease(ref, prop, ctx, Math.max(ms, 700));
        }
        return r;
      }

      // 单名球员字段并发读取（受控微批调用，即读即释，严格控制在原生 128 订阅句柄安全线内）
      async function readOnePlayer(i) {
        const pRef = { source: playersSub.handle, path: String(i) };
        const pCtx = { ...baseCtx, Person: pRef, InPossession: true };

        // 阶段 1：并发读取球员独立标量属性与出战三态（单人峰值 <= 10 个短命句柄）
        const scalarTasks = [
          readRetry(pRef, "Name", pCtx, 700),
          readRetry(pRef, "SquadNumber", pCtx, 500),
          readRetry(pRef, "Age", pCtx, 500),
          readRetry(pRef, "BestPositionShortString", pCtx, 500),
          readRetry(pRef, "Condition", pCtx, 500),
          readRetry(pRef, "Sharpness", pCtx, 500),
          readRetry(pRef, "Morale", pCtx, 500)
        ];
        if (includeAvailability) {
          scalarTasks.push(
            scope.readAndRelease(pRef, "IsInjured", pCtx, 400),
            scope.readAndRelease(pRef, "IsSuspended", pCtx, 400),
            scope.readAndRelease(pRef, "PlayerAvailabilityStatus", pCtx, 400)
          );
        }
        const scalarRes = await Promise.all(scalarTasks);
        const [nameR, numR, ageR, posR, condR, sharpRaw, moraleR] = scalarRes;

        let sharpR = sharpRaw;
        let injured = null;
        let suspended = null;
        let availability = null;

        const fallbackTasks = [];
        if (!sharpR.ok || sharpR.scalar === null) {
          fallbackTasks.push(
            scope.readAndRelease(pRef, "MatchSharpness", pCtx, 400).then(r => { sharpR = r; })
          );
        }
        if (includeAvailability) {
          const [, , , , , , , injR, banR, availR] = scalarRes;
          injured = injR.ok ? parseTriBool(injR.scalar) : null;
          suspended = banR.ok ? parseTriBool(banR.scalar) : null;
          availability = availR.ok ? (availR.scalar || null) : null;
          if (suspended === null) {
            fallbackTasks.push(
              scope.readAndRelease(pRef, "IsBanned", pCtx, 350).then(banAlt => {
                if (banAlt.ok) suspended = parseTriBool(banAlt.scalar);
              })
            );
          }
        }
        if (fallbackTasks.length) await Promise.all(fallbackTasks);

        let position = posR.scalar || null;
        let caStars = null;
        let paStars = null;
        let contractExpires = null;
        let playingTime = null;
        let wage = null;
        let loanClub = null;

        // 阶段 2：并发读取外租、教练报告与合同子对象，读取完毕立即释放子句柄
        const subTasks = [
          (async () => {
            const loanSub = await scope.subscribeOptional(pRef, "LoanClub", pCtx, 400);
            if (!loanSub.handle) return;
            try {
              if (loanSub.read?.value?.identity) {
                const lcName = await scope.resolveRefName(loanSub.handle, pCtx, 400);
                if (lcName && lcName !== myTeamName) loanClub = lcName;
              }
            } finally {
              await scope.release(loanSub.handle);
            }
          })()
        ];

        if (includeContractAndStars || !position) {
          subTasks.push((async () => {
            const reportSub = await scope.subscribeOptional(pRef, "ClubCoachReport", pCtx, 700);
            if (!reportSub.handle) return;
            try {
              const rTasks = [];
              if (!position) {
                rTasks.push(
                  scope.readAndRelease(reportSub.handle, "ScoutedPositionList", pCtx, 600).then(sp => {
                    position = extractPositionText(sp.value);
                  })
                );
              }
              if (includeContractAndStars) {
                rTasks.push(
                  scope.readAndRelease(reportSub.handle, "ScoutedCurrentAbilityInfo", pCtx, 500).then(caR => {
                    caStars = extractAbilityText(caR.value);
                  }),
                  scope.readAndRelease(reportSub.handle, "ScoutedPotentialAbilityInfo", pCtx, 500).then(paR => {
                    paStars = extractAbilityText(paR.value);
                  })
                );
              }
              if (rTasks.length) await Promise.all(rTasks);
            } finally {
              await scope.release(reportSub.handle);
            }
          })());
        }

        if (includeContractAndStars) {
          subTasks.push((async () => {
            const fcSub = await scope.subscribeOptional(pRef, "FullContract", pCtx, 600);
            if (fcSub.handle) {
              try {
                const [expR, ptR, fcWageR] = await Promise.all([
                  scope.readAndRelease(fcSub.handle, "EndDateDescription", pCtx, 500),
                  scope.readAndRelease(fcSub.handle, "AgreedPlayingTimeDescription", pCtx, 500),
                  scope.readAndRelease(fcSub.handle, "Wage", pCtx, 500)
                ]);
                contractExpires = expR.scalar;
                playingTime = ptR.scalar;
                wage = extractWageText(fcWageR.value);
              } finally {
                await scope.release(fcSub.handle);
              }
            }
            if (!wage) {
              const wageR = await scope.readAndRelease(pRef, "Wage", pCtx, 400);
              wage = extractWageText(wageR.value);
            }
          })());
        }

        await Promise.all(subTasks);

        if (!nameR.ok) degradedFields++;
        return {
          index: i,
          personIdentity: allItems[i]?.identity || null,
          name: nameR.scalar || `#${i}`,
          number: numR.scalar,
          age: ageR.scalar,
          position,
          condition: condR.scalar,
          sharpness: sharpR.scalar,
          morale: moraleR.scalar,
          ...(includeAvailability ? { injured, suspended, ...(availability ? { availability } : {}) } : {}),
          ...(loanClub ? { loanClub } : {}),
          ...(includeContractAndStars ? { caStars, paStars, wage, contractExpires, playingTime } : {})
        };
      }

      // 受控 4 人微批并发：30 人快照峰值句柄 ~42（远低于 128 限制），耗时由 ~30s 压缩至 ~3-5s
      const PLAYER_BATCH_SIZE = 4;
      for (let batchStart = start; batchStart < end; batchStart += PLAYER_BATCH_SIZE) {
        const batchIndices = [];
        for (let i = batchStart; i < Math.min(end, batchStart + PLAYER_BATCH_SIZE); i++) {
          batchIndices.push(i);
        }
        const batchRows = await Promise.all(batchIndices.map(i => readOnePlayer(i)));
        rows.push(...batchRows);
      }

      return {
        ok: true,
        readOnly: true,
        teamIdentity,
        gameDate,
        total,
        offset: start,
        returned: rows.length,
        truncated: end < total,
        degraded: degradedFields > 0,
        players: rows
      };
    });
  }

  // 读取当前日期与球队标识（极轻量，用于判断只读全量快照缓存是否属于同一游戏时点，绝不跨日期复用）
  async function readSnapshotClock() {
    return client.scope(async scope => {
      const team = await scope.subscribeOptional("human", "Team", { human: { source: "human" } }, 1000);
      const dateR = await scope.readAndRelease("game", "CurrentGameDate", {}, 500);
      return {
        teamIdentity: team.read?.value?.identity || null,
        gameDate: dateR.scalar || null
      };
    }).catch(() => ({ teamIdentity: null, gameDate: null }));
  }

  // 全量分页读取整支一线队名单（Review #27/#52）：自动翻完所有页覆盖 30+ 球员，并支持同日期只读复用
  async function getFullSquadSnapshot({
    includeContractAndStars = true,
    includeAvailability = true,
    useCache = true,
    pageSize = 30
  } = {}) {
    const safePageSize = Math.max(10, Math.min(50, Number(pageSize) || 30));
    let clock = null;
    if (useCache) {
      clock = await readSnapshotClock();
      if (clock.teamIdentity && clock.gameDate) {
        const key = `${clock.teamIdentity}|${clock.gameDate}|c:${includeContractAndStars ? 1 : 0}|a:${includeAvailability ? 1 : 0}`;
        const hit = fullSnapshotCache.get(key);
        if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
          return { ...hit.snapshot, fromCache: true };
        }
      }
    }

    const allPlayers = [];
    let offset = 0;
    let total = 0;
    let degraded = false;
    let teamIdentity = clock?.teamIdentity || null;
    let gameDate = clock?.gameDate || null;
    let pagesRead = 0;
    const maxPages = 6; // 最多覆写 300 人，防止异常死循环

    while (pagesRead < maxPages) {
      const page = await getSquadSnapshot({
        offset,
        limit: safePageSize,
        includeContractAndStars,
        includeAvailability
      });
      pagesRead++;
      total = page.total ?? total;
      if (page.teamIdentity) teamIdentity = page.teamIdentity;
      if (page.gameDate) gameDate = page.gameDate;
      if (page.degraded) degraded = true;
      const batch = page.players || [];
      allPlayers.push(...batch);
      if (!page.truncated || batch.length === 0 || allPlayers.length >= total) break;
      offset += batch.length;
    }

    const snapshot = {
      ok: true,
      readOnly: true,
      teamIdentity,
      gameDate,
      total: Math.max(total, allPlayers.length),
      returned: allPlayers.length,
      pagesRead,
      partial: allPlayers.length < total,
      degraded,
      fromCache: false,
      players: allPlayers
    };

    if (useCache && teamIdentity && gameDate && !snapshot.partial && !snapshot.degraded) {
      const key = `${teamIdentity}|${gameDate}|c:${includeContractAndStars ? 1 : 0}|a:${includeAvailability ? 1 : 0}`;
      fullSnapshotCache.set(key, { cachedAt: Date.now(), snapshot });
    }
    return snapshot;
  }

  function clearCache() {
    fullSnapshotCache.clear();
  }

  return { getSquadSnapshot, getFullSquadSnapshot, clearCache };
}
