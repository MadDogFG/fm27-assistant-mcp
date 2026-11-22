using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Staff suggestion refresh on the current tactic (evidence/v91-tactic-suggestions.json):
// 1349935671 SuggestedTeamRequested (SuggestedLineupListBlock/PitchBlock) and
// 1114723152 SuggestedChangesRequested (SuggestedLineupListBlock), both target=Tactic with
// data = the tactic's current suggestion list value. No live dispatch; acceptance unverified.
public static class TacticSuggestionCommands
{
    private static InteropReference Resolve(string tactic)
    {
        var target = LiveTools.GetReference(tactic);
        var snapshot = LiveTools.GetSnapshot(tactic);
        var type = target.GetIl2CppType().FullName ?? "";
        if (!type.EndsWith("TacticReference", StringComparison.Ordinal) || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("Tactic"))
            throw new ArgumentException("Resolve the actual current Tactic reference.");
        return target;
    }
    private static TypedValue Current(string handle, string tactic, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != tactic || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property))
            throw new ArgumentException("Wrong tactic suggestion subscription: " + property);
        return snapshot.Value == null ? null : TypedValue.CreateCopyFrom(snapshot.Value);
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Token) Prepare(string kind, string tactic, string suggestedTeam, string suggestedChanges)
    {
        var target = Resolve(tactic);
        TypedValue payload;
        uint eventId;
        if (kind == "team") { payload = Current(suggestedTeam, tactic, "SuggestedTeamList"); eventId = 1349935671u; }
        else if (kind == "changes") { payload = Current(suggestedChanges, tactic, "SuggestedChangesList"); eventId = 1114723152u; }
        else throw new ArgumentException("Use team or changes.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "tactic-suggestion-" + kind, identity = target.GetPersistentIdentity(),
            payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, eventId, token);
    }
    public static object Preview(string kind, string tactic, string suggestedTeam, string suggestedChanges)
    {
        var p = Prepare(kind, tactic, suggestedTeam, suggestedChanges);
        return new { ok = true, action = "tactic-suggestion-" + kind, nativeEvent = p.Event, choiceToken = p.Token,
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string kind, string tactic, string suggestedTeam, string suggestedChanges, string token)
    {
        var p = Prepare(kind, tactic, suggestedTeam, suggestedChanges);
        if (token != p.Token) throw new InvalidOperationException("Tactic suggestion state changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "tactic_suggestion_" + kind, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, "tactic_suggestion_" + kind);
    }
}
