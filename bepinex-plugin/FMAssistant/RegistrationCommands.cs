using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// SquadRegistrationSelectionTableBlock uses these normal edit-session commands.
// Auto-selection retains the game's own registration and assistant-manager rules.
public static class RegistrationCommands
{
    private sealed record Prepared(InteropReference Target, uint Event, string Token);
    private static InteropReference Session(string team, string session)
    {
        var origin = NegotiationActions.Channel(team, "human", "Team");
        if (origin.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the actual manager team.");
        NegotiationActions.Channel(session, team, "SquadRegistration");
        var target = LiveTools.GetReference(session);
        if (target.GetIl2CppType().FullName != "FM.UI.SquadRegistrationEditSession") throw new ArgumentException("Use the game's actual squad-registration edit session.");
        return target;
    }
    private static Prepared Prepare(string operation, string team, string session, string selected, string allowed)
    {
        var target = Session(team, session);
        var property = operation switch { "auto" => "CanAskAssistant", "clear" => "CanClearAllSelectedPlayers", "revert" => "CanUndoChanges", "confirm" => "CanConfirmChanges", _ => throw new ArgumentException("Unknown registration operation.") };
        var can = NegotiationActions.Channel(allowed, session, property);
        if (can.Identity != target.GetPersistentIdentity() || !bool.TryParse(can.Value?.AsString(), out var permitted) || !permitted)
            throw new InvalidOperationException("The game does not permit this registration operation.");
        var members = NegotiationActions.Channel(selected, session, "SelectedPlayers");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            team = LiveTools.GetReference(team).GetPersistentIdentity(), session = target.GetPersistentIdentity(), operation,
            selected = NativeValueFingerprint.Compute(members.Value), permission = NativeValueFingerprint.Compute(can.Value),
            sessionContext = LiveTools.GetSnapshot(session).ContextDescriptions, selectedContext = members.ContextDescriptions, permissionContext = can.ContextDescriptions }));
        return new(target, operation switch { "auto" => 30U, "clear" => 31U, "revert" => 28U, _ => (uint)InteropEventIDs.EventFmxConfirmChanges }, token);
    }
    public static object Preview(string operation, string team, string session, string selected, string allowed)
    {
        var p = Prepare(operation, team, session, selected, allowed);
        return new { ok = true, operation, targetIdentity = p.Target.GetPersistentIdentity(), choiceToken = p.Token,
            effect = operation == "confirm" ? "submit_registration_draft" : "edit_registration_draft", liveVerified = false };
    }
    public static object Execute(string id, string operation, string team, string session, string selected, string allowed, string token)
    {
        var p = Prepare(operation, team, session, selected, allowed);
        if (p.Token != token) throw new InvalidOperationException("Registration draft or legal action changed; refresh.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "registration." + operation, p.Target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, null), null, null,
            operation == "confirm" ? "registration_submit_dispatch_only" : "registration_draft_dispatch_only");
    }
}
