using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using static FMAssistant.NegotiationActions;
using static FMAssistant.SubstitutionWorkflow;

namespace FMAssistant;

public static class SubstitutionCommands
{
    private static readonly Lazy<Journal> Store = new(() => new Journal(Path.Combine(Path.GetDirectoryName(typeof(Plugin).Assembly.Location), "state", "match-substitutions.jsonl")));
    internal static bool ContainsRoot(string id) => Store.Value.Contains(id);
    internal static void ValidateChildCall(string operationId, string path, Dictionary<string, string> query)
    {
        if (!(operationId ?? "").StartsWith("sub:", StringComparison.Ordinal)) return;
        var owner = MutationActivity.OwnerOf(operationId);
        var entry = Store.Value.ByOwner(owner);
        Active(entry.definition.operationId); // on the same main-thread turn as the impending native call
        var phase = Next(entry);
        if (!entry.phaseStarted || entry.status == "interrupted" || phase == null || !entry.definition.stepIds.TryGetValue(phase, out var expectedId) || expectedId != operationId)
            throw new InvalidOperationException("Workflow did not authorize this native child phase.");
        if (ActionCommands.Contains(operationId)) throw new InvalidOperationException("This child was already recorded. Recover it with readonly observation, never reissue it.");
        string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
        if (!long.TryParse(Arg("mutationCursor"), out var cursor) || cursor != entry.definition.mutationCursor)
            throw new ArgumentException("Native child must retain the parent activity checkpoint.");
        var route = phase == "pause" || phase == "resume" || phase == "restore_paused" ? "/api/v1/match/set-playing" : phase == "begin" ? "/api/v1/match/begin-draft" :
            phase == "pick" ? "/api/v1/commands/pick-player" : "/api/v1/match/draft";
        if (!path.Equals(route, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Wrong native command for this workflow phase.");
        if (phase == "pause" || phase == "resume" || phase == "restore_paused")
        {
            if (!bool.TryParse(Arg("playing"), out var playing) || playing != (phase == "resume")) throw new ArgumentException("Playback child does not match parent policy.");
        }
        else
        {
            if ((phase == "begin" || phase == "pick" || phase == "confirm") && MatchCommands.CapturePlayerContext().Playing)
                throw new InvalidOperationException("Playback resumed during the planned paused editing sequence; do not override that change.");
            if (MatchCommands.RequireCurrentTactic(Arg("tactic")).GetPersistentIdentity() != entry.definition.tacticIdentity)
                throw new InvalidOperationException("Native child tactic changed since the parent plan.");
            if (phase == "begin" && (!bool.TryParse(PlayerCommands.Channel(Arg("pending"), Arg("tactic"), "CanRevert").Value?.AsString(), out var existingDraft) || existingDraft))
                throw new InvalidOperationException("Another draft appeared before beginning this workflow; it will not be overwritten.");
            if (phase == "pick")
            {
                if (!int.TryParse(Arg("slot"), out var slot) || slot != entry.definition.selectionIndex || Arg("expected") != entry.definition.outgoingReference || !int.TryParse(Arg("option"), out var row))
                    throw new ArgumentException("Selection child changed the original substitution intent.");
                var choice = LineupCommands.Prepare(Arg("tactic"), Arg("options"), Arg("current"), row, slot);
                if (choice.DatabaseIndex != entry.definition.incomingDatabaseIndex || choice.Desired != entry.definition.incomingReference)
                    throw new ArgumentException("Selection child chose another incoming player.");
            }
            if (phase == "confirm" && (Arg("action") != "confirm" || !bool.TryParse(Arg("expected"), out var pending) || !pending))
                throw new ArgumentException("Confirmation child does not match the parent plan.");
        }
    }
    private static (Definition Definition, string Token) Prepare(string id, string tactic, string options, string current, string pending, int row, int slot, string policy)
    {
        if (slot < 0 || slot > 10 || policy != "restore" && policy != "leave_paused") throw new ArgumentException("Substitute a starting slot 0..10 and choose restore or leave_paused playback policy.");
        var target = MatchCommands.RequireCurrentTactic(tactic);
        var match = MatchCommands.CapturePlayerContext();
        if (!match.KickedOff) throw new InvalidOperationException("Use ordinary lineup selection before kick-off.");
        if (!MutationActivity.HooksReady) throw new InvalidOperationException("Required client mutation observers are not installed.");
        var draft = PlayerCommands.Channel(pending, tactic, "CanRevert");
        if (!bool.TryParse(draft.Value?.AsString(), out var dirty) || dirty) throw new InvalidOperationException("An existing tactical draft must be handled separately; this workflow will not overwrite it.");
        var choice = LineupCommands.Prepare(tactic, options, current, row, slot);
        if (!choice.OutgoingIndex.HasValue || choice.FromIndex < 11 || choice.FromIndex > 25 || choice.OutgoingIndex.Value == choice.DatabaseIndex)
            throw new InvalidOperationException("Select a real bench player for a currently occupied starting slot.");
        var cursor = MutationActivity.Cursor;
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            match = match.MatchIdentity, side = match.IsHomeTeam, tactic = target.GetPersistentIdentity(), slot, choice.Token,
            outgoing = choice.OutgoingIndex.Value, incoming = choice.DatabaseIndex, match.Playing, policy, cursor }));
        var owner = Owner(id ?? "preview"); var phases = Phases(match.Playing, policy);
        var ids = phases.Where(phase => phase != "baseline").ToDictionary(phase => phase, phase => owner + ":" + phase);
        var definition = new Definition(id, owner, token, match.MatchIdentity, target.GetPersistentIdentity(), LiveTools.SessionId, LiveTools.CurrentEpoch,
            match.IsHomeTeam, slot, choice.OutgoingIndex.Value, choice.DatabaseIndex, choice.Before, choice.Desired, match.Playing, policy, cursor, phases, ids);
        return (definition, token);
    }
    public static object Preview(string tactic, string options, string current, string pending, int row, int slot, string policy)
    {
        var prepared = Prepare(null, tactic, options, current, pending, row, slot, policy);
        return new { ok = true, planToken = prepared.Token, plan = prepared.Definition, nativeAtomicTransaction = false,
            sideEffects = new[] { "pause_if_initially_playing", "begin_tactical_changes", "stage_player_selection", "confirm_valid_draft", policy == "restore" ? "restore_initial_playback" : "leave_paused" },
            liveVerified = false };
    }
    public static object Register(string id, string tactic, string options, string current, string pending, int row, int slot, string policy, string token)
    {
        if (Store.Value.Contains(id))
        {
            if (Store.Value.Get(id).definition.planToken != token) throw new ArgumentException("Workflow operationId belongs to a different plan.");
            return new { ok = true, newlyRegistered = false, workflow = Status(id) };
        }
        if (ActionCommands.Contains(id) || CommandOperations.Contains(id) || TacticCommands.Contains(id)) throw new ArgumentException("OperationId already belongs to another command.");
        var prepared = Prepare(id, tactic, options, current, pending, row, slot, policy);
        if (prepared.Token != token) throw new InvalidOperationException("Substitution plan, actor, playback or client activity changed since preview.");
        Store.Value.Register(prepared.Definition);
        return new { ok = true, newlyRegistered = true, workflow = Status(id) };
    }
    private static Entry Active(string id)
    {
        var entry = Store.Value.Get(id); var current = MatchCommands.CapturePlayerContext();
        if (!SameContext(entry.definition, current.MatchIdentity, LiveTools.SessionId, LiveTools.CurrentEpoch, current.IsHomeTeam))
            throw new InvalidOperationException("Workflow belongs to another game session, epoch, match or manager side.");
        var observation = MutationActivity.Observe(entry.definition.mutationCursor, entry.definition.owner);
        if (!MutationActivity.HooksReady || !observation.Complete || observation.InterveningWrites != 0)
            throw new InvalidOperationException("Other client requests intervened or activity evidence is incomplete; workflow cannot continue writing.");
        return entry;
    }
    private static DispatchJournal.Receipt Child(Entry entry, string phase)
    {
        if (!entry.definition.stepIds.TryGetValue(phase, out var id)) throw new ArgumentException("This phase has no native child command.");
        var receipt = ActionCommands.Status(id) as DispatchJournal.Receipt ?? throw new InvalidOperationException("Native child receipt unavailable.");
        if (receipt.epoch != entry.definition.epoch) throw new InvalidOperationException("Child command belongs to another epoch.");
        var expectedTarget = phase == "pause" || phase == "resume" || phase == "restore_paused" ? entry.definition.matchIdentity : entry.definition.tacticIdentity;
        if (receipt.targetIdentity != expectedTarget) throw new InvalidOperationException("Child command targeted another match or tactic.");
        var valid = phase switch {
            "pause" => receipt.command == "set_match_playing" && receipt.verified && receipt.requested == "False",
            "resume" => receipt.command == "set_match_playing" && receipt.verified && receipt.requested == "True",
            "restore_paused" => receipt.command == "set_match_playing" && receipt.verified && receipt.requested == "False",
            "begin" => receipt.command == "begin_match_changes" && receipt.status == "dispatched_unverified",
            "pick" => receipt.command == "pick_player" && receipt.verified && receipt.before == entry.definition.outgoingReference &&
                receipt.requested == entry.definition.incomingReference && receipt.verificationScope == "team_selection_draft." + entry.definition.selectionIndex,
            "confirm" => receipt.command == "match_draft_confirm" && receipt.verified && receipt.before == "True" && receipt.requested == "False",
            _ => false
        };
        if (!valid) throw new InvalidOperationException("Native phase has no matching complete receipt; query it without replaying.");
        return receipt;
    }
    private static void ObservePick(Entry entry, string tactic, string inPossession, string outOfPossession)
    {
        if (!entry.phaseStarted || Next(entry) != "pick" || entry.baseline == null || MatchCommands.CapturePlayerContext().Playing ||
            PlayerCommands.Tactic(tactic) != entry.definition.tacticIdentity)
            throw new InvalidOperationException("Expected the original paused substitution draft.");
        var expected = entry.baseline.databaseIndices.Select(index => index == entry.definition.outgoingDatabaseIndex
            ? entry.definition.incomingDatabaseIndex : index).OrderBy(index => index).ToArray();
        foreach (var (handle, phase) in new[] { (inPossession, "True"), (outOfPossession, "False") })
        {
            var shape = PlayerCommands.Channel(handle, tactic, "TacticalPositionsMatchInformation",
                new Dictionary<string, string> { ["InPossession"] = phase });
            var rows = shape.Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<SI.Core.TypedValue>>()
                ?? throw new InvalidOperationException("Original match shape is unavailable.");
            var actual = new List<int>();
            foreach (var item in rows)
            {
                var row = Record(item);
                if (row == null || !row.TryGetValue(0x495a6748u, out var player) ||
                    !int.TryParse(player?.AsString(), out var index))
                    throw new InvalidOperationException("Original match shape contains an unreadable player index.");
                if (index >= 0) actual.Add(index);
            }
            if (!actual.OrderBy(index => index).SequenceEqual(expected))
                throw new InvalidOperationException("The draft shape does not contain exactly the requested substitution.");
        }
        var definition = entry.definition;
        ActionCommands.ObserveDomain(definition.stepIds["pick"], definition.tacticIdentity,
            "team_selection_draft." + definition.selectionIndex, definition.incomingReference);
    }
    public static object Phase(string id, string phase, string action, string error = "", string tactic = "", string ip = "", string oop = "")
    {
        if (action == "interrupt") { Store.Value.Interrupt(id, string.IsNullOrEmpty(error) ? "Client interrupted the workflow; inspect child results without replay." : error.Substring(0, Math.Min(error.Length, 2000))); return Status(id); }
        var entry = Active(id);
        if (action == "continue") Store.Value.Continue(id);
        else if (action == "start") Store.Value.Start(id, phase);
        else if (action == "complete")
        {
            if (phase == "baseline") throw new ArgumentException("Record a validated native roster baseline through its dedicated endpoint.");
            if (phase == "pick" && !string.IsNullOrEmpty(tactic)) ObservePick(entry, tactic, ip, oop);
            Child(entry, phase);
            Store.Value.Complete(id, phase, endCursor: entry.nextPhase + 1 == entry.definition.phases.Length ? MutationActivity.Cursor : null);
        }
        else throw new ArgumentException("Use start, complete, continue or interrupt.");
        return Status(id);
    }
    public static object Baseline(string id, string roster, string resolutions)
    {
        var entry = Active(id);
        if (!entry.phaseStarted || Next(entry) != "baseline") throw new InvalidOperationException("Baseline phase has not been started.");
        if (MatchCommands.CapturePlayerContext().Playing) throw new InvalidOperationException("Pause before taking the substitution roster baseline.");
        var value = NativeMatchRoster.Read(roster, resolutions);
        if (!SameContext(entry.definition, value.matchIdentity, value.sessionId, value.epoch, value.isHomeTeam) ||
            !value.databaseIndices.Contains(entry.definition.outgoingDatabaseIndex) || value.databaseIndices.Contains(entry.definition.incomingDatabaseIndex))
            throw new InvalidOperationException("Actual on-pitch baseline does not contain the requested outgoing-only configuration.");
        Store.Value.Complete(id, "baseline", value);
        return Status(id);
    }
    public static object Observe(string id, string roster, string resolutions)
    {
        var entry = Store.Value.Get(id);
        if (entry.status == "effect_verified") return Status(id);
        // Read-only native effect observation can follow later match progress. It does not
        // authorize further writes or claim exclusive causality after execution.
        if (entry.nextPhase != entry.definition.phases.Length || entry.phaseStarted) throw new InvalidOperationException("Complete native workflow phases before verifying match effect.");
        foreach (var phase in entry.definition.phases.Where(phase => phase != "baseline")) Child(entry, phase);
        var value = NativeMatchRoster.Read(roster, resolutions);
        if (!SameContext(entry.definition, value.matchIdentity, value.sessionId, value.epoch, value.isHomeTeam))
            throw new InvalidOperationException("Effect observation belongs to another match, session, epoch or side.");
        Store.Value.Observe(id, value);
        return Status(id);
    }
    public static object Status(string id)
    {
        var entry = Store.Value.Get(id);
        var children = new Dictionary<string, object>();
        foreach (var pair in entry.definition.stepIds)
        {
            try { children[pair.Key] = ActionCommands.Status(pair.Value); }
            catch (ArgumentException) { children[pair.Key] = new { status = "not_recorded", operationId = pair.Value, retrySafe = false }; }
        }
        var activity = MutationActivity.Observe(entry.definition.mutationCursor, entry.definition.owner);
        return new { ok = true, operationId = id, entry.status, verified = entry.status == "effect_verified", matchEffectVerified = entry.status == "effect_verified",
            verificationScope = "native_phases_and_validated_on_pitch_transition", exclusiveCausalityVerified = false, retrySafe = false,
            verificationTemporalScope = "recorded_transition_not_current_membership",
            nextPhase = Next(entry), entry.phaseStarted, plan = entry.definition, entry.baseline, entry.after, entry.executionEndCursor, entry.error, children,
            currentSessionId = LiveTools.SessionId, currentEpoch = LiveTools.CurrentEpoch,
            sessionChanged = entry.definition.sessionId != LiveTools.SessionId || entry.definition.epoch != LiveTools.CurrentEpoch,
            observedClientActivity = activity, nativeTransactionLock = false };
    }
}
