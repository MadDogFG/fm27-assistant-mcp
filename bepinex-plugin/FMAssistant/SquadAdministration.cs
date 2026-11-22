using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

public static class SquadAdministration
{
    private sealed record NumberChoice(InteropReference Session, string Player, TypedValue Payload, string Before, string Requested, string Token);
    private static (InteropReference Session, InteropReference Player, LiveTools.Snapshot Current) NumberPlayer(
        string team, string session, string players, string playerPath, string current)
    {
        Team(team); Channel(session, team, "SquadNumbersEditSession"); Channel(players, session, "Players");
        var target = LiveTools.GetReference(session);
        if (target.GetIl2CppType().FullName != "FM.UI.SquadNumbersEditSessionReference") throw new ArgumentException("Use an actual squad-number session.");
        if (!int.TryParse(playerPath, NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || playerPath != index.ToString(CultureInfo.InvariantCulture))
            throw new ArgumentException("Choose an original Players list index.");
        var player = LiveTools.GetReference(players, playerPath);
        if (player.GetIl2CppType().FullName != "FM.UI.PersonReference") throw new ArgumentException("Squad-number row is not an original person reference.");
        var value = Channel(current, session, "NumSelected");
        if (value.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Number selector belongs to another session.");
        PersonContext(value, player.GetPersistentIdentity(), true);
        return (target, player, value);
    }
    private static void PersonContext(LiveTools.Snapshot value, string identity, bool required)
    {
        var found = false;
        foreach (var pair in value.ContextDescriptions)
        {
            if (!pair.Key.Equals("Person", StringComparison.OrdinalIgnoreCase)) continue;
            found = true;
            using var document = JsonDocument.Parse(pair.Value);
            if (!document.RootElement.TryGetProperty("identity", out var member) || member.GetString() != identity)
                throw new ArgumentException("Squad-number context belongs to another player.");
        }
        if (required && !found) throw new ArgumentException("Original Person context is required for the number selector.");
    }
    private static string NumberValue(TypedValue value) => NativeValueFingerprint.Compute(NegotiationActions.Field(
        NegotiationActions.Record(value) ?? throw new ArgumentException("Native number selection is not a record."), "PropertyValue"));
    private static NumberChoice PrepareNumber(string team, string session, string players, string playerPath, string current, string allowed, string options, string optionPath)
    {
        var p = NumberPlayer(team, session, players, playerPath, current);
        var can = Channel(allowed, session, "CanChangeSquadNumber"); var choices = Channel(options, session, "SquadNumbersDropdown");
        foreach (var value in new[] { can, choices })
        {
            if (value.Identity != p.Session.GetPersistentIdentity()) throw new ArgumentException("Number candidates belong to another session.");
            PersonContext(value, p.Player.GetPersistentIdentity(), false);
        }
        if (!bool.TryParse(can.Value?.AsString(), out var editable) || !editable) throw new InvalidOperationException("The game does not permit changing this player's number.");
        var choice = NativeChoiceTree.Leaf(options, optionPath); // Complete original row/RowData, not its numeric value.
        var before = NumberValue(p.Current.Value); var desired = NumberValue(choice);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            session = p.Session.GetPersistentIdentity(), player = p.Player.GetPersistentIdentity(), before, desired,
            payload = NativeValueFingerprint.Compute(choice), contexts = p.Current.ContextDescriptions }));
        return new NumberChoice(p.Session, p.Player.GetPersistentIdentity(), choice, before, desired, token);
    }
    public static object PreviewPlayerNumber(string team, string session, string players, string playerPath, string current, string allowed, string options, string optionPath)
    {
        var p = PrepareNumber(team, session, players, playerPath, current, allowed, options, optionPath);
        return new { ok = true, playerIdentity = p.Player, before = p.Before, requested = p.Requested, choiceToken = p.Token,
            choice = LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object SetPlayerNumber(string id, string team, string session, string players, string playerPath, string current, string allowed, string options, string optionPath, string token)
    {
        var p = PrepareNumber(team, session, players, playerPath, current, allowed, options, optionPath);
        if (p.Token != token) throw new InvalidOperationException("Squad-number choice or player changed; refresh preview.");
        LiveTools.RequireUnusedDraft(p.Session);
        return ActionCommands.DispatchDomain(id, "select_player_squad_number", p.Session.GetPersistentIdentity() + "/" + p.Player, token,
            () => LiveTools.UpdateProperty(current, TypedValue.CreateCopyFrom(p.Payload)), p.Before, p.Requested, "individual_squad_number_draft");
    }
    public static object ReadPlayerNumber(string team, string session, string players, string playerPath, string current, string operationId)
    {
        var p = NumberPlayer(team, session, players, playerPath, current); var value = NumberValue(p.Current.Value);
        return new { ok = true, playerIdentity = p.Player.GetPersistentIdentity(), selection = LiveTools.DescribeValue(p.Current.Value), draftOnly = true,
            receipt = string.IsNullOrEmpty(operationId) ? null : ActionCommands.ObserveDomain(operationId,
                p.Session.GetPersistentIdentity() + "/" + p.Player.GetPersistentIdentity(), "individual_squad_number_draft", value), liveVerified = false };
    }
    private static LiveTools.Snapshot Channel(string handle, string source, string property) => NegotiationActions.Channel(handle, source, property);
    private static InteropReference Team(string team)
    {
        var origin = Channel(team, "human", "Team");
        if (origin.Identity != LiveTools.GetReference("human").GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual team.");
        return LiveTools.GetReference(team);
    }
    private sealed record Pick(TypedValue Data, string Target, string Label, string Token, uint EventId, uint ActionId, InteropReference ActionRef);
    private static Pick Captain(string team, string offered, string action, string items, string indices)
    {
        var target = Team(team); var available = Channel(offered, "game", "Actions");
        if (!available.ContextDescriptions.TryGetValue("Records", out var records)) throw new ArgumentException("Captain actions require real team records.");
        using var document = JsonDocument.Parse(records);
        var list = document.RootElement;
        if (list.GetProperty("kind").GetString() != "list" || list.GetProperty("count").GetInt32() != 1 ||
            list.GetProperty("items")[0].GetProperty("identity").GetString() != target.GetPersistentIdentity())
            throw new ArgumentException("Captain actions belong to another team.");
        var selected = Channel(action, "game", "Action");
        if (!selected.Contexts.TryGetValue("ID", out var idText) || !uint.TryParse(idText, out var id) || (id != 1112887921 && id != 859991371))
            throw new ArgumentException("Select the original TeamSelectCaptain or TeamSelectViceCaptain action.");
        var availableRecord = NegotiationActions.Record(available.Value);
        if (availableRecord == null || !availableRecord.TryGetValue(id, out var option) || option.IsNull ||
            (option.DataType?.FullName == "System.Boolean" && option.AsString() == "False")) throw new InvalidOperationException("The game does not offer this captain action.");
        var menu = Channel(items, action, "Items");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var menuRecords) || menuRecords != records)
            throw new ArgumentException("Captain menu has different team records.");
        var path = JsonSerializer.Deserialize<int[]>(indices) ?? throw new ArgumentException("Choose a native captain menu leaf.");
        if (path.Length == 0 || path.Length > 8 || path.Any(index => index < 0)) throw new ArgumentException("Invalid captain menu path.");
        var value = menu.Value; SI.Core.Record row = null;
        foreach (var index in path)
        {
            var choices = value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (choices == null || index >= choices.Count) throw new ArgumentException("Captain menu entry no longer exists.");
            row = NegotiationActions.Record(choices[index]) ?? throw new ArgumentException("Invalid captain menu row.");
            if (NegotiationActions.Flag(row, "Disabled", false)) throw new InvalidOperationException("Captain candidate is disabled.");
            var children = NegotiationActions.Field(row, "ChildList", false);
            row = NegotiationActions.Record(NegotiationActions.Field(row, "RowData", false)) ?? row;
            if (NegotiationActions.Flag(row, "Disabled", false)) throw new InvalidOperationException("Captain candidate is disabled.");
            value = children == null || children.IsNull ? NegotiationActions.Field(row, "ChildList", false) : children;
        }
        var evText = NegotiationActions.Field(row, "Event")?.AsString();
        if (!uint.TryParse(evText, out var eventId) || (eventId != 44 && eventId != 1698914672 && eventId != 1700152161))
            throw new ArgumentException("Choose a normal native DoAction leaf, not navigation.");
        var data = NegotiationActions.Field(row, "ActionData");
        if (data == null || data.IsNull) throw new ArgumentException("Captain candidate has no native payload.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            team = target.GetPersistentIdentity(), action = id, records, payload = NativeValueFingerprint.Compute(data) }));
        return new Pick(data, target.GetPersistentIdentity(), NegotiationActions.Field(row, "Text", false)?.AsString(), token, eventId, id, LiveTools.GetReference(action));
    }
    public static object PreviewCaptain(string team, string offered, string action, string items, string entry)
    {
        var pick = Captain(team, offered, action, items, entry);
        return new { ok = true, label = pick.Label, targetIdentity = pick.Target, choiceToken = pick.Token, liveVerified = false };
    }
    public static object SetCaptain(string id, string team, string offered, string action, string items, string entry, string token)
    {
        var pick = Captain(team, offered, action, items, entry);
        if (pick.Token != token) throw new InvalidOperationException("Captain candidate changed; preview again.");
        InteropReference teamRef = null;
        try { teamRef = LiveTools.GetReference(team); } catch { /* 容错保留 null */ }
        return ActionCommands.DispatchDomain(id, "select_team_captain", pick.Target, token,
            () =>
            {
                var payload = TypedValue.CreateCopyFrom(pick.Data);
                if (NegotiationActions.Record(payload) is { } rec && rec.ContainsKey(0x7772436fu))
                    rec[0x7772436fu] = TypedValue.Create(false);
                if (pick.ActionRef != null)
                    FM.Game.PluginContextActionsModule.HandleActionEvent((FM.GamePlugin.ActionID)pick.ActionId, pick.EventId, pick.ActionRef, payload, true, null, null);
                else
                    SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(pick.EventId, teamRef, payload);
            }, null, null, "captain_action_dispatch_only");
    }
    private sealed record Numbers(InteropReference Target, uint Event, string Token);
    private static Numbers NumberAction(string operation, string team, string session, string players, string allowed)
    {
        Team(team); Channel(session, team, "SquadNumbersEditSession");
        var target = LiveTools.GetReference(session);
        if (target.GetIl2CppType().FullName != "FM.UI.SquadNumbersEditSessionReference") throw new ArgumentException("A native squad-number edit session is required.");
        var property = operation switch { "auto" => "SquadNumbersCanChange", "clear" => "CanClearChanges", "revert" => "HasMadeChanges", "confirm" => "CanConfirmChanges", _ => throw new ArgumentException("Unknown squad-number operation.") };
        var can = Channel(allowed, session, property);
        if (can.Identity != target.GetPersistentIdentity() || !bool.TryParse(can.Value?.AsString(), out var permitted) || !permitted)
            throw new InvalidOperationException("The game does not allow this squad-number operation.");
        var list = Channel(players, session, "Players");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            team = LiveTools.GetReference(team).GetPersistentIdentity(), session = target.GetPersistentIdentity(), operation,
            players = NativeValueFingerprint.Compute(list.Value), permission = NativeValueFingerprint.Compute(can.Value) }));
        return new Numbers(target, operation == "auto" ? 30U : operation == "clear" ? 31U : operation == "confirm" ? (uint)InteropEventIDs.EventFmxConfirmChanges : 28U, token);
    }
    public static object PreviewNumbers(string operation, string team, string session, string players, string allowed)
    {
        var p = NumberAction(operation, team, session, players, allowed);
        return new { ok = true, operation, choiceToken = p.Token, targetIdentity = p.Target.GetPersistentIdentity(),
            effect = operation == "confirm" ? "submit_current_squad_numbers" : "squad_numbers_edit_session", liveVerified = false };
    }
    public static object ChangeNumbers(string id, string operation, string team, string session, string players, string allowed, string token)
    {
        var p = NumberAction(operation, team, session, players, allowed);
        if (p.Token != token) throw new InvalidOperationException("Squad-number draft changed; preview again.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "squad_numbers." + operation, p.Target.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, null), null, null,
            operation == "confirm" ? "squad_number_confirmation_dispatch_only" : "squad_number_draft_dispatch_only");
    }
}
