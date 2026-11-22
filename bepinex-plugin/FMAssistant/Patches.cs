using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using FM.GamePlugin;
using FM.Match;
using HarmonyLib;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

/// <summary>Rate limiter so hot events do not flood the in-memory log.</summary>
public static class Throttle
{
    private static readonly ConcurrentDictionary<string, int> Counts = new();

    public static bool Allow(string key, int limit)
    {
        var value = Counts.AddOrUpdate(key, 1, (_, current) => current + 1);
        return value <= limit;
    }

    public static void Reset() => Counts.Clear();
}

public static class InteropNames
{
    private static readonly Dictionary<uint, string> Map = Build();

    private static Dictionary<uint, string> Build()
    {
        var map = new Dictionary<uint, string>();
        try
        {
            foreach (var value in Enum.GetValues(typeof(InteropEventIDs)))
            {
                var id = Convert.ToUInt32(value);
                var name = Enum.GetName(typeof(InteropEventIDs), value);
                if (!string.IsNullOrEmpty(name) && !map.ContainsKey(id))
                {
                    map[id] = name;
                }
            }
        }
        catch
        {
            // ignore
        }
        return map;
    }

    public static string NameOf(uint id) => Map.TryGetValue(id, out var name) ? name : "unknown";
}

public static class Describe
{
    public static string Object(object obj, int maxProperties = 24, int depth = 0)
    {
        if (obj == null)
        {
            return "null";
        }
        if (depth > 2)
        {
            return TypeName(obj);
        }
        if (obj is string s)
        {
            return "\"" + s + "\"";
        }
        if (obj.GetType().IsPrimitive || obj is Enum || obj is decimal)
        {
            return Convert.ToString(obj, System.Globalization.CultureInfo.InvariantCulture);
        }

        var sb = new StringBuilder();
        sb.Append(TypeName(obj)).Append('{');
        var properties = obj.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance);
        var used = 0;
        foreach (var property in properties)
        {
            if (property.GetIndexParameters().Length > 0)
            {
                continue;
            }
            if (used >= maxProperties)
            {
                sb.Append("...");
                break;
            }
            try
            {
                var value = property.GetValue(obj);
                if (used > 0)
                {
                    sb.Append(", ");
                }
                sb.Append(property.Name).Append('=').Append(Object(value, maxProperties, depth + 1));
                used++;
            }
            catch
            {
                // native getters may throw; skip
            }
        }
        sb.Append('}');
        return sb.ToString();
    }

    public static string TypeName(object obj)
    {
        if (obj == null)
        {
            return "null";
        }
        return obj.GetType().FullName ?? obj.GetType().Name;
    }
}

/// <summary>Harmony patches that expose the game's own event flow to us.</summary>
public static class Patches
{
    public static volatile bool Applied;

    internal static bool HasMutationHooks(Harmony harmony)
    {
        bool Has(string method, Type prefix) => System.Linq.Enumerable.Any(harmony.GetPatchedMethods(), patched =>
            patched.DeclaringType == typeof(GameInteropSubsystem) && patched.Name == method &&
            System.Linq.Enumerable.Any((IEnumerable<Patch>)Harmony.GetPatchInfo(patched)?.Prefixes ?? Array.Empty<Patch>(), patch => patch.owner == Plugin.Guid && patch.PatchMethod.DeclaringType == prefix));
        return Has("SendEvent", typeof(InteropSendEventPatch)) && Has("UpdateChannelData", typeof(InteropUpdateChannelPatch));
    }
    internal static bool HasContinuationHooks(Harmony harmony)
    {
        var method = typeof(MatchPlaybackController).GetMethod("OnEventFromPlugin", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
            null, new[] { typeof(EventFromPlugin) }, null);
        var patches = method == null ? null : Harmony.GetPatchInfo(method);
        return patches != null && System.Linq.Enumerable.Any(patches.Prefixes, patch => patch.owner == Plugin.Guid && patch.PatchMethod.DeclaringType == typeof(MatchContinueCallbackPatch)) &&
            System.Linq.Enumerable.Any(patches.Finalizers, patch => patch.owner == Plugin.Guid && patch.PatchMethod.DeclaringType == typeof(MatchContinueCallbackPatch));
    }
    [HarmonyPatch(typeof(MatchPlaybackController), "OnEventFromPlugin", new Type[] { typeof(EventFromPlugin) })]
    internal static class MatchContinueCallbackPatch
    {
        [HarmonyPrefix]
        internal static void Prefix(MatchPlaybackController __instance, EventFromPlugin __0, out long? __state)
        {
            __state = null;
            if (!ContinueCallbackLog.Armed) return;
            try
            {
                if (__0 == null || __0.ID != 0x41323268) return;
                RuntimeCapabilities.RequireKnownProtocol(RuntimeCapabilities.MatchFlowObservation);
                var current = MatchCommands.ManagerController(false);
                if (current.Pointer != __instance.Pointer) return;
                var context = new ContinueCallbackLog.Context(LiveTools.SessionId, LiveTools.CurrentEpoch,
                    current.Pointer.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), current.MatchReference.GetPersistentIdentity(),
                    MatchCommands.ManagerTeam(current).ToString());
                __state = ContinueCallbackLog.Begin(context, current.StateMachine?.CurrentState?.GUID.ToString());
            }
            catch (Exception error) { EventLog.Add("error", "continue callback observation: " + error.GetBaseException().Message); }
        }
        [HarmonyFinalizer]
        internal static void Finalizer(MatchPlaybackController __instance, long? __state, Exception __exception)
        {
            if (!__state.HasValue) return;
            string phase = null;
            try { phase = __instance.StateMachine?.CurrentState?.GUID.ToString(); } catch { /* Handler result is separate from observer availability. */ }
            try { ContinueCallbackLog.Finish(__state.Value, phase, __exception?.GetBaseException().Message); }
            catch (Exception error) { EventLog.Add("error", "continue callback completion observation: " + error.GetBaseException().Message); }
            // void finalizer: retain the original exception and behavior.
        }
    }

    private static void LogInterop(uint eventId, InteropReference target, TypedValue data)
    {
        if (!HttpApi.LoggingEnabled)
        {
            return;
        }
        if (!Throttle.Allow("interop:" + eventId, 40))
        {
            return;
        }
        var name = InteropNames.NameOf(eventId);
        var targetText = target == null ? "null" : Describe.Object(target, 12);
        var dataText = data == null ? "null" : Describe.Object(data, 16);
        EventLog.Add("interop", $"id={eventId} name={name} target={targetText} data={dataText}");
    }

    private static void LogUiEvent(EventBase evt)
    {
        if (evt == null)
        {
            return;
        }
        var typeName = evt.GetType().Name;
        var interesting = typeName.IndexOf("Tactic", StringComparison.OrdinalIgnoreCase) >= 0
            || typeName.IndexOf("Formation", StringComparison.OrdinalIgnoreCase) >= 0
            || typeName.IndexOf("Role", StringComparison.OrdinalIgnoreCase) >= 0
            || typeName.IndexOf("TeamSelection", StringComparison.OrdinalIgnoreCase) >= 0
            || typeName.IndexOf("Instruction", StringComparison.OrdinalIgnoreCase) >= 0;
        if (!interesting && !HttpApi.LogAllUiEvents)
        {
            return;
        }
        if (!Throttle.Allow("ui:" + typeName, 40))
        {
            return;
        }
        EventLog.Add("ui-event", typeName + " " + Describe.Object(evt, 16));
    }

    [HarmonyPatch(typeof(GameInteropSubsystem), "SendEvent", new Type[] { typeof(uint), typeof(InteropReference), typeof(TypedValue) })]
    public static class InteropSendEventPatch
    {
        [HarmonyPrefix]
        public static void Prefix(GameInteropSubsystem __instance, uint eventID, InteropReference objectTo, TypedValue data)
        {
            try
            {
                Shared.CaptureInterop(__instance);
                MutationActivity.RecordInteropEvent(eventID, objectTo, data);
                if (eventID == 8) LiveTools.Reset();
                Observe.InteropEvent(eventID, objectTo, data);
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "interop prefix: " + ex.Message);
            }
        }
    }

    [HarmonyPatch(typeof(GameInteropSubsystem), "UpdateChannelData", new Type[] { typeof(SI.Bindable.Bindings.Key), typeof(TypedValue) })]
    public static class InteropUpdateChannelPatch
    {
        [HarmonyPrefix]
        public static void Prefix(SI.Bindable.Bindings.Key __0) => MutationActivity.RecordPropertyUpdate(__0.m_key);
    }

    [HarmonyPatch(typeof(SI.Core.EventDispatcher), nameof(SI.Core.EventDispatcher.SendEvent))]
    public static class DispatcherSendEventPatch
    {
        [HarmonyPrefix]
        public static void Prefix(SI.Core.EventDispatcher __instance, EventBase evt)
        {
            try
            {
                Shared.CaptureDispatcher(__instance);
                Observe.SiEvent(evt);
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "dispatcher prefix: " + ex.Message);
            }
        }
    }

    [HarmonyPatch(typeof(SI.Core.EventSubsystem), "SendEvent", new Type[] { typeof(SI.Core.EventBase) })]
    public static class EventSubsystemSendPatch
    {
        [HarmonyPrefix]
        public static void Prefix(SI.Core.EventSubsystem __instance, SI.Core.EventBase evt)
        {
            try
            {
                Shared.CaptureEventSubsystem(__instance);
                Observe.SiEvent(evt);
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "event subsystem prefix: " + ex.Message);
            }
        }
    }



    private static void PatchMethod(Harmony harmony, Type targetType, string methodName, string prefixName, Type eventType)
    {
        try
        {
            var target = targetType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (target == null)
            {
                EventLog.Add("error", "manual patch target not found: " + targetType.Name + "." + methodName);
                return;
            }
            var prefix = typeof(Patches).GetMethod(prefixName, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            if (prefix == null)
            {
                EventLog.Add("error", "manual patch prefix not found: " + prefixName);
                return;
            }
            harmony.Patch(target, new HarmonyMethod(prefix));
            EventLog.Add("system", "manual patch ok: " + targetType.Name + "." + methodName + " <- " + prefixName);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "manual patch " + methodName + ": " + ex);
        }
    }

    public static void RoleOptionPrefix(FM.UI.RoleOptionEvent evt)
    {
        try
        {
            Observe.SiEventDeep(evt);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "role option prefix: " + ex.Message);
        }
    }

    public static void FormationOptionPrefix(FM.UI.FormationOptionEvent evt)
    {
        try
        {
            Observe.SiEventDeep(evt);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "formation option prefix: " + ex.Message);
        }
    }

    public static void ModifyTacticPrefix(FM.UI.ModifyTacticEvent evt)
    {
        try
        {
            Observe.SiEventDeep(evt);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "modify tactic prefix: " + ex.Message);
        }
    }

    public static void DispatcherRaisePrefix(SI.Core.EventDispatcher __instance, SI.Core.EventBase evt)
    {
        try
        {
            Shared.CaptureDispatcher(__instance);
            Observe.SiEvent(evt);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dispatcher raise prefix: " + ex.Message);
        }
    }

    public static void ApplyManualPatches(Harmony harmony)
    {
        PatchGamePluginSend(harmony);
        PatchChannelUpdates(harmony);
        PatchBindingsMethod(harmony, "Set");
        PatchBindingsMethod(harmony, "SetPrefetched");
        try
        {
            var raise = typeof(SI.Core.EventDispatcher).GetMethod("Raise", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, new Type[] { typeof(SI.Core.EventBase) }, null);
            if (raise != null)
            {
                var prefix = typeof(Patches).GetMethod(nameof(DispatcherRaisePrefix), BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                harmony.Patch(raise, new HarmonyMethod(prefix));
                EventLog.Add("system", "manual patch ok: EventDispatcher.Raise");
            }
            else
            {
                EventLog.Add("error", "manual patch: EventDispatcher.Raise not found");
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "manual patch EventDispatcher.Raise: " + ex);
        }
    }

    public static void BindingsSetPrefix(SI.Bindable.Bindings __instance, ref SI.Bindable.Bindings.Key __0, SI.Core.TypedValue __1, SI.Bindable.Bindings.SetFlags __2)
    {
        try
        {
            if (!Observe.BindingsEnabled)
            {
                return;
            }
            var keyText = __0.m_key.ToString("x16");
            var valueText = Observe.DescribeTypedValuePublic(__1);
            Observe.AddBinding(keyText, valueText);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "bindings set prefix: " + ex.Message);
        }
    }

    private static void PatchChannelUpdates(Harmony harmony)
    {
        try
        {
            System.Reflection.MethodInfo target = null;
            foreach (var method in typeof(FM.GamePlugin.GamePlugin).GetMethods(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic))
            {
                if (method.Name == "UpdateChannelData")
                {
                    var parameters = method.GetParameters();
                    if (parameters.Length == 2 && parameters[1].ParameterType == typeof(SI.Core.TypedValue))
                    {
                        target = method;
                        break;
                    }
                }
            }
            if (target == null)
            {
                EventLog.Add("error", "manual patch: UpdateChannelData not found");
                return;
            }
            harmony.Patch(target, new HarmonyLib.HarmonyMethod(typeof(GamePluginChannelPatch).GetMethod("UpdateChannelPrefix")));
            EventLog.Add("system", "manual patch ok: GamePlugin.UpdateChannelData");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "manual patch UpdateChannelData: " + ex);
        }
    }

    private static void PatchGamePluginSend(Harmony harmony)
    {
        try
        {
            var method = typeof(FM.GamePlugin.GamePlugin).GetMethod("SendEvent", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance, null, new[] { typeof(uint), typeof(SI.Interop.InteropReference), typeof(SI.Core.TypedValue) }, null);
            if (method == null)
            {
                EventLog.Add("error", "manual patch: GamePlugin.SendEvent not found");
                return;
            }
            harmony.Patch(method, new HarmonyLib.HarmonyMethod(typeof(GamePluginSendEventPatch).GetMethod("Prefix")));
            EventLog.Add("system", "manual patch ok: GamePlugin.SendEvent");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "manual patch GamePlugin.SendEvent: " + ex);
        }
    }

    private static void PatchBindingsMethod(Harmony harmony, string methodName)
    {
        try
        {
            var method = typeof(SI.Bindable.Bindings).GetMethod(
                methodName,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic,
                null,
                new Type[] { typeof(SI.Bindable.Bindings.Key).MakeByRefType(), typeof(SI.Core.TypedValue), typeof(SI.Bindable.Bindings.SetFlags) },
                null);
            if (method == null)
            {
                EventLog.Add("error", "bindings patch target not found: " + methodName);
                return;
            }
            var prefix = typeof(Patches).GetMethod(nameof(BindingsSetPrefix), BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            harmony.Patch(method, new HarmonyMethod(prefix));
            EventLog.Add("system", "manual patch ok: Bindings." + methodName);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "manual patch Bindings." + methodName + ": " + ex);
        }
    }

public static class GamePluginSendEventPatch
{
    [HarmonyPrefix]
    public static void Prefix(FM.GamePlugin.GamePlugin __instance, uint eventID, SI.Interop.InteropReference objectTo, SI.Core.TypedValue data)
    {
        try
        {
            Shared.CaptureGamePlugin(__instance);
            Observe.InteropEvent(eventID, objectTo, data);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "gameplugin send prefix: " + ex.Message);
        }
    }
}

public static class GamePluginChannelPatch
{
    private static int s_count;

    [HarmonyPrefix]
    public static void UpdateChannelPrefix(object[] __args)
    {
        try
        {
            if (!Observe.Enabled || __args == null || __args.Length < 2)
            {
                return;
            }
            var value = __args[1] as SI.Core.TypedValue;
            if (value == null)
            {
                return;
            }
            s_count++;
            if (s_count > 20000)
            {
                return;
            }
            var action = __args[0];
            var actionType = action == null ? "null" : action.GetType().Name;
            var actionText = string.Empty;
            try
            {
                actionText = action == null ? string.Empty : (action.ToString() ?? string.Empty);
                if (actionText.Length > 300)
                {
                    actionText = actionText.Substring(0, 300);
                }
            }
            catch
            {
                // ignore
            }
            Observe.ChannelEvent2(actionType, actionText, value);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "channel prefix: " + ex.Message);
        }
    }
}
}
