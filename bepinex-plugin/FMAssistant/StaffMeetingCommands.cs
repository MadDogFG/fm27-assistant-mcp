using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Staff-meeting bulk advice. Full UI index (evidence/v96-staff-meeting-apply-all.json):
// StaffMeetingTopicBlock fires ApplyAllAdviceAllMatches (70696) with target=staffmeeting and data=null.
// Static evidence only; no live dispatch.
public static class StaffMeetingCommands
{
    private static InteropReference Resolve(string staffMeeting)
    {
        var target = LiveTools.GetReference(staffMeeting);
        var snapshot = LiveTools.GetSnapshot(staffMeeting);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("StaffMeeting"))
            throw new ArgumentException("Resolve the actual StaffMeeting reference.");
        return target;
    }
    private static string Token(InteropReference target) => DispatchJournal.Fingerprint(LiveTools.JsonText(new {
        sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = "staff-meeting-apply-all",
        identity = target.GetPersistentIdentity(), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
    public static object Preview(string staffMeeting)
    {
        var target = Resolve(staffMeeting);
        return new { ok = true, nativeEvent = 70696u, choiceToken = Token(target), payload = (object)null,
            draftOnly = true, liveVerified = false,
            note = "按 staff meeting 建议对所有比赛应用；结果需独立读回战术/建议状态。" };
    }
    public static object Execute(string id, string staffMeeting, string token)
    {
        var target = Resolve(staffMeeting);
        var expected = Token(target);
        if (token != expected) throw new InvalidOperationException("Staff meeting state changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "staff_meeting_apply_all_advice", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(70696u, target, null);
        }, null, null, "staff_meeting_apply_all_advice");
    }
}
