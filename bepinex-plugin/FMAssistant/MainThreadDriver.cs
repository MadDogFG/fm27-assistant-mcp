using System;
using System.Threading;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.Injection;
using UnityEngine;

namespace FMAssistant;

/// <summary>游戏主线程驱动：执行排队操作和命令结果核对。</summary>
public class MainThreadDriver : MonoBehaviour
{
    private int _frames;
    private static long LastTick;
    private static string _phase = "starting";
    public static long LastTickUtcTicks => Interlocked.Read(ref LastTick);
    public static string Phase => Volatile.Read(ref _phase);

    internal static object ReadHeartbeat()
    {
        var tick = LastTickUtcTicks;
        var age = tick == 0 ? (double?)null : Math.Max(0, (DateTime.UtcNow.Ticks - tick) / (double)TimeSpan.TicksPerMillisecond);
        return new { tickAgeMs = age, responsive = age.HasValue && age.Value < 5000,
            phase = Phase, queuedRequests = MainThread.Pending,
            note = "A responsive game thread does not prove that a save is loaded or a command is legal." };
    }

    public MainThreadDriver(IntPtr pointer) : base(pointer)
    {
    }

    private void Update()
    {
        try
        {
            Interlocked.Exchange(ref LastTick, DateTime.UtcNow.Ticks);
            Volatile.Write(ref _phase, "background_audio");
            BackgroundAudio.Tick();
            Volatile.Write(ref _phase, "request_queue");
            MainThread.Drain();
            Volatile.Write(ref _phase, "tactic_verification");
            TacticCommands.Tick();
            Volatile.Write(ref _phase, "operation_verification");
            CommandOperations.Tick();
            _frames++;
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "driver update: " + ex.Message);
        }
        finally
        {
            Volatile.Write(ref _phase, "between_updates");
        }
    }

    private void OnApplicationQuit() => BackgroundAudio.Restore();
    private void OnDestroy() => BackgroundAudio.Restore();

    public static void Install()
    {
        try
        {
            ClassInjector.RegisterTypeInIl2Cpp<MainThreadDriver>();
            var host = new GameObject("FMAssistantDriver");
            UnityEngine.Object.DontDestroyOnLoad(host);
            host.hideFlags = HideFlags.HideAndDontSave;
            host.AddComponent(Il2CppType.Of<MainThreadDriver>());
            EventLog.Add("system", "MainThreadDriver installed (MonoBehaviour Update)");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "driver install failed: " + ex);
        }
    }
}
