using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Confirm a match-preparation training session from the menu. Full UI index (evidence/v95-match-preparation-session.json):
// MatchPreparationSessionDropdownRow fires ConfirmTrainingSessionFromMenu (846022770) with
// target=human.trainingcalendar and data=row.eventdata; MatchPreparationDropdownRowReference exposes EventData.
// Static evidence only; no live dispatch.
public static class MatchPreparationSessionCommands
{
    private static InteropReference Calendar(string calendar)
    {
        var target = LiveTools.GetReference(calendar);
        var snapshot = LiveTools.GetSnapshot(calendar);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("TrainingCalendar") ||
            !string.IsNullOrEmpty(snapshot.SourcePath))
            throw new ArgumentException("Resolve the manager's human.TrainingCalendar reference.");
        return target;
    }
    private static TypedValue EventData(string eventData)
    {
        var snapshot = LiveTools.GetSnapshot(eventData);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("EventData"))
            throw new ArgumentException("Provide a live MatchPreparationDropdownRow EventData subscription.");
        if (snapshot.Value == null || snapshot.Value.IsNull) throw new ArgumentException("Session EventData is empty.");
        return TypedValue.CreateCopyFrom(snapshot.Value);
    }
    private static (InteropReference Target, TypedValue Payload, string Token) Prepare(string calendar, string eventData)
    {
        var target = Calendar(calendar);
        var payload = EventData(eventData);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "confirm-match-preparation-session", identity = target.GetPersistentIdentity(),
            payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, token);
    }
    public static object Preview(string calendar, string eventData)
    {
        var p = Prepare(calendar, eventData);
        return new { ok = true, nativeEvent = 846022770u, choiceToken = p.Token, payload = LiveTools.DescribeValue(p.Payload),
            draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string calendar, string eventData, string token)
    {
        var p = Prepare(calendar, eventData);
        if (token != p.Token) throw new InvalidOperationException("Match preparation session changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "confirm_match_preparation_session", p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(846022770u, p.Target, p.Payload);
        }, null, null, "confirm_match_preparation_session");
    }
}
