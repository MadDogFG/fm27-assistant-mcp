using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Ask the assistant to update the set-piece tactic. Full UI index (evidence/v94-set-piece-routine.json):
// OnThePitchSetPiecesTool fires SetPieceRequestTacticUpdate (1296390501) with target=team.tactic.SetPiece
// and data=const.True. Static evidence only; no live dispatch.
public static class SetPieceRoutineCommands
{
    private static InteropReference Resolve(string setPiece)
    {
        var target = LiveTools.GetReference(setPiece);
        var snapshot = LiveTools.GetSnapshot(setPiece);
        if (!snapshot.Ready || snapshot.Property != InternalCommands.PropertyId("SetPiece"))
            throw new ArgumentException("Resolve the current tactic's SetPiece reference.");
        var type = target.GetIl2CppType().FullName ?? "";
        if (type.Contains("Person") || type.Contains("TeamReference")) throw new ArgumentException("Resolved reference is not a set-piece reference.");
        return target;
    }
    private static string Token(InteropReference target) => DispatchJournal.Fingerprint(LiveTools.JsonText(new {
        sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = "set-piece-tactic-update",
        identity = target.GetPersistentIdentity(), payload = true, revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
    public static object Preview(string setPiece)
    {
        var target = Resolve(setPiece);
        return new { ok = true, nativeEvent = 1296390501u, choiceToken = Token(target), payload = true,
            draftOnly = true, liveVerified = false,
            note = "请求助手更新定位球战术；更新结果需独立读回定位球 routine。" };
    }
    public static object Execute(string id, string setPiece, string token)
    {
        var target = Resolve(setPiece);
        var expected = Token(target);
        if (token != expected) throw new InvalidOperationException("Set-piece state changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "set_piece_tactic_update", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1296390501u, target, TypedValue.Create(true));
        }, null, null, "set_piece_tactic_update");
    }
}
