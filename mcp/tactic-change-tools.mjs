import { createLiveClient, clean } from "./live-client.mjs";

// Tactic change lifecycle: next-match-only (1933068080), cancel (846559841, CanRevert),
// confirm (1937405795, CanConfirmChanges).
export function createTacticChangeTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const t = await scope.tactic();
      const tactic = t.tactic.handle;
      const contexts = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
      const canRevert = await scope.subscribe(tactic, "CanRevert", contexts);
      let canConfirm = null;
      try { canConfirm = await scope.subscribe(tactic, "CanConfirmChanges", contexts); } catch (error) { canConfirm = null; }
      return perform(scope, { tactic, canRevert: canRevert.handle, canConfirm: canConfirm ? canConfirm.handle : "",
        canRevertValue: canRevert.read?.value ?? null });
    });
  }
  return {
    state: args => context(args, async (scope, query) => {
      if (args.action) {
        if (args.action === "confirm" && !query.canConfirm) throw new Error("当前战术引用未暴露 CanConfirmChanges，本版无法预览确认动作。");
        return { ...await scope.api("/api/v1/tactics/change/preview", { ...query, action: args.action, value: args.value }),
          draftOnly: true, liveVerified: false };
      }
      return query.canConfirm
        ? ({ ...await scope.api("/api/v1/tactics/change/state", query), draftOnly: true, liveVerified: false })
        : ({ ok: true, tacticIdentity: null, canRevert: query.canRevertValue, canConfirmChanges: null,
            note: "当前战术引用未提供 CanConfirmChanges（比赛内战术或不同引用类型），确认动作不可用；取消与仅下一场仍可预览。",
            draftOnly: true, liveVerified: false });
    }),
    preview: args => context(args, async (scope, query) => {
      if (args.action === "confirm" && !query.canConfirm) throw new Error("当前战术引用未暴露 CanConfirmChanges，本版无法预览确认动作。");
      return { ...await scope.api("/api/v1/tactics/change/preview", { ...query, action: args.action, value: args.value }), draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供 action、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        if (args.action === "confirm" && !query.canConfirm) throw new Error("当前战术引用未暴露 CanConfirmChanges，本版无法确认变化。");
        const preview = await scope.api("/api/v1/tactics/change/preview", { ...query, action: args.action, value: args.value });
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("战术变化状态已变，请重新预览。");
        return { ...await scope.api("/api/v1/tactics/change/execute", { ...query, action: args.action, value: args.value,
          id: args.operationId, choiceToken: args.expectedChoiceToken }, true), applied: false };
      });
    },
    // TAC-O06: 通过 Tactic.Name 属性更新并读回校验重命名当前战术，严格区分 unchanged / verified / unverified 三态
    rename: async ({ name } = {}) => {
      const trimmed = clean(String(name || "")).trim();
      if (!trimmed) throw new Error("必须提供新的战术名称 name。");
      return client.scope(async scope => {
        const t = await scope.tactic();
        const tactic = t.tactic.handle;
        const nameCtx = { ...t.contexts, Tactic: { source: tactic }, tactic: { source: tactic } };
        const nameSub = await scope.subscribe(tactic, "Name", nameCtx);
        const beforeRaw = nameSub.read?.value?.value ?? null;
        const beforeName = beforeRaw === null ? null : clean(beforeRaw);
        if (beforeName === trimmed) {
          return {
            ok: true,
            status: "unchanged",
            changed: false,
            verified: false,
            beforeName,
            requestedName: trimmed,
            afterName: beforeName,
            note: "当前战术名称已是目标名称，未派发写入。"
          };
        }
        const upd = await call(
          `/api/v1/internal/update?handle=${encodeURIComponent(nameSub.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trimmed) }
        );
        await new Promise(r => setTimeout(r, 250));
        const afterSub = await scope.subscribe(tactic, "Name", nameCtx);
        const afterRaw = afterSub.read?.value?.value ?? null;
        const afterName = afterRaw === null ? null : clean(afterRaw);
        const matched = afterName === trimmed || afterName === JSON.stringify(trimmed);
        if (matched) {
          return {
            ok: true,
            status: "verified",
            changed: true,
            verified: true,
            beforeName,
            requestedName: trimmed,
            afterName,
            update: upd
          };
        }
        return {
          ok: false,
          status: "unverified",
          changed: false,
          verified: false,
          beforeName,
          requestedName: trimmed,
          afterName,
          error: `战术改名已派发，但独立读回仍为 "${afterName ?? "(空)"}"，未确认生效。`,
          update: upd
        };
      });
    }
  };
}
