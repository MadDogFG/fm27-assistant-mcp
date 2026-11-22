using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// GA 0x180880500 (ContinueManagerModule.ProcessConfirmTeamSelection):
// native 0x78774f20 targets the original tactic and carries two booleans.
// This differs from ConfirmShownTeamSelection (a selection-view operation).
public static class LineupSubmissionCommands
{
    private sealed record Submission(InteropReference Target, SI.Core.Record Payload, string Token,
        bool CanSubmit, string Reason, object Message, string LineupFingerprint);
    private static Submission Prepare(string tactic, string waiting, string date,
        string valid, string canConfirm, string message, string lineup)
    {
        var target = LiveTools.GetReference(tactic);
        var source = LiveTools.GetSnapshot(tactic);
        if (!source.Ready || !string.IsNullOrEmpty(source.SourcePath) ||
            source.Property != InternalCommands.PropertyId("Tactic") ||
            target.GetIl2CppType().FullName != "FM.UI.TeamTacticReference")
            throw new ArgumentException("Resolve the current manager's team tactic.");
        var team = LiveTools.GetSnapshot(source.Source);
        if (!team.Ready || team.Source != "human" || !string.IsNullOrEmpty(team.SourcePath) ||
            team.Property != InternalCommands.PropertyId("Team") ||
            team.Identity != LiveTools.GetReference("human").GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual team.");
        LiveTools.Snapshot Channel(string handle, string property)
        {
            var snapshot = NegotiationActions.Channel(handle, tactic, property);
            if (snapshot.Identity != target.GetPersistentIdentity())
                throw new InvalidOperationException("Lineup subscription target changed.");
            return snapshot;
        }
        if (!bool.TryParse(Channel(valid, "IsTeamSelectionValid").Value?.AsString(), out var isValid) ||
            !bool.TryParse(Channel(canConfirm, "CanConfirmTeamSelection").Value?.AsString(), out var allowed))
            throw new InvalidOperationException("Native team-selection eligibility is unavailable.");
        var detail = LiveTools.DescribeValue(Channel(message, "TeamSelectionMessage").Value);
        var fingerprint = NativeValueFingerprint.Compute(Channel(lineup, "TacticsTeamSelectionData").Value);
        var game = ContinueCommands.Capture(waiting, date, worldContinuation: false);
        var reason = !game.CanDispatch ? game.Reason : game.FlowState != 4 ? "not_waiting_for_team_selection" :
            !allowed ? "game_disallows_team_confirmation" : !isValid ? "team_selection_invalid" : null;
        var payload = new SI.Core.Record();
        payload[0x50315974] = TypedValue.Create(false); // UsingInstantResult
        payload[0x6c316965] = TypedValue.Create(false); // TeamSelectionCancelled
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new {
            session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, target = target.GetPersistentIdentity(),
            human = game.HumanIdentity, game = game.ChoiceToken, fingerprint, isValid, allowed,
            payload = NativeValueFingerprint.Compute(GameTools.MakeObjectTypedValue(payload))
        }));
        return new(target, payload, token, reason == null, reason, detail, fingerprint);
    }
    public static object Read(string tactic, string waiting, string date,
        string valid, string canConfirm, string message, string lineup)
    {
        var p = Prepare(tactic, waiting, date, valid, canConfirm, message, lineup);
        return new { ok = true, canSubmit = p.CanSubmit, reason = p.Reason, validationMessage = p.Message,
            choiceToken = p.Token, lineupFingerprint = p.LineupFingerprint, nativeEvent = 2021084960u,
            usingInstantResult = false, cancelled = false, mutationCursor = MutationActivity.Cursor,
            sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, liveVerified = false };
    }
    public static object Execute(string id, string tactic, string waiting, string date,
        string valid, string canConfirm, string message, string lineup, string token, long cursor)
    {
        Submission original = null;
        return ActionCommands.DispatchOnce(id, "submit_match_lineup",
            LiveTools.GetReference(tactic).GetPersistentIdentity(), token, "match_lineup_submission_request", () => {
                original = Prepare(tactic, waiting, date, valid, canConfirm, message, lineup);
                MutationActivity.RequireUnchanged(cursor);
                LiveTools.RequireUnusedDraft(original.Target);
                return new ContinueRequestGuard.Preflight(original.Token, false, original.CanSubmit, original.Reason);
            }, () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(2021084960u,
                original.Target, GameTools.MakeObjectTypedValue(original.Payload)));
    }
}
