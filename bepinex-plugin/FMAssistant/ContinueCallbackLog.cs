using System;
using System.Collections.Generic;
using System.Linq;

namespace FMAssistant;

// Passive history of the actual controller callback, independent of diagnostic
// logging switches and of request dispatch ownership. Never injects an event.
internal static class ContinueCallbackLog
{
    internal sealed record Context(string sessionId, int epoch, string controller, string matchIdentity, string side);
    internal sealed record Entry(long sequence, Context context, string phaseBefore, string phaseAfter,
        bool handlerReturned, string handlerError, string receivedUtc);
    internal sealed record Observation(bool complete, long cursor, Entry[] entries);
    private static readonly object Gate = new();
    private static readonly List<Entry> Entries = new();
    private static long Sequence;
    internal static bool HooksReady;
    internal static volatile bool Armed = false;
    internal static long Cursor { get { lock (Gate) return Sequence; } }
    internal static long Begin(Context context, string phase)
    {
        lock (Gate)
        {
            var entry = new Entry(++Sequence, context, phase, null, false, null, DateTime.UtcNow.ToString("O"));
            Entries.Add(entry);
            if (Entries.Count > 512) Entries.RemoveAt(0);
            return entry.sequence;
        }
    }
    internal static void Finish(long sequence, string phase, string error)
    {
        lock (Gate)
        {
            var index = Entries.FindIndex(entry => entry.sequence == sequence);
            if (index < 0) return; // Lost history cannot become positive proof.
            Entries[index] = Entries[index] with { phaseAfter = phase, handlerReturned = error == null, handlerError = error };
        }
    }
    internal static Observation Read(long cursor)
    {
        lock (Gate)
        {
            var complete = HooksReady && cursor >= 0 && cursor <= Sequence && (Entries.Count == 0 || cursor >= Entries[0].sequence - 1);
            return new Observation(complete, Sequence, complete ? Entries.Where(entry => entry.sequence > cursor).ToArray() : Array.Empty<Entry>());
        }
    }
}
