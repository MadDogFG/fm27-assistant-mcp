using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.Runtime;
using SI.Bindable;
using SI.Core;
using UnityEngine.UIElements;

namespace FMAssistant;

/// <summary>
/// 战术界面官方写操作：通过 FMPitchIndicator 缓存绑定键 + 官方事件构造 RoleOptionEvent / FormationOptionEvent。
/// 依据（反编译）：FMPitchIndicator.SendRoleOptionDropdownEvent case ChooseRole：
///   evt.Tactic        = bindings.Get(ref m_tacticKey)              (this+0x320)
///   evt.InPossession  = TypedValue.Create(bindings.Get(ref key))   (this+0x330)
///   evt.SelectionIndex= TypedValue.Create(bindings.Get(ref key))   (this+0x328)
///   evt.PositionMask  = TypedValue.Create(0)
///   evt.Person        = null
///   evt.Data          = TypedValue.Create<object>(reference)
///   EventSubsystem.SendEvent(evt)
/// 且 TacticRoleHandlerModule 收到后调用 GameInteropSubsystem.SendEvent(0x57785256, Tactic, Record{0x54536978:SelectionIndex, 0x506f736a:Data, 0x4b727553:InPossession})
/// </summary>
public static class TacticTools
{
    public const int OffTacticKey = 0x320;
    public const int OffSelectionIndexKey = 0x328;
    public const int OffInPossessionKey = 0x330;
    public const int OffIsDuringMatchKey = 0x338;
    public const int OffPlayerRoleOptionsKey = 0x348;

    public const uint NativeRoleEventId = 0x57785256u;
    public const uint KeySelectionIndex = 0x54536978u;
    public const uint KeyRoleData = 0x506f736au;
    public const uint KeyInPossession = 0x4b727553u;

    private static readonly List<VisualElement> Cache = new();

    private static ulong ReadU64(VisualElement element, int offset)
    {
        var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)element);
        if (pointer == IntPtr.Zero)
        {
            return 0;
        }
        return (ulong)Marshal.ReadInt64(IntPtr.Add(pointer, offset));
    }

    private static void Collect(VisualElement element, List<VisualElement> found, int depth)
    {
        if (element == null || depth > 80 || found.Count > 60)
        {
            return;
        }
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)element);
            if (pointer != IntPtr.Zero)
            {
                var klass = IL2CPP.il2cpp_object_get_class(pointer);
                if (klass != IntPtr.Zero)
                {
                    var className = IL2CPP.il2cpp_class_get_name_(klass);
                    if (className == "FMPitchIndicator")
                    {
                        found.Add(element);
                    }
                }
            }
        }
        catch
        {
            // ignore
        }
        int count;
        try
        {
            count = element.childCount;
        }
        catch
        {
            return;
        }
        for (var i = 0; i < count; i++)
        {
            VisualElement child = null;
            try
            {
                child = element.ElementAt(i);
            }
            catch
            {
                // ignore
            }
            if (child != null)
            {
                Collect(child, found, depth + 1);
            }
        }
    }

    private static T CastObj<T>(object value) where T : Il2CppObjectBase
    {
        if (value == null)
        {
            return null;
        }
        return ((Il2CppObjectBase)value).TryCast<T>();
    }

    public static List<VisualElement> FindPitchIndicators()
    {
        Cache.Clear();
        var roots = new List<VisualElement>();
        try
        {
            foreach (var root in UiTools.Roots)
            {
                if (root != null)
                {
                    roots.Add(root);
                }
            }
        }
        catch
        {
            // ignore
        }
        try
        {
            var documents = UnityEngine.Object.FindObjectsOfTypeAll(Il2CppType.Of<UnityEngine.UIElements.UIDocument>());
            if (documents != null)
            {
                foreach (var document in documents)
                {
                    var doc = document?.TryCast<UnityEngine.UIElements.UIDocument>();
                    if (doc?.rootVisualElement != null)
                    {
                        roots.Add(doc.rootVisualElement);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find uidocuments: " + ex.Message);
        }
        foreach (var root in roots)
        {
            Collect(root, Cache, 0);
        }
        return Cache;
    }

    private static string KeyText(Bindings bindings, ulong keyValue)
    {
        try
        {
            if (keyValue == 0)
            {
                return "null";
            }
            var key = new Bindings.Key(keyValue);
            var value = bindings.Get(ref key);
            var text = value == null ? "null" : Observe.DescribeTypedValuePublic(value);
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch
            {
                // ignore
            }
            var rawText = raw == null ? "null" : (Describe.TypeName(raw) + "@" + Shared.PointerOf(raw));
            return "{\"tv\":" + text + ",\"raw\":\"" + Json.Escape(rawText) + "\"}";
        }
        catch (Exception ex)
        {
            return "{\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string Info()
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var pitches = FindPitchIndicators();
            var sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"count\":").Append(pitches.Count).Append(",\"items\":[");
            for (var i = 0; i < pitches.Count; i++)
            {
                var pitch = pitches[i];
                if (i > 0)
                {
                    sb.Append(',');
                }
                var tacticKey = ReadU64(pitch, OffTacticKey);
                var selectionKey = ReadU64(pitch, OffSelectionIndexKey);
                var inPossessionKey = ReadU64(pitch, OffInPossessionKey);
                var duringMatchKey = ReadU64(pitch, OffIsDuringMatchKey);
                var roleOptionsKey = ReadU64(pitch, OffPlayerRoleOptionsKey);
                sb.Append("{\"index\":").Append(i)
                    .Append(",\"ptr\":\"").Append(Shared.PointerOf(pitch))
                    .Append("\",\"name\":\"").Append(Json.Escape(SafeName(pitch)))
                    .Append("\",\"tacticKey\":\"").Append(tacticKey.ToString("x16"))
                    .Append("\",\"tactic\":").Append(KeyText(bindings, tacticKey))
                    .Append(",\"selectionIndexKey\":\"").Append(selectionKey.ToString("x16"))
                    .Append("\",\"selectionIndex\":").Append(KeyText(bindings, selectionKey))
                    .Append(",\"inPossessionKey\":\"").Append(inPossessionKey.ToString("x16"))
                    .Append("\",\"inPossession\":").Append(KeyText(bindings, inPossessionKey))
                    .Append(",\"isDuringMatchKey\":\"").Append(duringMatchKey.ToString("x16"))
                    .Append("\",\"roleOptionsKey\":\"").Append(roleOptionsKey.ToString("x16"))
                    .Append("\",\"roleOptions\":").Append(KeyText(bindings, roleOptionsKey))
                    .Append('}');
            }
            sb.Append("]}");
            EventLog.Add("game", "tactic info " + sb.ToString().Substring(0, Math.Min(sb.Length, 4000)));
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "tactic info: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static string SafeName(VisualElement element)
    {
        try
        {
            return element.name ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static object ResolveRoleReference(object roleOptionsValue, int index)
    {
        if (roleOptionsValue == null)
        {
            return null;
        }
        var list = CastObj<Il2CppSystem.Collections.Generic.List<SI.Core.TypedValue>>(roleOptionsValue);
        if (list != null)
        {
            if (index < 0 || index >= list.Count)
            {
                return null;
            }
            var value = list[index];
            var obj = value.As<Il2CppSystem.Object>();
            return obj.TryCast<SI.Bindable.DynamicReference>();
        }
        var objectList = CastObj<Il2CppSystem.Collections.Generic.List<Il2CppSystem.Object>>(roleOptionsValue);
        if (objectList != null)
        {
            if (index < 0 || index >= objectList.Count)
            {
                return null;
            }
            return objectList[index].TryCast<SI.Bindable.DynamicReference>();
        }
        var direct = CastObj<SI.Bindable.DynamicReference>(roleOptionsValue);
        if (direct != null && index == 0)
        {
            return direct;
        }
        return null;
    }

    public static string SetRole(int roleIndex)
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var pitches = FindPitchIndicators();
            if (pitches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no FMPitchIndicator found\"}";
            }
            var pitch = pitches[0];
            var roleOptionsKey = ReadU64(pitch, OffPlayerRoleOptionsKey);
            if (roleOptionsKey == 0)
            {
                return "{\"ok\":false,\"error\":\"role options key is 0\"}";
            }
            var key = new Bindings.Key(roleOptionsKey);
            object roleOptions = null;
            try
            {
                roleOptions = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "get role options: " + ex.Message);
            }
            EventLog.Add("game", "role options raw: " + (roleOptions == null ? "null" : Describe.TypeName(roleOptions) + "@" + Shared.PointerOf(roleOptions) + " " + Describe.Object(roleOptions, 8)));
            var reference = ResolveRoleReference(roleOptions, roleIndex);
            if (reference == null)
            {
                return "{\"ok\":false,\"error\":\"role reference not resolved at index " + roleIndex + "\"}";
            }
            var dynamicReference = CastObj<SI.Bindable.DynamicReference>(reference);
            var method = typeof(FM.UI.FMPitchIndicator).GetMethod("SendRoleOptionDropdownEvent", BindingFlags.NonPublic | BindingFlags.Instance);
            if (method == null)
            {
                return "{\"ok\":false,\"error\":\"method not found\"}";
            }
            var keyArg = default(Bindings.Key);
            var eventType = (FM.UI.RoleDropdownOption)1;
            method.Invoke(pitch, new object[] { keyArg, eventType, dynamicReference });
            EventLog.Add("game", "SendRoleOptionDropdownEvent invoked index=" + roleIndex + " ref=" + Shared.PointerOf(dynamicReference));
            return "{\"ok\":true,\"index\":" + roleIndex + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "set role: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string DumpRoleOptions()
    {
        try
        {
            var bindings = BindingTools.GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var pitches = FindPitchIndicators();
            if (pitches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no FMPitchIndicator found\"}";
            }
            var roleOptionsKey = ReadU64(pitches[0], OffPlayerRoleOptionsKey);
            if (roleOptionsKey == 0)
            {
                return "{\"ok\":false,\"error\":\"role options key is 0\"}";
            }
            var key = new Bindings.Key(roleOptionsKey);
            var sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"key\":\"").Append(roleOptionsKey.ToString("x16")).Append('"');
            object raw = null;
            try
            {
                raw = bindings.Get<Il2CppSystem.Object>(ref key);
            }
            catch (Exception ex)
            {
                sb.Append(",\"getError\":\"").Append(Json.Escape(ex.Message)).Append('"');
            }
            if (raw != null)
            {
                sb.Append(",\"type\":\"").Append(Json.Escape(Describe.TypeName(raw))).Append('"');
                sb.Append(",\"ptr\":\"").Append(Shared.PointerOf(raw)).Append('"');
                sb.Append(",\"detail\":\"").Append(Json.Escape(Describe.Object(raw, 20))).Append('"');
                var list = CastObj<Il2CppSystem.Collections.Generic.List<SI.Core.TypedValue>>(raw);
                if (list != null)
                {
                    sb.Append(",\"count\":").Append(list.Count).Append(",\"items\":[");
                    for (var i = 0; i < list.Count && i < 40; i++)
                    {
                        if (i > 0)
                        {
                            sb.Append(',');
                        }
                        var item = list[i];
                        object obj = null;
                        try
                        {
                            obj = item.As<Il2CppSystem.Object>();
                        }
                        catch
                        {
                            // ignore
                        }
                        sb.Append("{\"i\":").Append(i)
                            .Append(",\"tv\":").Append(item == null ? "null" : Observe.DescribeTypedValuePublic(item))
                            .Append(",\"obj\":\"").Append(obj == null ? "null" : Json.Escape(Describe.TypeName(obj) + "@" + Shared.PointerOf(obj)))
                            .Append("\",\"detail\":\"").Append(obj == null ? string.Empty : Json.Escape(Describe.Object(obj, 10))).Append("\"}");
                    }
                    sb.Append(']');
                }
            }
            sb.Append('}');
            EventLog.Add("game", "role options dump " + sb);
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dump role options: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string BindPitchData(int index)
    {
        try
        {
            var pitches = FindPitchIndicators();
            if (pitches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no pitch indicators\"}";
            }
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"ok\":true,\"bound\":[");
            var count = 0;
            var from = index < 0 ? 0 : index;
            var to = index < 0 ? pitches.Count : Math.Min(pitches.Count, index + 1);
            for (var i = from; i < to; i++)
            {
                var element = pitches[i];
                try
                {
                    var pitch = CastObj<FM.UI.FMPitchIndicator>(element);
                    if (pitch == null)
                    {
                        throw new Exception("not FMPitchIndicator wrapper");
                    }
                    var bindMethod = typeof(FM.UI.FMPitchIndicator).GetMethod("BindToData");
                    if (bindMethod == null)
                    {
                        foreach (var iface in typeof(FM.UI.FMPitchIndicator).GetInterfaces())
                        {
                            bindMethod = iface.GetMethod("BindToData");
                            if (bindMethod != null) { break; }
                        }
                    }
                    if (bindMethod == null)
                    {
                        throw new Exception("BindToData not found");
                    }
                    bindMethod.Invoke(pitch, null);
                    if (count > 0) { sb.Append(','); }
                    sb.Append("{\"i\":").Append(i).Append(",\"name\":\"").Append(Json.Escape(SafeName(element))).Append("\"}");
                    count++;
                }
                catch (Exception ex)
                {
                    if (count > 0) { sb.Append(','); }
                    sb.Append("{\"i\":").Append(i).Append(",\"error\":\"").Append(Json.Escape(ex.Message)).Append("\"}");
                }
            }
            sb.Append("],\"count\":").Append(count).Append('}');
            EventLog.Add("game", "pitch binddata " + sb.ToString().Substring(0, Math.Min(sb.Length, 3000)));
            return sb.ToString();
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "pitch binddata: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }
}
