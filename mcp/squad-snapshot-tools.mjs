import { createLiveClient, clean, scalar } from "./live-client.mjs";

// 一行一人紧凑阵容快照（get_squad_snapshot）
export function createSquadSnapshotTools(call) {
  const client = createLiveClient(call);

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

  async function getSquadSnapshot({ offset = 0, limit = 30, includeContractAndStars = true } = {}) {
    const start = Math.max(0, Number(offset) || 0);
    const maxCount = Math.max(1, Math.min(50, Number(limit) || 30));

    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team", { human, Human: human });
      const baseCtx = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      const playersSub = await scope.subscribeOptional({ source: team.handle }, "Players", baseCtx, 2000);
      const allItems = playersSub.read?.value?.items || [];
      const total = playersSub.read?.value?.count ?? allItems.length;

      if (!playersSub.handle || total === 0) {
        return {
          ok: true,
          readOnly: true,
          degraded: !playersSub.handle,
          total: 0,
          returned: 0,
          players: [],
          note: playersSub.handle ? "当前球队名单为空。" : `未能获取球队名单句柄（${playersSub.unavailable || "no_handle"}）`
        };
      }

      const end = Math.min(total, start + maxCount);
      const myTeamName = await scope.resolveRefName(team.handle, baseCtx, 500);
      const rows = [];
      let degradedFields = 0;

      // 缓存预热兜底：首次读取返回空或超时时短暂退避重试一次，解决冷启动偶发 null
      async function readRetry(ref, prop, ctx, ms) {
        let r = await scope.readAndRelease(ref, prop, ctx, ms);
        if (!r.ok || r.scalar === null) {
          await new Promise(resolve => setTimeout(resolve, 100));
          r = await scope.readAndRelease(ref, prop, ctx, Math.max(ms, 850));
        }
        return r;
      }

      for (let i = start; i < end; i++) {
        const pRef = { source: playersSub.handle, path: String(i) };
        const pCtx = { ...baseCtx, Person: pRef, InPossession: true };

        const nameR = await readRetry(pRef, "Name", pCtx, 700);
        const numR = await readRetry(pRef, "SquadNumber", pCtx, 500);
        const ageR = await readRetry(pRef, "Age", pCtx, 500);
        const posR = await readRetry(pRef, "PositionString", pCtx, 500);
        const condR = await readRetry(pRef, "Condition", pCtx, 500);
        let sharpR = await readRetry(pRef, "Sharpness", pCtx, 500);
        if (!sharpR.ok || sharpR.scalar === null) {
          sharpR = await scope.readAndRelease(pRef, "MatchSharpness", pCtx, 500);
        }
        const moraleR = await readRetry(pRef, "Morale", pCtx, 500);

        let position = posR.scalar || null;
        let caStars = null;
        let paStars = null;
        let contractExpires = null;
        let playingTime = null;
        let wage = null;
        let loanClub = null;

        const loanSub = await scope.subscribeOptional(pRef, "LoanClub", pCtx, 400);
        if (loanSub.handle) {
          if (loanSub.read?.value?.identity) {
            const lcName = await scope.resolveRefName(loanSub.handle, pCtx, 400);
            if (lcName && lcName !== myTeamName) loanClub = lcName;
          }
          await scope.release(loanSub.handle);
        }

        if (includeContractAndStars || !position) {
          const reportSub = await scope.subscribeOptional(pRef, "ClubCoachReport", pCtx, 700);
          if (reportSub.handle) {
            if (!position) {
              const sp = await scope.readAndRelease(reportSub.handle, "ScoutedPositionList", pCtx, 600);
              position = extractPositionText(sp.value);
            }
            if (includeContractAndStars) {
              const caR = await scope.readAndRelease(reportSub.handle, "ScoutedCurrentAbilityInfo", pCtx, 500);
              const paR = await scope.readAndRelease(reportSub.handle, "ScoutedPotentialAbilityInfo", pCtx, 500);
              caStars = extractAbilityText(caR.value);
              paStars = extractAbilityText(paR.value);
            }
            await scope.release(reportSub.handle);
          }
        }

        if (includeContractAndStars) {
          const fcSub = await scope.subscribeOptional(pRef, "FullContract", pCtx, 600);
          if (fcSub.handle) {
            const expR = await scope.readAndRelease(fcSub.handle, "EndDateDescription", pCtx, 500);
            const ptR = await scope.readAndRelease(fcSub.handle, "AgreedPlayingTimeDescription", pCtx, 500);
            const fcWageR = await scope.readAndRelease(fcSub.handle, "Wage", pCtx, 500);
            contractExpires = expR.scalar;
            playingTime = ptR.scalar;
            wage = extractWageText(fcWageR.value);
            await scope.release(fcSub.handle);
          }
          if (!wage) {
            const wageR = await scope.readAndRelease(pRef, "Wage", pCtx, 400);
            wage = extractWageText(wageR.value);
          }
        }

        if (!nameR.ok) degradedFields++;
        rows.push({
          index: i,
          name: nameR.scalar || `#${i}`,
          number: numR.scalar,
          age: ageR.scalar,
          position,
          condition: condR.scalar,
          sharpness: sharpR.scalar,
          morale: moraleR.scalar,
          ...(loanClub ? { loanClub } : {}),
          ...(includeContractAndStars ? { caStars, paStars, wage, contractExpires, playingTime } : {})
        });
      }

      return {
        ok: true,
        readOnly: true,
        total,
        offset: start,
        returned: rows.length,
        truncated: end < total,
        degraded: degradedFields > 0,
        players: rows
      };
    });
  }

  return { getSquadSnapshot };
}
