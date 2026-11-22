import { randomUUID } from "node:crypto";
import { createLiveClient, clean, scalar } from "./live-client.mjs";
import { createPlayerTools } from "./player-tools.mjs";
import { createMatchTools } from "./match-tools.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createSubstitutionTools(call) {
  const client = createLiveClient(call), player = createPlayerTools(call), match = createMatchTools(call);
  const status = id => client.api("/api/v1/match/substitution-status", { id });
  async function planned(args, action) {
    if (!Number.isInteger(args.selectionIndex) || args.selectionIndex < 0 || args.selectionIndex > 10) throw new Error("换人需要 0..10 的场上槽位。");
    return player.withLineup(args, async ({ scope, tactic, options, current, choices }) => {
      const matches = choices.filter(row => row.selectable && [row.player, row.name, row.databaseIndex].some(value => String(value) === clean(args.player)));
      if (matches.length !== 1) throw new Error("从原生候选中选择唯一的替补球员。");
      const candidate = matches[0];
      const pending = await scope.subscribe(tactic.handle, "CanRevert");
      if (scalar(pending.read.value) === "True") throw new Error("已有未确认战术草稿，先处理原草稿。");
      const sourceIndex = Number(candidate.currentSelectionIndex);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 11 || sourceIndex > 25) throw new Error("原生候选不在替补槽位。");
      const pitch = await scope.subscribe(tactic.handle, "PositionFromTeamSelectionIndex", { TeamSelectionIndex: args.selectionIndex, InPossession: true });
      const fields = pitch.read.value?.fields;
      if (!current.read.value?.identity || fields?.["0x706c7972"]?.identity !== current.read.value.identity ||
          Number(scalar(fields?.["0x70496479"])) !== args.selectionIndex)
        throw new Error(`战术位置 ${args.selectionIndex} 与阵容选人槽位不一致，未派发换人。`);
      const bench = await scope.subscribe(tactic.handle, "PlayerFromTeamSelectionIndex", { TeamSelectionIndex: sourceIndex, InPossession: true });
      if (bench.read.value?.identity !== candidate.player) throw new Error("替补席阵容槽位已变化，未派发换人。");
      const query = { tactic: tactic.handle, options: options.handle, current: current.handle, pending: pending.handle,
        option: matches[0].optionIndex, slot: args.selectionIndex, playbackPolicy: args.playbackPolicy || "restore" };
      return action({ scope, query, choice: matches[0] });
    });
  }
  async function roster(root, route) {
    return match.withOnPitch({ isHomeTeam: root.plan.isHomeTeam }, async ({ scope, roster, resolutions, result }) => {
      if (!result.complete || result.matchIdentity !== root.plan.matchIdentity || result.epoch !== root.plan.epoch || result.sessionId !== root.plan.sessionId)
        throw new Error("场上名单不完整、已改变或属于另一场比赛，不能作为换人证据。");
      return scope.api(route, { id: root.operationId, roster, resolutions }, true);
    });
  }
  async function observe(id) {
    const root = await status(id);
    if (root.verified || root.sessionChanged || root.nextPhase || root.phaseStarted) return root;
    try { return await roster(root, "/api/v1/match/substitution-observe"); }
    catch (error) { return { ...root, effectObservationError: String(error.message || error) }; }
  }
  const progress = (id, phase, action, error) => client.api("/api/v1/match/substitution-phase", { id, phase, action, error }, true);
  const completePick = root => client.scope(async scope => {
    const { tactic } = await scope.tactic();
    const ip = await scope.subscribe(tactic.handle, "TacticalPositionsMatchInformation", { InPossession: true });
    const oop = await scope.subscribe(tactic.handle, "TacticalPositionsMatchInformation", { InPossession: false });
    return scope.api("/api/v1/match/substitution-phase", { id: root.operationId, phase: "pick", action: "complete",
      tactic: tactic.handle, ip: ip.handle, oop: oop.handle }, true);
  });
  function replyKnown(value) {
    if (value?.status?.includes("unknown") || value?.status === "cancelled_before_execution" || value?.ok === false)
      throw new Error(`阶段结果未确认：${value.error || value.status || "unknown"}；保留原请求号，不重发。`);
    return value;
  }
  async function recoverPhase(root) {
    const phase = root.nextPhase, id = root.plan.stepIds[phase];
    if (phase === "baseline") return roster(root, "/api/v1/match/substitution-baseline");
    // Recovery is readonly toward the game. Never reissue an already-started native step.
    if (["pause", "resume", "restore_paused"].includes(phase)) await client.api("/api/v1/match/state", { operationId: id });
    else if (phase === "pick") return replyKnown(await completePick(root));
    else if (phase === "confirm") await match.withTactic(({ scope, tactic, pending }) => scope.api("/api/v1/match/draft-state", {
      operationId: id, action: "confirm", tactic: tactic.handle, pending: pending.handle }));
    return replyKnown(await progress(root.operationId, phase, "complete"));
  }
  async function run(root, recover) {
    const id = root.operationId;
    try {
      if (root.verified || root.sessionChanged) return root;
      if (!root.nextPhase && !root.phaseStarted) return observe(id);
      if (root.phaseStarted) {
        if (!recover) return { ...root, note: "阶段已启动；只读查询或显式恢复，不会重新执行。" };
        root = await recoverPhase(root);
      }
      if (root.status === "interrupted") {
        if (!recover) return root;
        root = replyKnown(await progress(id, root.nextPhase, "continue"));
      }
      while (root.nextPhase) {
        const phase = root.nextPhase;
        root = replyKnown(await progress(id, phase, "start")); // fsync before native child call
        const plan = root.plan, commandId = plan.stepIds[phase], guard = { operationId: commandId, mutationCursor: plan.mutationCursor,
          expectedMatchIdentity: plan.matchIdentity };
        let receipt;
        if (phase === "pause") receipt = await match.setPlaying({ ...guard, playing: false, expectedPlaying: true });
        else if (phase === "baseline") { root = replyKnown(await roster(root, "/api/v1/match/substitution-baseline")); continue; }
        else if (phase === "begin") receipt = await match.begin(guard);
        else if (phase === "pick") receipt = await player.pickPlayer({ ...guard, selectionIndex: plan.selectionIndex,
          player: plan.incomingReference, expectedPlayer: plan.outgoingReference });
        else if (phase === "confirm") receipt = await match.confirm({ ...guard, expectedPending: true });
        else if (phase === "resume") receipt = await match.setPlaying({ ...guard, playing: true });
        else if (phase === "restore_paused") receipt = await match.setPlaying({ ...guard, playing: false });
        else throw new Error("未知换人阶段，未执行。");
        replyKnown(receipt);
        if (phase === "pick" && !receipt.verified && receipt.status === "dispatched_unverified") {
          root = replyKnown(await completePick(root));
          continue;
        }
        if (phase !== "begin" && !receipt.verified) throw new Error("原生阶段尚未读回确认，流程停止，不自动重发。");
        root = replyKnown(await progress(id, phase, "complete")); // server checks exact native child receipt
      }
      const until = Date.now() + 8000;
      do {
        root = await observe(id);
        if (root.verified || root.sessionChanged || root.effectObservationError) break;
        await pause(200);
      } while (Date.now() < until);
      return root;
    } catch (error) {
      try { await progress(id, root.nextPhase || "", "interrupt", String(error.message || error)); } catch { /* preserve first error and original parent ID */ }
      let stored = root;
      try { stored = await status(id); } catch { /* result remains unknown */ }
      return { ...stored, operationId: id, retrySafe: false, workflowError: String(error.message || error),
        nextAction: "保留父 operationId 查询；恢复只读核验已启动阶段，未证明完成的原生步骤不会重发。" };
    }
  }
  return {
    preview: args => planned(args, async ({ scope, query, choice }) => ({ ...await scope.api("/api/v1/match/substitution-preview", query), incomingName: choice.name })),
    execute: async args => {
      if (!args.expectedPlanToken) throw new Error("先预览完整换人计划，再提供 expectedPlanToken。");
      const id = args.operationId || randomUUID();
      let registered;
      try { registered = await planned(args, ({ scope, query }) => scope.api("/api/v1/match/substitution-register", {
        ...query, id, planToken: args.expectedPlanToken }, true)); }
      catch (error) { return { ok: false, operationId: id, status: "registration_result_unknown", executionStarted: false, retrySafe: false,
        error: String(error.message || error) }; }
      if (!registered.newlyRegistered) return registered.workflow ? { ...registered.workflow, note: "已有持久化意图，未重复执行；使用查询或显式恢复。" } :
        { ...registered, operationId: id, executionStarted: false, retrySafe: false };
      return run(registered.workflow, false);
    },
    status: args => observe(args.operationId),
    resume: async args => {
      const root = await status(args.operationId);
      if (!args.expectedPlanToken || args.expectedPlanToken !== root.plan.planToken) throw new Error("恢复必须提供原计划 token，不接受改变原换人意图。");
      return run(root, true);
    }
  };
}
