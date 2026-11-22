using System;
using System.Linq;
using FM.GamePlugin;
using SI.Bindable.Reference.Core;
using SI.Core;
using SI.Interop;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Calendar UI event 0x614f6e72 -> server -> normal training schedule business rules.
// Use original schedule.EventData, week.WeekStartDate and responsibility record.
public static class TeamScheduleCommands
{
    internal static InteropReference Target(string calendar)
    {
        var source = LiveTools.GetSnapshot(calendar);
        if (!source.Ready || source.Source != "human" || !string.IsNullOrEmpty(source.SourcePath) ||
            source.Property != InternalCommands.PropertyId("TrainingCalendar") || source.Identity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual TrainingCalendar.");
        var target = LiveTools.GetReference(calendar);
        if (target.GetIl2CppType().FullName != "FM.UI.CalendarReference") throw new ArgumentException("Expected a real training calendar reference.");
        return target;
    }
    private static LiveTools.Snapshot Week(string calendar, string weeks, string path, string date)
    {
        Target(calendar);
        Channel(weeks, calendar, "TrainingScheduleWeeks");
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose an actual training week path.");
        if (Record(LiveTools.GetValue(weeks, path)) == null) throw new ArgumentException("Week is not an original calendar week record.");
        var value = Channel(date, weeks, "WeekStartDate", path);
        return value;
    }
    internal static string Context(LiveTools.Snapshot source, uint id)
    {
        var name = new ContextID(id).ToString().Split(':')[0];
        return source.ContextDescriptions.TryGetValue(name, out var description) ? description : throw new ArgumentException("Missing schedule context: " + name);
    }
    private static void DateContext(LiveTools.Snapshot source, TypedValue date)
    {
        if (Context(source, 0x6e4d7a54) != LiveTools.JsonText(LiveTools.DescribeValue(date)))
            throw new ArgumentException("Schedule choices refer to a different week date.");
    }
    internal static SI.Core.Record Choice(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose a concrete native training option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var ancestor = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (ancestor != null && Flag(ancestor, "Disabled", false)) throw new InvalidOperationException("Game disabled the training option or its parent group.");
        }
        return Record(LiveTools.GetValue(handle, path)) ?? throw new ArgumentException("Choose an original training option record.");
    }
    private static (InteropReference Target, SI.Core.Record Payload, uint Event, string Token, string Date) Prepare(
        string calendar, string weeks, string weekPath, string date, string editable, string control, string categories, string categoryPath, string schedules, string schedulePath, string eventData, string delegation)
    {
        var target = Target(calendar);
        var weekDate = Week(calendar, weeks, weekPath, date).Value;
        var canEdit = Channel(editable, weeks, "CanEditTrainingSchedule", weekPath).Value;
        if (!bool.TryParse(canEdit?.AsString(), out var edit) || !edit) throw new InvalidOperationException("Game does not allow editing this training week.");
        // Match each field back to the same current week record, even if the parent list reordered.
        var week = Record(LiveTools.GetValue(weeks, weekPath));
        if (NativeValueFingerprint.Compute(Field(week, "WeekStartDate")) != NativeValueFingerprint.Compute(weekDate) ||
            Field(week, "CanEditTrainingSchedule").AsString() != canEdit.AsString())
            throw new InvalidOperationException("Training week changed after its fields were subscribed. Refresh the week.");
        var responsibility = GeneralTrainingControl.Read(calendar, control).Value;
        var categoryList = Channel(categories, calendar, "TrainingScheduleCategoryDropdown");
        var choices = Channel(schedules, calendar, "TrainingSchedules");
        DateContext(categoryList, weekDate); DateContext(choices, weekDate);
        var month = Context(LiveTools.GetSnapshot(weeks), 0x6d506451);
        if (new[] { categoryList, choices }.Any(channel =>
            channel.ContextDescriptions.TryGetValue("MonthIndex", out var actualMonth) && actualMonth != month))
            throw new ArgumentException("Week and training choices use different month contexts.");
        if (string.IsNullOrWhiteSpace(categoryPath) || string.IsNullOrWhiteSpace(schedulePath)) throw new ArgumentException("Select concrete native category and schedule paths.");
        var category = LiveTools.GetValue(categories, categoryPath);
        var categoryRecord = Choice(categories, categoryPath);
        Field(categoryRecord, "PropertyValue");
        if (Flag(categoryRecord, "Disabled", false)) throw new InvalidOperationException("Game disabled this training category.");
        if (Context(choices, 0x6c793152) != LiveTools.JsonText(LiveTools.DescribeValue(category))) throw new ArgumentException("Schedules do not belong to the selected native category.");
        var selected = Choice(schedules, schedulePath);
        if (Flag(selected, "Disabled", false)) throw new InvalidOperationException("Game disabled this schedule.");
        var data = Channel(eventData, schedules, "EventData", schedulePath).Value;
        if (NativeValueFingerprint.Compute(data) != NativeValueFingerprint.Compute(Field(selected, "EventData")))
            throw new InvalidOperationException("The selected schedule changed while reading its event data.");
        if (Record(data) == null) throw new InvalidOperationException("Schedule has no native EventData record.");
        var payload = new SI.Core.Record();
        payload[0x65766474] = TypedValue.CreateCopyFrom(data);
        payload[0x43714d41] = TypedValue.CreateCopyFrom(weekDate);
        payload[0x6d385934] = TypedValue.CreateCopyFrom(responsibility);
        var operation = GeneralTrainingControl.Prepare(responsibility, delegation, payload, 1632595570, true);
        var dateHash = NativeValueFingerprint.Compute(weekDate);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), revision = Revision(target.GetPersistentIdentity()), dateHash, week = NativeValueFingerprint.Compute(LiveTools.GetValue(weeks, weekPath)),
            delegation, nativeEvent = operation.Event, responsibility = NativeValueFingerprint.Compute(responsibility),
            choice = NativeValueFingerprint.Compute(LiveTools.GetValue(schedules, schedulePath)), payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(operation.Payload)) }));
        return (target, operation.Payload, operation.Event, token, dateHash);
    }
    public static object Preview(string calendar, string weeks, string weekPath, string date, string editable, string control, string categories, string categoryPath, string schedules, string schedulePath, string eventData, string delegation)
    {
        var prepared = Prepare(calendar, weeks, weekPath, date, editable, control, categories, categoryPath, schedules, schedulePath, eventData, delegation);
        return new { ok = true, choiceToken = prepared.Token, dateFingerprint = prepared.Date, delegation, nativeEventId = prepared.Event,
            responsibilityEffect = delegation == "take_control_all" ? "Apply the change and take over future general training when currently delegated." : delegation == "take_control_this_once" ? "Apply only this change when currently delegated." : "Respect current responsibility.",
            payload = LiveTools.DescribeValue(GameTools.MakeObjectTypedValue(prepared.Payload)), liveVerified = false };
    }
    public static object Execute(string id, string calendar, string weeks, string weekPath, string date, string editable, string control, string categories, string categoryPath, string schedules, string schedulePath, string eventData, string token, string delegation)
    {
        var prepared = Prepare(calendar, weeks, weekPath, date, editable, control, categories, categoryPath, schedules, schedulePath, eventData, delegation);
        if (prepared.Token != token) throw new InvalidOperationException("Training week, responsibility or schedule choice changed since preview.");
        return ActionCommands.DispatchDomain(id, "team_training_week_schedule", prepared.Target.GetPersistentIdentity(), token,
            () => { Touch(prepared.Target.GetPersistentIdentity()); SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(prepared.Event, prepared.Target, GameTools.MakeObjectTypedValue(prepared.Payload)); },
            null, null, "team_training_schedule_dispatch");
    }
    public static object Read(string calendar, string weeks, string weekPath, string date)
    {
        var target = Target(calendar);
        var weekDate = Week(calendar, weeks, weekPath, date).Value;
        var week = LiveTools.GetValue(weeks, weekPath);
        if (NativeValueFingerprint.Compute(Field(Record(week), "WeekStartDate")) != NativeValueFingerprint.Compute(weekDate))
            throw new InvalidOperationException("Training week reordered after subscribing its date.");
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, targetIdentity = target.GetPersistentIdentity(),
            dateFingerprint = NativeValueFingerprint.Compute(weekDate), week = LiveTools.DescribeValue(week, 6),
            verificationScope = "observed_training_week", commandCausalityVerified = false };
    }
}
