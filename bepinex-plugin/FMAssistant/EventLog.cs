using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace FMAssistant;

/// <summary>In-memory ring log exposed over HTTP for the agent.</summary>
public static class EventLog
{
    public sealed class Entry
    {
        public long Seq;
        public long TimeUtcMs;
        public string Category;
        public string Message;
    }

    private const int MaxEntries = 6000;
    private static readonly ConcurrentQueue<Entry> Queue = new();
    private static int _count;
    private static long _seq;

    public static void Add(string category, string message)
    {
        try
        {
            var entry = new Entry
            {
                Seq = Interlocked.Increment(ref _seq),
                TimeUtcMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Category = category,
                Message = message,
            };
            Queue.Enqueue(entry);
            if (Interlocked.Increment(ref _count) > MaxEntries && Queue.TryDequeue(out _))
            {
                Interlocked.Decrement(ref _count);
            }
        }
        catch
        {
            // never throw from logging
        }
    }

    public static List<Entry> Snapshot(int limit, string category, long since)
    {
        IEnumerable<Entry> items = Queue.ToArray();
        if (!string.IsNullOrEmpty(category))
        {
            items = items.Where(e => string.Equals(e.Category, category, StringComparison.OrdinalIgnoreCase));
        }
        if (since > 0)
        {
            items = items.Where(e => e.Seq > since);
        }
        return items.OrderBy(e => e.Seq).TakeLast(Math.Clamp(limit, 1, 3000)).ToList();
    }

    public static int Count => Volatile.Read(ref _count);

    public static void Clear()
    {
        while (Queue.TryDequeue(out _))
        {
            Interlocked.Decrement(ref _count);
        }
    }
}
