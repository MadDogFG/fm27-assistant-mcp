import { createLiveClient } from "./live-client.mjs";

// Club vision meeting draft: human.Club -> ClubVisionMeetingEditSession, flags + possible objectives,
// then add-objective / undo / revert / suggest / confirm events. No live acceptance is claimed.
export function createClubVisionTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club", { Human: human, human });
      const contexts = { Human: human, human, Club: { source: club.handle }, club: { source: club.handle },
        ClubVisionNegotiationType: Number.isInteger(args.clubVisionNegotiationType) ? args.clubVisionNegotiationType : 0,
        VisionObjectiveYear: Number.isInteger(args.visionObjectiveYear) ? args.visionObjectiveYear : 0 };
      const session = await scope.subscribeOptional(club.handle, "ClubVisionMeetingEditSession", contexts);
      if (!session.handle) return { ok: true, available: false, unavailable: session.unavailable, action: args.action };
      const query = { session: session.handle };
      query.canEdit = (await scope.subscribe(session.handle, "CanEdit", contexts)).handle;
      query.canUndo = (await scope.subscribe(session.handle, "CanUndo", contexts)).handle;
      query.canRevert = (await scope.subscribe(session.handle, "CanRevert", contexts)).handle;
      query.canConfirm = (await scope.subscribe(session.handle, "CanConfirmTerms", contexts)).handle;
      query.canSuggest = (await scope.subscribe(session.handle, "CanSuggestTerms", contexts)).handle;
      query.possible = (await scope.subscribe(session.handle, "ClubVisionMeetingPossibleObjectivesToAdd", contexts)).handle;
      if (!args.action) return perform(scope, query, false);
      query.action = args.action; query.optionPath = args.optionPath;
      if (args.action === "remove-objective") {
        query.objectives = (await scope.subscribe(session.handle,
          args.objectivesKind === "year" ? "ClubVisionMeetingObjectivesForYear" : "ClubVisionMeetingActionableObjectives", contexts)).handle;
        query.objectivePath = args.objectivePath;
        if (args.objectivePath === undefined) throw new Error("remove-objective 需要 objectivePath 与 objectivesKind。");
      }
      return perform(scope, query, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, complete) => {
      const state = await scope.api("/api/v1/club-vision/state", query);
      return complete ? { ...state, ...await scope.api("/api/v1/club-vision/preview", query), draftOnly: true, liveVerified: false }
        : { ...state, draftOnly: true, liveVerified: false };
    }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken) throw new Error("提供 action、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/club-vision/preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("俱乐部愿景草稿变化，请重新预览。");
        return { ...await scope.api("/api/v1/club-vision/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          clubVisionConfirmed: false };
      });
    }
  };
}
