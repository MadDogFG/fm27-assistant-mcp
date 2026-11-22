using System;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;

namespace FMAssistant;

[BepInPlugin(Guid, "FM Assistant", Version)]
public class Plugin : BasePlugin
{
    public const string Guid = "com.fm27assistant.plugin";
    public const string Version = "1.0.0";

    public static Plugin Instance { get; private set; }

    public override void Load()
    {
        Instance = this;
        EventLog.Add("system", "FM Assistant loading v" + Version);
        Log.LogInfo("[FM Assistant] loading v" + Version);

        HttpApi.Start();

        try
        {
            var offMarker = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".", "patches.off");
            if (System.IO.File.Exists(offMarker))
            {
                EventLog.Add("system", "patches disabled by patches.off marker");
                Log.LogWarning("[FM Assistant] harmony patches disabled by patches.off");
            }
            else
            {
                var harmony = new Harmony(Guid);
                try
                {
                    harmony.PatchAll();
                }
                catch (Exception ex)
                {
                    Log.LogError("[FM Assistant] patchAll failure: " + ex);
                    EventLog.Add("error", "patchAll failure: " + ex);
                }
                var patchedCount = System.Linq.Enumerable.Count(harmony.GetPatchedMethods());
                Patches.Applied = patchedCount > 1;
                MutationActivity.HooksReady = Patches.HasMutationHooks(harmony);
                ContinueCallbackLog.HooksReady = Patches.HasContinuationHooks(harmony);
                EventLog.Add("system", "harmony patchAll done, patched methods: " + patchedCount);
                try
                {
                    Patches.ApplyManualPatches(harmony);
                }
                catch (Exception ex)
                {
                    Log.LogError("[FM Assistant] manual patch failure: " + ex);
                    EventLog.Add("error", "manual patch failure: " + ex);
                }
            }
        }
        catch (Exception ex)
        {
            Log.LogError("[FM Assistant] patch failure: " + ex);
            EventLog.Add("error", "patch failure: " + ex);
        }

        MainThreadDriver.Install();

        Log.LogInfo($"[FM Assistant] loaded; API on http://127.0.0.1:{HttpApi.DefaultPort}/");
    }
}
