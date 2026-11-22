using System;
using System.Text.Json;

namespace FMAssistant;

// Event13 toggles GameWaiting. A new request ID must not replay the same intent
// while the asynchronous game has not changed the previewed business state.
internal static class ContinueRequestGuard
{
    internal const string Command = "request_continue_game";
    internal const string Scope = "game_waiting_request_only";
    // The game's normal button routes all other states to their own business workflow.
    // Match64 is the shipped ContinueFlowFlags.Match. A live match module is outside
    // the main-game scene even while it owns the normal team-talk/period workflow.
    internal static bool ModuleEligible(bool active, bool initialised, bool inMainGameScene, long flags) =>
        active && initialised && (inMainGameScene || (flags & 64) != 0);
    internal static string FlowReason(int flowState, bool worldContinuation = true, bool inMatch = false) =>
        worldContinuation && inMatch ? "use_match_stage_workflow" : !worldContinuation || flowState is 0 or 10 or 11 ? null :
        flowState is 1 or 32 or 33 ? "process_current_manager_message" : "process_current_continue_workflow";
    internal sealed record Preflight(string ChoiceToken, bool Waiting, bool CanDispatch, string Reason, string ObservationBaseline = null);
    internal static DispatchJournal.Receipt Dispatch(DispatchJournal journal, string id, string target, int epoch,
        string token, Func<Preflight> read, Action dispatch)
        => DispatchOnce(journal, id, Command, Scope, target, epoch, token, read, dispatch, "False", "True");
    internal static DispatchJournal.Receipt DispatchOnce(DispatchJournal journal, string id, string command, string scope, string target, int epoch,
        string token, Func<Preflight> read, Action dispatch, string before = null, string requested = null)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 100 || string.IsNullOrWhiteSpace(target) ||
            token == null || token.Length != 64 || !Array.TrueForAll(token.ToCharArray(), Uri.IsHexDigit))
            throw new ArgumentException("Original game identity, preview token and operation ID are required.");
        // Dedup precedes live reads: even expired channels or a new process may
        // query the original receipt, but can never authorize its replay.
        if (journal.Contains(id))
            return journal.Dispatch(id, command, target, epoch, token, () => throw new InvalidOperationException("Duplicate entered dispatch."));
        var fingerprint = DispatchJournal.Fingerprint(JsonSerializer.Serialize(new { command, target, semanticArguments = token }));
        if (journal.HasFingerprint(fingerprint))
            throw new InvalidOperationException("This continuation intent was already attempted under another ID. Query its receipt; do not resend.");
        var state = read();
        if (state.ChoiceToken != token) throw new InvalidOperationException("Continuation state changed; preview it again.");
        if (state.Waiting || !state.CanDispatch) throw new InvalidOperationException(state.Reason ?? "Continuation is not currently available.");
        return journal.Dispatch(id, command, target, epoch, token, dispatch, before, requested, scope, state.ObservationBaseline);
    }
}
