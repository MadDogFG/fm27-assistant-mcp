import { createLiveClient } from "./live-client.mjs";

// Club affiliate proposal draft: human.Club -> AffiliateEditSession, with proposed/selected clubs and
// the CanCommitAffiliateProposal gate. Selection/propose/cancel events come from the ClubAffiliatesBlock asset.
export function createClubAffiliateTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club", { Human: human, human });
      const contexts = { Human: human, human, Club: { source: club.handle }, club: { source: club.handle },
        ProposedAffiliateViewpoint: Number.isInteger(args.proposedAffiliateViewpoint) ? args.proposedAffiliateViewpoint : 0 };
      // Session-bound panel references: a missing/absent affiliate session must stop here. Do not
      // subscribe child channels just to discover they never become ready — polling those channels
      // while no session exists crashed FM on 2026-11-20 (ProposedAffiliateClubs).
      const session = await scope.subscribeOptional(club.handle, "AffiliateEditSession", contexts, 1500);
      if (!session.handle) return { ok: true, available: false, unavailable: session.unavailable, action: args.action, guarded: "session" };
      const canCommit = await scope.subscribeOptional(session.handle, "CanCommitAffiliateProposal", contexts, 1500);
      if (!canCommit.handle) return { ok: true, available: false, unavailable: canCommit.unavailable, action: args.action, guarded: "canCommit" };
      const count = await scope.subscribeOptional(session.handle, "Count", contexts, 1500);
      if (!count.handle) return { ok: true, available: false, unavailable: count.unavailable, action: args.action, guarded: "count" };
      const proposed = await scope.subscribeOptional(session.handle, "ProposedAffiliateClubs", contexts, 1500);
      const selected = await scope.subscribeOptional(session.handle, "SelectedAffiliateClub", contexts, 1500);
      if (!proposed.handle || !selected.handle)
        return { ok: true, available: false, unavailable: (proposed.unavailable || selected.unavailable), action: args.action, guarded: "children" };
      const query = { session: session.handle, club: club.handle, canCommit: canCommit.handle, count: count.handle,
        proposed: proposed.handle, selected: selected.handle };
      if (!args.action) return perform(scope, query, false);
      query.action = args.action;
      if (args.index !== undefined) query.index = args.index;
      return perform(scope, query, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete) => {
      const state = await scope.api("/api/v1/club-affiliate/state", query);
      if (!complete) return { ok: true, ...state, draftOnly: true, liveVerified: false };
      return { ...state, ...await scope.api("/api/v1/club-affiliate/preview", query), draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供 action、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/club-affiliate/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("关联俱乐部草稿变化，请重新预览。");
        return { ...await scope.api("/api/v1/club-affiliate/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          affiliateLinkCreated: false };
      });
    },
    // CLB-O09: 请求或确认结束现有附属俱乐部关系（不触碰 ProposedAffiliateClubs）
    cancelLink: async ({ confirm = false, affiliateIndex = 0, operationId } = {}) => {
      if (!Number.isInteger(affiliateIndex) || affiliateIndex < 0) {
        throw new Error("affiliateIndex 必须为非负整数。");
      }
      const id = operationId || `affiliate_cancel_${confirm ? "confirm" : "req"}_${Date.now()}`;
      return client.scope(async scope => {
        const human = { source: "human" };
        const club = await scope.subscribe("human", "Club", { Human: human, human });
        const eventName = confirm ? "EventFmxAffiliateCancelLinkConfirm" : "EventFmxAffiliateCancelLink";
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(club.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(affiliateIndex) }
        );
        return { ok: true, operationId: id, confirm: Boolean(confirm), affiliateIndex, eventName, dispatch: send };
      });
    }
  };
}
