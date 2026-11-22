using System;
using System.Collections.Generic;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

public static class LineupCommands
{
    private static Dictionary<string, string> Context(int slot)
    {
        if (slot < 0 || slot > 25) throw new ArgumentException("Use a native squad selection index 0..25.");
        return new Dictionary<string, string> { ["TeamSelectionIndex"] = slot.ToString(CultureInfo.InvariantCulture) };
    }
    private static FM.UI.PersonReference Person(TypedValue value, bool nullable = false)
    {
        if (value == null || value.IsNull)
        {
            if (nullable) return null;
            throw new ArgumentException("A real player reference is required.");
        }
        var type = value.DataType?.FullName ?? "";
        if (type == "SI.Core.DynamicNumber" || type.StartsWith("System.", StringComparison.Ordinal)) throw new ArgumentException("Expected a native player reference.");
        return value.Get()?.TryCast<FM.UI.PersonReference>() ?? throw new ArgumentException("Expected a native PersonReference.");
    }
    private static string Current(string tactic, string current, int slot)
    {
        PlayerCommands.Tactic(tactic);
        return Person(PlayerCommands.Channel(current, tactic, "PlayerFromTeamSelectionIndex", Context(slot)).Value, true)?.GetPersistentIdentity();
    }
    private static void Enabled(SI.Core.Record row)
    {
        if (Flag(row, "Disabled", false) || Flag(row, "IsDisabled", false)) throw new InvalidOperationException("Game disabled this player selection.");
    }
    internal static (string Identity, TypedValue Payload, string Before, string Desired, string Token, int DatabaseIndex, int FromIndex, int? OutgoingIndex, InteropEventIDs EventId) Prepare(
        string tactic, string options, string current, int rowIndex, int slot, string variant = "")
    {
        var identity = PlayerCommands.Tactic(tactic);
        var contexts = Context(slot);
        var isMatch = LiveTools.GetReference(tactic).GetIl2CppType().FullName == "FM.UI.MatchTacticReference";
        var column = isMatch && LiveTools.GetSnapshot(options).Property == InternalCommands.PropertyId("PlayerColumnDropdownOptions");
        // Current-build metadata: the dropdown is phase-scoped; the selected
        // player's channel is slot-scoped. They do not share a context schema.
        var offered = PlayerCommands.Channel(options, tactic, column ? "PlayerColumnDropdownOptions" : "TeamSelectionIndexDropdown",
            column ? contexts : new Dictionary<string, string> { ["InPossession"] = "True" });
        if (offered.Contexts.TryGetValue("InPossession", out var phase) && phase != "True") throw new ArgumentException("Use the ordinary in-possession selection options.");
        var beforeValue = PlayerCommands.Channel(current, tactic, "PlayerFromTeamSelectionIndex", contexts).Value;
        var outgoing = Person(beforeValue, true);
        if (!(offered.Value?.DataType?.FullName ?? "").StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal)) throw new InvalidOperationException("Native player options are not a list.");
        var rows = offered.Value.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new InvalidOperationException("Player options are unavailable.");
        if (rowIndex < 0 || rowIndex >= rows.Count) throw new ArgumentException("Choose an original player option index.");
        var row = Record(rows[rowIndex]) ?? throw new ArgumentException("Player option is not a record.");
        Enabled(row);
        // The compact shirt dropdown wraps player rows in RowData. Never walk arbitrary record branches.
        if (row.TryGetValue(0x526f7744, out var nested)) { row = Record(nested) ?? throw new ArgumentException("Invalid native player RowData."); Enabled(row); }
        var selectionRow = row;
        if (column)
        {
            if (!row.TryGetValue(0x7074766cu, out var action) || action?.AsString() != "2" ||
                !row.TryGetValue(0x71764a36u, out var displayValue) || Record(displayValue) is not { } displayRow ||
                !displayRow.TryGetValue(0x54536978u, out var targetSlot) || targetSlot?.AsString() != slot.ToString(CultureInfo.InvariantCulture))
                throw new InvalidOperationException("Expected the game's original pick option for this match slot.");
            selectionRow = displayRow;
        }
        var person = Person(Field(selectionRow, "Player"));
        var sourceSlot = column && selectionRow.TryGetValue(0x61766742u, out var nativeSource) ? nativeSource : Field(selectionRow, "Index");
        if (!int.TryParse(sourceSlot.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var from) || from < -1 || from > 25)
            throw new ArgumentException("Native row has no valid current squad selection index.");
        var databaseIndex = person.TryCast<FM.UI.DatabaseRecordReference>()?.m_index ?? throw new ArgumentException("Player has no native database identity.");
        if (databaseIndex < 0) throw new ArgumentException("Invalid native player database index.");
        // Exact shipped TacticSelectPlayerForPositionDropdownEventContext.FillEvent recipe:
        // PropertyValue=PickPlayer; DisplayValue contains only Index and TeamSelectionIndex.
        var display = new SI.Bindable.DynamicReference();
        display[0x70496479] = TypedValue.Create(databaseIndex);
        display[0x54536978] = TypedValue.Create(slot);
        var payload = new SI.Bindable.DynamicReference();
        payload[0x7074766c] = TypedValue.Create(2);
        payload[0x71764a36] = GameTools.MakeObjectTypedValue(display);
        var substitution = LiveTools.GetReference(tactic).GetIl2CppType().FullName == "FM.UI.MatchTacticReference" &&
            outgoing != null && slot < 11 && from >= 11;
        // Diagnostic variants for in-match substitutions: the default keeps the shipped
        // swap event, and "pick" deliberately tries the ordinary team-selection pick event
        // on the match tactic. "swap-reversed" swaps the source/target rows of the drag payload.
        var useSwap = substitution;
        var reversed = false;
        if (!string.IsNullOrEmpty(variant))
        {
            if (variant == "pick") useSwap = false;
            else if (variant == "swap" || variant == "auto") useSwap = substitution;
            else if (variant == "swap-reversed") { useSwap = substitution; reversed = true; }
            else throw new ArgumentException("Unknown lineup pick variant. Use auto, pick, swap or swap-reversed.");
        }
        if (column && (!selectionRow.TryGetValue(0x70496479u, out var nativePlayerIndex) ||
            nativePlayerIndex?.AsString() != databaseIndex.ToString(CultureInfo.InvariantCulture)))
            throw new InvalidOperationException("Original match dropdown player index mismatch.");
        var eventId = useSwap && !column ? InteropEventIDs.EventFmxSwapPlayers : InteropEventIDs.EventFmxTeamSelectionPickPlayer;
        var value = column ? GameTools.MakeObjectTypedValue(row) : useSwap ? (string.IsNullOrEmpty(variant) || variant == "auto"
            ? MatchDropdownSwapPayload(row, outgoing, slot)
            : MatchSwapPayload(person, from, outgoing, slot, reversed)) : GameTools.MakeObjectTypedValue(payload);
        var before = outgoing?.GetPersistentIdentity(); var desired = person.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = identity, slot, before, desired, databaseIndex, from, eventId, payload = NativeValueFingerprint.Compute(value) }));
        return (identity, value, before, desired, token, databaseIndex, from, outgoing?.TryCast<FM.UI.DatabaseRecordReference>()?.m_index, eventId);
    }

    private static TypedValue MatchDropdownSwapPayload(SI.Core.Record choice, InteropReference outgoing, int slot)
    {
        var outgoingIndex = outgoing.TryCast<FM.UI.DatabaseRecordReference>()?.m_index
            ?? throw new InvalidOperationException("Current match player has no native database index.");
        var payload = new SI.Bindable.DynamicReference();
        payload[0x72692047u] = GameTools.MakeObjectTypedValue(choice);
        payload[0x61766742u] = TypedValue.Create(slot);
        payload[0x495a6748u] = TypedValue.Create(outgoingIndex);
        payload[0x4b727553u] = TypedValue.Create(true);
        return GameTools.MakeObjectTypedValue(payload);
    }

    private static TypedValue MatchSwapPayload(InteropReference incoming, int from, InteropReference outgoing, int slot, bool reversed)
    {
        // The shipped in-match player row uses event 21. FMDropTarget.Drop
        // wraps each person, possession phase, squad slot and both-shapes flag.
        var sourcePerson = reversed ? outgoing : incoming;
        var sourceIndex = reversed ? slot : from;
        var targetPerson = reversed ? incoming : outgoing;
        var targetIndex = reversed ? from : slot;
        var source = new SI.Bindable.DynamicReference();
        source[0x37614477] = GameTools.MakeObjectTypedValue(sourcePerson);
        source[0x69784c66] = TypedValue.Create(true);
        source[0x3320697a] = TypedValue.Create(sourceIndex);
        source[0x34553673] = TypedValue.Create(true);
        var target = new SI.Bindable.DynamicReference();
        target[0x38514a62] = GameTools.MakeObjectTypedValue(targetPerson);
        target[0x69784c66] = TypedValue.Create(true);
        target[0x3320697a] = TypedValue.Create(targetIndex);
        target[0x34553673] = TypedValue.Create(true);
        var payload = new SI.Bindable.DynamicReference();
        payload[0x37614477] = GameTools.MakeObjectTypedValue(source);
        payload[0x38514a62] = GameTools.MakeObjectTypedValue(target);
        return GameTools.MakeObjectTypedValue(payload);
    }
    public static object Preview(string tactic, string options, string current, int rowIndex, int slot, string variant = "")
    {
        var prepared = Prepare(tactic, options, current, rowIndex, slot, variant);
        return new { ok = true, choiceToken = prepared.Token, selectionIndex = slot, currentPlayer = prepared.Before, player = prepared.Desired,
            databaseIndex = prepared.DatabaseIndex, outgoingDatabaseIndex = prepared.OutgoingIndex, currentSelectionIndex = prepared.FromIndex,
            variant = variant ?? "", eventId = (uint)prepared.EventId, mutationCursor = MutationActivity.Cursor,
            epoch = LiveTools.CurrentEpoch, sessionId = LiveTools.SessionId, liveVerified = false };
    }
    public static object Execute(string id, string tactic, string options, string current, int rowIndex, int slot, string expected, string token, long cursor, string variant = "")
    {
        var prepared = Prepare(tactic, options, current, rowIndex, slot, variant);
        if (prepared.Before != (string.IsNullOrEmpty(expected) ? null : expected) || prepared.Token != token)
            throw new InvalidOperationException("Selection or legal player option changed since preview.");
        MutationActivity.RequireUnchanged(cursor);
        var target = LiveTools.GetReference(tactic);
        return ActionCommands.DispatchDomain(id, "pick_player", prepared.Identity, token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)prepared.EventId, target, prepared.Payload),
            prepared.Before, prepared.Desired, "team_selection_draft." + slot);
    }
    public static object Read(string tactic, string current, int slot, string operationId)
    {
        var value = Current(tactic, current, slot);
        return ActionCommands.ObserveDomain(operationId, LiveTools.GetReference(tactic).GetPersistentIdentity(), "team_selection_draft." + slot, value);
    }
}
