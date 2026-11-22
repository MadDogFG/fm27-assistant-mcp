using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// TouchlineShoutMenuHandlerModule.<Init>b__2_1: event0x54775070,
// actual MatchTacticReference and the complete original shout row TypedValue.
public static class MatchShoutCommands
{
    private static readonly string[] Names = { "TouchlineShoutsEnabled", "TouchlineShouts", "TouchlineShoutGroupType", "TouchlineShoutSelectedPlayers", "TouchlineShoutAvailablePlayers" };
    private sealed record Context(InteropReference Tactic, Dictionary<string, LiveTools.Snapshot> Values, Dictionary<string, string> Handles, string Match);
    private static Context Resolve(string tactic, string channels)
    {
        var controller = MatchCommands.ManagerController();
        if (!controller.MatchKickedOff) throw new InvalidOperationException("Touchline shouts require a kicked-off unfinished managed match.");
        var target = MatchCommands.RequireCurrentTactic(tactic);
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Supply the original shout channels.");
        if (handles.Count != Names.Length) throw new ArgumentException("Supply all recovered shout state channels.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var name in Names)
        {
            if (!handles.TryGetValue(name, out var handle)) throw new ArgumentException("Missing shout state: " + name);
            var snapshot = NegotiationActions.Channel(handle, tactic, name);
            if (snapshot.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Shout channel belongs to another match tactic.");
            values.Add(name, snapshot);
        }
        return new(target, values, handles, controller.MatchReference.GetPersistentIdentity());
    }
    private static bool Enabled(Context c) => bool.TryParse(c.Values[Names[0]].Value?.AsString(), out var enabled)
        ? enabled : throw new InvalidOperationException("Native shout cooldown/availability status unavailable.");
    private static (Context Context, TypedValue Payload, string Token) Prepare(string tactic, string channels, string kind, int option)
    {
        var c = Resolve(tactic, channels);
        if (!Enabled(c)) throw new InvalidOperationException("Game disabled touchline shouts (cooldown or match/responsibility restriction).");
        TypedValue payload;
        if (kind == "shout")
        {
            var list = c.Values["TouchlineShouts"].Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
                ?? throw new ArgumentException("Native shout candidates are not ready.");
            if (option < 0 || option >= list.Count) throw new ArgumentException("Choose an actual native shout candidate index.");
            payload = TypedValue.CreateCopyFrom(list[option]);
            var row = NegotiationActions.Record(payload) ?? throw new ArgumentException("Shout candidate is not an original record.");
            foreach (var name in new[] { "Disabled", "IsDisabled" })
                if (NegotiationActions.Flag(row, name, false)) throw new InvalidOperationException("Game disabled this shout option.");
        }
        else if (kind == "group")
        {
            // Exact TacticalShoutsPanelContent.ButtonGroup.OptionValues.
            if (!new[] { 4, 1, 2, 3 }.Contains(option)) throw new ArgumentException("Choose an original touchline group value (4,1,2,3).");
            payload = TypedValue.Create(option);
        }
        else throw new ArgumentException("Use shout or group.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            match = c.Match, human = LiveTools.GetReference("human").GetPersistentIdentity(), side = MatchCommands.CapturePlayerContext().IsHomeTeam,
            tactic = c.Tactic.GetPersistentIdentity(), kind, option, payload = NativeValueFingerprint.Compute(payload),
            group = NativeValueFingerprint.Compute(c.Values["TouchlineShoutGroupType"].Value),
            recipients = NativeValueFingerprint.Compute(c.Values["TouchlineShoutSelectedPlayers"].Value),
            candidates = NativeValueFingerprint.Compute(c.Values["TouchlineShouts"].Value) }));
        return (c, payload, token);
    }
    public static object Read(string tactic, string channels)
    {
        var c = Resolve(tactic, channels); var fields = new Dictionary<string, object>();
        foreach (var pair in c.Values) fields.Add(pair.Key, LiveTools.DescribeValue(pair.Value.Value, 8));
        return new { ok = true, canShout = Enabled(c), fields, groupValues = new[] { 4, 1, 2, 3 },
            targetIdentity = c.Tactic.GetPersistentIdentity(), matchIdentity = c.Match, liveVerified = false };
    }
    public static object Preview(string tactic, string channels, string kind, int option)
    {
        var p = Prepare(tactic, channels, kind, option);
        return new { ok = true, kind, option, choiceToken = p.Token, payload = LiveTools.DescribeValue(p.Payload),
            nativeEvent = kind == "shout" ? (uint?)InteropEventIDs.EventFmxChangeTeamTouchlineTalk : null,
            verificationScope = "touchline_shout_business_dispatch_only", liveVerified = false };
    }
    public static object Execute(string id, string tactic, string channels, string kind, int option, string token)
    {
        var p = Prepare(tactic, channels, kind, option);
        if (p.Token != token) throw new InvalidOperationException("Shout, recipients or match context changed; refresh preview.");
        // The normal match HUD itself binds this live tactic. It is not an
        // isolated negotiation draft: do not require the player to close it.
        return ActionCommands.DispatchDomain(id, "touchline_" + kind, p.Context.Tactic.GetPersistentIdentity(), token, () => {
            if (kind == "group") LiveTools.UpdateProperty(p.Context.Handles["TouchlineShoutGroupType"], p.Payload);
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxChangeTeamTouchlineTalk, p.Context.Tactic, p.Payload);
        }, null, null, "touchline_shout_business_dispatch_only");
    }
    private static (Context Context, TypedValue Payload, string Token) Players(string tactic, string channels, string indices)
    {
        var c = Resolve(tactic, channels);
        if (!Enabled(c)) throw new InvalidOperationException("Game disabled touchline shout selection.");
        var requested = JsonSerializer.Deserialize<int[]>(indices) ?? throw new ArgumentException("Supply player candidate indices.");
        if (requested.Length > 32 || requested.Distinct().Count() != requested.Length) throw new ArgumentException("Choose at most 32 distinct player candidates.");
        var candidates = c.Values["TouchlineShoutAvailablePlayers"].Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new InvalidOperationException("Native shout player candidates are not ready.");
        var rows = new Il2CppSystem.Collections.Generic.List<TypedValue>();
        foreach (var index in requested)
        {
            if (index < 0 || index >= candidates.Count) throw new ArgumentException("Choose an actual native player candidate index.");
            var original = candidates[index];
            var row = NegotiationActions.Record(original) ?? throw new ArgumentException("Player candidate is not an original row.");
            // Original StreamedTable RowEnabledProperty=926037610, InvertRowEnabled=true.
            if (!row.TryGetValue(926037610, out var disabled) || !bool.TryParse(disabled.AsString(), out var unavailable))
                throw new InvalidOperationException("Native shout player availability is not ready.");
            if (unavailable) throw new InvalidOperationException("Game disabled this shout recipient.");
            rows.Add(TypedValue.CreateCopyFrom(original));
        }
        var payload = GameTools.MakeObjectTypedValue(rows);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), match = c.Match, tactic = c.Tactic.GetPersistentIdentity(),
            side = MatchCommands.CapturePlayerContext().IsHomeTeam,
            candidates = NativeValueFingerprint.Compute(c.Values["TouchlineShoutAvailablePlayers"].Value),
            group = NativeValueFingerprint.Compute(c.Values["TouchlineShoutGroupType"].Value),
            before = NativeValueFingerprint.Compute(c.Values["TouchlineShoutSelectedPlayers"].Value),
            requested = NativeValueFingerprint.Compute(payload) }));
        return (c, payload, token);
    }
    public static object PreviewPlayers(string tactic, string channels, string indices)
    {
        var p = Players(tactic, channels, indices);
        return new { ok = true, choiceToken = p.Token, recipients = LiveTools.DescribeValue(p.Payload, 8),
            nativeEvent = (uint)InteropEventIDs.EventFmxSelectTouchlineTalkPlayer,
            verificationScope = "touchline_selected_players_only", shoutSent = false, liveVerified = false };
    }
    public static object SelectPlayers(string id, string tactic, string channels, string indices, string token)
    {
        var p = Players(tactic, channels, indices);
        if (token != p.Token) throw new InvalidOperationException("Shout player candidates, recipients or match changed; refresh preview.");
        return ActionCommands.DispatchDomain(id, "touchline_players", p.Context.Tactic.GetPersistentIdentity(), token, () => {
            // Original multi-select writes complete original selected rows, then fires its business event.
            LiveTools.UpdateProperty(p.Context.Handles["TouchlineShoutSelectedPlayers"], p.Payload);
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxSelectTouchlineTalkPlayer, p.Context.Tactic, p.Payload);
        }, NativeValueFingerprint.Compute(p.Context.Values["TouchlineShoutSelectedPlayers"].Value), NativeValueFingerprint.Compute(p.Payload), "touchline_selected_players_only");
    }
    public static object ReadPlayers(string tactic, string channels, string operationId)
    {
        var c = Resolve(tactic, channels);
        return new { ok = true, state = Read(tactic, channels), operation = string.IsNullOrEmpty(operationId) ? null :
            ActionCommands.ObserveDomain(operationId, c.Tactic.GetPersistentIdentity(), "touchline_selected_players_only",
                NativeValueFingerprint.Compute(c.Values["TouchlineShoutSelectedPlayers"].Value)),
            shoutSent = false, liveVerified = false };
    }

}
