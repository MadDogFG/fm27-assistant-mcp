import { createLiveClient } from "./live-client.mjs";

// Confirm a match-preparation training session (event 846022770, target=human.TrainingCalendar, data=row EventData).
export function createMatchPreparationTools(call) {
  const client = createLiveClient(call);
  const preparation = "singleton:MatchPreparation";
  async function context(args, perform) {
    if (args.sessionIndex === undefined) throw new Error("需要 sessionIndex（MatchPreparationSessions 行下标）。");
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const contexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle } };
      const calendar = await scope.subscribe("human", "TrainingCalendar", contexts);
      const sessions = await scope.subscribe(preparation, "MatchPreparationSessions", contexts);
      const row = { source: sessions.handle, path: String(args.sessionIndex) };
      const eventData = await scope.subscribe(row, "EventData", contexts);
      return perform(scope, { calendar: calendar.handle, eventData: eventData.handle });
    });
  }
  return {
    preview: args => args.sessionIndex === undefined ? client.scope(async scope => {
      const availability = await scope.subscribeOptional(preparation, "MatchPreparationAvailability");
      const sessions = await scope.subscribeOptional(preparation, "MatchPreparationSessions");
      return { ok: true, ready: sessions.read.value?.kind === "list", availability: availability.read.value,
        sessions: sessions.read.value, availabilityUnavailable: availability.unavailable,
        sessionsUnavailable: sessions.unavailable, liveVerified: false };
    }) : context(args, async (scope, query) =>
      ({ ...await scope.api("/api/v1/match-preparation/session-confirm-preview", query), draftOnly: true, liveVerified: false })),
    confirm: args => {
      if (!args.operationId || !args.expectedChoiceToken) throw new Error("提供 token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/match-preparation/session-confirm-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("赛前准备会话变化，请重新预览。");
        return { ...await scope.api("/api/v1/match-preparation/session-confirm-execute", { ...query, id: args.operationId,
          choiceToken: args.expectedChoiceToken }, true), sessionConfirmed: false };
      });
    }
  };
}
