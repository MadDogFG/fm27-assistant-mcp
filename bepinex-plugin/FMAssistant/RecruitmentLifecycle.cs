using System;
using System.Globalization;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// RecruitmentFocusToolTableCarouselBlock / RecruitmentFocusRadioItem:
// actual ScoutingInfo business commands with the selected focus's original UniqueId.
public static class RecruitmentLifecycle
{
    private sealed record Prepared(InteropReference Info, InteropReference Focus, TypedValue Id, uint Event, string Token, string Confirmation);
    private static Prepared Prepare(string action, string info, string source, string path, string uniqueId, string complete, string name)
    {
        if (string.IsNullOrEmpty(path)) throw new ArgumentException("Select an existing focus from RecruitmentFocusesList, not the new draft.");
        var focus = RecruitmentCommands.Target(info, source, path);
        var id = RecruitmentCommands.FocusChannel(uniqueId, source, "UniqueId", path).Value;
        if (id == null || id.IsNull || !ulong.TryParse(id.AsString(), NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number == 65535)
            throw new InvalidOperationException("Focus does not have an accepted existing identity.");
        if (!bool.TryParse(RecruitmentCommands.FocusChannel(complete, source, "IsFocusComplete", path).Value?.AsString(), out var completed))
            throw new InvalidOperationException("Focus completion status is unavailable.");
        var label = RecruitmentCommands.FocusChannel(name, source, "Name", path).Value;
        uint eventId; string confirmation = null;
        if (action == "restart")
        {
            if (!completed) throw new InvalidOperationException("Only a completed focus can be restarted.");
            eventId = (uint)InteropEventIDs.EventFmxRecruitmentFocusRestart;
        }
        else if (action == "complete")
        {
            if (completed) throw new InvalidOperationException("This focus is already completed.");
            eventId = (uint)InteropEventIDs.EventFmxRecruitmentFocusRemove;
            confirmation = "Complete this focus. Completed focuses can be restarted from the Completed section.";
        }
        else if (action == "delete")
        {
            if (!completed) throw new InvalidOperationException("The game's delete control requires a completed focus; complete it separately first.");
            eventId = (uint)InteropEventIDs.EventFmxRecruitmentFocusDelete;
            confirmation = "Delete this focus. This action cannot be undone.";
        }
        else throw new ArgumentException("Use restart, complete or delete.");
        var actualInfo = LiveTools.GetReference(info);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), info = actualInfo.GetPersistentIdentity(),
            focus = focus.GetPersistentIdentity(), id = NativeValueFingerprint.Compute(id), completed, name = NativeValueFingerprint.Compute(label), action, eventId, confirmation }));
        return new Prepared(actualInfo, focus, TypedValue.CreateCopyFrom(id), eventId, token, confirmation);
    }
    public static object Preview(string action, string info, string source, string path, string uniqueId, string complete, string name)
    {
        var p = Prepare(action, info, source, path, uniqueId, complete, name);
        return new { ok = true, action, focusIdentity = p.Focus.GetPersistentIdentity(), focusId = p.Id.AsString(),
            choiceToken = p.Token, eventId = p.Event, requiresConfirmation = p.Confirmation != null, confirmation = p.Confirmation,
            verificationScope = "recruitment_focus_lifecycle_dispatch", liveVerified = false };
    }
    public static object Execute(string id, string action, string info, string source, string path, string uniqueId, string complete, string name, string token, bool acceptConfirmation)
    {
        var p = Prepare(action, info, source, path, uniqueId, complete, name);
        if (p.Token != token) throw new InvalidOperationException("Focus identity or lifecycle state changed; preview again.");
        if (p.Confirmation != null && !acceptConfirmation) throw new InvalidOperationException("Read the confirmation and supply acceptConfirmation for the authorized operation.");
        return ActionCommands.DispatchDomain(id, "recruitment_focus_" + action, p.Focus.GetPersistentIdentity(),
            LiveTools.JsonText(new { token, acceptConfirmation }), () => GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Info, p.Id),
            null, null, "recruitment_focus_lifecycle_dispatch");
    }
}
