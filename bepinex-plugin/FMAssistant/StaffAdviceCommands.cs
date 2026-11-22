using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Request the full staff-meeting advice collection. Full UI index (evidence/v92-staff-advice.json):
// StaffMeetingCard fires RequestFullAdviceCollection (1397301300) with target=human and data=null.
// Static evidence only; whether the advice collection is generated/displayed is unverified.
public static class StaffAdviceCommands
{
    private static InteropReference Human()
    {
        var human = LiveTools.GetReference("human");
        if (human == null) throw new ArgumentException("The active manager reference is unavailable.");
        return human;
    }
    private static string Token(string action)
    {
        var human = Human();
        return DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity = human.GetPersistentIdentity(), revision = NegotiationActions.Revision(human.GetPersistentIdentity()) }));
    }
    public static object PreviewFullAdvice()
    {
        var human = Human();
        return new { ok = true, nativeEvent = 1397301300u, choiceToken = Token("request-full-advice"),
            payload = (object)null, draftOnly = true, liveVerified = false,
            note = "请求完整 staff 建议集合；结果需从实际建议/收件箱独立读取。" };
    }
    public static object ExecuteFullAdvice(string id, string token)
    {
        var human = Human();
        var expected = Token("request-full-advice");
        if (token != expected) throw new InvalidOperationException("Manager state changed since preview.");
        LiveTools.RequireUnusedDraft(human);
        return ActionCommands.DispatchDomain(id, "request_full_advice_collection", human.GetPersistentIdentity(), token, () => {
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1397301300u, human, null);
        }, null, null, "staff_advice_request");
    }
}
