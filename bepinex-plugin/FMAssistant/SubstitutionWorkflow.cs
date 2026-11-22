using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace FMAssistant;

// Durable parent state. Native child effects remain in DispatchJournal. A started phase
// is never automatically replayed after loss of its response.
internal static class SubstitutionWorkflow
{
    internal sealed record Definition(string operationId, string owner, string planToken, string matchIdentity, string tacticIdentity,
        string sessionId, int epoch, bool isHomeTeam, int selectionIndex, int outgoingDatabaseIndex, int incomingDatabaseIndex,
        string outgoingReference, string incomingReference, bool initiallyPlaying, string playbackPolicy, long mutationCursor,
        string[] phases, Dictionary<string, string> stepIds);
    internal sealed record Roster(string matchIdentity, string sessionId, int epoch, bool isHomeTeam, long? timeSlice,
        int[] databaseIndices, string source, string observedUtc);
    internal sealed record Entry(Definition definition, int nextPhase, bool phaseStarted, string status,
        Roster baseline = null, Roster after = null, long? executionEndCursor = null, string error = null);
    internal static string Owner(string id) => "sub:" + DispatchJournal.Fingerprint(id).ToLowerInvariant();
    internal static string[] Phases(bool playing, string policy) => playing
        ? policy == "restore" ? new[] { "pause", "baseline", "begin", "pick", "confirm", "resume" } : new[] { "pause", "baseline", "begin", "pick", "confirm", "restore_paused" }
        : new[] { "baseline", "begin", "pick", "confirm", "restore_paused" };
    internal static string Next(Entry entry) => entry.nextPhase < entry.definition.phases.Length ? entry.definition.phases[entry.nextPhase] : null;
    internal static bool SameContext(Definition plan, string match, string session, int epoch, bool side) =>
        plan.matchIdentity == match && plan.sessionId == session && plan.epoch == epoch && plan.isHomeTeam == side;
    internal static bool ValidRoster(Definition plan, Roster roster) => roster != null &&
        SameContext(plan, roster.matchIdentity, roster.sessionId, roster.epoch, roster.isHomeTeam) &&
        roster.timeSlice.HasValue && roster.timeSlice.Value >= 0 && roster.databaseIndices != null &&
        roster.databaseIndices.Length > 0 && roster.databaseIndices.Length <= 11 &&
        roster.databaseIndices.All(id => id >= 0) && roster.databaseIndices.Distinct().Count() == roster.databaseIndices.Length &&
        roster.source == "validated_native_PlayerMatchStatsOnPitch_subscription_graph";
    internal static bool Transition(Entry entry, Roster after) => ValidRoster(entry.definition, entry.baseline) && ValidRoster(entry.definition, after) &&
        entry.nextPhase == entry.definition.phases.Length && !entry.phaseStarted &&
        entry.baseline.timeSlice.HasValue && after.timeSlice.HasValue && after.timeSlice >= entry.baseline.timeSlice &&
        entry.baseline.databaseIndices.Contains(entry.definition.outgoingDatabaseIndex) && !entry.baseline.databaseIndices.Contains(entry.definition.incomingDatabaseIndex) &&
        after.databaseIndices.Contains(entry.definition.incomingDatabaseIndex) && !after.databaseIndices.Contains(entry.definition.outgoingDatabaseIndex);

    internal sealed class Journal
    {
        private readonly string FileName;
        private readonly Dictionary<string, Entry> Entries = new(StringComparer.Ordinal);
        private bool Poisoned;
        private static bool ValidDefinition(Definition plan) => plan != null && !string.IsNullOrWhiteSpace(plan.operationId) &&
            plan.operationId.Length <= 100 && !plan.operationId.StartsWith("sub:", StringComparison.Ordinal) && plan.owner == Owner(plan.operationId) &&
            !string.IsNullOrWhiteSpace(plan.planToken) && !string.IsNullOrWhiteSpace(plan.matchIdentity) && !string.IsNullOrWhiteSpace(plan.tacticIdentity) &&
            !string.IsNullOrWhiteSpace(plan.sessionId) && plan.epoch >= 0 && plan.mutationCursor >= 0 && plan.selectionIndex >= 0 && plan.selectionIndex <= 10 &&
            plan.outgoingDatabaseIndex >= 0 && plan.incomingDatabaseIndex >= 0 && plan.outgoingDatabaseIndex != plan.incomingDatabaseIndex &&
            !string.IsNullOrWhiteSpace(plan.outgoingReference) && !string.IsNullOrWhiteSpace(plan.incomingReference) && plan.outgoingReference != plan.incomingReference &&
            (plan.playbackPolicy == "restore" || plan.playbackPolicy == "leave_paused") && plan.phases != null &&
            plan.phases.SequenceEqual(Phases(plan.initiallyPlaying, plan.playbackPolicy)) && plan.stepIds != null &&
            plan.stepIds.Count == plan.phases.Length - 1 && plan.phases.Where(phase => phase != "baseline").All(phase =>
                plan.stepIds.TryGetValue(phase, out var id) && id == plan.owner + ":" + phase);
        private static bool ValidEntry(Entry entry) => entry != null && ValidDefinition(entry.definition) &&
            entry.nextPhase >= 0 && entry.nextPhase <= entry.definition.phases.Length &&
            (!entry.phaseStarted || entry.nextPhase < entry.definition.phases.Length) &&
            new[] { "registered", "phase_started", "phase_complete", "interrupted", "awaiting_effect", "effect_verified" }.Contains(entry.status) &&
            (entry.status != "registered" || entry.nextPhase == 0 && !entry.phaseStarted) &&
            (entry.status != "phase_started" || entry.phaseStarted) &&
            (entry.status != "awaiting_effect" || entry.nextPhase == entry.definition.phases.Length && !entry.phaseStarted) &&
            (entry.baseline == null || ValidRoster(entry.definition, entry.baseline)) &&
            (entry.nextPhase <= Array.IndexOf(entry.definition.phases, "baseline") || entry.baseline != null) &&
            (entry.after == null || ValidRoster(entry.definition, entry.after)) &&
            (entry.status != "effect_verified" || Transition(entry, entry.after));
        internal Journal(string fileName)
        {
            FileName = Path.GetFullPath(fileName);
            if (!File.Exists(FileName)) return;
            if (new FileInfo(FileName).Length > 16 * 1024 * 1024) throw new InvalidOperationException("Substitution journal requires archival.");
            foreach (var line in File.ReadLines(FileName))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var entry = JsonSerializer.Deserialize<Entry>(line) ?? throw new JsonException("Empty workflow entry");
                    if (!ValidEntry(entry)) throw new JsonException("Invalid workflow state");
                    if (Entries.TryGetValue(entry.definition.operationId, out var previous) &&
                        (JsonSerializer.Serialize(previous.definition) != JsonSerializer.Serialize(entry.definition) || entry.nextPhase < previous.nextPhase))
                        throw new JsonException("Workflow intent changed or progress moved backwards");
                    Entries[entry.definition.operationId] = entry;
                }
                catch (JsonException) { throw new InvalidOperationException("Substitution journal is corrupt or torn; no workflow writes are allowed."); }
            }
        }
        internal bool Contains(string id) => Entries.ContainsKey(id ?? "");
        internal Entry ByOwner(string owner) => Entries.Values.SingleOrDefault(entry => entry.definition.owner == owner)
            ?? throw new ArgumentException("Unknown substitution workflow owner.");
        internal Entry Get(string id) => Entries.TryGetValue(id ?? "", out var entry) ? entry : throw new ArgumentException("Unknown substitution workflow ID.");
        private Entry Persist(Entry entry)
        {
            if (Poisoned) throw new InvalidOperationException("Substitution journal write previously failed; recover it before continuing.");
            var bytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(entry) + "\n");
            if (File.Exists(FileName) && new FileInfo(FileName).Length + bytes.Length > 16 * 1024 * 1024) throw new InvalidOperationException("Archive substitution journal before more writes.");
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FileName));
                using var file = new FileStream(FileName, FileMode.Append, FileAccess.Write, FileShare.Read);
                file.Write(bytes, 0, bytes.Length); file.Flush(true);
                Entries[entry.definition.operationId] = entry;
                return entry;
            }
            catch { Poisoned = true; throw; }
        }
        internal Entry Register(Definition definition)
        {
            if (!ValidDefinition(definition)) throw new ArgumentException("Invalid substitution intent, identity, policy or reserved child IDs.");
            if (Contains(definition.operationId))
            {
                var old = Get(definition.operationId);
                if (old.definition.planToken != definition.planToken) throw new ArgumentException("Workflow ID belongs to a different substitution plan.");
                return old;
            }
            if (Entries.Count >= 512) throw new InvalidOperationException("Archive substitution workflows before registering more.");
            return Persist(new Entry(definition, 0, false, "registered"));
        }
        internal Entry Start(string id, string phase)
        {
            var entry = Get(id);
            if (entry.status == "interrupted" || entry.status == "effect_verified" || entry.phaseStarted || Next(entry) != phase)
                throw new InvalidOperationException("Wrong phase or an earlier phase may already have executed; query status without replaying.");
            return Persist(entry with { phaseStarted = true, status = "phase_started", error = null });
        }
        internal Entry Complete(string id, string phase, Roster baseline = null, long? endCursor = null)
        {
            var entry = Get(id);
            if (!entry.phaseStarted || Next(entry) != phase) throw new InvalidOperationException("Workflow phase is not awaiting completion.");
            if (phase == "baseline" && (!ValidRoster(entry.definition, baseline) ||
                !baseline.databaseIndices.Contains(entry.definition.outgoingDatabaseIndex) || baseline.databaseIndices.Contains(entry.definition.incomingDatabaseIndex)))
                throw new ArgumentException("Complete native outgoing-only roster baseline is required.");
            if (phase != "baseline" && baseline != null) throw new ArgumentException("Roster baseline belongs only to its dedicated phase.");
            var next = entry.nextPhase + 1;
            return Persist(entry with { nextPhase = next, phaseStarted = false, baseline = baseline ?? entry.baseline,
                status = next == entry.definition.phases.Length ? "awaiting_effect" : "phase_complete", executionEndCursor = endCursor ?? entry.executionEndCursor });
        }
        internal Entry Interrupt(string id, string error)
        {
            var entry = Get(id);
            if (entry.status == "effect_verified") return entry;
            return Persist(entry with { status = "interrupted", error = error });
        }
        internal Entry Continue(string id)
        {
            var entry = Get(id);
            if (entry.phaseStarted) throw new InvalidOperationException("Resolve the already-started phase without replay before continuing.");
            if (entry.status != "interrupted") return entry;
            return Persist(entry with { status = "phase_complete", error = null });
        }
        internal Entry Observe(string id, Roster roster)
        {
            var entry = Get(id);
            if (entry.status == "effect_verified") return entry;
            if (entry.nextPhase != entry.definition.phases.Length || entry.phaseStarted || !ValidRoster(entry.definition, roster))
                throw new InvalidOperationException("Complete all phases and observe the same native match before recording effect evidence.");
            var verified = Transition(entry, roster);
            // Polling unchanged membership must not fill the journal. Preserve the first observation;
            // a changed membership or the first successful transition is always recorded.
            if (!verified && entry.after != null && entry.after.databaseIndices.OrderBy(id => id).SequenceEqual(roster.databaseIndices.OrderBy(id => id))) return entry;
            return Persist(entry with { after = roster, status = verified ? "effect_verified" : entry.status });
        }
    }
}
