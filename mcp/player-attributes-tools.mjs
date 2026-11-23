import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { hexToAscii } from "./live-query-tools.mjs";

// 球员核心属性分组（FM27 原生 PersonReference 属性名）
const ATTRIBUTE_GROUPS = {
  technical: [
    "Corners", "Crossing", "Dribbling", "Finishing", "FirstTouch",
    "FreeKickTaking", "Heading", "LongShots", "LongThrows", "Marking",
    "Passing", "PenaltyTaking", "Tackling", "Technique"
  ],
  mental: [
    "Aggression", "Anticipation", "Bravery", "Composure", "Concentration",
    "Decisions", "Determination", "Flair", "Leadership", "OffTheBall",
    "Positioning", "Teamwork", "Vision", "WorkRate"
  ],
  physical: [
    "Acceleration", "Agility", "Balance", "JumpingReach",
    "NaturalFitness", "Pace", "Stamina", "Strength"
  ],
  goalkeeping: [
    "AerialReach", "CommandOfArea", "Communication", "Eccentricity",
    "Handling", "Kicking", "OneOnOnes", "PunchingTendency",
    "Reflexes", "RushingOutTendency", "Throwing"
  ]
};

function decodeCompact(val, depth = 0) {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") return val;
  if (val.kind === "scalar") return clean(val.value ?? "");
  if (val.kind === "reference") return { type: val.type, identity: val.identity };
  if (val.kind === "list") {
    const items = val.items || [];
    if (depth >= 2) return `[list count=${val.count ?? items.length}]`;
    return items.slice(0, 30).map(it => decodeCompact(it, depth + 1));
  }
  if (val.kind === "record" && val.fields) {
    const out = {};
    for (const [k, v] of Object.entries(val.fields)) {
      out[hexToAscii(k)] = decodeCompact(v, depth + 1);
    }
    return out;
  }
  return val;
}

export function createPlayerAttributesTools(call) {
  const client = createLiveClient(call);

  /**
   * 聚合读取本队指定球员的技术/精神/身体/门将属性（自动分批防超时，兼容 squadIndex 与 playerIndex）
   */
  async function getPlayerAttributes({ squadIndex, playerIndex, categories = ["technical", "mental", "physical"], customAttributes = [] } = {}) {
    const idx = Number.isInteger(squadIndex) ? squadIndex : (Number.isInteger(playerIndex) ? playerIndex : 0);
    return client.scope(async scope => {
      const resolved = await scope.resolvePlayerRef({ squadIndex: idx });
      const pRef = { source: resolved.source, path: resolved.path };
      const human = { source: "human" };
      const teamRef = { source: resolved.team.handle };
      const pCtx = { human, Human: human, team: teamRef, Team: teamRef, Person: pRef, InPossession: true };

      const nameR = await scope.readAndRelease(pRef, "Name", pCtx, 700);
      const posR = await scope.readAndRelease(pRef, "BestPositionShortString", pCtx, 500);
      const ageR = await scope.readAndRelease(pRef, "Age", pCtx, 500);
      const numR = await scope.readAndRelease(pRef, "SquadNumber", pCtx, 500);

      // 动态探测该球员节点支持的属性名（避免逐个猜 AttributeXxx 或裸名）
      const metaProps = await scope.properties(pRef, "").catch(() => []);
      const propSet = new Set(metaProps.map(p => p.name.split(":")[0]));

      const targetGroups = Array.isArray(categories) && categories.length ? categories : ["technical", "mental", "physical"];
      const attributes = {};

      async function readAttrValue(baseName) {
        const candidates = [baseName, `Attribute${baseName}`, `PlayerAttribute${baseName}`];
        const matched = candidates.find(c => propSet.has(c));
        if (!matched) return null;
        const r = await scope.readAndRelease(pRef, matched, pCtx, 600);
        if (!r.ok || r.value === null) return null;
        return r.scalar !== null ? r.scalar : decodeCompact(r.value, 1);
      }

      for (const groupName of targetGroups) {
        const list = ATTRIBUTE_GROUPS[groupName];
        if (!list) continue;
        const groupData = {};
        for (let i = 0; i < list.length; i++) {
          const val = await readAttrValue(list[i]);
          if (val !== null) groupData[list[i]] = val;
          if ((i + 1) % 6 === 0) await new Promise(r => setTimeout(r, 30));
        }
        attributes[groupName] = groupData;
      }

      if (Array.isArray(customAttributes) && customAttributes.length) {
        const custom = {};
        for (const attr of customAttributes.slice(0, 20)) {
          const val = await readAttrValue(attr);
          if (val !== null) custom[attr] = val;
        }
        attributes.custom = custom;
      }

      return {
        ok: true,
        readOnly: true,
        squadIndex: idx,
        player: {
          name: nameR.scalar || null,
          squadNumber: numR.scalar || null,
          age: ageR.scalar || null,
          position: posR.scalar || null
        },
        attributes
      };
    });
  }

  /**
   * 只读聚合当前联赛积分榜/排名与赛程（自动探测 Team / Club / Comp 原生属性并解析队名）
   */
  async function getLeagueTableAndFixtures({ limit = 20 } = {}) {
    const maxRows = Math.max(1, Math.min(30, Number(limit) || 20));
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team", { human, Human: human });
      const club = await scope.subscribeOptional("human", "Club", { human, Human: human }, 1500);
      const ctx = {
        human, Human: human,
        team: { source: team.handle }, Team: { source: team.handle },
        ...(club.handle ? { club: { source: club.handle }, Club: { source: club.handle } } : {})
      };

      const teamName = await scope.resolveRefName(team.handle, ctx, 500);
      const teamProps = await scope.properties(team.handle, "").catch(() => []);
      const teamPropNames = new Set(teamProps.map(p => p.name.split(":")[0]));

      // 1. 探测当前主联赛引用及排名文本
      let leagueName = null;
      let leaguePosition = null;
      let leagueTable = null;
      const posProp = ["LeaguePositionString", "LeaguePosition", "CurrentLeaguePosition", "DivisionPositionString"].find(p => teamPropNames.has(p));
      if (posProp) {
        const posR = await scope.readAndRelease(team.handle, posProp, ctx, 800);
        leaguePosition = posR.scalar || decodeCompact(posR.value, 1);
      }

      const compProp = ["LeagueComp", "MainDivision", "CurrentComp1", "Division", "Competition"].find(p => teamPropNames.has(p));
      if (compProp) {
        const compSub = await scope.subscribeOptional(team.handle, compProp, ctx, 1200);
        if (compSub.handle && compSub.read?.value?.kind === "reference") {
          leagueName = await scope.resolveRefName(compSub.handle, ctx, 600);
          // 通过 CurrentLiveTableDefaultStage -> Stage -> LeagueTable(LeagueTableType) 获取完整联赛积分榜
          const defStageSub = await scope.subscribeOptional(compSub.handle, "CurrentLiveTableDefaultStage", ctx, 1200);
          if (defStageSub.handle) {
            const stageSub = await scope.subscribeOptional(defStageSub.handle, "Stage", ctx, 1200);
            if (stageSub.handle) {
              const typeSub = await scope.subscribeOptional(stageSub.handle, "DefaultLeagueTableType", ctx, 1000);
              const tableTypeVal = typeSub.handle ? scalar(typeSub.read?.value) : "0";
              const tblCtx = { ...ctx, LeagueTableType: Number(tableTypeVal) || 0 };
              const tblSub = await scope.subscribeOptional(stageSub.handle, "LeagueTable", tblCtx, 1500);
              if (tblSub.handle && tblSub.read?.value?.kind === "list") {
                const tblItems = tblSub.read.value.items || [];
                const rows = [];
                for (let i = 0; i < Math.min(tblItems.length, maxRows); i++) {
                  const rowObj = decodeCompact(tblItems[i], 1);
                  // 若行内含 TeamReference，尝试顺手解析俱乐部名称
                  const fields = tblItems[i]?.fields || {};
                  const teamFieldKey = Object.keys(fields).find(k => fields[k]?.kind === "reference" && fields[k]?.type === "FM.UI.TeamReference");
                  let clubName = null;
                  if (teamFieldKey) {
                    clubName = await scope.resolveRefName({ source: tblSub.handle, path: `${i}/${teamFieldKey}` }, ctx, 400).catch(() => null);
                  }
                  rows.push({
                    rank: i + 1,
                    teamName: clubName || null,
                    played: rowObj.gpld ?? null,
                    won: rowObj.gwon ?? null,
                    drawn: rowObj.gdrw ?? null,
                    lost: rowObj.glos ?? null,
                    gf: rowObj.glfr ?? null,
                    ga: rowObj.GAgn ?? null,
                    gd: rowObj.lgdf ?? null,
                    points: rowObj.TJjm ?? rowObj.pts ?? null
                  });
                }
                leagueTable = { count: tblSub.read.value.count ?? tblItems.length, rows };
              }
            }
          }
        }
      }

      // 2. 探测赛程列表（未来赛程 + 历史赛程，精简输出并解析对手队名）
      const fixtures = {};
      for (const fProp of ["Fixtures", "UpcomingFixtures", "Next5Fixtures", "RecentFixtures", "PlayedFixtures", "NextMatchInformation"]) {
        if (!teamPropNames.has(fProp)) continue;
        const fSub = await scope.subscribeOptional(team.handle, fProp, ctx, 1200);
        if (fSub.handle && fSub.read?.value) {
          const val = fSub.read.value;
          if (val.kind === "list" && Array.isArray(val.items)) {
            const parsed = [];
            for (let i = 0; i < Math.min(val.items.length, maxRows); i++) {
              const item = val.items[i];
              const row = decodeCompact(item, 1);
              const fields = item?.fields || {};
              const oppKey = Object.keys(fields).find(k => fields[k]?.kind === "reference" && fields[k]?.type === "FM.UI.TeamReference");
              let opponentName = null;
              if (oppKey) {
                opponentName = await scope.resolveRefName({ source: fSub.handle, path: `${i}/${oppKey}` }, ctx, 400).catch(() => null);
              }
              if (fProp === "Next5Fixtures") {
                parsed.push({ inDays: row.qvJ6 ?? null, opponentName });
              } else {
                parsed.push({ ...(opponentName ? { opponentName } : {}), ...row });
              }
            }
            fixtures[fProp] = { count: val.count ?? val.items.length, items: parsed };
          } else {
            fixtures[fProp] = decodeCompact(val, 1);
          }
          await scope.release(fSub.handle);
        }
      }

      return {
        ok: true,
        readOnly: true,
        teamName,
        league: {
          name: leagueName,
          position: leaguePosition,
          table: leagueTable
        },
        fixtures
      };
    });
  }

  /**
   * 赛前一键简报（Token 优化聚合工具）：1 次调用汇总联赛名次、下场对手、本队体能/伤病预警与预算，单次 < 4KB
   */
  async function getPreMatchBriefing() {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team", { human, Human: human });
      const club = await scope.subscribeOptional("human", "Club", { human, Human: human }, 1200);
      const ctx = {
        human, Human: human,
        team: { source: team.handle }, Team: { source: team.handle },
        ...(club.handle ? { club: { source: club.handle }, Club: { source: club.handle } } : {})
      };

      const teamName = await scope.resolveRefName(team.handle, ctx, 500);
      const posR = await scope.readAndRelease(team.handle, "LeaguePosition", ctx, 600);
      const compSub = await scope.subscribeOptional(team.handle, "CurrentComp1", ctx, 1000);
      const leagueName = compSub.handle ? await scope.resolveRefName(compSub.handle, ctx, 500) : null;

      // 下场比赛信息
      let nextOpponent = null, inDays = null;
      const nfSub = await scope.subscribeOptional(team.handle, "Next5Fixtures", ctx, 1000);
      if (nfSub.handle && nfSub.read?.value?.kind === "list" && nfSub.read.value.items?.length) {
        const first = nfSub.read.value.items[0];
        const fields = first?.fields || {};
        inDays = clean(scalar(fields["0x71764a36"])) || null;
        const oppKey = Object.keys(fields).find(k => fields[k]?.kind === "reference" && fields[k]?.type === "FM.UI.TeamReference");
        if (oppKey) nextOpponent = await scope.resolveRefName({ source: nfSub.handle, path: `0/${oppKey}` }, ctx, 500).catch(() => null);
        await scope.release(nfSub.handle);
      }

      // 扫描本队体能偏低(<80)、锐度偏低(<50)或士气偏低(<=11)的预警球员（不吐全量20人以极省 Token）
      const alerts = [];
      const playersSub = await scope.subscribeOptional(team.handle, "Players", ctx, 1500);
      if (playersSub.handle && playersSub.read?.value?.kind === "list") {
        const items = playersSub.read.value.items || [];
        for (let i = 0; i < Math.min(items.length, 25); i++) {
          const pRef = { source: playersSub.handle, path: String(i) };
          const pCtx = { ...ctx, Person: pRef };
          const cond = Number((await scope.readAndRelease(pRef, "Condition", pCtx, 400)).scalar ?? 100);
          const morale = Number((await scope.readAndRelease(pRef, "Morale", pCtx, 400)).scalar ?? 15);
          if (cond < 80 || morale <= 11) {
            const name = (await scope.readAndRelease(pRef, "Name", pCtx, 400)).scalar || `#${i}`;
            const pos = (await scope.readAndRelease(pRef, "BestPositionShortString", pCtx, 400)).scalar || null;
            alerts.push({ squadIndex: i, name, position: pos, condition: cond, morale });
          }
        }
        await scope.release(playersSub.handle);
      }

      const unreadR = await scope.readAndRelease("human", "NumberUnreadMessages", ctx, 500);
      const tacticSub = await scope.subscribeOptional(team.handle, "Tactic", { ...ctx, Boolean: true }, 1000);
      const mentalityR = tacticSub.handle ? await scope.readAndRelease(tacticSub.handle, "Mentality", ctx, 500) : null;

      return {
        ok: true,
        readOnly: true,
        teamName,
        league: { name: leagueName, position: posR.scalar || null },
        nextMatch: { opponentName: nextOpponent, inDays },
        currentMentality: mentalityR?.scalar || null,
        unreadMessages: unreadR.scalar || "0",
        squadAlertsCount: alerts.length,
        squadAlerts: alerts,
        tip: "如需完整 20 人名单请调 get_squad_snapshot；需对手预计首发与针对性指令请调 get_opposition_instructions。"
      };
    });
  }

  return { getPlayerAttributes, getLeagueTableAndFixtures, getPreMatchBriefing };
}
