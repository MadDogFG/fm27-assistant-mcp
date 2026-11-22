using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Training week edit commit/cancel. Full UI index (evidence/v87-training-week-edit.json):
// TrainingScheduleEditor buttons fire CommitTrainingWeekFromCard (4108082463) and
// CancelTrainingWeekEditFromCard (4108082471) with target=trainingselector and data=null.
// The selector is the manager's human.TrainingCalendar reference (implements ITrainingSelectorReference).
// Static evidence only; no live dispatch.
public static class TrainingWeekEditCommands
{
    public static object PastePreview(string selector, string date, string allowed)
        => new { ok = true, choiceToken = PasteToken(selector, date, allowed), nativeEvent = 1500406048u, liveVerified = false };
    private static string PasteToken(string selector, string date, string allowed)
    {
        var target = Resolve(selector);
        var payload = WeekDate(date, selector);
        var permission = LiveTools.GetSnapshot(allowed);
        if (!permission.Ready || permission.Source != selector ||
            permission.Property != InternalCommands.PropertyId("CanPasteTrainingWeek") ||
            !bool.TryParse(permission.Value?.AsString(), out var canPaste) || !canPaste)
            throw new InvalidOperationException("FM does not allow pasting into this week.");
        if (TeamScheduleCommands.Context(permission, 0x6e4d7a54) != LiveTools.JsonText(LiveTools.DescribeValue(payload)))
            throw new InvalidOperationException("Paste permission refers to another target week.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new {
            session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "paste_training_week", identity = target.GetPersistentIdentity(),
            date = NativeValueFingerprint.Compute(payload), contexts = permission.Contexts
        }));
        return token;
    }
    public static object PasteExecute(string id, string selector, string date, string allowed, string token)
    {
        if (PasteToken(selector, date, allowed) != token)
            throw new InvalidOperationException("Paste target changed; refresh its preview.");
        var target = Resolve(selector);
        var payload = WeekDate(date, selector);
        return ActionCommands.DispatchDomain(id, "paste_training_week", target.GetPersistentIdentity(), token,
            () => GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1500406048u, target, payload),
            null, null, "paste_training_week");
    }
    private static InteropReference Resolve(string selector)
    {
        var target = LiveTools.GetReference(selector);
        var snapshot = LiveTools.GetSnapshot(selector);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("TrainingCalendar") ||
            !string.IsNullOrEmpty(snapshot.SourcePath))
            throw new ArgumentException("Resolve the manager's human.TrainingCalendar reference (training selector).");
        var type = target.GetIl2CppType().FullName ?? "";
        if (type != "FM.UI.CalendarReference") throw new ArgumentException("Resolved reference is not the training calendar selector.");
        return target;
    }
    private static string Token(string selector, string action)
    {
        var target = Resolve(selector);
        return DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "training-week-" + action, identity = target.GetPersistentIdentity(),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
    }
    public static object Preview(string action, string selector)
    {
        if (action != "commit" && action != "cancel") throw new ArgumentException("Use commit or cancel.");
        var target = Resolve(selector);
        return new { ok = true, action, nativeEvent = action == "commit" ? 4108082463u : 4108082471u,
            choiceToken = Token(selector, action), payload = (object)null, draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string selector, string token)
    {
        if (action != "commit" && action != "cancel") throw new ArgumentException("Use commit or cancel.");
        var target = Resolve(selector);
        var expected = Token(selector, action);
        if (token != expected) throw new InvalidOperationException("Training week edit changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        var eventId = action == "commit" ? 4108082463u : 4108082471u;
        return ActionCommands.DispatchDomain(id, "training_week_edit_" + action, target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(eventId, target, null);
        }, null, null, "training_week_edit_" + action);
    }

    // CopyTrainingWeek 962751567: target=human.TrainingCalendar (calendar) and data=the selected week's date
    // (TrainingOverviewCalendarWeekSmall binding calendar/date). The date is taken from a live week-row Date channel.
    private static TypedValue WeekDate(string date, string selector)
    {
        var snapshot = LiveTools.GetSnapshot(date);
        if (!snapshot.Ready || string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId("WeekStartDate"))
            throw new ArgumentException("Provide a live Date subscription of the selected training week row.");
        var weeks = LiveTools.GetSnapshot(snapshot.Source);
        if (!weeks.Ready || weeks.Source != selector ||
            weeks.Property != InternalCommands.PropertyId("TrainingScheduleWeeks"))
            throw new ArgumentException("The selected week must belong to this training calendar.");
        var value = snapshot.Value ?? throw new ArgumentException("Training week date is not ready.");
        return TypedValue.CreateCopyFrom(value);
    }
    public static object CopyPreview(string selector, string date)
    {
        var target = Resolve(selector);
        var payload = WeekDate(date, selector);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "training-week-copy", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        return new { ok = true, nativeEvent = 962751567u, choiceToken = token, payload = LiveTools.DescribeValue(payload),
            draftOnly = true, liveVerified = false };
    }
    public static object CopyExecute(string id, string selector, string date, string token)
    {
        var target = Resolve(selector);
        var payload = WeekDate(date, selector);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "training-week-copy", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        if (token != expected) throw new InvalidOperationException("Training week selection changed since preview.");
        // CalendarReference is the shared calendar, not an exclusive edit draft.
        // Normal calendar views retain it while the player copies a week.
        return ActionCommands.DispatchDomain(id, "copy_training_week", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(962751567u, target, payload);
        }, null, null, "copy_training_week");
    }
}
