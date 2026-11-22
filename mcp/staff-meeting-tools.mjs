import { createLiveClient } from "./live-client.mjs";

// Staff-meeting bulk advice: human/team StaffMeeting -> ApplyAllAdviceAllMatches (70696).
export function createStaffMeetingTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      let staffMeeting;
      try { staffMeeting = await scope.subscribe("human", "StaffMeeting", contexts); }
      catch {
        try { staffMeeting = await scope.subscribe(team.handle, "StaffMeeting", contexts); }
        catch {
          const club = await scope.subscribe("human", "Club");
          const dt = await scope.subscribe("game", "CurrentGameDate");
          const clubCtx = { ...contexts, club: { source: club.handle }, Club: { source: club.handle }, Date: { valueSource: dt.handle }, AdviceDeliveryType: 0 };
          staffMeeting = await scope.subscribe(club.handle, "StaffMeeting", clubCtx);
        }
      }
      return perform(scope, { staffMeeting: staffMeeting.handle });
    });
  }
  return {
    preview: args => context(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/staff-meeting/apply-all-preview", query), draftOnly: true, liveVerified: false })),
    applyAll: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/staff-meeting/apply-all-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("Staff meeting 状态变化，请重新预览。");
        return { ...await scope.api("/api/v1/staff-meeting/apply-all-execute", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), adviceApplied: false };
      });
    }
  };
}
