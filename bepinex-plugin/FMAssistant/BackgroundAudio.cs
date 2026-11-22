using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Il2CppInterop.Runtime;
using UnityEngine;

namespace FMAssistant;

// Opt-in, process-local test mute. No preferences, Windows mixer or launch options.
// Volume/source mute keeps the audio clock running; AudioListener.pause is not used.
internal static class BackgroundAudio
{
    private static bool Enabled;
    private static float OriginalVolume;
    private static string LastError;
    private static readonly Dictionary<int, (AudioSource Source, bool Muted)> Sources = new();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    internal static object State() => new { ok = true, processId = Environment.ProcessId, enabled = Enabled,
        muted = Enabled && LastError == null && AudioListener.volume == 0f,
        listenerVolume = AudioListener.volume, sources = Sources.Count, error = LastError,
        scope = "current_process_unity_audio_only", persistentSettingsChanged = false, liveVerified = false };

    internal static object Set(bool muted)
    {
        if (!muted) { Restore(); return State(); }
        if (!Enabled) { OriginalVolume = AudioListener.volume; Enabled = true; }
        Tick();
        return State();
    }

    internal static void Tick()
    {
        if (!Enabled) return;
        try
        {
            GetWindowThreadProcessId(GetForegroundWindow(), out var foreground);
            if (foreground == Environment.ProcessId) { Restore(); return; } // Player took over this running FM instance.
            AudioListener.volume = 0f;
            foreach (var obj in Resources.FindObjectsOfTypeAll(Il2CppType.Of<AudioSource>()))
            {
                var source = obj.TryCast<AudioSource>();
                if (source == null || !source.gameObject.scene.IsValid()) continue;
                var id = source.GetInstanceID();
                if (!Sources.ContainsKey(id)) Sources.Add(id, (source, source.mute));
                source.mute = true; // Includes music/UI sources that ignore listener volume.
            }
            LastError = null;
        }
        catch (Exception error) { LastError = error.GetBaseException().Message; }
    }

    internal static void Restore()
    {
        if (!Enabled) return;
        Enabled = false;
        AudioListener.volume = OriginalVolume;
        foreach (var item in Sources.Values)
            try { if (item.Source != null) item.Source.mute = item.Muted; } catch { /* Destroyed scene source. */ }
        Sources.Clear(); LastError = null;
    }
}
