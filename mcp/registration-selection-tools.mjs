import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";

// 赛事报名/注册逐人选择工具（Review #33：不覆盖调用方 contexts，多赛事并存时显式呈现赛事与规则来源）
export function createRegistrationSelectionTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const baseCtx = { Human: human, human, Team: teamRef, team: teamRef };
      const userContexts = args.contexts && typeof args.contexts === "object" ? args.contexts : {};
      const explicitRule = Number.isInteger(args.squadSelectionRule)
        ? args.squadSelectionRule
        : (Number.isInteger(userContexts.SquadSelectionRule) ? userContexts.SquadSelectionRule : null);

      // 读取当前参赛赛事列表，多赛事并存且未显式指定规则时给出明确标识与提示
      const compsList = await scope.resolveRefList(team.handle, "CurrentComps", baseCtx, 10).catch(() => null);
      const activeCompetitions = Array.isArray(compsList?.items) ? compsList.items : [];
      const ruleSource = explicitRule !== null
        ? "explicit"
        : (activeCompetitions.length <= 1 ? "single_competition_default_165" : "fallback_default_165_multiple_competitions");

      // 允许调用方 contexts 覆写默认规则，避免被后面的硬编码字段静默盖掉（Review #33）
      const contexts = {
        ...baseCtx,
        SquadSelectionRule: 165,
        PlayerSquadSelectionValue: 0,
        ...userContexts,
        ...(Number.isInteger(args.squadSelectionRule) ? { SquadSelectionRule: args.squadSelectionRule } : {}),
        ...(Number.isInteger(args.playerSquadSelectionValue) ? { PlayerSquadSelectionValue: args.playerSquadSelectionValue } : {})
      };

      const session = await scope.subscribeOptional(team.handle, "SquadRegistration", contexts);
      if (!session.handle) {
        return {
          ok: true,
          available: false,
          unavailable: session.unavailable,
          squadSelectionRule: contexts.SquadSelectionRule,
          ruleSource,
          activeCompetitions
        };
      }
      const players = await scope.subscribeOptional(session.handle, "Players", contexts);
      if (!players.handle) {
        return {
          ok: true,
          available: true,
          players: null,
          unavailable: players.unavailable,
          squadSelectionRule: contexts.SquadSelectionRule,
          ruleSource,
          activeCompetitions
        };
      }
      if (args.personPath === undefined) {
        const deadlineSub = await scope.subscribeOptional(session.handle, "DeadlineDateString", contexts, 500).catch(() => ({ handle: null, read: { value: null } }));
        return {
          ok: true,
          squadSelectionRule: contexts.SquadSelectionRule,
          ruleSource,
          activeCompetitions,
          deadline: scalar(deadlineSub.read?.value) || null,
          ...(ruleSource === "fallback_default_165_multiple_competitions"
            ? { warning: `当前球队同时参加 ${activeCompetitions.length} 项赛事且未指定 squadSelectionRule，本次按默认规则 165 读取；执行前请确认目标赛事规则号。` }
            : {}),
          players: players.read.value,
          liveVerified: false
        };
      }
      if (typeof args.personPath !== "string" || !args.personPath) throw new Error("需要原始注册候选中的personPath。");
      if (typeof args.selected !== "boolean") throw new Error("selected必须是明确的布尔注册意图。");
      const person = { source: players.handle, path: args.personPath };
      const scoped = { ...contexts, Person: person, person };
      const current = await scope.subscribe(session.handle, "Selected", scoped);
      const editable = await scope.subscribe(session.handle, "CanChangeSelection", scoped);
      const query = { team: team.handle, session: session.handle, players: players.handle, personPath: args.personPath,
        current: current.handle, editable: editable.handle, selected: args.selected };
      const preview = await scope.api("/api/v1/registration/player-preview", query);
      if (!execute) {
        const out = args.operationId
          ? { ...preview, observation: await scope.api("/api/v1/registration/player-state", { ...query, operationId: args.operationId }) }
          : preview;
        return { ...out, squadSelectionRule: contexts.SquadSelectionRule, ruleSource, activeCompetitions };
      }
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("注册选择或权限已变化，请重新预览。");
      const id = args.operationId || randomUUID();
      try {
        return {
          ...await scope.api("/api/v1/registration/player-execute", { ...query, id, choiceToken: preview.choiceToken }, true),
          squadSelectionRule: contexts.SquadSelectionRule,
          ruleSource
        };
      } catch (error) {
        return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) };
      }
    });
  }
  async function setMany(args) {
    if (!Array.isArray(args.changes) || !args.changes.length || args.changes.length > 100 ||
        args.changes.some(change => typeof change.personPath !== "string" || !change.personPath || typeof change.selected !== "boolean" || !change.expectedChoiceToken) ||
        new Set(args.changes.map(change => change.personPath)).size !== args.changes.length)
      throw new Error("changes需要1至100个不重复球员路径、明确selected和各自原预览token。");
    const operationId = args.operationId || randomUUID();
    if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 80) throw new Error("批操作请求号需要1至80字符。");
    const results = [];
    for (const [index, change] of args.changes.entries()) {
      const childId = `${operationId}:${index}`;
      let result;
      try { result = await context({ ...args, ...change, operationId: childId }, true); }
      catch (error) {
        return { ok: false, operationId, completed: results.length, stoppedIndex: index, results,
          error: String(error.message || error), atomic: false, registrationSubmitted: false, retrySafe: false };
      }
      results.push(result);
      if (!result.ok || !["dispatched_unverified", "verified", "no_change"].includes(result.status))
        return { ok: false, operationId, stoppedIndex: index, results, atomic: false, registrationSubmitted: false, retrySafe: false };
    }
    return { ok: true, operationId, results, atomic: false, registrationSubmitted: false,
      verified: false, note: "逐人正常选择已派发，最终名单需独立读取并显式确认提交。" };
  }
  return { get: args => context(args, false), set: args => context(args, true), setMany };
}
