using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Two normal squad-administration menu families only. Deliberately excludes the
// editor's PersonMoveToMyTeam/OtherTeam/OnLoan actions and all forced transfers.
public static class PlayerAvailabilityCommands
{
    private static readonly HashSet<uint> Allowed = new() { 1516726887, 1245135978 };
    private static string Subject(string source, string path, string club, string playerClub, string offered)
    {
        var player = LiveTools.GetReference(source, path);
        if (player.GetIl2CppType().FullName != "FM.UI.PersonReference") throw new ArgumentException("Use an original player reference.");
        var human = LiveTools.GetReference("human");
        if (NegotiationActions.Channel(club, "human", "Club").Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual club.");
        if (NegotiationActions.Channel(playerClub, source, "Club", path).Identity != player.GetPersistentIdentity() ||
            LiveTools.GetReference(playerClub).GetPersistentIdentity() != LiveTools.GetReference(club).GetPersistentIdentity())
            throw new InvalidOperationException("This player does not currently belong to the active club.");
        var menu = NegotiationActions.Channel(offered, "game", "Actions");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var raw)) throw new ArgumentException("Actions require original Records.");
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference" ||
            root.GetProperty("items")[0].GetProperty("identity").GetString() != player.GetPersistentIdentity())
            throw new ArgumentException("Actions belong to another player or a multi-selection.");
        return player.GetPersistentIdentity();
    }
    public static object Offered(string source, string path, string club, string playerClub, string offered)
    {
        var target = Subject(source, path, club, playerClub, offered);
        var record = NegotiationActions.Record(LiveTools.GetSnapshot(offered).Value) ?? throw new ArgumentException("Game has not returned player actions.");
        var rows = new List<object>();
        foreach (var pair in record)
            if (Allowed.Contains(pair.Key)) rows.Add(new { id = pair.Key.ToString(CultureInfo.InvariantCulture), name = Enum.GetName(typeof(ActionID), pair.Key),
                offered = pair.Value?.DataType?.FullName != "System.Boolean" || pair.Value.AsString() != "False" });
        return new { ok = true, targetIdentity = target, actions = rows, liveVerified = false };
    }
    private static (string Target, uint Action, TypedValue Payload, string Label, bool Confirmation, string Token) Prepare(
        string source, string path, string club, string playerClub, string offered, string action, string items, string entry)
    {
        var target = Subject(source, path, club, playerClub, offered);
        var act = NegotiationActions.Channel(action, "game", "Action");
        if (!act.Contexts.TryGetValue("ID", out var idText) || !uint.TryParse(idText, out var id) || !Allowed.Contains(id))
            throw new ArgumentException("Only normal squad-change and reserve-availability action families are supported.");
        var record = NegotiationActions.Record(LiveTools.GetSnapshot(offered).Value);
        if (record == null || !record.TryGetValue(id, out var available) || available?.DataType?.FullName == "System.Boolean" && available.AsString() == "False") throw new InvalidOperationException("Game no longer offers this player action.");
        var menu = NegotiationActions.Channel(items, action, "Items");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var records) || records != LiveTools.GetSnapshot(offered).ContextDescriptions["Records"])
            throw new ArgumentException("Menu belongs to different player records.");
        var indices = JsonSerializer.Deserialize<int[]>(entry) ?? throw new ArgumentException("Select an original menu entry.");
        if (indices.Length < 1 || indices.Length > 8 || indices.Any(index => index < 0)) throw new ArgumentException("Use 1..8 nonnegative menu indices.");
        var value = menu.Value; SI.Core.Record row = null;
        foreach (var index in indices)
        {
            var list = value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list == null || index >= list.Count) throw new ArgumentException("Menu entry is outside current choices.");
            row = NegotiationActions.Record(list[index]) ?? throw new ArgumentException("Native menu row unavailable.");
            if (NegotiationActions.Flag(row, "Disabled", false)) throw new InvalidOperationException("Game disabled this menu entry.");
            var children = NegotiationActions.Field(row, "ChildList", false);
            var nested = NegotiationActions.Record(NegotiationActions.Field(row, "RowData", false));
            if (nested != null) row = nested;
            if (NegotiationActions.Flag(row, "Disabled", false)) throw new InvalidOperationException("Game disabled this choice.");
            value = children == null || children.IsNull ? NegotiationActions.Field(row, "ChildList", false) : children;
        }
        if (NegotiationActions.Field(row, "Event").AsString() != "44") throw new ArgumentException("Choose the game's concrete DoAction business leaf, not navigation.");
        var payload = NegotiationActions.Field(row, "ActionData");
        if (payload == null || payload.IsNull) throw new ArgumentException("Native action payload unavailable.");
        var data = NegotiationActions.Record(payload);
        var confirmation = data == null ? TypedValue.Null : NegotiationActions.Field(data, "ConfirmationDialogData", false);
        var label = NegotiationActions.Field(row, "Text", false)?.AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target, action = id, records, payload = NativeValueFingerprint.Compute(payload), label }));
        return (target, id, TypedValue.CreateCopyFrom(payload), label, confirmation != null && !confirmation.IsNull, token);
    }
    public static object Preview(string source, string path, string club, string playerClub, string offered, string action, string items, string entry)
    {
        var p = Prepare(source, path, club, playerClub, offered, action, items, entry);
        return new { ok = true, choiceToken = p.Token, actionId = p.Action, label = p.Label, requiresConfirmation = p.Confirmation,
            payload = LiveTools.DescribeValue(p.Payload), liveVerified = false };
    }
    public static object Execute(string id, string source, string path, string club, string playerClub, string offered, string action, string items, string entry, string token, bool acceptConfirmation)
    {
        var p = Prepare(source, path, club, playerClub, offered, action, items, entry);
        if (p.Token != token) throw new InvalidOperationException("Player action or legal menu payload changed; preview again.");
        if (p.Confirmation && !acceptConfirmation) throw new InvalidOperationException("Read the native confirmation and explicitly acknowledge it.");
        return ActionCommands.DispatchDomain(id, "player_availability_action", p.Target, token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxDoAction, null, p.Payload),
            null, null, "player_availability_dispatch_only");
    }
}
