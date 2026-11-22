using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Tactic change lifecycle on the current tactic. Full UI index (evidence/v98-tactic-change-lifecycle.json):
// 1933068080 SetTacticNextMatchOnly (TacticalPlannerHeader, target=Tactic, data=const.True/False),
// 846559841 CancelTacticalChanges (TeamTalkCard, target=tactic, data=true, gate tactic.CanRevert),
// 1937405795 ConfirmTacticalChanges (MatchCommentaryBarWithButtons, target=tactic, data=true).
// Static evidence only; no live dispatch.
public static class TacticChangeCommands
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
    private static bool Flag(string handle, string tactic, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != tactic || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong tactic flag subscription: " + property);
        return bool.TryParse(snapshot.Value?.AsString(), out var flag) ? flag : throw new ArgumentException("Tactic flag is not ready: " + property);
    }
    public static object Read(string tactic, string canRevert, string canConfirm)
    {
        var target = Resolve(tactic);
        return new { ok = true, tacticIdentity = target.GetPersistentIdentity(),
            canRevert = Flag(canRevert, tactic, "CanRevert"), canConfirmChanges = Flag(canConfirm, tactic, "CanConfirmChanges"),
            draftOnly = true, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Scope, string Token) Prepare(
        string action, string tactic, string canRevert, string canConfirm, bool? value)
    {
        var target = Resolve(tactic);
        TypedValue payload;
        uint eventId;
        string scope;
        switch (action)
        {
            case "next-match-only":
                if (value == null) throw new ArgumentException("next-match-only needs value=true/false.");
                payload = TypedValue.Create(value.Value); eventId = 1933068080u; scope = "tactic_next_match_only"; break;
            case "cancel":
                if (!Flag(canRevert, tactic, "CanRevert")) throw new InvalidOperationException("Game does not allow reverting tactical changes.");
                payload = TypedValue.Create(true); eventId = 846559841u; scope = "tactic_cancel_changes"; break;
            case "confirm":
                if (!Flag(canConfirm, tactic, "CanConfirmChanges")) throw new InvalidOperationException("Game does not allow confirming tactical changes.");
                payload = TypedValue.Create(true); eventId = 1937405795u; scope = "tactic_confirm_changes"; break;
            default: throw new ArgumentException("Use next-match-only, cancel or confirm.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, eventId, scope, token);
    }
    public static object Preview(string action, string tactic, string canRevert, string canConfirm, bool? value)
    {
        var p = Prepare(action, tactic, canRevert, canConfirm, value);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string tactic, string canRevert, string canConfirm, bool? value, string token)
    {
        var p = Prepare(action, tactic, canRevert, canConfirm, value);
        if (token != p.Token) throw new InvalidOperationException("Tactic change state changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "tactic_change_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, p.Scope);
    }
}
