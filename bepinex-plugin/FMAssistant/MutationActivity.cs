using System;
using System.Collections.Generic;
using System.Linq;

namespace FMAssistant;

// Observed client business writes, separate from normal binding data notifications.
// A workflow must stop if another command intervenes. This is not a native transaction lock.
internal static class MutationActivity
{
    internal sealed record Entry(long Cursor, string Owner, string Kind, string Target, long At);
    internal sealed record Observation(bool Complete, long Cursor, int InterveningWrites);
    private static readonly object Gate = new();
    private static readonly Queue<Entry> Entries = new();
    private static long Sequence;
    // Actual bindings.Create("game.IdleTime") key, verified on the current build.
    internal const ulong IdleTimeBindingKey = 0x298fdd3a8e99aae7UL;
    private static long IdleTimeUpdates;
    internal static volatile bool HooksReady;
    [ThreadStatic] private static string Owner;
    internal static long Cursor { get { lock (Gate) return Sequence; } }
    internal static string CurrentOwner => Owner;
    internal static string OwnerOf(string id)
    {
        if (id != null && id.StartsWith("sub:", StringComparison.Ordinal) && id.Length > 69 && id[68] == ':' &&
            id.Substring(4, 64).All(Uri.IsHexDigit)) return id.Substring(0, 68);
        return id;
    }
    private sealed class Scope : IDisposable
    {
        private readonly string Previous;
        internal Scope(string id) { Previous = Owner; Owner = OwnerOf(id); }
        public void Dispose() { Owner = Previous; }
    }
    internal static IDisposable Enter(string id) => new Scope(id);
    internal static void RecordPropertyUpdate(ulong key)
    {
        if (key == IdleTimeBindingKey && Owner == null)
        {
            lock (Gate) IdleTimeUpdates++;
            return;
        }
        Record("interop_property_update:" + key.ToString("x16"));
    }
    internal static void RecordInteropEvent(uint eventId, SI.Interop.InteropReference target, SI.Core.TypedValue data)
    {
        if (eventId == (uint)FM.GamePlugin.InteropEventIDs.EventFmxAuditHeartbeat) return;
        var kind = "interop_event:" + eventId;
        if (eventId == (uint)FM.GamePlugin.InteropEventIDs.EventFmxMakingTacticalChanges && (data == null || data.IsNull))
        {
            var identity = target?.GetPersistentIdentity();
            lock (Gate)
            {
                var prior = Entries.LastOrDefault();
                var now = Environment.TickCount64;
                // The game's native callback can acknowledge draft opening by sending the same
                // empty notification for the same tactic. Selections and confirmations still count.
                if (Owner == null && identity != null && prior?.Owner?.StartsWith("sub:", StringComparison.Ordinal) == true &&
                    prior.Kind == kind && prior.Target == identity && now - prior.At <= 500)
                    Record(kind + ":draft_open_notification", identity, prior.Owner);
                else Record(kind, identity);
            }
            return;
        }
        Record(kind);
    }
    internal static void Record(string kind, string target = null, string owner = null)
    {
        lock (Gate)
        {
            Entries.Enqueue(new Entry(++Sequence, owner ?? Owner, kind, target, Environment.TickCount64));
            while (Entries.Count > 2048) Entries.Dequeue();
        }
    }
    internal static Observation Observe(long cursor, string owner)
    {
        lock (Gate)
        {
            var complete = cursor >= 0 && cursor <= Sequence && (Entries.Count == 0 || cursor >= Entries.Peek().Cursor - 1);
            // Both an unowned game/UI command and another agent's command can
            // intervene. Plain Bindings.Set notifications never call Record.
            return new Observation(complete, Sequence, complete ? Entries.Count(entry => entry.Cursor > cursor && (owner == null || entry.Owner != owner)) : 0);
        }
    }
    internal static object Recent(long since)
    {
        lock (Gate) return new { ok = true, cursor = Sequence,
            complete = since >= 0 && since <= Sequence && (Entries.Count == 0 || since >= Entries.Peek().Cursor - 1),
            entries = Entries.Where(e => e.Cursor > since).TakeLast(128).ToArray(),
            ignoredIdleTimeUpdates = IdleTimeUpdates, excludedPropertyBindingKey = IdleTimeBindingKey.ToString("x16"),
            scope = "observed_GameInterop_commands_not_binding_notifications" };
    }
    internal static void RequireUnchanged(long cursor)
    {
        if (cursor < 0) return;
        if (!HooksReady) throw new InvalidOperationException("Client mutation observers are not installed; guarded workflow writes are unavailable.");
        if (Owner == null) throw new InvalidOperationException("Workflow command has no operation identity.");
        var observed = Observe(cursor, Owner);
        if (!observed.Complete || observed.InterveningWrites != 0)
            throw new InvalidOperationException("Another client write intervened, or activity history is incomplete. Refresh before continuing this workflow.");
    }
}
