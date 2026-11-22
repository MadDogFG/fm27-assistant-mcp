using System;
using System.Linq;

namespace FMAssistant;

// These are independent observations, not a fabricated engine transaction receipt.
internal static class ContinueProgress
{
    internal sealed record Snapshot(string sessionId, int epoch, string gameIdentity, string humanIdentity,
        string dateFingerprint, bool waiting, string matchIdentity, string controller, string side,
        bool phaseReady, string phaseGuid, bool nativeReady, string nativeMatchId, string nativeHandle, int? nativePeriod,
        long callbackCursor, bool callbackHooksReady, bool multiplayer);
    internal sealed record Report(bool ready, string reason, bool observedWaiting, bool observedDateChange,
        bool sameMatch, bool callbackHistoryComplete, int observedCallbacks, int returnedCallbacks, int failedCallbacks,
        bool observedManagedPhaseChange, bool nativeContextMatches, bool observedNativePeriodChange,
        bool observedCallbackAndManagedPhaseChange, bool stageAdvanceVerified = false,
        bool commandCausalityVerified = false, string verificationScope = "independent_continuation_observations",
        string previousPhase = null, string currentPhase = null, int? previousNativePeriod = null, int? currentNativePeriod = null,
        bool multiplayerCoordination = false);
    internal static Report Compare(Snapshot before, Snapshot current, ContinueCallbackLog.Observation callbacks)
    {
        Report Unready(string reason) => new(false, reason, false, false, false, false, 0, 0, 0, false, false, false, false);
        if (before == null) return Unready("original_continuation_baseline_unavailable");
        if (current == null) return Unready("current_continuation_state_unavailable");
        if (before.sessionId != current.sessionId || before.epoch != current.epoch || before.gameIdentity != current.gameIdentity || before.humanIdentity != current.humanIdentity)
            return Unready("continuation_session_game_or_manager_changed");
        var sameMatch = !string.IsNullOrEmpty(before.matchIdentity) && before.matchIdentity == current.matchIdentity &&
            !string.IsNullOrEmpty(before.controller) && before.controller == current.controller && before.side == current.side;
        var complete = before.callbackHooksReady && current.callbackHooksReady && callbacks.complete;
        var matches = complete ? callbacks.entries.Where(entry => entry.sequence > before.callbackCursor &&
            entry.context.sessionId == before.sessionId && entry.context.epoch == before.epoch && entry.context.matchIdentity == before.matchIdentity &&
            entry.context.controller == before.controller && entry.context.side == before.side).ToArray() : Array.Empty<ContinueCallbackLog.Entry>();
        var returned = matches.Count(entry => entry.handlerReturned && entry.handlerError == null);
        var phaseChanged = sameMatch && before.phaseReady && current.phaseReady && !string.IsNullOrEmpty(before.phaseGuid) &&
            !string.IsNullOrEmpty(current.phaseGuid) && before.phaseGuid != current.phaseGuid;
        var native = sameMatch && before.nativeReady && current.nativeReady && !string.IsNullOrEmpty(before.nativeMatchId) &&
            before.nativeMatchId == current.nativeMatchId && !string.IsNullOrEmpty(before.nativeHandle) && before.nativeHandle == current.nativeHandle &&
            before.nativePeriod is >= 0 and <= 9 && current.nativePeriod is >= 0 and <= 9;
        return new Report(true, null, current.waiting, before.dateFingerprint != current.dateFingerprint,
            sameMatch, complete, matches.Length, returned, matches.Count(entry => entry.handlerError != null),
            phaseChanged, native, native && before.nativePeriod != current.nativePeriod,
            sameMatch && phaseChanged && matches.Any(entry => entry.handlerReturned && entry.handlerError == null && entry.phaseBefore == before.phaseGuid),
            previousPhase: before.phaseGuid, currentPhase: current.phaseGuid, previousNativePeriod: before.nativePeriod, currentNativePeriod: current.nativePeriod,
            multiplayerCoordination: before.multiplayer && current.multiplayer);
    }
}
