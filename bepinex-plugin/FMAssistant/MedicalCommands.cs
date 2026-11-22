using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Normal player-action menu protocol; only the two actual medical report actions.
// Never edits injuries, fitness, recovery dates or medical player attributes.
public static class MedicalCommands
{
    private static bool Allowed(uint action) => action == (uint)ActionID.PersonRequestPhysioReport || action == (uint)ActionID.PersonRequestInjuryRiskUpdate;
    private sealed record Prepared(uint Action, SI.Interop.InteropReference ActionRef, string Target, TypedValue Payload, string Label, bool Disabled, bool Confirmation, string Token);
    private static Prepared Prepare(string offered, string action, string items, string entryJson)
    {
        var available = Channel(offered, "game", "Actions");
        if (!available.ContextDescriptions.TryGetValue("Records", out var records)) throw new ArgumentException("Original person Records are required.");
        using var document = JsonDocument.Parse(records);
        var root = document.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference")
            throw new ArgumentException("Medical reports require exactly one actual player reference.");
        var selected = Channel(action, "game", "Action");
        if (!selected.ContextDescriptions.TryGetValue("Records", out var selectedRecords) || selectedRecords != records)
            throw new ArgumentException("Medical action reference belongs to a different actual player.");
        if (!selected.Contexts.TryGetValue("ID", out var value) || !uint.TryParse(value, out var id) || !Allowed(id))
            throw new ArgumentException("Select RequestPhysioReport or RequestInjuryRiskUpdate.");
        var offerings = Record(available.Value);
        if (offerings == null || !offerings.TryGetValue(id, out var offeredValue) || offeredValue.IsNull ||
            (offeredValue.DataType?.FullName == "System.Boolean" && offeredValue.AsString() == "False"))
            throw new InvalidOperationException("Game does not offer this medical action for this player.");
        var menu = Channel(items, action, "Items");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var menuRecords) || records != menuRecords)
            throw new ArgumentException("Medical menu does not belong to the same actual player.");
        var entry = JsonSerializer.Deserialize<int[]>(entryJson);
        if (entry == null || entry.Length < 1 || entry.Length > 8 || entry.Any(index => index < 0)) throw new ArgumentException("Select an original menu leaf by 1..8 indices.");
        var current = menu.Value; SI.Core.Record row = null; var disabled = false;
        foreach (var index in entry)
        {
            var list = current?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list == null || index >= list.Count) throw new ArgumentException("Medical menu path is outside its original list.");
            row = Record(list[index]) ?? throw new ArgumentException("Medical menu entry is not a record.");
            disabled |= Flag(row, "Disabled", false);
            var children = Field(row, "ChildList", false);
            var nested = Record(Field(row, "RowData", false)); if (nested != null) row = nested;
            disabled |= Flag(row, "Disabled", false);
            current = children == null || children.IsNull ? Field(row, "ChildList", false) : children;
        }
        var payload = Field(row, "ActionData");
        if (Field(row, "Event").AsString() != "44" || payload == null || payload.IsNull)
            throw new InvalidOperationException("Select the game's actual DoAction business leaf, not navigation.");
        var confirmation = Field(Record(payload), "ConfirmationDialogData", false);
        var requiresConfirmation = confirmation != null && !confirmation.IsNull;
        var label = Field(row, "Text", false)?.AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            id, records, payload = NativeValueFingerprint.Compute(payload), disabled, requiresConfirmation }));
        return new Prepared(id, LiveTools.GetReference(action), DispatchJournal.Fingerprint(records), TypedValue.CreateCopyFrom(payload), label, disabled, requiresConfirmation, token);
    }
    public static object Preview(string offered, string action, string items, string entry)
    {
        var p = Prepare(offered, action, items, entry);
        return new { ok = true, actionId = p.Action.ToString(CultureInfo.InvariantCulture), label = p.Label, choiceToken = p.Token,
            disabled = p.Disabled, requiresConfirmationProtocol = p.Confirmation, silentExecutionImplemented = !p.Confirmation,
            verificationScope = "medical_report_request_dispatch", liveVerified = false };
    }
    public static object Execute(string id, string offered, string action, string items, string entry, string token)
    {
        var p = Prepare(offered, action, items, entry);
        if (p.Token != token) throw new InvalidOperationException("Medical request changed; preview again.");
        if (p.Disabled) throw new InvalidOperationException("Game disabled this medical action.");
        if (p.Confirmation) throw new InvalidOperationException("This medical choice requires a separate confirmation business protocol that is not yet implemented.");
        return ActionCommands.DispatchDomain(id, "medical_report_request", p.Target, p.Token,
            () =>
            {
                var payload = TypedValue.CreateCopyFrom(p.Payload);
                if (Record(payload) is { } rec && rec.ContainsKey(0x7772436fu))
                    rec[0x7772436fu] = TypedValue.Create(false);
                if (p.ActionRef != null)
                    FM.Game.PluginContextActionsModule.HandleActionEvent((ActionID)p.Action, (uint)InteropEventIDs.EventFmxDoAction, p.ActionRef, payload, false, null, null);
                else
                    GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxDoAction, null, payload);
            },
            null, null, "medical_report_request_dispatch");
    }
}
