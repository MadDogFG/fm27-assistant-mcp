using System;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;

namespace FMAssistant;

/// <summary>Captured live game objects (IL2CPP instances) for later calls.</summary>
public static class Shared
{
    public static object InteropSubsystem;
    public static object GamePlugin;
    public static object Dispatcher;
    public static object EventSubsystem;

    public static string PointerOf(object obj)
    {
        if (obj == null)
        {
            return "0";
        }
        try
        {
            return IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)obj).ToString("X");
        }
        catch
        {
            return "?";
        }
    }

    public static void CaptureInterop(object instance)
    {
        if (instance != null && InteropSubsystem == null)
        {
            InteropSubsystem = instance;
            EventLog.Add("capture", "GameInteropSubsystem@" + PointerOf(instance));
        }
    }

    public static void CaptureGamePlugin(object instance)
    {
        if (instance != null && GamePlugin == null)
        {
            GamePlugin = instance;
            EventLog.Add("capture", "GamePlugin@" + PointerOf(instance));
        }
    }

    public static void CaptureDispatcher(object instance)
    {
        if (instance != null && Dispatcher == null)
        {
            Dispatcher = instance;
            EventLog.Add("capture", "EventDispatcher@" + PointerOf(instance));
        }
    }

    public static void CaptureEventSubsystem(object subsystem)
    {
        if (subsystem != null && EventSubsystem == null)
        {
            EventSubsystem = subsystem;
            EventLog.Add("capture", "EventSubsystem@" + PointerOf(subsystem));
        }
    }
}
