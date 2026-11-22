using System;
using System.Collections.Concurrent;
using System.Diagnostics;

namespace FMAssistant;

/// <summary>Actions queued here are executed on the game's main thread during Update.</summary>
public static class MainThread
{
    private static readonly ConcurrentQueue<Action> Queue = new();
    private static readonly long DrainBudgetTicks = Stopwatch.Frequency * 4 / 1000;

    public static int Pending => Queue.Count;

    public static void Enqueue(Action action)
    {
        if (action != null)
        {
            Queue.Enqueue(action);
        }
    }

    public static int Drain()
    {
        var handled = 0;
        var started = Stopwatch.GetTimestamp();
        while (handled < 64 && (handled == 0 || Stopwatch.GetTimestamp() - started < DrainBudgetTicks) &&
               Queue.TryDequeue(out var action))
        {
            handled++;
            try
            {
                action();
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "main-thread action failed: " + ex);
            }
        }
        return handled;
    }
}
