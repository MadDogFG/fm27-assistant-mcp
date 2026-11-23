import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createRegistrationSelectionTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { ...(args.contexts || {}), Human: human, human, Team: teamRef, team: teamRef, SquadSelectionRule: args.squadSelectionRule ?? 165, PlayerSquadSelectionValue: Number.isInteger(args.playerSquadSelectionValue) ? args.playerSquadSelectionValue : 0 };
      const session = await scope.subscribeOptional(team.handle, "SquadRegistration", contexts);
      if (!session.handle) return { ok: true, available: false, unavailable: session.unavailable };
      const players = await scope.subscribeOptional(session.handle, "Players", contexts);
      if (!players.handle) return { ok: true, available: true, players: null, unavailable: players.unavailable };
      if (args.personPath === undefined) return { ok: true, players: players.read.value, liveVerified: false };
      if (typeof args.personPath !== "string" || !args.personPath) throw new Error("需要原始注册候选中的personPath。");
      if (typeof args.selected !== "boolean") throw new Error("selected必须是明确的布尔注册意图。");
      const person = { source: players.handle, path: args.personPath };
      const scoped = { ...contexts, Person: person, person };
      const current = await scope.subscribe(session.handle, "Selected", scoped);
      const editable = await scope.subscribe(session.handle, "CanChangeSelection", scoped);
      const query = { team: team.handle, session: session.handle, players: players.handle, personPath: args.personPath,
        current: current.handle, editable: editable.handle, selected: args.selected };
      const preview = await scope.api("/api/v1/registration/player-preview", query);
      if (!execute) return args.operationId ? { ...preview, observation: await scope.api("/api/v1/registration/player-state", { ...query, operationId: args.operationId }) } : preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("注册选择或权限已变化，请重新预览。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/registration/player-execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
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
