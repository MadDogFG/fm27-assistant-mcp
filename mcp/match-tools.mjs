import { randomUUID } from "node:crypto";
import { createLiveClient, scalar, clean } from "./live-client.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createMatchTools(call) {
  const client = createLiveClient(call);
  async function scoreboard(original) {
    return client.scope(async scope => {
      const home = await scope.subscribe("match", "MatchHomeScore");
      const away = await scope.subscribe("match", "MatchAwayScore");
      if ([home, away].some(channel => channel.reference?.identity !== original.matchIdentity || channel.read.epoch !== original.epoch))
        throw new Error("比分频道不属于当前比赛。");
      const [homeRead, awayRead] = await Promise.all([scope.ready(home.handle), scope.ready(away.handle)]);
      const current = await scope.api("/api/v1/match/state");
      if (!current.inMatch || current.matchIdentity !== original.matchIdentity || current.epoch !== original.epoch || current.sessionId !== original.sessionId ||
          homeRead.revision !== home.read.revision || awayRead.revision !== away.read.revision)
        throw new Error("读取期间比分或比赛发生变化，请刷新。");
      const scores = [homeRead, awayRead].map(read => scalar(read.value));
      if (scores.some(value => typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))))
        throw new Error("游戏尚未返回数字比分。");
      return { home: Number(scores[0]), away: Number(scores[1]), source: "MatchHomeScore/MatchAwayScore", finished: current.finished === true };
    });
  }
  async function onPitch(args, action) {
    return client.scope(async scope => {
      const state = await scope.api("/api/v1/match/state");
      if (!state.inMatch) throw new Error("当前没有比赛实例。");
      const isHomeTeam = args.isHomeTeam ?? state.isHomeTeam;
      if (typeof isHomeTeam !== "boolean") throw new Error("请指定 isHomeTeam 以读取主队或客队。");
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { isHomeTeam, IsHomeTeam: isHomeTeam, human, Human: human, team: teamRef, Team: teamRef };
      const list = await scope.subscribe("match", "PlayerMatchStatsOnPitch", contexts);
      const players = [], unresolved = [], resolutions = [];
      for (let index = 0; index < (list.read.value?.items?.length || 0); index++) {
        let source = { source: list.handle, path: String(index) };
        try {
          let person, key;
          for (let depth = 0; depth < 3; depth++) {
            try { key = await scope.api("/api/v1/match/person-key", source); person = source; break; }
            catch { /* A statistics record may expose Name/UniqueId too; only the native person type establishes identity. */ }
            const metadata = await scope.properties(source);
            const property = ["Person", "Player", "MatchPlayer"].find(name => metadata.some(p => p.name.split(":")[0] === name));
            if (!property) break;
            const reference = await scope.subscribe(source, property, contexts);
            source = { source: reference.handle };
          }
          if (!person) throw new Error("无法解析比赛统计中的球员引用。");
          if (!Number.isInteger(key.databaseIndex) || key.databaseIndex < 0 || key.epoch !== state.epoch || key.sessionId !== state.sessionId)
            throw new Error("球员标识无效或属于另一游戏会话。");
          if (players.some(player => player.databaseIndex === key.databaseIndex)) throw new Error("场上名单包含重复的球员标识。");
          const name = await scope.subscribe(person, "Name", contexts);
          players.push({ databaseIndex: key.databaseIndex, playerReference: key.reference, name: scalar(name.read.value) });
          resolutions.push(person);
        } catch (error) { unresolved.push({ row: index, error: String(error.message || error) }); }
      }
      const finalList = await scope.api("/api/v1/live/read", { handle: list.handle, depth: 6 });
      const finalState = await scope.api("/api/v1/match/state");
      const stale = finalState.matchIdentity !== state.matchIdentity || finalState.epoch !== state.epoch || finalState.sessionId !== state.sessionId ||
        JSON.stringify(finalList.value) !== JSON.stringify(list.read.value);
      const result = { ok: true, source: "native_PlayerMatchStatsOnPitch", matchIdentity: state.matchIdentity,
        epoch: state.epoch, sessionId: state.sessionId, isHomeTeam, currentTimeSlice: state.currentTimeSlice,
        total: list.read.value?.count, players, unresolved, truncated: Boolean(list.read.value?.truncated),
        snapshotStale: stale,
        complete: !stale && list.read.value?.kind === "list" && !list.read.value.truncated && unresolved.length === 0 && players.length === list.read.value.count };
      return action ? action({ scope, roster: list.handle, resolutions, result }) : result;
    });
  }
  async function withTactic(action, requireValid = false) {
    return client.scope(async scope => {
      const state = await scope.api("/api/v1/match/state");
      if (!state.inMatch || state.pastMatch || state.replay || state.finished || state.spectating)
        throw new Error("当前不是玩家执教中的未结束比赛。");
      const { tactic } = await scope.tactic();
      const pending = await scope.subscribe(tactic.handle, "CanRevert");
      const valid = requireValid ? await scope.subscribe(tactic.handle, "IsTeamSelectionValid") : null;
      return action({ scope, state, tactic, pending, valid });
    });
  }
  async function draft(args, action) {
    const receipt = await withTactic(async ({ scope, tactic, pending, valid }) => {
      const current = scalar(pending.read.value)?.toLowerCase();
      if (!["true", "false"].includes(current)) throw new Error("游戏尚未返回战术草稿状态。");
      const expected = args.expectedPending ?? current === "true";
      return scope.api("/api/v1/match/draft", { id: args.operationId || randomUUID(), action, tactic: tactic.handle,
        pending: pending.handle, valid: valid?.handle, expected, mutationCursor: args.mutationCursor }, true);
    }, action === "confirm");
    if (receipt.verified || receipt.status !== "dispatched_unverified") return receipt;
    const until = Date.now() + 8000;
    let observed = receipt;
    do {
      try {
        observed = await withTactic(({ scope, tactic, pending }) => scope.api("/api/v1/match/draft-state", {
          operationId: receipt.operationId, action, tactic: tactic.handle, pending: pending.handle }));
      } catch (error) { return { ...receipt, verificationError: String(error.message || error) }; }
      if (observed.verified || observed.status === "session_changed") break;
      await pause(150);
    } while (Date.now() < until);
    return { ...observed, matchEffectVerified: false,
      note: "这里只核对战术草稿已提交/取消；换人是否上场及比赛中的实际执行需要读取场上状态确认。" };
  }
  return {
    state: async (args = {}) => {
      const state = await client.api("/api/v1/match/state", { operationId: args.operationId });
      if (!state.inMatch || state.pastMatch || state.replay || state.spectating) return state;
      if (args.includeScore === true) {
        try { state.score = await scoreboard(state); }
        catch (error) { state.scoreReadError = String(error.message || error); }
      }
      if (state.finished) return state;
      try {
        return await withTactic(async ({ state: current, pending }) => {
          if (current.matchIdentity !== state.matchIdentity || current.epoch !== state.epoch || current.sessionId !== state.sessionId)
            throw new Error("当前比赛已变化，请刷新。");
          return { ...state, tacticalDraftPending: scalar(pending.read.value)?.toLowerCase() === "true" };
        });
      } catch (error) { return { ...state, draftReadError: String(error.message || error) }; }
    },
    setPlaying: async args => {
      if (typeof args.playing !== "boolean") throw new Error("playing 必须为布尔值。");
      const state = await client.api("/api/v1/match/state");
      if (!state.inMatch || !state.matchIdentity || !state.sessionId || !Number.isSafeInteger(state.epoch))
        throw new Error("当前没有可识别的比赛会话。");
      if (args.expectedMatchIdentity && state.matchIdentity !== args.expectedMatchIdentity) throw new Error("当前比赛已变化，请刷新。");
      const receipt = await client.api("/api/v1/match/set-playing", { id: args.operationId || randomUUID(),
        playing: args.playing, expected: args.expectedPlaying ?? state.playing, mutationCursor: args.mutationCursor,
        matchIdentity: state.matchIdentity, sessionId: state.sessionId, epoch: state.epoch }, true);
      if (receipt.verified || receipt.status !== "dispatched_unverified") return receipt;
      const until = Date.now() + 8000;
      let observed = receipt;
      do {
        try { observed = await client.api("/api/v1/match/state", { operationId: receipt.operationId }); }
        catch (error) { return { ...receipt, verificationError: String(error.message || error) }; }
        if (observed.verified || observed.status === "session_changed" || observed.inMatch === false) break;
        await pause(150);
      } while (Date.now() < until);
      return observed;
    },
    begin: args => withTactic(({ scope, tactic, pending }) => scope.api("/api/v1/match/begin-draft", { id: args.operationId || randomUUID(), tactic: tactic.handle, pending: pending.handle, mutationCursor: args.mutationCursor, data: typeof args.data === "boolean" ? String(args.data) : undefined }, true)),
    onPitch,
    withOnPitch: onPitch,
    withTactic,
    verifySubstitution: async args => {
      if (!Number.isInteger(args.outgoingDatabaseIndex) || !Number.isInteger(args.incomingDatabaseIndex) || args.outgoingDatabaseIndex === args.incomingDatabaseIndex)
        throw new Error("需要不同的上下场球员 databaseIndex，可从实时球员引用和场上名单读取。");
      const result = await onPitch(args);
      const incomingPresent = result.players.some(p => p.databaseIndex === args.incomingDatabaseIndex);
      const outgoingPresent = result.players.some(p => p.databaseIndex === args.outgoingDatabaseIndex);
      let pending;
      try {
        pending = await client.scope(async scope => {
          const state = await scope.api("/api/v1/match/state");
          if (state.matchIdentity !== result.matchIdentity || state.sessionId !== result.sessionId || state.epoch !== result.epoch)
            return null;
          const contexts = { isHomeTeam: result.isHomeTeam };
          const flag = await scope.subscribeOptional("match", "MatchTeamHasPendingChanges", contexts);
          const description = await scope.subscribeOptional("match", "MatchTeamPendingChangesDescription", contexts);
          return { active: scalar(flag.read.value), description: clean(scalar(description.read.value)) || null };
        });
      } catch {}
      return { ...result, verified: result.complete && incomingPresent && !outgoingPresent,
        verificationScope: "observed_on_pitch_players", incomingPresent, outgoingPresent, pending: pending ?? null,
        note: "这是当前场上名单的独立证据，不等同于特定命令的因果确认。" };
    },
    confirm: args => draft(args, "confirm"),
    cancel: args => draft(args, "cancel")
  };
}
