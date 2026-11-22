using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Bindable.Reference.Core;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// TacticsPicker uses game-provided slot indices and native event 78.
// TeamTacticRadioListBlock writes its selected native radio index normally.
public static class TacticSlotCommands
{
    private static readonly System.Text.RegularExpressions.Regex SlotName = new(@"^TacticSlot([1-9][0-9]*)Name$");
    private static int[] NativeSlots(InteropReference target)
    {
        var properties = new Il2CppSystem.Collections.Generic.List<PropertyID>();
        target.GetProperties(properties);
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in properties) names.Add(property.ToString().Split(':')[0]);
        return names.Select(name => SlotName.Match(name))
            .Where(match => match.Success && names.Contains("TacticSlot" + match.Groups[1].Value + "Valid"))
            .Select(match => int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) - 1)
            .OrderBy(index => index).ToArray();
    }
    private static string SlotProperty(int slot, string suffix) => "TacticSlot" + (slot + 1) + suffix;
    private static readonly string[] Optional = { "PrimaryTrainingTacticSlotIndex", "TacticsSlotForRadioGroup", "CanRevert", "IsCreatingTactic" };
    private const string CreateCommand = "tactic_slot.create";
    private const string CreateScope = "tactic_slots.occupied_count";
    private sealed record Context(InteropReference Tactic, Dictionary<string, LiveTools.Snapshot> Values, Dictionary<string, string> Handles, int[] Slots);
    private static Context Resolve(string team, string tactic, string channels)
    {
        var human = LiveTools.GetReference("human");
        if (NegotiationActions.Channel(team, "human", "Team").Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the active manager's actual team.");
        var target = LiveTools.GetReference(tactic);
        if (target.GetIl2CppType().FullName == "FM.UI.MatchTacticReference") MatchCommands.RequireCurrentTactic(tactic);
        else if (target.GetIl2CppType().FullName == "FM.UI.TeamTacticReference")
        { if (NegotiationActions.Channel(tactic, team, "Tactic").Identity != LiveTools.GetReference(team).GetPersistentIdentity()) throw new ArgumentException("Use this manager's own team tactic."); }
        else throw new ArgumentException("A real team or match tactic is required.");
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Tactic slot channels required.");
        var slots = NativeSlots(target);
        if (slots.Length == 0) throw new InvalidOperationException("The game does not expose tactic slot metadata.");
        var required = slots.SelectMany(slot => new[] { SlotProperty(slot, "Name"), SlotProperty(slot, "Valid") })
            .Append("CurrentTacticSlot").ToHashSet(StringComparer.Ordinal);
        if (required.Any(name => !handles.ContainsKey(name)) || handles.Keys.Any(name => !required.Contains(name) && !Optional.Contains(name)))
            throw new ArgumentException("Supply the original slot-name, validity and current-slot subscriptions.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var pair in handles)
        {
            var value = NegotiationActions.Channel(pair.Value, tactic, pair.Key);
            if (value.Identity != target.GetPersistentIdentity()) throw new ArgumentException("Slot state belongs to another tactic.");
            values.Add(pair.Key, value);
        }
        return new(target, values, handles, slots);
    }
    private static int Number(Context c, string field) => c.Values.TryGetValue(field, out var value) && int.TryParse(value.Value?.AsString(), out var number)
        ? number : throw new InvalidOperationException("Native slot index unavailable: " + field);
    private static bool Valid(Context c, int slot) => c.Slots.Contains(slot) && SlotOccupied(c, slot);
    private static bool SlotOccupied(Context c, int slot) =>
        bool.TryParse(c.Values[SlotProperty(slot, "Valid")].Value?.AsString(), out var valid)
            ? valid : throw new InvalidOperationException("Native tactic slot validity unavailable.");
    private static int Occupied(Context c) => c.Slots.Count(slot => SlotOccupied(c, slot));
    public static object Read(string team, string tactic, string channels, string operationId)
    {
        var c = Resolve(team, tactic, channels);
        var current = Number(c, "CurrentTacticSlot");
        var slots = c.Slots.Select(slot => new { slotIndex = slot, label = c.Values[SlotProperty(slot, "Name")].Value?.AsString(),
            exists = Valid(c, slot), selected = current == slot }).ToArray();
        object receipt = null;
        if (!string.IsNullOrEmpty(operationId))
        {
            var previous = ActionCommands.Status(operationId) as DispatchJournal.Receipt ?? throw new ArgumentException("Unknown durable slot operation.");
            if (previous.command == CreateCommand)
                receipt = ActionCommands.ObserveDomain(operationId, c.Tactic.GetPersistentIdentity(), CreateScope, Occupied(c).ToString(CultureInfo.InvariantCulture));
            else
            {
                var field = previous.command == "tactic_slot.select" ? "CurrentTacticSlot" : previous.command == "tactic_slot.training" ? "PrimaryTrainingTacticSlotIndex" :
                    throw new ArgumentException("This ID does not belong to tactic slot selection or creation.");
                receipt = ActionCommands.ObserveDomain(operationId, c.Tactic.GetPersistentIdentity(), "tactic_slot_configuration." + field, Number(c, field).ToString(CultureInfo.InvariantCulture));
            }
        }
        return new { ok = true, slots, currentSlotIndex = current, targetIdentity = c.Tactic.GetPersistentIdentity(),
            primaryTrainingSlotIndex = c.Values.ContainsKey("PrimaryTrainingTacticSlotIndex") ? (int?)Number(c, "PrimaryTrainingTacticSlotIndex") : null,
            trainingOptions = c.Values.TryGetValue("TacticsSlotForRadioGroup", out var options) ? LiveTools.DescribeValue(options.Value, 8) : null,
            receipt, scope = "tactic_slot_configuration_not_match_engine_acceptance", liveVerified = false };
    }
    private static (Context Context, string Field, string Before, string Requested, string Token) Prepare(string action, string team, string tactic, string channels, int slot)
    {
        if (action != "select" && action != "training") throw new ArgumentException("Use select or training.");
        var c = Resolve(team, tactic, channels);
        if (!Valid(c, slot)) throw new InvalidOperationException("This tactic slot is empty or invalid. Create a tactic before selecting it.");
        if (c.Tactic.GetIl2CppType().FullName == "FM.UI.MatchTacticReference")
        {
            if (!c.Values.TryGetValue("CanRevert", out var pending) || !bool.TryParse(pending.Value?.AsString(), out var dirty)) throw new InvalidOperationException("Current match tactical draft state unavailable.");
            if (dirty) throw new InvalidOperationException("An existing match tactical draft requires its own decision before switching slots.");
        }
        var field = action == "select" ? "CurrentTacticSlot" : "PrimaryTrainingTacticSlotIndex";
        if (action == "training")
        {
            if (c.Tactic.GetIl2CppType().FullName != "FM.UI.TeamTacticReference") throw new ArgumentException("Primary training tactic must use the actual team tactic.");
            if (!c.Values.TryGetValue("TacticsSlotForRadioGroup", out var radio)) throw new ArgumentException("Use the game's actual training radio choices.");
            var list = radio.Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new ArgumentException("Native radio choices unavailable.");
            if (slot >= list.Count) throw new ArgumentException("This slot is outside native training radio choices.");
            var row = NegotiationActions.Record(list[slot]);
            if (row != null && (NegotiationActions.Flag(row, "Disabled", false) || NegotiationActions.Flag(row, "IsDisabled", false))) throw new InvalidOperationException("Game disabled this training tactic choice.");
        }
        var before = Number(c, field).ToString(CultureInfo.InvariantCulture); var requested = slot.ToString(CultureInfo.InvariantCulture);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = LiveTools.GetReference(team).GetPersistentIdentity(),
            tactic = c.Tactic.GetPersistentIdentity(), slot, before,
            state = c.Values.ToDictionary(pair => pair.Key, pair => NativeValueFingerprint.Compute(pair.Value.Value)) }));
        return (c, field, before, requested, token);
    }
    public static object Preview(string action, string team, string tactic, string channels, int slot)
    {
        var p = Prepare(action, team, tactic, channels, slot);
        return new { ok = true, choiceToken = p.Token, before = p.Before, requested = p.Requested, action, slotIndex = slot, liveVerified = false };
    }
    private static (LiveTools.Snapshot Menu, string Kind) MenuSource(Context c, string tactic, string choices)
    {
        if (c.Tactic.GetIl2CppType().FullName != "FM.UI.TeamTacticReference") throw new ArgumentException("Manage slots through the active manager's actual team tactic.");
        var snapshot = LiveTools.GetSnapshot(choices);
        var property = snapshot.Property == InternalCommands.PropertyId("AddTacticOptions") ? "AddTacticOptions" :
            snapshot.Property == InternalCommands.PropertyId("ModifyTacticOptions") ? "ModifyTacticOptions" :
            throw new ArgumentException("Use the original AddTacticOptions or ModifyTacticOptions subscription.");
        var menu = NegotiationActions.Channel(choices, tactic, property);
        if (menu.Identity != c.Tactic.GetPersistentIdentity()) throw new ArgumentException("Menu belongs to another tactic.");
        return (menu, property == "AddTacticOptions" ? "add" : "modify");
    }
    private static (Context Context, TypedValue Data, int Code, string Token) MenuChoice(string team, string tactic, string channels, string choices, string path)
    {
        var c = Resolve(team, tactic, channels);
        var (menu, kind) = MenuSource(c, tactic, choices);
        var data = TypedValue.CreateCopyFrom(NativeChoiceTree.Leaf(choices, path));
        var row = NegotiationActions.Record(data) ?? throw new ArgumentException("Choose an original native menu option.");
        if (!int.TryParse(NegotiationActions.Field(row, "PropertyValue").AsString(), out var code) || code != 2 && code != 9)
            throw new ArgumentException("Only original Duplicate(2) and Clear/Delete(9) menu entries are implemented here.");
        if (code == 2 && kind != "add" || code == 9 && kind != "modify")
            throw new ArgumentException("Duplicate uses the original Add menu; Clear uses the original Modify menu.");
        if (code == 2 && Occupied(c) >= c.Slots.Length) throw new InvalidOperationException("All native tactic slots are occupied.");
        if (code == 9 && Occupied(c) <= 1) throw new InvalidOperationException("Keep at least one tactic slot.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), team = LiveTools.GetReference(team).GetPersistentIdentity(),
            target = c.Tactic.GetPersistentIdentity(), kind, code, payload = NativeValueFingerprint.Compute(data), menu = NativeValueFingerprint.Compute(menu.Value), contexts = menu.ContextDescriptions,
            state = c.Values.ToDictionary(p => p.Key, p => NativeValueFingerprint.Compute(p.Value.Value)) }));
        return (c, data, code, token);
    }
    public static object MenuRead(string team, string tactic, string channels, string choices)
    {
        var c = Resolve(team, tactic, channels); var (menu, kind) = MenuSource(c, tactic, choices);
        return new { ok = true, menuKind = kind, choices = LiveTools.DescribeValue(menu.Value, 8), duplicateCode = 2, deleteCode = 9, currentSlotIndex = Number(c, "CurrentTacticSlot"),
            nextAction = kind == "add" ? "Preview an original Duplicate leaf to copy the selected source tactic into an available slot. No empty-slot selection is required." : "Use menuKind=add for duplicate candidates.", liveVerified = false };
    }
    public static object MenuPreview(string team, string tactic, string channels, string choices, string path)
    {
        var p = MenuChoice(team, tactic, channels, choices, path);
        return new { ok = true, choiceToken = p.Token, action = p.Code == 2 ? "duplicate-offered-source" : "delete-current", requiresDeleteAcknowledgment = p.Code == 9,
            currentSlotIndex = Number(p.Context, "CurrentTacticSlot"), payload = LiveTools.DescribeValue(p.Data), liveVerified = false };
    }
    public static object MenuExecute(string id, string team, string tactic, string channels, string choices, string path, string token, bool acceptDelete)
    {
        var p = MenuChoice(team, tactic, channels, choices, path);
        if (token != p.Token) throw new InvalidOperationException("Tactic menu or original slots changed; preview again.");
        if (p.Code == 9 && !acceptDelete) throw new InvalidOperationException("Explicitly acknowledge deletion of the previewed current tactic slot.");
        return ActionCommands.DispatchDomain(id, "tactic_slot." + (p.Code == 2 ? "duplicate" : "delete"), p.Context.Tactic.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Code == 2 ? 77u : 90u, p.Context.Tactic, p.Code == 2 ? p.Data : null),
            null, null, "tactic_slot_management_dispatch_only");
    }

    public static object SaveFile(string team, string tactic, string channels, string info, string saveMethod, string name, string id, string token)
    {
        var c = Resolve(team, tactic, channels);
        var slot = Number(c, "CurrentTacticSlot");
        if (!Valid(c, slot)) throw new InvalidOperationException("Select an occupied team tactic slot.");
        if (string.IsNullOrWhiteSpace(name) || name.Length > 64 || name.Any(ch => !char.IsLetterOrDigit(ch) && ch != ' ' && ch != '-' && ch != '_'))
            throw new ArgumentException("Use a short tactic name with letters, digits, spaces, hyphens or underscores.");
        if (!Guid.TryParse(id, out var operation)) throw new ArgumentException("Use a UUID operation ID.");
        var filename = $"{name.Trim()}-{operation:N}";
        var tacticInfo = NegotiationActions.Channel(info, tactic, "TacticInfo");
        if (tacticInfo.Identity != c.Tactic.GetPersistentIdentity() || tacticInfo.Value?.DataType?.FullName != "SI.Core.SmallMessage")
            throw new InvalidOperationException("Game did not provide the selected tactic's original save data.");
        var method = NegotiationActions.Channel(saveMethod, "singleton:ApplicationReference", "DefaultAddOnSaveMethod");
        if (method.Value?.AsString() != "0") throw new InvalidOperationException("This operation requires the game's local add-on save mode.");
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = c.Tactic.GetPersistentIdentity(), slot, filename, state = NativeValueFingerprint.Compute(tacticInfo.Value) }));
        if (string.IsNullOrEmpty(token)) return new { ok = true, choiceToken = expected, filename, slot, liveVerified = false };
        if (expected != token) throw new InvalidOperationException("Tactic or filename changed; preview again.");
        var file = new SI.Bindable.DynamicReference();
        file[0x6c67666e] = TypedValue.Create(filename);
        file[0x79703161] = TypedValue.CreateCopyFrom(method.Value);
        file[0x6e616d66] = TypedValue.Create("");
        file[0x64657363] = TypedValue.Create("");
        file[0x32202020] = TypedValue.Null;
        var context = new SI.Bindable.DynamicReference();
        context[0x736c7464] = GameTools.MakeObjectTypedValue(file);
        context[0x31303020] = TypedValue.Create(0);
        context[0x5465616d] = GameTools.MakeObjectTypedValue(LiveTools.GetReference(team));
        context[0x70496479] = TypedValue.Create(slot);
        context[0x6d61576a] = TypedValue.CreateCopyFrom(tacticInfo.Value);
        foreach (var field in new[] { 0x45516d76u, 0x68474e6fu, 0x32202020u, 0x706c7972u }) context[field] = TypedValue.Null;
        return ActionCommands.DispatchDomain(id, "tactic_file.save", c.Tactic.GetPersistentIdentity(), token,
            () => GameSubsystems.Get<EventSubsystem>().SendEvent(new FM.UI.SaveAddonEvent
            {
                SaveName = filename,
                EventID = InteropEventIDs.EventSaveAddOn,
                DataToSend = GameTools.MakeObjectTypedValue(context)
            }), null, filename, "tactic_file_save_dispatch");
    }

    private sealed record CreationOption(int id, string key);
    private sealed record Creator(Context Context, int Occupied, bool InUse, CreationOption[] Styles, CreationOption[] Formations, CreationOption[] OutOfPossessionFormations);
    private static Il2CppSystem.Collections.Generic.List<TypedValue> StaticOptions(string handle, string property) =>
        NegotiationActions.Channel(handle, "singleton:StaticDataReference", property).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
        ?? throw new InvalidOperationException("Game did not provide the original " + property + " options.");

    private static int StaticOptionId(TypedValue value, int? recordId)
    {
        if (recordId.HasValue) return recordId.Value;
        if (value?.DataType?.FullName == "SI.Core.DynamicNumber" &&
            int.TryParse(value.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
            return id;
        throw new InvalidOperationException("Game returned a tactic creation option with an unknown format.");
    }

    private static CreationOption[] ReadFormationOptions(string handle, bool inPossession)
    {
        var snapshot = NegotiationActions.Channel(handle, "singleton:StaticDataReference", "FormationOptionList");
        if (!snapshot.Contexts.TryGetValue("InPossession", out var phase) || !bool.TryParse(phase, out var actual) || actual != inPossession)
            throw new ArgumentException("Provide game formation choices for the requested possession phase.");
        var options = new List<CreationOption>();
        foreach (var value in StaticOptions(handle, "FormationOptionList"))
        {
            var entry = value?.Get()?.TryCast<FormationOptionEntry>();
            var id = StaticOptionId(value, entry == null ? null : (int)entry.OptionID);
            if (id > 0) options.Add(new(id, entry?.OptionID.ToString() ?? id.ToString(CultureInfo.InvariantCulture)));
        }
        return options.ToArray();
    }

    private static Creator CreationContext(string team, string tactic, string channels, string styles, string formations, string oopFormations)
    {
        if (MatchCommands.HasActivePlayback()) throw new InvalidOperationException("Create team tactics outside the match playback session.");
        var c = Resolve(team, tactic, channels);
        if (c.Tactic.GetIl2CppType().FullName != "FM.UI.TeamTacticReference" ||
            !c.Values.TryGetValue("IsCreatingTactic", out var creating) || !bool.TryParse(creating.Value?.AsString(), out var inUse))
            throw new InvalidOperationException("The active player's team tactic creator state is unavailable.");
        var styleOptions = new List<CreationOption>();
        foreach (var value in StaticOptions(styles, "TacticalStylesOptionList"))
        {
            var entry = value?.Get()?.TryCast<TacticalStylesOptionEntry>();
            var id = StaticOptionId(value, entry == null ? null : (int)entry.OptionID);
            if (id >= 0) styleOptions.Add(new(id, entry?.OptionID.ToString() ?? id.ToString(CultureInfo.InvariantCulture)));
        }
        var formationOptions = ReadFormationOptions(formations, true);
        var defensiveOptions = ReadFormationOptions(oopFormations, false);
        if (styleOptions.Count == 0 || formationOptions.Length == 0 || defensiveOptions.Length == 0)
            throw new InvalidOperationException("The game has not populated the creation options.");
        return new(c, Occupied(c), inUse, styleOptions.ToArray(), formationOptions, defensiveOptions);
    }

    private static string CreationToken(Creator c, int style, int ip, int oop)
    {
        if (c.Occupied >= c.Context.Slots.Length || c.InUse) throw new InvalidOperationException("A free slot and an idle native tactic creator are required.");
        if (c.Styles.Count(option => option.id == style) != 1 || c.Formations.Count(option => option.id == ip) != 1 ||
            c.OutOfPossessionFormations.Count(option => option.id == oop) != 1)
            throw new ArgumentException("Choose a tactical style and both formations from the current game's option lists.");
        return DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            tactic = c.Context.Tactic.GetPersistentIdentity(), style, ip, oop, cursor = MutationActivity.Cursor,
            slots = c.Context.Values.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .ToDictionary(pair => pair.Key, pair => NativeValueFingerprint.Compute(pair.Value.Value)) }));
    }

    public static object CreationPreview(string team, string tactic, string channels, string styles, string formations, string oopFormations, int? style, int? ip, int? oop)
    {
        var c = CreationContext(team, tactic, channels, styles, formations, oopFormations);
        var hasSelection = style.HasValue || ip.HasValue || oop.HasValue;
        if (hasSelection && !(style.HasValue && ip.HasValue && oop.HasValue)) throw new ArgumentException("Provide a style and both formations to preview creation.");
        var token = hasSelection ? CreationToken(c, style.Value, ip.Value, oop.Value) : null;
        return new { ok = true, occupied = c.Occupied, inUse = c.InUse, canCreate = c.Occupied < c.Context.Slots.Length && !c.InUse,
            tacticalStyles = c.Styles, formations = c.Formations, outOfPossessionFormations = c.OutOfPossessionFormations, choiceToken = token, liveVerified = false };
    }

    public static object Create(string id, string team, string tactic, string channels, string styles, string formations, string oopFormations, int style, int ip, int oop, string token)
    {
        var c = CreationContext(team, tactic, channels, styles, formations, oopFormations);
        if (CreationToken(c, style, ip, oop) != token) throw new InvalidOperationException("Tactic slots or creation choices changed; preview again.");
        var payload = new SI.Bindable.DynamicReference();
        payload[0x31363920] = TypedValue.Create(style);
        payload[0x20784d55] = TypedValue.Create(ip);
        payload[0x6443376b] = TypedValue.Create(oop);
        var before = c.Occupied.ToString(CultureInfo.InvariantCulture);
        var requested = (c.Occupied + 1).ToString(CultureInfo.InvariantCulture);
        return ActionCommands.DispatchDomain(id, CreateCommand, c.Context.Tactic.GetPersistentIdentity(), token,
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxConfirmedCreateNewTactic,
                c.Context.Tactic, GameTools.MakeObjectTypedValue(payload)), before, requested, CreateScope);
    }
    public static object Execute(string id, string action, string team, string tactic, string channels, int slot, string token)
    {
        var p = Prepare(action, team, tactic, channels, slot);
        if (token != p.Token) throw new InvalidOperationException("Tactic slots or the current selection changed; preview again.");
        return ActionCommands.DispatchDomain(id, "tactic_slot." + action, p.Context.Tactic.GetPersistentIdentity(), token, () => {
            if (action == "select") SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxSetTacticSlot, p.Context.Tactic, TypedValue.Create(slot));
            else LiveTools.UpdateProperty(p.Context.Handles[p.Field], TypedValue.Create(slot));
        }, p.Before, p.Requested, "tactic_slot_configuration." + p.Field);
    }
}
