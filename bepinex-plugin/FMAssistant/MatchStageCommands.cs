using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using FM.GamePlugin;
using FM.Match;
using SI.Core;

namespace FMAssistant;

public static class MatchStageCommands
{
    internal const string Command = "continue_match_stage";
    private static readonly HashSet<string> Stages = new(StringComparer.Ordinal) {
        "FM.Match.TeamTalkState", "FM.Match.HalfTimeBreakState", "FM.Match.FullTimeState", "FM.Match.KickOffState",
        "FM.Match.WarmUpState", "FM.Match.TeamNewsState", "FM.Match.TeamLineupState", "FM.Match.LeagueTableLineupState",
        "FM.Match.ExtraTimeBreakState", "FM.Match.ExtraTimeHalfTimeBreakState", "FM.Match.PenaltyTakers",
        "FM.Match.FullTimeReactionState", "FM.Match.TunnelInterviewState"
    };
    private sealed record Stage(MatchPlaybackController Controller, MatchPlaybackFSMState Script, string MatchIdentity,
        string Phase, string Type, int? TalkType, string Token, bool CanRequest, string Reason, ContinueCommands.State Game);
    private static Stage Capture(string waiting, string date, string tactic, string pending, string managerSide)
    {
        // Match stages execute their own original business method, not event13.
        // Keep common processing/waiting guards; this class validates the actual stage below.
        var controller = MatchCommands.StageController(managerSide);
        var game = ContinueCommands.Capture(waiting, date, worldContinuation: false, stageManagerKnown: true);
        var controls = MatchCommands.Controls(controller);
        var cooldown = (typeof(FMMatchUIComponent).GetProperty("m_preventContinueCoroutine", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Continue cooldown accessor unavailable.")).GetValue(controls) != null;
        string tacticIdentity = "none";
        bool hasDraft = false;
        if (!string.IsNullOrEmpty(tactic) && !string.IsNullOrEmpty(pending))
        {
            var target = MatchCommands.RequireCurrentTactic(tactic, controller);
            var dirty = PlayerCommands.Channel(pending, tactic, "CanRevert");
            if (!bool.TryParse(dirty.Value?.AsString(), out hasDraft)) throw new InvalidOperationException("Current match draft status is unavailable.");
            tacticIdentity = target.GetPersistentIdentity();
        }
        var machine = controller.StateMachine; var state = machine?.CurrentState;
        if (state?.Scripts == null || state.CurrentStateMachine?.Pointer != machine.Pointer || controller.PeriodTransition == null)
            throw new InvalidOperationException("Current match stage is not ready.");
        var stages = new List<MatchPlaybackFSMState>();
        foreach (var script in state.Scripts) { var playback = script.TryCast<MatchPlaybackFSMState>(); if (playback != null) stages.Add(playback); }
        var scripts = stages.ToArray();
        if (scripts.Length != 1 || scripts[0].Controller?.Pointer != controller.Pointer || scripts[0].State?.Pointer != state.Pointer)
            throw new InvalidOperationException("Expected one original playback stage owned by the current match controller.");
        var current = scripts[0]; var type = current.GetIl2CppType().FullName;
        // Use the original current-stage virtual business method reached by
        // OnContinue. Never finish an active simulation, setup or spectator state.
        var supported = Stages.Contains(type) && current.TryCast<MatchPlaybackState>() == null;
        var status = typeof(MatchPlaybackFSMState).GetProperty("m_status", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Current stage continuation status is unavailable.");
        var active = Convert.ToInt32(status.GetValue(current), CultureInfo.InvariantCulture) == 0;
        var talk = current.TryCast<TeamTalkState>();
        int? talkType = talk == null ? null : Convert.ToInt32((typeof(TeamTalkState).GetProperty("m_type", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Current talk type is unavailable.")).GetValue(talk), CultureInfo.InvariantCulture);
        if (talkType.HasValue && (talkType.Value < 0 || talkType.Value > 4)) throw new InvalidOperationException("Unknown team-talk stage type.");
        var waitingForOthers = controller.IsMultiplayerMatch && controller.ClientStatus != SI.Match.MatchClientStatus.Idle;
        var reason = !supported ? "stage_business_override_not_yet_recovered" : cooldown ? "player_continue_cooldown_active" : !active ? "stage_already_continuing" :
            controller.PeriodTransition.IsPreparing ? "match_period_transition_preparing" : hasDraft ? "existing_tactical_draft_requires_separate_decision" :
            waitingForOthers ? "multiplayer_client_not_idle_do_not_toggle" : !game.CanDispatch ? game.Reason : null;
        var identity = controller.MatchReference.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            game = game.ChoiceToken, match = identity, controller = controller.Pointer.ToInt64().ToString(CultureInfo.InvariantCulture),
            script = current.Pointer.ToInt64().ToString(CultureInfo.InvariantCulture), phase = state.GUID.ToString(), type, talkType,
            tactic = tacticIdentity, hasDraft, clientStatus = controller.ClientStatus.ToString() }));
        return new Stage(controller, current, identity, state.GUID.ToString(), type, talkType, token, reason == null, reason, game);
    }
    public static object Read(string waiting, string date, string tactic, string pending, string managerSide, string operationId)
    {
        var stage = Capture(waiting, date, tactic, pending, managerSide);
        var observation = ContinueCommands.Observation(stage.Game);
        DispatchJournal.Receipt receipt = null; ContinueProgress.Report progress = null;
        if (!string.IsNullOrEmpty(operationId))
        {
            receipt = (DispatchJournal.Receipt)ActionCommands.Status(operationId);
            if (receipt.command != Command || receipt.targetIdentity != stage.MatchIdentity) throw new ArgumentException("This stage request belongs to another command or match.");
            var baseline = ContinueCommands.Baseline(receipt);
            progress = ContinueProgress.Compare(baseline, observation.Snapshot, ContinueCallbackLog.Read(baseline?.callbackCursor ?? -1));
        }
        return new { ok = true, ready = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            matchIdentity = stage.MatchIdentity, phaseGuid = stage.Phase, stageType = stage.Type, teamTalkType = stage.TalkType,
            choiceToken = stage.Token, canRequest = stage.CanRequest, reason = stage.Reason,
            mutationCursor = MutationActivity.Cursor, clientMutationGuardReady = MutationActivity.HooksReady,
            normalPhaseViewUpdates = true, explicitTacticsPanelToggle = false, receipt, progress,
            match = observation.Match, simulation = observation.Simulation, stageAdvanceVerified = false, commandCausalityVerified = false, liveVerified = false };
    }
    public static object Execute(string id, string waiting, string date, string tactic, string pending, string managerSide, string matchIdentity, string token, long cursor)
    {
        Stage original = null;
        return ActionCommands.ContinueStage(id, matchIdentity, token, () => {
            original = Capture(waiting, date, tactic, pending, managerSide);
            if (original.MatchIdentity != matchIdentity) throw new InvalidOperationException("Current match changed.");
            if (cursor < 0) throw new ArgumentException("Original preview mutation cursor is required.");
            var observation = ContinueCommands.Observation(original.Game);
            MutationActivity.RequireUnchanged(cursor); ContinueCallbackLog.Armed = true;
            return new ContinueRequestGuard.Preflight(original.Token, false, original.CanRequest, original.Reason, LiveTools.JsonText(observation.Snapshot));
        }, () => {
            // Preserve the original OnContinue business prelude. Omit its
            // ToggleOpenTactics(false,false,true) presentation-only step.
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(0x5867736b, original.Controller.MatchReference, null);
            var current = Capture(waiting, date, tactic, pending, managerSide);
            if (current.Controller.Pointer != original.Controller.Pointer || current.Script.Pointer != original.Script.Pointer ||
                current.Phase != original.Phase || current.MatchIdentity != original.MatchIdentity || !current.CanRequest)
                throw new InvalidOperationException("Match context changed after the native prelude; no stage handler was invoked. Observe this partial result without replay.");
            MutationActivity.RequireUnchanged(cursor);
            current.Script.HandleContinue(); // Actual virtual override: keeps per-stage rules and normal period preparation.
        });
    }
}
