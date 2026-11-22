using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Native Calendar player-event/server branches 0x326d4872: one day's existing training slot.
// Do not send SelectTrainingSession or BeginTrainingWeekEditFromCard: those select shared UI drafts.
public static class TeamSessionCommands
{
    private const string Scope = "team_training_session_configuration";
    private static SI.Core.Record Option(SI.Core.Record menu, string path)
    {
        var parts = (path ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !parts[0].Equals("0x204e4773", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Choose a concrete training leaf in the native Dropdown tree.");
        var childrenKey = "0x" + InternalCommands.PropertyId("ChildList").ToString("x8");
        var next = Field(menu, "Dropdown");
        var at = 1;
        var depth = 0;
        while (++depth <= 8)
        {
            var type = next?.DataType?.FullName ?? "";
            if (!type.StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal)) throw new ArgumentException("Training choice group is not a list.");
            var list = next.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>() ?? throw new ArgumentException("Training choice group is not a native list.");
            if (at >= parts.Length || !int.TryParse(parts[at++], NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0 || index >= list.Count)
                throw new ArgumentException("Training option index is outside the current native group.");
            var row = Record(list[index]) ?? throw new ArgumentException("Training menu row is not a record.");
            if (Flag(row, "Disabled", false)) throw new InvalidOperationException("Game disabled this training option or parent group.");
            var data = row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested) ? Record(nested) : row;
            if (data == null) throw new ArgumentException("Training row has no original option data.");
            if (Flag(data, "Disabled", false)) throw new InvalidOperationException("Game disabled this training option.");
            var children = Field(row, "ChildList", false);
            if (children.IsNull) children = Field(data, "ChildList", false);
            if (at < parts.Length && parts[at].Equals(childrenKey, StringComparison.OrdinalIgnoreCase))
            {
                at++; next = children; continue;
            }
            if (at < parts.Length && parts[at].Equals("0x526f7744", StringComparison.OrdinalIgnoreCase)) at++;
            if (at != parts.Length) throw new ArgumentException("Training choice path can only traverse group indices and RowData.");
            if (!children.IsNull)
            {
                var childType = children.DataType?.FullName ?? "";
                if (!childType.StartsWith("System.Collections.Generic.List`1", StringComparison.Ordinal) ||
                    children.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()?.Count != 0)
                    throw new ArgumentException("Select a concrete training session leaf, not a category heading.");
            }
            return data;
        }
        throw new ArgumentException("Training menu nesting exceeds the supported depth.");
    }
    private static (InteropReference Calendar, string Slot, TypedValue Date, TypedValue Index, TypedValue Current) State(
        string calendar, string days, string dayPath, string date, string events, string eventPath, string current, string index)
    {
        var target = TeamScheduleCommands.Target(calendar);
        Channel(days, calendar, "MonthEvents");
        if (string.IsNullOrWhiteSpace(dayPath) || string.IsNullOrWhiteSpace(eventPath)) throw new ArgumentException("Select an actual day and training event path.");
        var day = Record(LiveTools.GetValue(days, dayPath)) ?? throw new ArgumentException("Calendar day is not an original record.");
        var dateValue = Channel(date, days, "Date", dayPath).Value;
        if (NativeValueFingerprint.Compute(dateValue) != NativeValueFingerprint.Compute(Field(day, "Date"))) throw new InvalidOperationException("Calendar day changed after subscribing its date.");
        var eventList = Channel(events, days, "Events", dayPath).Value;
        if (NativeValueFingerprint.Compute(eventList) != NativeValueFingerprint.Compute(Field(day, "Events"))) throw new InvalidOperationException("Calendar day events changed; refresh before operating.");
        var row = Record(LiveTools.GetValue(events, eventPath)) ?? throw new ArgumentException("Select an actual training event.");
        var currentValue = Channel(current, events, "SessionType", eventPath).Value;
        var indexValue = Channel(index, events, "SessionIndex", eventPath).Value;
        if (NativeValueFingerprint.Compute(currentValue) != NativeValueFingerprint.Compute(Field(row, "SessionType")) ||
            NativeValueFingerprint.Compute(indexValue) != NativeValueFingerprint.Compute(Field(row, "SessionIndex")))
            throw new InvalidOperationException("Training event changed after subscribing its fields.");
        if (!int.TryParse(indexValue.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var slot) || slot < 0 || slot > 2)
            throw new ArgumentException("This event is not one of the game's three daily training slots.");
        var identity = target.GetPersistentIdentity() + "|date:" + NativeValueFingerprint.Compute(dateValue) + "|slot:" + slot;
        return (target, identity, dateValue, indexValue, currentValue);
    }
    public static object Read(string calendar, string days, string dayPath, string date, string events, string eventPath, string current, string index, string control, string operationId)
    {
        var state = State(calendar, days, dayPath, date, events, eventPath, current, index);
        var owned = GeneralTrainingControl.Read(calendar, control).Owned;
        if (!string.IsNullOrWhiteSpace(operationId))
        {
            var receipt = (DispatchJournal.Receipt)ActionCommands.Status(operationId);
            return receipt.verificationScope == Scope + ".with_control"
                ? ActionCommands.ObserveDomain(operationId, state.Slot, Scope + ".with_control", GeneralTrainingControl.WithControl(state.Current.AsString(), owned))
                : ActionCommands.ObserveDomain(operationId, state.Slot, Scope, state.Current.AsString());
        }
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, slotIdentity = state.Slot,
            current = state.Current.AsString(), generalTrainingControlled = owned, date = LiveTools.DescribeValue(state.Date), slotIndex = state.Index.AsString(),
            eventData = LiveTools.DescribeValue(LiveTools.GetValue(events, eventPath), 6), verificationScope = Scope };
    }
    private static (InteropReference Calendar, SI.Core.Record Payload, uint Event, string Slot, string Before, string Desired, string Token, string VerificationScope) Prepare(
        string calendar, string days, string dayPath, string date, string events, string eventPath, string current, string index, string editable, string passed, string control, string menu, string optionPath, string delegation)
    {
        var state = State(calendar, days, dayPath, date, events, eventPath, current, index);
        var canEdit = Channel(editable, events, "CanEdit", eventPath).Value;
        var dayPassed = Channel(passed, days, "HasDayPassed", dayPath).Value;
        if (!bool.TryParse(canEdit?.AsString(), out var allowed) || !allowed || !bool.TryParse(dayPassed?.AsString(), out var past) || past)
            throw new InvalidOperationException("Game does not permit editing this training slot, or the day has passed.");
        var row = Record(LiveTools.GetValue(events, eventPath));
        var day = Record(LiveTools.GetValue(days, dayPath));
        if (Field(row, "CanEdit").AsString() != canEdit.AsString() || Field(day, "HasDayPassed").AsString() != dayPassed.AsString())
            throw new InvalidOperationException("Training permission changed after subscribing it.");
        var responsibilityState = GeneralTrainingControl.Read(calendar, control);
        var responsibility = responsibilityState.Value;
        var menuSource = Channel(menu, calendar, "TrainingCategoryAndSessionsDropdown");
        if (TeamScheduleCommands.Context(menuSource, 0x6e4d7a54) != LiveTools.JsonText(LiveTools.DescribeValue(state.Date)) ||
            TeamScheduleCommands.Context(menuSource, 0x39735275) != LiveTools.JsonText(LiveTools.DescribeValue(state.Index)))
            throw new ArgumentException("Training choices belong to a different day or slot.");
        // Native query returns {Dropdown: original category/choice tree, EventData: base record}.
        var menuRecord = Record(menuSource.Value) ?? throw new InvalidOperationException("Training menu is not ready.");
        var selected = Option(menuRecord, optionPath);
        var selectedValue = Field(selected, "PropertyValue");
        if (!ushort.TryParse(selectedValue.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
            throw new ArgumentException("Choose a concrete native training session value.");
        var original = Record(Field(menuRecord, "EventData")) ?? throw new InvalidOperationException("Training menu has no original event data.");
        if (NativeValueFingerprint.Compute(Field(original, "Date")) != NativeValueFingerprint.Compute(state.Date) ||
            NativeValueFingerprint.Compute(Field(original, "SessionIndex")) != NativeValueFingerprint.Compute(state.Index) ||
            NativeValueFingerprint.Compute(Field(original, "GeneralTrainingHumanControlled")) != NativeValueFingerprint.Compute(responsibility))
            throw new InvalidOperationException("Native training menu data changed or belongs to another slot/responsibility.");
        Field(original, "WeekStartDate");
        var payload = new SI.Core.Record();
        foreach (var pair in original) payload[pair.Key] = TypedValue.CreateCopyFrom(pair.Value);
        payload[0x4f516a6e] = TypedValue.CreateCopyFrom(selectedValue);
        var operation = GeneralTrainingControl.Prepare(responsibility, delegation, payload, 846022770, false);
        var before = operation.VerifyControl ? GeneralTrainingControl.WithControl(state.Current.AsString(), responsibilityState.Owned) : state.Current.AsString();
        var desired = operation.VerifyControl ? GeneralTrainingControl.WithControl(selectedValue.AsString(), true) : selectedValue.AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            slot = state.Slot, revision = Revision(state.Calendar.GetPersistentIdentity()), before, desired, delegation, nativeEvent = operation.Event,
            offered = NativeValueFingerprint.Compute(menuSource.Value), payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(operation.Payload)) }));
        return (state.Calendar, operation.Payload, operation.Event, state.Slot, before, desired, token, Scope + (operation.VerifyControl ? ".with_control" : ""));
    }
    public static object Preview(string calendar, string days, string dayPath, string date, string events, string eventPath, string current, string index, string editable, string passed, string control, string menu, string optionPath, string delegation)
    {
        var prepared = Prepare(calendar, days, dayPath, date, events, eventPath, current, index, editable, passed, control, menu, optionPath, delegation);
        return new { ok = true, choiceToken = prepared.Token, slotIdentity = prepared.Slot, before = prepared.Before, requested = prepared.Desired,
            delegation, nativeEventId = prepared.Event,
            payload = LiveTools.DescribeValue(GameTools.MakeObjectTypedValue(prepared.Payload)), verificationScope = prepared.VerificationScope, liveVerified = false };
    }
    public static object Execute(string id, string calendar, string days, string dayPath, string date, string events, string eventPath, string current, string index, string editable, string passed, string control, string menu, string optionPath, string token, string delegation)
    {
        var prepared = Prepare(calendar, days, dayPath, date, events, eventPath, current, index, editable, passed, control, menu, optionPath, delegation);
        if (prepared.Token != token) throw new InvalidOperationException("Training slot or legal option changed since preview.");
        return ActionCommands.DispatchDomain(id, "team_training_session", prepared.Slot, token, () => {
            Touch(prepared.Calendar.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(prepared.Event, prepared.Calendar, GameTools.MakeObjectTypedValue(prepared.Payload));
        }, prepared.Before, prepared.Desired, prepared.VerificationScope);
    }
}
