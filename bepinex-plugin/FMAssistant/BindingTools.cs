using System;
using System.Collections.Generic;
using System.Text;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.Runtime;
using SI.Bindable;
using SI.Core;

namespace FMAssistant;

/// <summary>
/// 官方数据层入口：直接读/写游戏 UI 用的 Bindings 树（SI.Bindable.Bindings）。
/// 这是 UI 控件读写数据的同一套官方 API，不模拟任何输入。
/// </summary>
public static class BindingTools
{
    public static Bindings BindingsInstance;

    public static Bindings GetBindings()
    {
        if (BindingsInstance != null)
        {
            return BindingsInstance;
        }
        try
        {
            var subsystem = SI.Core.GameSubsystems.Get<SI.Bindable.BindingSubsystem>();
            if (subsystem != null)
            {
                BindingsInstance = subsystem;
                EventLog.Add("bindings", "BindingSubsystem@" + Shared.PointerOf(subsystem));
                return BindingsInstance;
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "get bindings subsystem: " + ex.Message);
        }
        try
        {
            var list = SI.Core.GameSubsystems.s_subsystems;
            if (list != null)
            {
                for (var i = 0; i < list.Count; i++)
                {
                    var item = list[i];
                    if (item == null)
                    {
                        continue;
                    }
                    var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)item);
                    var subs = Il2CppObjectPool.Get<SI.Bindable.BindingSubsystem>(pointer);
                    if (subs != null)
                    {
                        BindingsInstance = subs;
                        EventLog.Add("bindings", "BindingSubsystem(s_subsystems)@" + Shared.PointerOf(subs));
                        return BindingsInstance;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "find bindings in subsystems: " + ex.Message);
        }
        return null;
    }

    private static string ValueText(TypedValue value)
    {
        if (value == null)
        {
            return "null";
        }
        try
        {
            return Observe.DescribeTypedValuePublic(value);
        }
        catch
        {
            return "{\"tv\":\"?\"}";
        }
    }

    public static string Walk(string filter, int maxDepth, int maxNodes, bool readValues)
    {
        var bindings = GetBindings();
        if (bindings == null)
        {
            return "{\"ok\":false,\"error\":\"bindings not found\"}";
        }
        try { System.IO.File.WriteAllText(ProgressFile, ""); } catch { }
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"nodes\":[");
        var count = 0;
        var total = 0;
        try
        {
            var root = bindings.RootNode;
            if (root == null)
            {
                return "{\"ok\":false,\"error\":\"root node null\"}";
            }
            WalkNode(root, string.Empty, string.Empty, filter ?? string.Empty, 0, maxDepth, maxNodes, sb, ref count, ref total, readValues);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
        sb.Append("],\"count\":").Append(count).Append(",\"visited\":").Append(total).Append('}');
        return sb.ToString();
    }

    // Diagnostics stay portable: write next to the plugin assembly instead of a user path.
    private static readonly string ProgressFile = System.IO.Path.Combine(
        System.IO.Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".", "state", "bindings-walk.log");

    private static void Progress(string text)
    {
        try
        {
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(ProgressFile));
            System.IO.File.AppendAllText(ProgressFile, text + "\n");
        }
        catch
        {
            // ignore
        }
    }

    private static void WalkNode(IReadOnlyNode node, string path, string parentName, string filter, int depth, int maxDepth, int maxNodes, StringBuilder sb, ref int count, ref int total, bool readValues)
    {
        if (node == null || count >= maxNodes || total > 50000)
        {
            return;
        }
        total++;
        string name;
        try
        {
            name = node.Name ?? string.Empty;
        }
        catch
        {
            name = string.Empty;
        }
        var nodePath = string.IsNullOrEmpty(path) ? name : (string.IsNullOrEmpty(name) ? path : path + "." + name);
        if (total < 200 || total % 200 == 0)
        {
            Progress("visit " + total + " " + nodePath);
        }
        var match = string.IsNullOrEmpty(filter)
            || nodePath.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0;
        if (match)
        {
            Bindings.Key key = default;
            try
            {
                key = node.Key;
            }
            catch
            {
                // ignore
            }
            TypedValue value = null;
            if (readValues)
            {
                try
                {
                    value = node.Value;
                }
                catch
                {
                    // ignore
                }
            }
            if (count > 0)
            {
                sb.Append(',');
            }
            sb.Append("{\"path\":\"").Append(Json.Escape(nodePath))
                .Append("\",\"name\":\"").Append(Json.Escape(name))
                .Append("\",\"key\":\"").Append(key.m_key.ToString("x16"))
                .Append("\",\"value\":").Append(readValues ? ValueText(value) : "\"<not-read>\"")
                .Append(",\"children\":").Append(SafeChildCount(node))
                .Append('}');
            count++;
        }
        if (depth >= maxDepth)
        {
            return;
        }
        IReadOnlyNode child = null;
        try
        {
            child = node.FirstChild;
        }
        catch (Exception ex)
        {
            Progress("firstchild-error " + nodePath + " " + ex.Message);
            return;
        }
        var guard = 0;
        while (child != null && guard++ < 5000)
        {
            WalkNode(child, nodePath, name, filter, depth + 1, maxDepth, maxNodes, sb, ref count, ref total, readValues);
            if (count >= maxNodes || total > 50000)
            {
                return;
            }
            try
            {
                child = child.NextSibling;
            }
            catch (Exception ex)
            {
                Progress("nextsibling-error " + nodePath + " " + ex.Message);
                return;
            }
        }
    }

    private static int SafeChildCount(IReadOnlyNode node)
    {
        try
        {
            return node.ChildCount;
        }
        catch
        {
            return 0;
        }
    }

    public static string SetByKey(string keyHex, string intText, bool stringValue)
    {
        try
        {
            var bindings = GetBindings();
            if (bindings == null)
            {
                return "{\"ok\":false,\"error\":\"bindings not found\"}";
            }
            var key = new Bindings.Key(Convert.ToUInt64(keyHex, 16));
            TypedValue value;
            if (stringValue)
            {
                value = TypedValue.Create(intText ?? string.Empty);
            }
            else
            {
                value = TypedValue.Create(int.Parse(intText ?? "0"));
            }
            bindings.Set(ref key, value, Bindings.SetFlags.Default);
            bindings.Update();
            EventLog.Add("bindings", "set key=" + keyHex + " value=" + (intText ?? ""));
            return "{\"ok\":true}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "bindings set: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }
}
