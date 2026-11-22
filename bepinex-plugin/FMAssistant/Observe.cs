using System;
using System.Collections.Generic;
using System.Text;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.Runtime;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

/// <summary>
/// 只读观察层：记录游戏自己的官方事件（SI 事件总线 + 插件互操作事件），
/// 不做任何注入，仅用于搞清官方参数编码，供后续通过官方 API 操作。
/// </summary>
public static class Observe
{
    public static volatile bool Enabled = true;
    public static volatile bool Deep;
    public static volatile bool BindingsEnabled;

    private sealed class Entry
    {
        public long Seq;
        public string Time;
        public string Kind;
        public string Type;
        public string Json;
    }

    private static readonly List<Entry> Items = new();
    private static long _seq;
    private static string _lastType;
    private static long _lastTicks;

    public static void SiEventDeep(object evt)
    {
        SiEventInternal(evt, true);
    }

    public static void SiEvent(object evt)
    {
        SiEventInternal(evt, false);
    }

    private static void SiEventInternal(object evt, bool forceDeep)
    {
        if (!Enabled || evt == null)
        {
            return;
        }
        try
        {
            var type = evt.GetType().Name;
            if (!Interesting(type))
            {
                return;
            }
            var now = System.DateTime.UtcNow.Ticks;
            if (type == _lastType && now - _lastTicks < 30 * System.TimeSpan.TicksPerMillisecond)
            {
                return;
            }
            _lastType = type;
            _lastTicks = now;
            if (!forceDeep && (!Deep || !DeepInteresting(type)))
            {
                Add("si", type, "{\"shallow\":true}");
                return;
            }
            Add("si", type, FormatEvent(evt));
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "observe si: " + ex.Message);
        }
    }

    public static void InteropEvent(uint id, InteropReference target, TypedValue data)
    {
        if (!Enabled)
        {
            return;
        }
        try
        {
            var name = InteropNames.NameOf(id);
            if (Deep && id == 2003194700u)
            {
                var record = NegotiationActions.Record(data);
                var players = (record != null && record.TryGetValue(0x6472654cu, out var targets) ? targets : null)
                    ?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
                var start = record != null && record.TryGetValue(0x70737766u, out var flag) ? flag?.AsString() : null;
                var first = players != null && players.Count > 0 ? NegotiationActions.Record(players[0]) : null;
                Add("interop", "WeakerFootTraining", LiveTools.JsonText(new { eventId = id, start,
                    playerCount = players?.Count, firstIsReferenceRecord = first != null && first.TryGetValue(0x64726566u, out _) }));
                return;
            }
            if (!Deep || !DeepInteresting(name))
            {
                Add("interop", name, "{\"eventId\":" + id + ",\"shallow\":true}");
                return;
            }
            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"eventId\":").Append(id);
            sb.Append(",\"name\":\"").Append(Json.Escape(name)).Append('"');
            sb.Append(",\"target\":").Append(RefText(target));
            sb.Append(",\"data\":").Append(TvText(data));
            sb.Append('}');
            Add("interop", name, sb.ToString());
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "observe interop: " + ex.Message);
        }
    }

    private static bool DeepInteresting(string type)
    {
        return type.IndexOf("RoleOption", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("FormationOption", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("ModifyTactic", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("TacticTeamSelection", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("TeamSelection", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("PlayerInstruction", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("TeamInstruction", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("QuickChangeTactic", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Mentality", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("SetTacticSlot", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool Interesting(string type)
    {
        return type.IndexOf("Tactic", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Formation", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Role", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("TeamSelection", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Instruction", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Save", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Load", StringComparison.OrdinalIgnoreCase) >= 0
            || type.IndexOf("Match", StringComparison.OrdinalIgnoreCase) >= 0
        || type.IndexOf("Dropdown", StringComparison.OrdinalIgnoreCase) >= 0
        || type.IndexOf("Select", StringComparison.OrdinalIgnoreCase) >= 0
        || type.IndexOf("Binding", StringComparison.OrdinalIgnoreCase) >= 0
        || type.IndexOf("Change", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static void Add(string kind, string type, string json)
    {
        lock (Items)
        {
            _seq++;
            Items.Add(new Entry
            {
                Seq = _seq,
                Time = System.DateTime.Now.ToString("HH:mm:ss.fff"),
                Kind = kind,
                Type = type,
                Json = json
            });
            if (Items.Count > 600)
            {
                Items.RemoveRange(0, Items.Count - 600);
            }
        }
    }

    public static string ListJson(string kindFilter, long sinceSeq, int limit)
    {
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"events\":[");
        var count = 0;
        lock (Items)
        {
            for (var i = Items.Count - 1; i >= 0 && count < limit; i--)
            {
                var item = Items[i];
                if (item.Seq <= sinceSeq)
                {
                    continue;
                }
                if (!string.IsNullOrEmpty(kindFilter) && !string.Equals(item.Kind, kindFilter, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                if (count > 0)
                {
                    sb.Append(',');
                }
                sb.Append("{\"seq\":").Append(item.Seq)
                    .Append(",\"time\":\"").Append(item.Time)
                    .Append("\",\"kind\":\"").Append(Json.Escape(item.Kind))
                    .Append("\",\"type\":\"").Append(Json.Escape(item.Type))
                    .Append("\",\"json\":").Append(item.Json ?? "null")
                    .Append('}');
                count++;
            }
        }
        sb.Append("]}");
        return sb.ToString();
    }

    public static string DescribeTypedValuePublic(SI.Core.TypedValue value)
    {
        try
        {
            return TvText(value);
        }
        catch
        {
            return "null";
        }
    }

    public static void AddBinding(string key, string valueText)
    {
        try
        {
            Add("binding", key ?? "", "{\"key\":\"" + Json.Escape(key ?? "") + "\",\"value\":" + (valueText ?? "null") + "}");
        }
        catch
        {
            // ignore
        }
    }

    public static void ChannelEvent(string type, SI.Core.TypedValue value)
    {
        if (!Enabled || value == null)
        {
            return;
        }
        try
        {
            var text = DescribeTypedValuePublic(value);
            Add("channel", type, text);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "channel event: " + ex.Message);
        }
    }


    public static void ChannelEvent2(string actionType, string actionText, SI.Core.TypedValue value)
    {
        if (!Enabled || value == null)
        {
            return;
        }
        try
        {
            var sb = new System.Text.StringBuilder();
            sb.Append("{\"actionType\":\"").Append(Json.Escape(actionType ?? string.Empty)).Append("\",\"action\":\"").Append(Json.Escape(actionText ?? string.Empty)).Append("\",\"value\":");
            var list = value.As<Il2CppSystem.Object>();
            if (list != null)
            {
                var typedList = ((Il2CppObjectBase)list).TryCast<Il2CppSystem.Collections.Generic.List<SI.Core.TypedValue>>();
                if (typedList != null)
                {
                    sb.Append("[");
                    for (var i = 0; i < typedList.Count && i < 20; i++)
                    {
                        if (i > 0) { sb.Append(','); }
                        sb.Append(DescribeTypedValuePublic(typedList[i]));
                    }
                    sb.Append(']');
                }
                else
                {
                    sb.Append(DescribeTypedValuePublic(value));
                }
            }
            else
            {
                sb.Append(DescribeTypedValuePublic(value));
            }
            sb.Append('}');
            Add("channel", actionType ?? "channel", sb.ToString());
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "channel event2: " + ex.Message);
        }
    }

    public static string Clear()
    {
        lock (Items)
        {
            Items.Clear();
            _seq = 0;
        }
        return "{\"ok\":true}";
    }

    // ---------- 格式化 ----------

    private static string FormatEvent(object evt)
    {
        var sb = new StringBuilder();
        sb.Append('{');
        var first = true;
        try
        {
            var properties = evt.GetType().GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);
            foreach (var property in properties)
            {
                if (property.GetIndexParameters().Length > 0)
                {
                    continue;
                }
                string text;
                try
                {
                    var value = property.GetValue(evt);
                    text = Fmt(value);
                }
                catch
                {
                    continue;
                }
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                sb.Append('"').Append(Json.Escape(property.Name)).Append("\":").Append(text);
            }
        }
        catch (Exception ex)
        {
            sb.Append("\"error\":\"").Append(Json.Escape(ex.Message)).Append('"');
        }
        sb.Append('}');
        return sb.ToString();
    }

    private static string Fmt(object value)
    {
        if (value == null)
        {
            return "null";
        }
        if (value is string text)
        {
            return "\"" + Json.Escape(text) + "\"";
        }
        var type = value.GetType();
        if (type.IsPrimitive || type.IsEnum)
        {
            return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
        }
        if (value is InteropReference reference)
        {
            return RefText(reference);
        }
        if (value is TypedValue typedValue)
        {
            return TvText(typedValue);
        }
        if (value is Il2CppObjectBase)
        {
            return "\"" + Json.Escape(type.Name) + "\"";
        }
        return "\"" + Json.Escape(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? type.Name) + "\"";
    }

    private static string RefText(InteropReference reference)
    {
        if (reference == null)
        {
            return "null";
        }
        var sb = new StringBuilder();
        sb.Append('{');
        var first = true;
        try
        {
            var identity = reference.GetPersistentIdentity();
            sb.Append("\"identity\":\"").Append(Json.Escape(identity ?? string.Empty)).Append('"');
            first = false;
        }
        catch
        {
            // ignore
        }
        try
        {
            var list = reference.m_id;
            if (list != null)
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                sb.Append("\"pairs\":[");
                for (var i = 0; i < list.Count; i++)
                {
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    var pair = list[i];
                    sb.Append("{\"id\":").Append(pair.ID).Append(",\"value\":").Append(pair.Value).Append('}');
                }
                sb.Append(']');
            }
        }
        catch
        {
            // ignore
        }
        sb.Append('}');
        return sb.ToString();
    }

    private static string TvText(object value)
    {
        if (value == null)
        {
            return "null";
        }
        var type = value.GetType();
        var sb = new StringBuilder();
        sb.Append("{\"tv\":\"").Append(Json.Escape(type.Name)).Append('"');
        var field = FieldText(value, "m_value");
        if (field != null)
        {
            sb.Append(",\"value\":").Append(field);
        }
        sb.Append('}');
        return sb.ToString();
    }

    private static string FieldText(object wrapper, string fieldName)
    {
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)wrapper);
            if (pointer == IntPtr.Zero)
            {
                return null;
            }
            var klass = IL2CPP.il2cpp_object_get_class(pointer);
            var field = IntPtr.Zero;
            for (var current = klass; current != IntPtr.Zero && field == IntPtr.Zero; current = IL2CPP.il2cpp_class_get_parent(current))
            {
                field = IL2CPP.il2cpp_class_get_field_from_name(current, fieldName);
            }
            if (field == IntPtr.Zero)
            {
                return null;
            }
            var objectPointer = IL2CPP.il2cpp_field_get_value_object(field, pointer);
            if (objectPointer == IntPtr.Zero)
            {
                return "null";
            }
            // 只按对象的真实原生类型来处理，避免把数值误包装成 InteropReference 导致原生调用崩溃
            var boxedClass = IL2CPP.il2cpp_object_get_class(objectPointer);
            var boxedName = IL2CPP.il2cpp_class_get_name_(boxedClass) ?? string.Empty;
            if (boxedName.IndexOf("InteropReference", StringComparison.Ordinal) >= 0)
            {
                var asReference = Il2CppObjectPool.Get<InteropReference>(objectPointer);
                return RefText(asReference);
            }
            try
            {
                var boxed = Il2CppObjectPool.Get<Il2CppSystem.Object>(objectPointer);
                var text = boxed == null ? "null" : (boxed.ToString() ?? "null");
                return "\"" + Json.Escape(text) + "\"";
            }
            catch
            {
                return "\"" + Json.Escape(boxedName) + "\"";
            }
        }
        catch
        {
            return null;
        }
    }
}
