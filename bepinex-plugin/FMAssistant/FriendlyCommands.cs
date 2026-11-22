using System;
using System.Collections.Generic;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// ArrangeFriendlyBlock: venue event9(bool), ConfirmArrangeFriendly and
// CancelArrangeFriendly(null). No UI events or fabricated fixture records.
public static class FriendlyCommands
{
    private static readonly string[] Fields = { "Date", "TeamOpponent", "MatchRules", "IsValid", "IsOppositionTeamValid", "CanPlayAway" };
    private sealed record Draft(InteropReference Target, Dictionary<string, LiveTools.Snapshot> Values);
    private static Draft Resolve(string team, string friendly, string channels)
    {
        var owner = NegotiationActions.Channel(team, "human", "Team");
        if (owner.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the active manager's team.");
        NegotiationActions.Channel(friendly, team, "ArrangeFriendly");
        var target = LiveTools.GetReference(friendly);
        if (target.GetIl2CppType().FullName != "FM.UI.ArrangeFriendlyReference") throw new ArgumentException("Use the team's real friendly arrangement.");
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Friendly state channels required.");
        if (handles.Count != Fields.Length) throw new ArgumentException("Supply the complete friendly state snapshot.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var name in Fields)
        {
            if (!handles.TryGetValue(name, out var handle)) throw new ArgumentException("Missing friendly field: " + name);
            var value = NegotiationActions.Channel(handle, friendly, name);
            if (value.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Friendly state belongs to another draft.");
            values.Add(name, value);
        }
        return new(target, values);
    }
    private static bool Flag(Draft draft, string name) => bool.TryParse(draft.Values[name].Value?.AsString(), out var value)
        ? value : throw new InvalidOperationException("Friendly status unavailable: " + name);
    private static (Draft Draft, uint Event, TypedValue Data, string Token) Prepare(string operation, string team, string friendly, string channels)
    {
        var draft = Resolve(team, friendly, channels); uint eventId; TypedValue data = null;
        if (operation == "confirm")
        {
            if (!Flag(draft, "IsValid") || !Flag(draft, "IsOppositionTeamValid")) throw new InvalidOperationException("The game has not accepted this friendly arrangement as valid.");
            eventId = (uint)InteropEventIDs.EventFmxConfirmArrangeFriendly;
        }
        else if (operation == "cancel") eventId = (uint)InteropEventIDs.EventFmxCancelArrangeFriendly;
        else if (operation == "home" || operation == "away")
        {
            if (operation == "away" && !Flag(draft, "CanPlayAway")) throw new InvalidOperationException("The game does not allow playing away.");
            eventId = 9; data = TypedValue.Create(operation == "home");
        }
        else throw new ArgumentException("Use home, away, confirm or cancel.");
        var state = new Dictionary<string, string>();
        foreach (var pair in draft.Values) state.Add(pair.Key, NativeValueFingerprint.Compute(pair.Value.Value));
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            team = LiveTools.GetReference(team).GetPersistentIdentity(), draft = draft.Target.GetPersistentIdentity(), operation, state }));
        return (draft, eventId, data, token);
    }
    public static object Preview(string operation, string team, string friendly, string channels)
    {
        if (string.IsNullOrEmpty(operation))
        {
            var draft = Resolve(team, friendly, channels); var fields = new Dictionary<string, object>();
            foreach (var pair in draft.Values) fields.Add(pair.Key, LiveTools.DescribeValue(pair.Value.Value));
            return new { ok = true, fields, operations = new[] { "home", "away", "confirm", "cancel" }, liveVerified = false,
                missing = new[] { "opponent_and_rules_selection", "date_selection", "independent_created_fixture_acceptance" } };
        }
        var p = Prepare(operation, team, friendly, channels);
        return new { ok = true, operation, choiceToken = p.Token, eventId = p.Event, targetIdentity = p.Draft.Target.GetPersistentIdentity(),
            scope = "friendly_arrangement_business_dispatch_only", liveVerified = false };
    }
    public static object Execute(string id, string operation, string team, string friendly, string channels, string token)
    {
        var p = Prepare(operation, team, friendly, channels);
        if (p.Token != token) throw new InvalidOperationException("Friendly arrangement changed; refresh preview.");
        LiveTools.RequireUnusedDraft(p.Draft.Target);
        if (operation == "confirm")
            return ActionCommands.DispatchOnce(id, "friendly.confirm", p.Draft.Target.GetPersistentIdentity(), token,
                "friendly_arrangement_business_dispatch_only", () => new ContinueRequestGuard.Preflight(p.Token, false, true, null),
                () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Draft.Target, p.Data));
        return ActionCommands.DispatchDomain(id, "friendly." + operation, p.Draft.Target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Draft.Target, p.Data), null, null,
            "friendly_arrangement_business_dispatch_only");
    }
}
