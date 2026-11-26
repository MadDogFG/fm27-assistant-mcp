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
    // CLB-O09 (Review #41): 预览、请求或确认结束现有附属俱乐部关系，严格绑定母俱乐部与目标附属俱乐部稳定身份及 choiceToken
    // 两家附属俱乐部调换顺序或列表变化时必须拒绝过期确认，零派发（且绝不触碰 ProposedAffiliateClubs）
    cancelLink: async ({ action, confirm = false, affiliateIndex, expectedAffiliateIdentity, expectedChoiceToken, operationId } = {}) => {
      const mode = action || (confirm ? "confirm" : (affiliateIndex === undefined && !expectedAffiliateIdentity ? "preview" : "request"));
      if (!["preview", "request", "confirm"].includes(mode)) {
        throw new Error(`未知附属关系解除动作: ${mode}（支持 preview/request/confirm）`);
      }
      if (mode !== "preview") {
        if (!Number.isInteger(affiliateIndex) || affiliateIndex < 0) {
          throw new Error("必须提供有效的非负整数 affiliateIndex。");
        }
        if (!expectedAffiliateIdentity || typeof expectedAffiliateIdentity !== "string") {
          throw new Error("必须先预览并传入目标附属俱乐部的 expectedAffiliateIdentity，防止列表顺序变化误解除其他俱乐部关系。");
        }
        if (mode === "confirm" && (!expectedChoiceToken || typeof expectedChoiceToken !== "string")) {
          throw new Error("确认解除附属关系必须提供上次预览/请求返回的 expectedChoiceToken 与固定 operationId。");
        }
      }
      const id = operationId || `affiliate_cancel_${mode}_${Date.now()}`;
      return client.scope(async scope => {
        const human = { source: "human" };
        const club = await scope.subscribe("human", "Club", { Human: human, human });
        const clubIdentity = club.read?.value?.identity || null;
        const contexts = { Human: human, human, Club: { source: club.handle }, club: { source: club.handle } };
        const list = await scope.resolveRefList(club.handle, "AffiliatedClubsList", contexts, 30);
        const affiliates = Array.isArray(list?.items) ? list.items : [];
        const makeToken = (idx, affId) => `${clubIdentity || "club"}|aff:${affId}|idx:${idx}`;

        if (mode === "preview") {
          const candidates = affiliates.map(a => ({
            affiliateIndex: a.index,
            affiliateIdentity: a.identity,
            affiliateName: a.name || null,
            choiceToken: a.identity ? makeToken(a.index, a.identity) : null
          }));
          return {
            ok: true,
            readOnly: true,
            parentClubIdentity: clubIdentity,
            count: list?.count ?? candidates.length,
            affiliates: candidates
          };
        }

        if (affiliateIndex >= affiliates.length) {
          return {
            ok: false,
            blocked: true,
            reason: `affiliateIndex=${affiliateIndex} 超出当前附属俱乐部数量(${affiliates.length})，已阻断且零派发。`,
            parentClubIdentity: clubIdentity,
            affiliates,
            zeroDispatches: true
          };
        }
        const target = affiliates[affiliateIndex];
        if (!target?.identity || target.identity !== expectedAffiliateIdentity) {
          return {
            ok: false,
            blocked: true,
            reason: `附属俱乐部列表顺序或内容已变化：下标 ${affiliateIndex} 当前为 "${target?.name || target?.identity}"，与预期 "${expectedAffiliateIdentity}" 不符，已拒绝派发。`,
            parentClubIdentity: clubIdentity,
            expectedAffiliateIdentity,
            observedAffiliate: target || null,
            zeroDispatches: true
          };
        }
        const liveToken = makeToken(affiliateIndex, target.identity);
        if (expectedChoiceToken && expectedChoiceToken !== liveToken) {
          return {
            ok: false,
            blocked: true,
            reason: "附属关系确认令牌已过期（母俱乐部或附属列表位置已变更），已拒绝确认且零派发。",
            parentClubIdentity: clubIdentity,
            expectedChoiceToken,
            currentChoiceToken: liveToken,
            zeroDispatches: true
          };
        }
        const eventName = mode === "confirm" ? "EventFmxAffiliateCancelLinkConfirm" : "EventFmxAffiliateCancelLink";
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(club.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(affiliateIndex) }
        );
        const afterList = await scope.resolveRefList(club.handle, "AffiliatedClubsList", contexts, 30).catch(() => null);
        return {
          ok: true,
          operationId: id,
          action: mode,
          confirm: mode === "confirm",
          parentClubIdentity: clubIdentity,
          affiliateIndex,
          affiliateIdentity: target.identity,
          affiliateName: target.name || null,
          choiceToken: liveToken,
          eventName,
          observedAfterCount: afterList?.count ?? null,
          dispatch: send
        };
      });
    }
  };
}
