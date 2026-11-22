using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Normal player-action menu protocol; only the actual training-report/rest/cancel-rest menu families.
// Never edits injuries, fitness, recovery dates or training player attributes.
public static class PlayerTrainingMenuCommands
{
    // The game exposes different training-menu action families per build/player; the bridge
    // resolves the real offered action by its game API name, so accept every training-family
    // action that can be a rest/report menu, not a hardcoded build-specific subset.
    private static bool Allowed(uint action) => action == (uint)ActionID.PersonRequestTrainingReport || action == (uint)ActionID.PersonRestTrainingSchedule ||
        action == (uint)ActionID.PersonCancelRestTrainingSchedule || action == (uint)ActionID.PersonTrainingIntensityRest ||
        action == (uint)ActionID.PlayerFootednessTraitTraining || action == (uint)ActionID.PersonLeadershipCourse ||
        action == (uint)ActionID.PersonSendOnIntensiveLanguageCourse || action == (uint)ActionID.PersonTrainingNewPreferredMove;
    private const uint RestDurationEvent = 1702130291u;
    private const uint WeakerFootEvent = 2003194700u;
    private sealed record Prepared(uint Action, uint Event, SI.Interop.InteropReference ActionReference, string Target, TypedValue Payload, string Label, bool Disabled, bool Confirmation, string Token);
    private static Prepared Prepare(string offered, string action, string items, string entryJson)
    {
        var available = Channel(offered, "game", "Actions");
        if (!available.ContextDescriptions.TryGetValue("Records", out var records)) throw new ArgumentException("Original person Records are required.");
        using var document = JsonDocument.Parse(records);
        var root = document.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference")
            throw new ArgumentException("Training reports require exactly one actual player reference.");
        var selected = Channel(action, "game", "Action");
        if (!selected.ContextDescriptions.TryGetValue("Records", out var selectedRecords) || selectedRecords != records)
            throw new ArgumentException("Training action reference belongs to a different actual player.");
        if (!selected.Contexts.TryGetValue("ID", out var value) || !uint.TryParse(value, out var id) || !Allowed(id))
            throw new ArgumentException("Select a supported player training action.");
        var offerings = Record(available.Value);
        if (offerings == null || !offerings.TryGetValue(id, out var offeredValue) || offeredValue.IsNull ||
            (offeredValue.DataType?.FullName == "System.Boolean" && offeredValue.AsString() == "False"))
            throw new InvalidOperationException("Game does not offer this training action for this player.");
        var menu = Channel(items, action, "Items");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var menuRecords) || records != menuRecords)
            throw new ArgumentException("Training menu does not belong to the same actual player.");
        var entry = JsonSerializer.Deserialize<int[]>(entryJson);
        if (entry == null || entry.Length < 1 || entry.Length > 8 || entry.Any(index => index < 0)) throw new ArgumentException("Select an original menu leaf by 1..8 indices.");
        var current = menu.Value; SI.Core.Record row = null; var disabled = false;
        foreach (var index in entry)
        {
            var list = current?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list == null || index >= list.Count) throw new ArgumentException("Training menu path is outside its original list.");
            row = Record(list[index]) ?? throw new ArgumentException("Training menu entry is not a record.");
            disabled |= Flag(row, "Disabled", false);
            var children = Field(row, "ChildList", false);
            var nested = Record(Field(row, "RowData", false)); if (nested != null) row = nested;
            disabled |= Flag(row, "Disabled", false);
            current = children == null || children.IsNull ? Field(row, "ChildList", false) : children;
        }
        var payload = Field(row, "ActionData");
        var weakerFoot = id == (uint)ActionID.PlayerFootednessTraitTraining;
        if (!uint.TryParse(Field(row, "Event").AsString(), out var nativeEvent) ||
            (weakerFoot ? nativeEvent != WeakerFootEvent : nativeEvent != (uint)InteropEventIDs.EventFmxDoAction &&
             !(id == (uint)ActionID.PersonTrainingIntensityRest && nativeEvent == RestDurationEvent)) ||
            payload == null || payload.IsNull)
            throw new InvalidOperationException("Select a supported native training menu leaf.");
        var confirmation = Field(Record(payload), "ConfirmationDialogData", false);
        var requiresConfirmation = confirmation != null && !confirmation.IsNull;
        var label = Field(row, "Text", false)?.AsString();
        var preferredMove = id == (uint)ActionID.PersonTrainingNewPreferredMove;
        if (preferredMove)
        {
            var traitPayload = Record(payload);
            if (traitPayload == null || !traitPayload.TryGetValue(0x6d6f6465u, out var mode) || mode?.AsString() is not ("0" or "2"))
                throw new InvalidOperationException("The game's trait training mode is unsupported.");
            if (mode.AsString() == "0" && (!traitPayload.TryGetValue(0x706d7472u, out var selectedTrait) ||
                Record(selectedTrait) is not { } trait || !trait.TryGetValue(0x706d6172u, out var traitId) || !uint.TryParse(traitId?.AsString(), out _)))
                throw new InvalidOperationException("The game's selected trait identity is missing.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), id, nativeEvent, records,
            payload = NativeValueFingerprint.Compute(payload, stablePreferredMove: preferredMove), disabled, requiresConfirmation }));
        return new Prepared(id, nativeEvent, (weakerFoot || nativeEvent == RestDurationEvent || id == (uint)ActionID.PersonCancelRestTrainingSchedule ||
            id == (uint)ActionID.PersonLeadershipCourse || id == (uint)ActionID.PersonTrainingNewPreferredMove || IsLanguageCourse(id)) ? LiveTools.GetReference(action) : null, DispatchJournal.Fingerprint(records), TypedValue.CreateCopyFrom(payload), label, disabled, requiresConfirmation, token);
    }
    private static bool IsLanguageCourse(uint id) => id == (uint)ActionID.PersonSendOnIntensiveLanguageCourse;
    private static bool SupportsConfirmation(uint id) => IsLanguageCourse(id) || id == (uint)ActionID.PersonTrainingNewPreferredMove;
    public static object Preview(string offered, string action, string items, string entry)
    {
        var p = Prepare(offered, action, items, entry);
        return new { ok = true, actionId = p.Action.ToString(CultureInfo.InvariantCulture), nativeEvent = p.Event, label = p.Label, choiceToken = p.Token,
            disabled = p.Disabled, requiresConfirmationProtocol = p.Confirmation, silentExecutionImplemented = p.Confirmation ? SupportsConfirmation(p.Action) : !IsLanguageCourse(p.Action),
            confirmation = p.Confirmation ? LiveTools.DescribeValue(Field(Record(p.Payload), "ConfirmationDialogData", false)) : null,
            verificationScope = "player_training_menu_dispatch", liveVerified = false };
    }
    public static object Execute(string id, string offered, string action, string items, string entry, string token, bool acceptConfirmation)
    {
        var p = Prepare(offered, action, items, entry);
        if (p.Token != token) throw new InvalidOperationException("Training request changed; preview again.");
        if (p.Disabled) throw new InvalidOperationException("Game disabled this training action.");
        var language = IsLanguageCourse(p.Action);
        if (language && (!p.Confirmation || !acceptConfirmation)) throw new InvalidOperationException("Preview the game's language course terms and explicitly accept confirmation.");
        if (p.Confirmation && (!SupportsConfirmation(p.Action) || !acceptConfirmation))
            throw new InvalidOperationException("Preview the game's training confirmation and explicitly accept it.");
        return ActionCommands.DispatchDomain(id, "player_training_menu_action", p.Target, p.Token,
            () =>
            {
                if (p.ActionReference != null)
                    FM.Game.PluginContextActionsModule.HandleActionEvent((ActionID)p.Action, p.Event, p.ActionReference, p.Payload, !p.Confirmation, null, null);
                else GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, null, p.Payload);
            },
            null, null, "player_training_menu_dispatch");
    }
}
