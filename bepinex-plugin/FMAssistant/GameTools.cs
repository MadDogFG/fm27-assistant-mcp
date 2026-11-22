using System;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.Runtime;
using SI.Core;
using SI.Bindable;
using UnityEngine;

namespace FMAssistant;

/// <summary>游戏官方 API 层：找核心单例、发官方 interop 事件。</summary>
public static class GameTools
{
    public static object InteropSubsystem;
    public static object GamePluginRef;

    public static object FindInterop()
    {
        if (InteropSubsystem != null)
        {
            return InteropSubsystem;
        }
        try
        {
            var captured = Shared.InteropSubsystem;
            if (captured != null)
            {
                var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)captured);
                var wrapper = Il2CppObjectPool.Get<FM.GamePlugin.GameInteropSubsystem>(pointer);
                if (wrapper != null)
                {
                    InteropSubsystem = wrapper;
                    return InteropSubsystem;
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find captured interop: " + ex.Message);
        }
        try
        {
            var type = Il2CppType.Of<FM.GamePlugin.GameInteropSubsystem>();
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(type);
            if (objects != null)
            {
                foreach (var obj in objects)
                {
                    var sub = obj?.TryCast<FM.GamePlugin.GameInteropSubsystem>();
                    if (sub != null)
                    {
                        InteropSubsystem = sub;
                        EventLog.Add("game", "captured GameInteropSubsystem@" + Shared.PointerOf(sub));
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find interop: " + ex.Message);
        }
        return InteropSubsystem;
    }

    public static string SendEvent(uint id)
    {
        try
        {
            var sub = FindInterop() as FM.GamePlugin.GameInteropSubsystem;
            if (sub == null)
            {
                return "{\"ok\":false,\"error\":\"GameInteropSubsystem not found\"}";
            }
            sub.SendEvent(id, null, null);
            EventLog.Add("game", "sent interop event id=" + id);
            return "{\"ok\":true,\"sent\":" + id + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "send interop event " + id + ": " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }


    public static object LoadModule;

    public static object FindLoadModule()
    {
        if (LoadModule != null)
        {
            return LoadModule;
        }
        try
        {
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<FM.UI.LoadGameHandlerModule>());
            if (objects != null)
            {
                foreach (var obj in objects)
                {
                    var module = obj?.TryCast<FM.UI.LoadGameHandlerModule>();
                    if (module != null)
                    {
                        LoadModule = module;
                        EventLog.Add("game", "captured LoadGameHandlerModule@" + Shared.PointerOf(module));
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find load module: " + ex.Message);
        }
        return LoadModule;
    }

    public static string ConfirmLastSave()
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            module.ShowConfirmLoadLastSaveDialog();
            EventLog.Add("game", "called ShowConfirmLoadLastSaveDialog");
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "confirm last save: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    // Programmatic confirmation of the "load last save" dialog: call the game's own dialog
    // button handler with the game's own save record, instead of synthesizing UI input.
    public static string ConfirmLastSaveOnClick()
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            var bindings = BindingTools.GetBindings();
            var keyOrNull = FindBindingKeyBySuffix(".LastSave");
            if (keyOrNull == null)
            {
                return "{\"ok\":false,\"error\":\"last save binding not found\"}";
            }
            var key = keyOrNull.Value;
            var value = bindings.Get(ref key);
            if (value == null)
            {
                return "{\"ok\":false,\"error\":\"last save binding value null\"}";
            }
            var raw = value.As<Il2CppSystem.Object>();
            var dynamicReference = (raw as Il2CppObjectBase)?.TryCast<SI.Bindable.DynamicReference>();
            if (dynamicReference == null)
            {
                return "{\"ok\":false,\"error\":\"last save value is not a DynamicReference\"}";
            }
            var method = module.GetType().GetMethod("ConfirmLoadLastSaveOnClick");
            if (method == null)
            {
                return "{\"ok\":false,\"error\":\"ConfirmLoadLastSaveOnClick not found\"}";
            }
            var dataType = Type.GetType("SI.Bindable.DialogManager+DialogButtonData, SI.Bindable");
            object dialogData = null;
            if (dataType != null)
            {
                try { dialogData = Activator.CreateInstance(dataType); } catch { dialogData = null; }
            }
            module.ShowConfirmLoadLastSaveDialog();
            var args = new object[] { "confirm", dialogData, dynamicReference };
            method.Invoke(module, args);
            EventLog.Add("game", "ConfirmLoadLastSaveOnClick invoked (dialogData=" + (dataType?.FullName ?? "null") + ")");
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "confirm last save click: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ProbeModules()
    {
        var sb = new System.Text.StringBuilder();
        sb.Append('{');
        var first = true;
        ProbeType<FM.UI.TacticRoleHandlerModule>("TacticRoleHandlerModule", sb, ref first);
        ProbeType<FM.UI.TacticFormationHandlerModule>("TacticFormationHandlerModule", sb, ref first);
        ProbeType<FM.UI.ModifyTacticHandlerModule>("ModifyTacticHandlerModule", sb, ref first);
        ProbeType<FM.UI.LoadGameHandlerModule>("LoadGameHandlerModule", sb, ref first);
        ProbeType<FM.UI.SaveGameHandlerModule>("SaveGameHandlerModule", sb, ref first);
        try
        {
            var helper = FM.UI.FMPositionHelper.Instance;
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            sb.Append("\"FMPositionHelper\":\"").Append(Shared.PointerOf(helper)).Append('"');
        }
        catch (Exception ex)
        {
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            sb.Append("\"FMPositionHelper\":\"err:").Append(Json.Escape(ex.Message)).Append('"');
        }
        sb.Append('}');
        EventLog.Add("game", "modules: " + sb);
        return sb.ToString();
    }

    private static void ProbeType<T>(string label, System.Text.StringBuilder sb, ref bool first) where T : class
    {
        try
        {
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<T>());
            var pointers = new System.Collections.Generic.List<string>();
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    if (candidate == null)
                    {
                        continue;
                    }
                    pointers.Add(Shared.PointerOf(candidate));
                    if (pointers.Count >= 8)
                    {
                        break;
                    }
                }
            }
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            sb.Append('"').Append(label).Append("\":[");
            for (var i = 0; i < pointers.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                sb.Append('"').Append(pointers[i]).Append('"');
            }
            sb.Append(']');
        }
        catch (Exception ex)
        {
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            sb.Append('"').Append(label).Append("\":\"err:").Append(Json.Escape(ex.Message)).Append('"');
        }
    }

    public static string Probe()
    {
        var sub = FindInterop();
        return "{\"ok\":true,\"interop\":\"" + Shared.PointerOf(sub) + "\"}";
    }

    public static string LoadLastSave()
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            module.OnLoadSaveShortcut(null);
            EventLog.Add("game", "LoadGameHandlerModule.OnLoadSaveShortcut(null) called");
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "load last save: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ContinueGame()
    {
        try
        {
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<FM.UI.ContinueManagerModule>());
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    var module = candidate?.TryCast<FM.UI.ContinueManagerModule>();
                    if (module != null)
                    {
                        module.ContinueGame(default);
                        EventLog.Add("game", "ContinueManagerModule.ContinueGame() called");
                        return "{\"ok\":true}";
                    }
                }
            }
            return "{\"ok\":false,\"error\":\"ContinueManagerModule not found\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "continue game: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string SendEventByName(string typeName)
    {
        try
        {
            Type eventType = null;
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    foreach (var type in assembly.GetTypes())
                    {
                        if (type.Name == typeName)
                        {
                            eventType = type;
                            break;
                        }
                    }
                }
                catch
                {
                    // ignore
                }
                if (eventType != null)
                {
                    break;
                }
            }
            if (eventType == null)
            {
                return "{\"ok\":false,\"error\":\"event type not found: " + Json.Escape(typeName) + "\"}";
            }
            var instance = Activator.CreateInstance(eventType);
            var evt = instance as SI.Core.EventBase;
            if (evt == null)
            {
                return "{\"ok\":false,\"error\":\"not an EventBase\"}";
            }
            var subsystem = FindEventSubsystem();
            if (subsystem == null)
            {
                return "{\"ok\":false,\"error\":\"EventSubsystem not found\"}";
            }
            subsystem.SendEvent(evt);
            EventLog.Add("game", "sent event " + typeName + " via EventSubsystem");
            return "{\"ok\":true,\"sent\":\"" + Json.Escape(typeName) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "send event " + typeName + ": " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static SI.Core.EventSubsystem FindEventSubsystem()
    {
        try
        {
            var existing = Shared.EventSubsystem as SI.Core.EventSubsystem;
            if (existing != null)
            {
                return existing;
            }
            return SI.Core.GameSubsystems.Get<SI.Core.EventSubsystem>();
        }
        catch
        {
            return null;
        }
    }

    public static string LoadRecord()
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            var sb = new System.Text.StringBuilder();
            SI.Core.Record record = null;
            try
            {
                record = module.m_loadGameDataRecord;
                sb.Append("m_loadGameDataRecord=").Append(Shared.PointerOf(record)).Append(';');
            }
            catch (Exception ex)
            {
                sb.Append("m_loadGameDataRecord err:").Append(ex.Message).Append(';');
            }
            EventLog.Add("game", "load record state: " + sb);
            if (record == null)
            {
                return "{\"ok\":false,\"error\":\"no game data record\",\"state\":\"" + Json.Escape(sb.ToString()) + "\"}";
            }
            LiveTools.Reset();
            module.StartLoadingSave(record);
            EventLog.Add("game", "StartLoadingSave(record) called");
            return "{\"ok\":true,\"state\":\"" + Json.Escape(sb.ToString()) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "load record: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string NavList()
    {
        try
        {
            object data = null;
            try
            {
                data = FM.UI.StaticData.Instance;
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"StaticData.Instance: " + Json.Escape(ex.Message) + "\"}";
            }
            var staticData = data as FM.UI.StaticData;
            if (staticData == null)
            {
                var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<FM.UI.StaticData>());
                if (objects != null)
                {
                    foreach (var candidate in objects)
                    {
                        staticData = candidate?.TryCast<FM.UI.StaticData>();
                        if (staticData != null)
                        {
                            break;
                        }
                    }
                }
            }
            if (staticData == null)
            {
                return "{\"ok\":false,\"error\":\"StaticData not found\"}";
            }
            var map = staticData.ClubNavigationMap;
            if (map == null)
            {
                map = staticData.NationalTeamNavigationMap;
            }
            if (map == null)
            {
                return "{\"ok\":false,\"error\":\"navigation map null\"}";
            }
            var entriesRaw = map.Entries;
            var entries = entriesRaw == null ? null : entriesRaw.TryCast<Il2CppSystem.Collections.Generic.List<SI.Bindable.MainTabInfo>>();
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"entries\":[");
            if (entries != null)
            {
                for (var i = 0; i < entries.Count; i++)
                {
                    var entry = entries[i];
                    if (entry == null)
                    {
                        continue;
                    }
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    var panelRef = entry.PanelRef;
                    sb.Append("{\"index\":").Append(i)
                        .Append(",\"panelRef\":\"").Append(Shared.PointerOf(panelRef))
                        .Append("\",\"hideFromNavBar\":").Append(entry.HideFromNavBar ? "true" : "false")
                        .Append(",\"showAsPrimaryTab\":").Append(entry.ShowAsPrimaryTab ? "true" : "false")
                        .Append(",\"detail\":\"").Append(Json.Escape(Describe.Object(panelRef, 10))).Append("\"}");
                }
            }
            sb.Append("]}");
            EventLog.Add("game", "nav list " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "nav list: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string NavOpen(int index)
    {
        try
        {
            var data = FM.UI.StaticData.Instance;
            var staticData = data as FM.UI.StaticData;
            if (staticData == null)
            {
                return "{\"ok\":false,\"error\":\"StaticData not found\"}";
            }
            var map = staticData.ClubNavigationMap ?? staticData.NationalTeamNavigationMap;
            if (map == null)
            {
                return "{\"ok\":false,\"error\":\"navigation map null\"}";
            }
            var entriesRaw = map.Entries;
            var entries = entriesRaw == null ? null : entriesRaw.TryCast<Il2CppSystem.Collections.Generic.List<SI.Bindable.MainTabInfo>>();
            if (entries == null || index < 0 || index >= entries.Count)
            {
                return "{\"ok\":false,\"error\":\"index out of range\"}";
            }
            var entry = entries[index];
            if (entry == null)
            {
                return "{\"ok\":false,\"error\":\"entry null\"}";
            }
            var evt = new SI.Bindable.Events.OpenPanelEvent();
            evt.PanelID = entry.PanelRef;
            evt.CheckForExistingOpenedPanel = true;
            var subsystem = FindEventSubsystem();
            if (subsystem == null)
            {
                return "{\"ok\":false,\"error\":\"EventSubsystem not found\"}";
            }
            subsystem.SendEvent(evt);
            EventLog.Add("game", "OpenPanelEvent sent index=" + index + " panelRef=" + Shared.PointerOf(entry.PanelRef));
            return "{\"ok\":true,\"index\":" + index + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "nav open: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static SI.Bindable.DialogManager FindDialogManager()
    {
        try
        {
            return SI.Bindable.DialogManager.Instance;
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "DialogManager.Instance: " + ex.Message);
            return null;
        }
    }

    public static string DialogCurrent()
    {
        try
        {
            var dm = FindDialogManager();
            if (dm == null)
            {
                return "{\"ok\":false,\"error\":\"DialogManager not found\"}";
            }
            var current = dm.CurrentDialog;
            if (current == null)
            {
                return "{\"ok\":false,\"error\":\"no current dialog\"}";
            }
            var data = current.Value;
            if (data == null)
            {
                return "{\"ok\":false,\"error\":\"dialog value null\"}";
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true");
            try { sb.Append(",\"type\":\"").Append(Json.Escape(data.Type ?? string.Empty)).Append('"'); } catch { }
            try { sb.Append(",\"title\":\"").Append(Json.Escape(data.Title ?? string.Empty)).Append('"'); } catch { }
            try { sb.Append(",\"description\":\"").Append(Json.Escape(data.Description ?? string.Empty)).Append('"'); } catch { }
            try
            {
                var primary = data.PrimaryButton;
                if (primary != null)
                {
                    sb.Append(",\"primaryText\":\"").Append(Json.Escape(primary.Text ?? string.Empty)).Append('"');
                    sb.Append(",\"primaryEvent\":\"").Append(Json.Escape(primary.EventID ?? string.Empty)).Append('"');
                    sb.Append(",\"primaryCallback\":\"").Append(Shared.PointerOf(primary.Callback)).Append('"');
                }
            }
            catch { }
            try
            {
                var secondary = data.SecondaryButton;
                if (secondary != null)
                {
                    sb.Append(",\"secondaryText\":\"").Append(Json.Escape(secondary.Text ?? string.Empty)).Append('"');
                    sb.Append(",\"secondaryEvent\":\"").Append(Json.Escape(secondary.EventID ?? string.Empty)).Append('"');
                }
            }
            catch { }
            sb.Append('}');
            EventLog.Add("game", "dialog current " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dialog current: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string DialogClick(int button)
    {
        try
        {
            var dm = FindDialogManager();
            if (dm == null)
            {
                return "{\"ok\":false,\"error\":\"DialogManager not found\"}";
            }
            var current = dm.CurrentDialog;
            var data = current == null ? null : current.Value;
            if (data == null)
            {
                return "{\"ok\":false,\"error\":\"no current dialog\"}";
            }
            var buttonData = button == 0 ? data.PrimaryButton : data.SecondaryButton;
            if (buttonData == null)
            {
                return "{\"ok\":false,\"error\":\"button null\"}";
            }
            var callback = buttonData.Callback;
            if (callback == null)
            {
                return "{\"ok\":false,\"error\":\"callback null\"}";
            }
            var result = new SI.Bindable.DialogManager.DialogResult();
            var eventId = buttonData.EventID ?? string.Empty;
            callback.Invoke(eventId, ref buttonData, ref result);
            EventLog.Add("game", "dialog click invoked button=" + button + " event=" + eventId);
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dialog click: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string LoadLastSaveWithContext()
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            var context = new UnityEngine.InputSystem.InputAction.CallbackContext();
            module.OnLoadSaveShortcut(context);
            EventLog.Add("game", "OnLoadSaveShortcut(default context) called");
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "loadlast context: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static Bindings.Key? FindBindingKeyBySuffix(string suffix)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null || bindings.RootNode == null)
            {
                return null;
            }
            var node = bindings.RootNode;
            var found = FindKeyRecursive(bindings.RootNode, string.Empty, suffix, 0);
            return found;
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find key suffix: " + ex.Message);
            return null;
        }
    }

    private static Bindings.Key? FindKeyRecursive(IReadOnlyNode node, string path, string suffix, int depth)
    {
        if (node == null || depth > 24)
        {
            return null;
        }
        string name;
        try
        {
            name = node.Name ?? string.Empty;
        }
        catch
        {
            return null;
        }
        var nodePath = string.IsNullOrEmpty(path) ? name : path + "." + name;
        if (nodePath.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                return node.Key;
            }
            catch
            {
                return null;
            }
        }
        IReadOnlyNode child = null;
        try
        {
            child = node.FirstChild;
        }
        catch
        {
            return null;
        }
        var guard = 0;
        while (child != null && guard++ < 5000)
        {
            var result = FindKeyRecursive(child, nodePath, suffix, depth + 1);
            if (result != null)
            {
                return result;
            }
            try
            {
                child = child.NextSibling;
            }
            catch
            {
                return null;
            }
        }
        return null;
    }

    public static string StartLoadFromBinding(string suffix)
    {
        try
        {
            var module = FindLoadModule() as FM.UI.LoadGameHandlerModule;
            if (module == null)
            {
                return "{\"ok\":false,\"error\":\"LoadGameHandlerModule not found\"}";
            }
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var targetSuffix = string.IsNullOrEmpty(suffix) ? ".LastSave" : suffix;
            var keyOrNull = FindBindingKeyBySuffix(targetSuffix);
            if (keyOrNull == null)
            {
                return "{\"ok\":false,\"error\":\"binding not found: " + Json.Escape(targetSuffix) + "\"}";
            }
            var key = keyOrNull.Value;
            var value = bindings.Get(ref key);
            if (value == null)
            {
                return "{\"ok\":false,\"error\":\"binding value null\"}";
            }
            string tvText;
            try
            {
                tvText = Observe.DescribeTypedValuePublic(value);
            }
            catch
            {
                tvText = "?";
            }
            EventLog.Add("game", "startload tv=" + tvText + " key=" + key.m_key.ToString("x16"));
            object raw = null;
            try
            {
                raw = value.As<Il2CppSystem.Object>();
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "startload As<object>: " + ex.Message);
            }
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"typed value not object\",\"tv\":" + tvText + "}";
            }
            var dynamicReference = ((Il2CppObjectBase)raw).TryCast<SI.Bindable.DynamicReference>();
            if (dynamicReference == null)
            {
                return "{\"ok\":false,\"error\":\"not a DynamicReference\",\"type\":\"" + Json.Escape(Describe.TypeName(raw)) + "\",\"tv\":" + tvText + "}";
            }
            var record = dynamicReference.TryCast<SI.Core.Record>();
            if (record == null)
            {
                return "{\"ok\":false,\"error\":\"not a Record\"}";
            }
            module.StartLoadingSave(record);
            EventLog.Add("game", "StartLoadingSave called with binding-derived record");
            return "{\"ok\":true,\"tv\":" + tvText + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "startload: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string DialogInfo()
    {
        try
        {
            var manager = FindDialogManagerRobust();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"DialogManager not found\"}";
            }
            var pointer = Shared.PointerOf(manager);
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"ptr\":\"").Append(pointer).Append('"');
            try
            {
                var current = manager.CurrentDialog;
                sb.Append(",\"currentDialogPtr\":\"").Append(Shared.PointerOf(current)).Append('"');
                if (current != null)
                {
                    var data = current.Value;
                    if (data != null)
                    {
                        sb.Append(",\"title\":\"").Append(Json.Escape(data.Title ?? string.Empty)).Append('"');
                        sb.Append(",\"description\":\"").Append(Json.Escape(data.Description ?? string.Empty)).Append('"');
                        var primary = data.PrimaryButton;
                        if (primary != null)
                        {
                            sb.Append(",\"primaryText\":\"").Append(Json.Escape(primary.Text ?? string.Empty)).Append('"');
                            sb.Append(",\"primaryEvent\":\"").Append(Json.Escape(primary.EventID ?? string.Empty)).Append('"');
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                sb.Append(",\"error\":\"").Append(Json.Escape(ex.Message)).Append('"');
            }
            sb.Append('}');
            EventLog.Add("game", "dialog info " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dialog info: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static SI.Bindable.DialogManager FindDialogManagerRobust()
    {
        try
        {
            var instance = SI.Bindable.DialogManager.Instance;
            if (instance != null)
            {
                return instance;
            }
        }
        catch
        {
            // ignore
        }
        try
        {
            var klass = Il2CppClassPointerStore<SI.Bindable.DialogManager>.NativeClassPtr;
            var current = klass;
            for (var depth = 0; depth < 6 && current != IntPtr.Zero; depth++)
            {
                var iter = IntPtr.Zero;
                while (true)
                {
                    var field = IL2CPP.il2cpp_class_get_fields(current, ref iter);
                    if (field == IntPtr.Zero)
                    {
                        break;
                    }
                    var fieldName = IL2CPP.il2cpp_field_get_name_(field);
                    if (!string.IsNullOrEmpty(fieldName) && fieldName.IndexOf("instance", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        var objectPointer = IL2CPP.il2cpp_field_get_value_object(field, IntPtr.Zero);
                        if (objectPointer != IntPtr.Zero)
                        {
                            EventLog.Add("game", "DialogManager static field " + fieldName + " -> " + objectPointer.ToString("X"));
                            return Il2CppObjectPool.Get<SI.Bindable.DialogManager>(objectPointer);
                        }
                    }
                }
                current = IL2CPP.il2cpp_class_get_parent(current);
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dialog manager static scan: " + ex.Message);
        }
        return null;
    }

    public static string OpenTabPanel(string suffix)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var keyOrNull = FindBindingKeyBySuffix(suffix);
            if (keyOrNull == null)
            {
                return "{\"ok\":false,\"error\":\"binding not found: " + Json.Escape(suffix) + "\"}";
            }
            var key = keyOrNull.Value;
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"get: " + Json.Escape(ex.Message) + "\"}";
            }
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"value null\"}";
            }
            var typeName = Describe.TypeName(raw);
            var asset = ((Il2CppObjectBase)raw).TryCast<UnityEngine.AddressableAssets.AssetReferenceT<SI.Bindable.PanelID>>();
            if (asset == null)
            {
                try
                {
                    var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)raw);
                    if (pointer != IntPtr.Zero)
                    {
                        asset = Il2CppObjectPool.Get<UnityEngine.AddressableAssets.AssetReferenceT<SI.Bindable.PanelID>>(pointer);
                    }
                }
                catch (Exception ex)
                {
                    EventLog.Add("error", "opentab wrap: " + ex.Message);
                }
            }
            if (asset == null)
            {
                return "{\"ok\":false,\"error\":\"not an asset reference\",\"type\":\"" + Json.Escape(typeName) + "\"}";
            }
            var evt = new SI.Bindable.Events.OpenPanelEvent();
            evt.PanelID = asset;
            evt.CheckForExistingOpenedPanel = true;
            var subsystem = FindEventSubsystem();
            if (subsystem == null)
            {
                return "{\"ok\":false,\"error\":\"EventSubsystem not found\"}";
            }
            subsystem.SendEvent(evt);
            EventLog.Add("game", "OpenPanelEvent sent for " + suffix + " type=" + typeName);
            return "{\"ok\":true,\"suffix\":\"" + Json.Escape(suffix) + "\",\"type\":\"" + Json.Escape(typeName) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "open tab: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static SI.Bindable.PanelManager FindPanelManager()
    {
        try
        {
            return SI.Bindable.PanelManager.Instance;
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "PanelManager.Instance: " + ex.Message);
            return null;
        }
    }

    public static string PanelList()
    {
        try
        {
            var manager = FindPanelManager();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"PanelManager not found\"}";
            }
            var panels = manager.Panels;
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"count\":").Append(panels == null ? 0 : panels.Count).Append(",\"panels\":[");
            if (panels != null)
            {
                for (var i = 0; i < panels.Count; i++)
                {
                    var panel = panels[i];
                    if (panel == null)
                    {
                        continue;
                    }
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    string text;
                    try
                    {
                        text = panel.ToString();
                    }
                    catch
                    {
                        text = "?";
                    }
                    sb.Append("{\"i\":").Append(i)
                        .Append(",\"id\":").Append(panel.ID)
                        .Append(",\"text\":\"").Append(Json.Escape(text ?? string.Empty))
                        .Append("\",\"ptr\":\"").Append(Shared.PointerOf(panel)).Append("\"}");
                }
            }
            sb.Append("]}");
            EventLog.Add("game", "panel list " + sb.ToString().Substring(0, Math.Min(sb.Length, 6000)));
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "panel list: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string OpenPanelById(uint id)
    {
        try
        {
            var manager = FindPanelManager();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"PanelManager not found\"}";
            }
            var panels = manager.Panels;
            SI.Bindable.PanelID target = null;
            if (panels != null)
            {
                for (var i = 0; i < panels.Count; i++)
                {
                    var panel = panels[i];
                    if (panel != null && panel.ID == id)
                    {
                        target = panel;
                        break;
                    }
                }
            }
            if (target == null)
            {
                return "{\"ok\":false,\"error\":\"panel id not found\"}";
            }
            var opened = manager.Open(target, null, null);
            EventLog.Add("game", "PanelManager.Open id=" + id + " -> " + Shared.PointerOf(opened));
            return "{\"ok\":true,\"id\":" + id.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"panel\":\"" + Shared.PointerOf(opened) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "open panel: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }


    public static string ShowPanelBySuffix(string suffix)
    {
        try
        {
            var manager = FindPanelManager();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"PanelManager not found\"}";
            }
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var keyOrNull = FindBindingKeyBySuffix(suffix);
            if (keyOrNull == null)
            {
                return "{\"ok\":false,\"error\":\"binding not found: " + Json.Escape(suffix) + "\"}";
            }
            var key = keyOrNull.Value;
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"get: " + Json.Escape(ex.Message) + "\"}";
            }
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"value null\"}";
            }
            UnityEngine.AddressableAssets.AssetReferenceT<SI.Bindable.PanelID> asset = null;
            try
            {
                asset = ((Il2CppObjectBase)raw).TryCast<UnityEngine.AddressableAssets.AssetReferenceT<SI.Bindable.PanelID>>();
            }
            catch
            {
                // ignore
            }
            if (asset == null)
            {
                var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)raw);
                if (pointer != IntPtr.Zero)
                {
                    asset = Il2CppObjectPool.Get<UnityEngine.AddressableAssets.AssetReferenceT<SI.Bindable.PanelID>>(pointer);
                }
            }
            if (asset == null)
            {
                return "{\"ok\":false,\"error\":\"not asset reference\"}";
            }
            manager.Show(asset, null);
            EventLog.Add("game", "PanelManager.Show called for " + suffix);
            return "{\"ok\":true,\"suffix\":\"" + Json.Escape(suffix) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "show panel: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string PanelAssets()
    {
        try
        {
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<SI.Bindable.PanelID>());
            var sb = new System.Text.StringBuilder();
            var count = 0;
            sb.Append("{\"ok\":true,\"items\":[");
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    var panel = candidate?.TryCast<SI.Bindable.PanelID>();
                    if (panel == null)
                    {
                        continue;
                    }
                    string text;
                    try
                    {
                        text = panel.ToString();
                    }
                    catch
                    {
                        text = "?";
                    }
                    if (count > 0)
                    {
                        sb.Append(',');
                    }
                    sb.Append("{\"id\":").Append(panel.ID)
                        .Append(",\"text\":\"").Append(Json.Escape(text ?? string.Empty))
                        .Append("\",\"ptr\":\"").Append(Shared.PointerOf(panel)).Append("\"}");
                    count++;
                    if (count > 400)
                    {
                        break;
                    }
                }
            }
            sb.Append("],\"count\":").Append(count).Append('}');
            EventLog.Add("game", "panel assets " + sb.ToString().Substring(0, Math.Min(sb.Length, 8000)));
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "panel assets: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string OpenPanelAsset(uint id)
    {
        try
        {
            var manager = FindPanelManager();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"PanelManager not found\"}";
            }
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<SI.Bindable.PanelID>());
            SI.Bindable.PanelID target = null;
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    var panel = candidate?.TryCast<SI.Bindable.PanelID>();
                    if (panel != null && panel.ID == id)
                    {
                        target = panel;
                        break;
                    }
                }
            }
            if (target == null)
            {
                return "{\"ok\":false,\"error\":\"panel asset not found\"}";
            }
            var opened = manager.Open(target, null, null);
            EventLog.Add("game", "PanelManager.Open(asset id=" + id + ") -> " + Shared.PointerOf(opened));
            return "{\"ok\":true,\"id\":" + id.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"panel\":\"" + Shared.PointerOf(opened) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "open panel asset: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static SI.Bindable.PanelID FindPanelByName(string name)
    {
        var objects = UnityEngine.Resources.FindObjectsOfTypeAll(Il2CppType.Of<SI.Bindable.PanelID>());
        if (objects == null)
        {
            return null;
        }
        foreach (var candidate in objects)
        {
            var panel = candidate?.TryCast<SI.Bindable.PanelID>();
            if (panel == null)
            {
                continue;
            }
            try
            {
                if (string.Equals(panel.ToString(), name, StringComparison.OrdinalIgnoreCase))
                {
                    return panel;
                }
            }
            catch
            {
                // ignore
            }
        }
        return null;
    }

    public static string PanelParams(string name)
    {
        try
        {
            var panel = FindPanelByName(name);
            if (panel == null)
            {
                return "{\"ok\":false,\"error\":\"panel not found\"}";
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"id\":").Append(panel.ID);
            try
            {
                var description = panel.Description;
                if (description != null)
                {
                    sb.Append(",\"layer\":").Append((int)description.layer);
                    sb.Append(",\"params\":[");
                    var parameters = description.parameters;
                    if (parameters != null)
                    {
                        for (var i = 0; i < parameters.Length; i++)
                        {
                            if (i > 0)
                            {
                                sb.Append(',');
                            }
                            sb.Append('"').Append(Json.Escape(parameters[i] ?? string.Empty)).Append('"');
                        }
                    }
                    sb.Append(']');
                }
            }
            catch (Exception ex)
            {
                sb.Append(",\"descError\":\"").Append(Json.Escape(ex.Message)).Append('"');
            }
            sb.Append('}');
            EventLog.Add("game", "panel params " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "panel params: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string OpenPanelWithParams(string name)
    {
        try
        {
            var manager = FindPanelManager();
            if (manager == null)
            {
                return "{\"ok\":false,\"error\":\"PanelManager not found\"}";
            }
            var panel = FindPanelByName(name);
            if (panel == null)
            {
                return "{\"ok\":false,\"error\":\"panel not found\"}";
            }
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var description = panel.Description;
            var parameters = description == null ? null : description.parameters;
            var open = false;
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"args\":[");
            if (parameters != null)
            {
                for (var i = 0; i < parameters.Length; i++)
                {
                    var paramName = parameters[i];
                    if (string.IsNullOrEmpty(paramName))
                    {
                        continue;
                    }
                    var keyOrNull = FindBindingKeyBySuffix("." + paramName);
                    if (keyOrNull == null)
                    {
                        continue;
                    }
                    var key = keyOrNull.Value;
                    var value = bindings.Get(ref key);
                    if (value == null)
                    {
                        continue;
                    }
                    if (open)
                    {
                        sb.Append(',');
                    }
                    var text = "?";
                    try
                    {
                        text = Describe.TypeName(value.As<Il2CppSystem.Object>());
                    }
                    catch
                    {
                        // ignore
                    }
                    sb.Append("{\"name\":\"").Append(Json.Escape(paramName)).Append("\",\"type\":\"").Append(Json.Escape(text)).Append("\"}");
                    open = true;
                }
            }
            sb.Append("]}");
            EventLog.Add("game", "open panel args " + sb);
            if (!open)
            {
                return "{\"ok\":false,\"error\":\"no parameter bindings found\",\"args\":" + sb.ToString()[14..] + "}";
            }
            // open with first found parameter
            if (parameters != null)
            {
                for (var i = 0; i < parameters.Length; i++)
                {
                    var paramName = parameters[i];
                    if (string.IsNullOrEmpty(paramName))
                    {
                        continue;
                    }
                    var keyOrNull = FindBindingKeyBySuffix("." + paramName);
                    if (keyOrNull == null)
                    {
                        continue;
                    }
                    var key = keyOrNull.Value;
                    var value = bindings.Get(ref key);
                    if (value == null)
                    {
                        continue;
                    }
                    var opened = manager.Open(panel, paramName, value, null, null, default);
                    EventLog.Add("game", "Open with param " + paramName + " -> " + Shared.PointerOf(opened));
                    return "{\"ok\":true,\"param\":\"" + Json.Escape(paramName) + "\",\"panel\":\"" + Shared.PointerOf(opened) + "\"}";
                }
            }
            var fallback = manager.Open(panel, null, null);
            return "{\"ok\":true,\"fallback\":true,\"panel\":\"" + Shared.PointerOf(fallback) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "open panel params: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static Il2CppSystem.ReadOnlySpan<char> MakeSpan(string text)
    {
        text ??= string.Empty;
        var array = new Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppStructArray<char>(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            array[i] = text[i];
        }
        return new Il2CppSystem.ReadOnlySpan<char>(array);
    }

    private static string DescribeAny(object value)
    {
        if (value == null)
        {
            return "null";
        }
        try
        {
            if (value is SI.Core.TypedValue typed)
            {
                return Observe.DescribeTypedValuePublic(typed);
            }
            var text = "?";
            try
            {
                text = Describe.TypeName(value) + "@" + Shared.PointerOf(value);
            }
            catch
            {
                // ignore
            }
            return text;
        }
        catch (Exception ex)
        {
            return "err:" + ex.Message;
        }
    }

    public static string GetPath(string path)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var span = MakeSpan(path);
            var tv = bindings.Get(span);
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(MakeSpan(path));
            }
            catch
            {
                // ignore
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"path\":\"").Append(Json.Escape(path)).Append("\",\"tv\":");
            sb.Append(tv == null ? "null" : Observe.DescribeTypedValuePublic(tv));
            sb.Append(",\"raw\":\"").Append(Json.Escape(DescribeAny(raw))).Append('"');
            EventLog.Add("game", "getpath " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "getpath " + path + ": " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string GetRelative(string rootHex, string relativePath)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var rootKey = new SI.Bindable.Bindings.Key(Convert.ToUInt64(rootHex, 16));
            var relative = MakeSpan(relativePath);
            var tv = bindings.Get(ref rootKey, ref relative);
            object raw = null;
            try
            {
                var rootKey2 = new SI.Bindable.Bindings.Key(Convert.ToUInt64(rootHex, 16));
                var relative2 = MakeSpan(relativePath);
                raw = bindings.Get<Il2CppSystem.Object>(ref rootKey2, ref relative2);
            }
            catch
            {
                // ignore
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"root\":\"").Append(rootHex).Append("\",\"path\":\"").Append(Json.Escape(relativePath)).Append("\",\"tv\":");
            sb.Append(tv == null ? "null" : Observe.DescribeTypedValuePublic(tv));
            sb.Append(",\"raw\":\"").Append(Json.Escape(DescribeAny(raw))).Append('"');
            EventLog.Add("game", "getrel " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "getrel " + relativePath + ": " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string MakeKeyForPath(string path)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var span = MakeSpan(path);
            var key = bindings.Create(ref span, default);
            return "{\"ok\":true,\"path\":\"" + Json.Escape(path) + "\",\"key\":\"" + key.m_key.ToString("x16") + "\"}";
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static SI.Bindable.Bindings.ValueChangedCallback s_bindCallback;

    private static void OnBindChanged(SI.Bindable.Bindings.Key key, SI.Core.TypedValue value)
    {
        EventLog.Add("game", "bind callback key=" + key.m_key.ToString("x16") + " value=" + (value == null ? "null" : "tv"));
    }

    public static string RefInspect(string keyHex)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var key = new SI.Bindable.Bindings.Key(Convert.ToUInt64(keyHex, 16));
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"get: " + Json.Escape(ex.Message) + "\"}";
            }
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"value null\"}";
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"type\":\"").Append(Json.Escape(Describe.TypeName(raw))).Append('"');
            var reference = ((Il2CppObjectBase)raw).TryCast<SI.Interop.InteropReference>();
            if (reference == null)
            {
                sb.Append(",\"note\":\"not InteropReference\"}");
                return sb.ToString();
            }
            try
            {
                sb.Append(",\"identity\":\"").Append(Json.Escape(reference.GetPersistentIdentity() ?? string.Empty)).Append('"');
            }
            catch
            {
                // ignore
            }
            try
            {
                var properties = new Il2CppSystem.Collections.Generic.List<SI.Bindable.Reference.Core.PropertyID>();
                reference.GetProperties(properties);
                sb.Append(",\"properties\":[");
                for (var i = 0; i < properties.Count && i < 120; i++)
                {
                    var property = properties[i];
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    var name = "?";
                    try
                    {
                        name = property.ToString();
                    }
                    catch
                    {
                        // ignore
                    }
                    var hasValue = false;
                    var value = 0;
                    try
                    {
                        hasValue = reference.TryGetProperty(property.id, out value);
                    }
                    catch
                    {
                        // ignore
                    }
                    sb.Append("{\"id\":").Append(property.id)
                        .Append(",\"name\":\"").Append(Json.Escape(name ?? string.Empty))
                        .Append("\",\"has\":").Append(hasValue ? "true" : "false")
                        .Append(",\"value\":").Append(value).Append('}');
                }
                sb.Append(']');
            }
            catch (Exception ex)
            {
                sb.Append(",\"propsError\":\"").Append(Json.Escape(ex.Message)).Append('"');
            }
            sb.Append('}');
            EventLog.Add("game", "ref inspect " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "ref inspect: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string BindOpen(string rootHex, string relativePath)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var root = new SI.Bindable.Bindings.Key(Convert.ToUInt64(rootHex, 16));
            var path = MakeSpan(relativePath);
            if (s_bindCallback == null)
            {
                s_bindCallback = Il2CppInterop.Runtime.DelegateSupport.ConvertDelegate<SI.Bindable.Bindings.ValueChangedCallback>(
                    new Action<SI.Bindable.Bindings.Key, SI.Core.TypedValue>(OnBindChanged));
            }
            var owner = ((Il2CppObjectBase)bindings).TryCast<Il2CppSystem.Object>();
            var newKey = bindings.Bind(ref root, ref path, owner, s_bindCallback);
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref newKey);
            }
            catch
            {
                // ignore
            }
            var tv = bindings.Get(ref newKey);
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"key\":\"").Append(newKey.m_key.ToString("x16"))
                .Append("\",\"tv\":").Append(tv == null ? "null" : Observe.DescribeTypedValuePublic(tv))
                .Append(",\"raw\":\"").Append(Json.Escape(DescribeAny(raw))).Append('"');
            EventLog.Add("game", "bindopen " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "bindopen " + relativePath + ": " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string FireNativeRole(string tacticKeyHex, int selectionIndex, bool inPossession, string roleKeyHex)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var tacticKey = new SI.Bindable.Bindings.Key(Convert.ToUInt64(tacticKeyHex, 16));
            var tacticRaw = bindings.Get<Il2CppSystem.Object>(ref tacticKey);
            if (tacticRaw == null)
            {
                return "{\"ok\":false,\"error\":\"tactic value null\"}";
            }
            var tacticRef = ((Il2CppObjectBase)tacticRaw).TryCast<SI.Interop.InteropReference>();
            if (tacticRef == null)
            {
                return "{\"ok\":false,\"error\":\"tactic is not InteropReference: " + Json.Escape(Describe.TypeName(tacticRaw)) + "\"}";
            }
            var roleKey = new SI.Bindable.Bindings.Key(Convert.ToUInt64(roleKeyHex, 16));
            var roleTv = bindings.Get(ref roleKey);
            if (roleTv == null)
            {
                return "{\"ok\":false,\"error\":\"role value null\"}";
            }
            object roleRaw = null;
            try
            {
                roleRaw = bindings.Get<Il2CppSystem.Object>(ref roleKey);
            }
            catch
            {
                // ignore
            }
            var record = new SI.Core.Record();
            record.InsertOrAssign<SI.Core.TypedValue>(0x54536978u, SI.Core.TypedValue.Create(selectionIndex));
            record.InsertOrAssign<SI.Core.TypedValue>(0x506f736au, SI.Core.TypedValue.Create<object>(roleRaw ?? (object)roleTv));
            record.InsertOrAssign<SI.Core.TypedValue>(0x4b727553u, SI.Core.TypedValue.Create(inPossession));
            var recordValue = MakeObjectTypedValue(record);
            var interop = FindInterop() as FM.GamePlugin.GameInteropSubsystem;
            if (interop == null)
            {
                return "{\"ok\":false,\"error\":\"GameInteropSubsystem not found\"}";
            }
            interop.SendEvent(0x57785256u, tacticRef, recordValue);
            EventLog.Add("game", "native role event sent tactic=" + tacticKeyHex + " role=" + roleKeyHex + " sel=" + selectionIndex + " inPoss=" + inPossession);
            return "{\"ok\":true,\"roleRaw\":\"" + Json.Escape(DescribeAny(roleRaw)) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "native role: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string RefCreate(string typeName, string pairsText)
    {
        try
        {
            var pairs = new Il2CppSystem.Collections.Generic.List<SI.Interop.InteropReference.Pair>();
            if (!string.IsNullOrEmpty(pairsText))
            {
                foreach (var item in pairsText.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var parts = item.Split(':');
                    if (parts.Length != 2)
                    {
                        continue;
                    }
                    pairs.Add(new SI.Interop.InteropReference.Pair(uint.Parse(parts[0]), int.Parse(parts[1])));
                }
            }
            SI.Interop.InteropReference reference = null;
            switch (typeName)
            {
                case "Tactic":
                    reference = new FM.UI.TacticReference(pairs);
                    break;
                case "Team":
                    reference = new FM.UI.TeamReference(pairs);
                    break;
                case "Person":
                    reference = new FM.UI.PersonReference(pairs);
                    break;
                default:
                    return "{\"ok\":false,\"error\":\"unsupported type " + Json.Escape(typeName) + "\"}";
            }
            var identity = "?";
            try
            {
                identity = reference.GetPersistentIdentity();
            }
            catch
            {
                // ignore
            }
            var typeResult = Describe.TypeName(reference);
            EventLog.Add("game", "ref create " + typeName + " type=" + typeResult + " identity=" + identity);
            return "{\"ok\":true,\"type\":\"" + Json.Escape(typeResult) + "\",\"identity\":\"" + Json.Escape(identity ?? string.Empty) + "\",\"ptr\":\"" + Shared.PointerOf(reference) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "ref create: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string RefFireOnTactic(string tacticKeyHex, int eventId)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var key = new SI.Bindable.Bindings.Key(Convert.ToUInt64(tacticKeyHex, 16));
            var raw = bindings.Get<Il2CppSystem.Object>(ref key);
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"null\"}";
            }
            var reference = ((Il2CppObjectBase)raw).TryCast<SI.Interop.InteropReference>();
            if (reference == null)
            {
                return "{\"ok\":false,\"error\":\"not InteropReference\"}";
            }
            EventLog.Add("game", "tactic ref type=" + Describe.TypeName(reference) + " identity=" + reference.GetPersistentIdentity());
            return "{\"ok\":true,\"identity\":\"" + Json.Escape(reference.GetPersistentIdentity() ?? string.Empty) + "\",\"type\":\"" + Json.Escape(Describe.TypeName(reference)) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "ref fire: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static object s_probeElement;

    public static string RefProbe(string keyHex)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var key = new SI.Bindable.Bindings.Key(Convert.ToUInt64(keyHex, 16));
            var raw = bindings.Get<Il2CppSystem.Object>(ref key);
            if (raw == null)
            {
                return "{\"ok\":false,\"error\":\"value null\"}";
            }
            var reference = ((Il2CppObjectBase)raw).TryCast<SI.Bindable.Reference.Core.IDataReference>();
            if (reference == null)
            {
                return "{\"ok\":false,\"error\":\"not IDataReference: " + Json.Escape(Describe.TypeName(raw)) + "\"}";
            }
            var element = new SI.Bindable.DataReferenceElement();
            element.SetTarget(reference);
            element.BindToData();
            s_probeElement = element;
            var elementKey = element.Key;
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"elementKey\":\"").Append(elementKey.m_key.ToString("x16")).Append("\",\"props\":[");
            var node = bindings.GetNode(ref elementKey);
            var count = 0;
            if (node != null)
            {
                var child = node.FirstChild;
                var guard = 0;
                while (child != null && guard++ < 400)
                {
                    string name = string.Empty;
                    try { name = child.Name ?? string.Empty; } catch { }
                    var childKey = child.Key;
                    var tv = bindings.Get(ref childKey);
                    object childRaw = null;
                    try { childRaw = bindings.Get<Il2CppSystem.Object>(ref childKey); } catch { }
                    if (count > 0) { sb.Append(','); }
                    sb.Append("{\"name\":\"").Append(Json.Escape(name))
                        .Append("\",\"key\":\"").Append(childKey.m_key.ToString("x16"))
                        .Append("\",\"tv\":").Append(tv == null ? "null" : Observe.DescribeTypedValuePublic(tv))
                        .Append(",\"raw\":\"").Append(Json.Escape(DescribeAny(childRaw))).Append("\"}");
                    count++;
                    try { child = child.NextSibling; } catch { break; }
                }
            }
            sb.Append("],\"count\":").Append(count).Append('}');
            EventLog.Add("game", "ref probe " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "ref probe: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static SI.Interop.InteropReference CreatedReference;

    public static string SelectRole2(string pairsText, int selectionIndex, bool inPossession, int roleId, int dataMode)
    {
        try
        {
            var pairs = new Il2CppSystem.Collections.Generic.List<SI.Interop.InteropReference.Pair>();
            foreach (var item in (pairsText ?? string.Empty).Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = item.Split(':');
                if (parts.Length != 2)
                {
                    continue;
                }
                pairs.Add(new SI.Interop.InteropReference.Pair(uint.Parse(parts[0]), int.Parse(parts[1])));
            }
            var tactic = new FM.UI.TacticReference(pairs);
            CreatedReference = tactic;
            var record = new SI.Core.Record();
            record.InsertOrAssign<SI.Core.TypedValue>(0x54536978u, SI.Core.TypedValue.Create(selectionIndex));
            SI.Core.TypedValue dataValue;
            if (dataMode == 0)
            {
                dataValue = SI.Core.TypedValue.Create(roleId);
            }
            else if (dataMode == 1)
            {
                var dataRecord = new SI.Core.Record();
                dataRecord.InsertOrAssign<SI.Core.TypedValue>(0x526f7744u, SI.Core.TypedValue.Create(1));
                dataRecord.InsertOrAssign<SI.Core.TypedValue>(0x7074766cu, SI.Core.TypedValue.Create(roleId));
                dataValue = MakeObjectTypedValue(dataRecord);
            }
            else
            {
                dataValue = SI.Core.TypedValue.Create(roleId);
            }
            record.InsertOrAssign<SI.Core.TypedValue>(0x506f736au, dataValue);
            record.InsertOrAssign<SI.Core.TypedValue>(0x4b727553u, SI.Core.TypedValue.Create(inPossession));
            var recordValue = MakeObjectTypedValue(record);
            var interop = FindInterop() as FM.GamePlugin.GameInteropSubsystem;
            if (interop == null)
            {
                return "{\"ok\":false,\"error\":\"GameInteropSubsystem not found\"}";
            }
            interop.SendEvent(0x57785256u, tactic, recordValue);
            EventLog.Add("game", "SelectRole2 sent sel=" + selectionIndex + " inp=" + inPossession + " roleId=" + roleId + " dataMode=" + dataMode + " pairs=" + pairsText);
            return "{\"ok\":true,\"sel\":" + selectionIndex + ",\"roleId\":" + roleId + ",\"dataMode\":" + dataMode + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "SelectRole2: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static SI.Core.TypedValue MakeObjectTypedValue(object value)
    {
        var baseValue = (Il2CppObjectBase)value;
        try
        {
            return SI.Core.TypedValue.Create<Il2CppSystem.Object>(baseValue.TryCast<Il2CppSystem.Object>());
        }
        catch (Exception ex)
        {
            EventLog.Add("game", "Create<object> failed, fallback: " + ex.Message);
        }
        var referenceValue = SI.Core.TypedValue.GetReferenceTypedValue();
        referenceValue.SetValue(baseValue.TryCast<Il2CppSystem.Object>());
        return referenceValue;
    }

    public static string SelectRole3(string pairsText, int selectionIndex, bool inPossession, int roleId, int objectMode)
    {
        try
        {
            SI.Interop.InteropReference objectTo = null;
            if (objectMode == 1)
            {
                var pairs = new Il2CppSystem.Collections.Generic.List<SI.Interop.InteropReference.Pair>();
                foreach (var item in (pairsText ?? string.Empty).Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var parts = item.Split(':');
                    if (parts.Length == 2)
                    {
                        pairs.Add(new SI.Interop.InteropReference.Pair(uint.Parse(parts[0]), int.Parse(parts[1])));
                    }
                }
                objectTo = new FM.UI.TacticReference(pairs);
            }
            else if (objectMode == 2)
            {
                var pairs = new Il2CppSystem.Collections.Generic.List<SI.Interop.InteropReference.Pair>();
                pairs.Add(new SI.Interop.InteropReference.Pair(0x64726566u, 402677836));
                pairs.Add(new SI.Interop.InteropReference.Pair(0x626c656eu, 1));
                objectTo = new FM.UI.TacticReference(pairs);
            }
            var inner = new SI.Core.Record();
            inner.InsertOrAssign<SI.Core.TypedValue>(0x506f736au, SI.Core.TypedValue.Create(roleId));
            var middle = new SI.Core.Record();
            middle.InsertOrAssign<SI.Core.TypedValue>(0x71764a36u, MakeObjectTypedValue(inner));
            var outer = new SI.Core.Record();
            outer.InsertOrAssign<SI.Core.TypedValue>(0x54536978u, SI.Core.TypedValue.Create(selectionIndex));
            outer.InsertOrAssign<SI.Core.TypedValue>(0x506f736au, MakeObjectTypedValue(middle));
            outer.InsertOrAssign<SI.Core.TypedValue>(0x4b727553u, SI.Core.TypedValue.Create(inPossession));
            var recordValue = MakeObjectTypedValue(outer);
            var interop = FindInterop() as FM.GamePlugin.GameInteropSubsystem;
            if (interop == null)
            {
                return "{\"ok\":false,\"error\":\"GameInteropSubsystem not found\"}";
            }
            interop.SendEvent(0x57785256u, objectTo, recordValue);
            EventLog.Add("game", "SelectRole3 sent sel=" + selectionIndex + " inp=" + inPossession + " roleId=" + roleId + " objectMode=" + objectMode + " objectTo=" + Shared.PointerOf(objectTo));
            return "{\"ok\":true,\"sel\":" + selectionIndex + ",\"roleId\":" + roleId + ",\"objectMode\":" + objectMode + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "SelectRole3: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }
}
