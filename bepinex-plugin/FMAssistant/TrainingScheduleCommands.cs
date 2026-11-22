using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Custom training schedule draft lifecycle. Event ids come from InteropEventIDs and captured
// current-build UI frames (evidence/v74-training-schedule-protocol.json):
// 1132029239 begin edit (target human.CustomTrainingSchedule, null data),
// 829774452 save (target schedule, null data, gated by CanSave),
// 2053720650 clear (target schedule, const.true data, gated by CanClearSchedule),
// 827224151 create from dialog (target schedule, schedule.Name string).
// Dropdown confirmation uses the selected leaf's TrainingSchedule.PropertyValue.
public static class TrainingScheduleCommands
{
    private const uint CustomScheduleFlag = 0x70757343;
    private sealed record Prepared(InteropReference Target, TypedValue Payload, uint Event, string Scope, string Token, string Before, string Requested);
    private static InteropReference Resolve(string schedule)
    {
        var target = LiveTools.GetReference(schedule);
        var snapshot = LiveTools.GetSnapshot(schedule);
        if (target.GetIl2CppType().FullName != "FM.UI.CustomTrainingScheduleReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("CustomTrainingSchedule"))
            throw new ArgumentException("Resolve the actual human.CustomTrainingSchedule reference.");
        return target;
    }
    private static LiveTools.Snapshot State(string handle, string schedule, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != schedule || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong training schedule subscription: " + property);
        return snapshot;
    }
    private static LiveTools.Snapshot NameChannel(string handle, string schedule)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != schedule || !string.IsNullOrEmpty(snapshot.SourcePath))
            throw new ArgumentException("Wrong training schedule name subscription.");
        var name = snapshot.Property;
        if (name != InternalCommands.PropertyId("TrainingScheduleName") && name != InternalCommands.PropertyId("Name"))
            throw new ArgumentException("Expected the schedule Name or TrainingScheduleName property.");
        return snapshot;
    }
    private static bool Flag(LiveTools.Snapshot snapshot) => bool.TryParse(snapshot.Value?.AsString(), out var flag)
        ? flag : throw new ArgumentException("Native training schedule flag is not ready.");
    public static object Read(string schedule, string canSave, string canClear, string dropdownName, string scheduleName)
    {
        var target = Resolve(schedule);
        return new { ok = true, scheduleIdentity = target.GetPersistentIdentity(),
            canSave = Flag(State(canSave, schedule, "CanSave")),
            canClearSchedule = Flag(State(canClear, schedule, "CanClearSchedule")),
            trainingScheduleDropdownName = LiveTools.DescribeValue(State(dropdownName, schedule, "TrainingScheduleDropdownName").Value),
            trainingScheduleName = LiveTools.DescribeValue(NameChannel(scheduleName, schedule).Value),
            draftOnly = true, liveVerified = false };
    }
    private static Prepared Prepare(string action, string schedule, string canSave, string canClear, string name)
    {
        var target = Resolve(schedule);
        var identity = target.GetPersistentIdentity();
        TypedValue payload = null;
        uint eventId;
        string scope;
        switch (action)
        {
            case "begin":
                eventId = 1132029239u; scope = "training_schedule_edit_begin"; break;
            case "save":
                if (!Flag(State(canSave, schedule, "CanSave"))) throw new InvalidOperationException("Game does not allow saving this custom training schedule.");
                eventId = 829774452u; scope = "training_schedule_save"; break;
            case "clear":
                if (!Flag(State(canClear, schedule, "CanClearSchedule"))) throw new InvalidOperationException("Game does not allow clearing this custom training schedule.");
                payload = TypedValue.Create(true); eventId = 2053720650u; scope = "training_schedule_clear"; break;
            case "create":
                if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Creating a custom training schedule requires a non-empty name.");
                payload = TypedValue.Create(name.Trim()); eventId = 827224151u; scope = "training_schedule_create"; break;
            default:
                throw new ArgumentException("Use begin, save, clear or create.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity, payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(identity) }));
        return new(target, payload, eventId, scope, token, null, action == "create" ? name.Trim() : null);
    }
    public static object Preview(string action, string schedule, string canSave, string canClear, string name)
    {
        var p = Prepare(action, schedule, canSave, canClear, name);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string schedule, string canSave, string canClear, string name, string token)
    {
        var p = Prepare(action, schedule, canSave, canClear, name);
        if (token != p.Token) throw new InvalidOperationException("Custom training schedule draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "training_schedule_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, p.Before, p.Requested, p.Scope);
    }

    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete training schedule option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var row = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
                throw new InvalidOperationException("Game disabled this training schedule option or its parent group.");
        }
        var option = LiveTools.GetValue(handle, path);
        var selected = Record(option) ?? throw new ArgumentException("Selected training schedule is not a native record.");
        if (selected.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; selected = Record(option); }
        if (selected == null || !selected.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var value) || Record(value) is not { } payload)
            throw new ArgumentException("Select a training schedule leaf with a native PropertyValue record.");
        if (!payload.TryGetValue(0x74797065, out var kind) || kind.AsString() != "0")
            throw new ArgumentException("Select a normal schedule leaf. File actions and delete entries are not schedule selections.");
        return TypedValue.CreateCopyFrom(value);
    }
    public static object ConfirmPreview(string schedule, string options, string optionPath)
    {
        var target = Resolve(schedule);
        State(options, schedule, "TrainingScheduleDropdown");
        var payload = Option(options, optionPath);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "confirm", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return new { ok = true, action = "confirm", nativeEvent = 1632595570u, choiceToken = token,
            payload = LiveTools.DescribeValue(payload), draftOnly = true, liveVerified = false };
    }
    public static object ConfirmExecute(string id, string schedule, string options, string optionPath, string token)
    {
        var target = Resolve(schedule);
        State(options, schedule, "TrainingScheduleDropdown");
        var payload = Option(options, optionPath);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "confirm", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        if (token != expected) throw new InvalidOperationException("Training schedule or option changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "training_schedule_confirm", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1632595570u, target, payload);
        }, null, null, "training_schedule_confirm");
    }

    // Full UI index: TrainingScheduleRow fires EventFmxRequestDeleteCustomTrainingSchedule (2001683788)
    // with target=human.TrainingCalendar and data=the row's EventData value; live evidence on
    // 2026-11-19 showed the request event alone does not delete, while the game enum's real delete
    // event EventFmxDeleteCustomTrainingSchedule (1632055349) with the same target/data deletes the
    // row (TrainingSchedules list count 2 -> 1 and the dropdown custom entry disappeared).
    private static InteropReference Calendar(string calendar)
    {
        var target = LiveTools.GetReference(calendar);
        var snapshot = LiveTools.GetSnapshot(calendar);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("TrainingCalendar") ||
            !string.IsNullOrEmpty(snapshot.SourcePath))
            throw new ArgumentException("Resolve the manager's human.TrainingCalendar reference.");
        return target;
    }
    private static TypedValue ScheduleEventData(string schedules, string calendar, string optionPath)
    {
        var list = LiveTools.GetSnapshot(schedules);
        if (!list.Ready || list.Source != calendar || !string.IsNullOrEmpty(list.SourcePath) ||
            list.Property != InternalCommands.PropertyId("TrainingSchedules"))
            throw new ArgumentException("Use the manager calendar's actual TrainingSchedules list.");
        if (string.IsNullOrWhiteSpace(optionPath)) throw new ArgumentException("Select a native custom training schedule row.");
        var row = LiveTools.GetValue(schedules, optionPath);
        var record = Record(row) ?? throw new ArgumentException("Selected schedule is not a native record.");
        if (!record.TryGetValue(InternalCommands.PropertyId("EventData"), out var data) ||
            Record(data) is not { } eventRecord || !eventRecord.TryGetValue(CustomScheduleFlag, out var custom) ||
            !bool.TryParse(custom.AsString(), out var isCustom) || !isCustom)
            throw new ArgumentException("Selected row has no custom schedule EventData.");
        return TypedValue.CreateCopyFrom(data);
    }
    public static object DeletePreview(string calendar, string schedules, string optionPath)
    {
        var target = Calendar(calendar);
        var payload = ScheduleEventData(schedules, calendar, optionPath);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "delete", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return new { ok = true, action = "delete", nativeEvent = 1632055349u, requestEvent = 2001683788u, choiceToken = token,
            payload = LiveTools.DescribeValue(payload), externalUsers = LiveTools.ExternalReferenceUsers(target),
            draftOnly = true, liveVerified = false,
            note = "删除自定义训练日程；使用游戏真实删除事件 1632055349（请求事件 2001683788 单独不会删除）。" };
    }
    public static object DeleteExecute(string id, string calendar, string schedules, string optionPath, string token)
    {
        var target = Calendar(calendar);
        var payload = ScheduleEventData(schedules, calendar, optionPath);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "delete", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        if (token != expected) throw new InvalidOperationException("Training schedule or option changed since preview.");
        // Live finding 2026-11-19: human.TrainingCalendar always has the game's own panel roots in the
        // binding tree (read-only diagnosis showed plain FM.UI.CalendarReference nodes named
        // "calendar"/"TrainingCalendar" at depths 9-12), so RequireUnusedDraft would refuse every
        // delete. This event is a request to delete a stored custom schedule, not an edit of a shared
        // draft; the token still binds the exact row EventData and calendar identity.
        return ActionCommands.DispatchDomain(id, "training_schedule_delete", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1632055349u, target, payload);
        }, null, null, "training_schedule_delete");
    }
}
