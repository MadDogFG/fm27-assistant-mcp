using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using UnityEngine.UIElements;

namespace FMAssistant;

/// <summary>UI Toolkit 层：捕获界面根节点、导出控件树、尝试派发点击。</summary>
public static class UiTools
{
    public static object UiDispatcher;
    public static object Panel;
    public static readonly List<VisualElement> Roots = new();
    public static readonly List<object> Panels = new();
    public static volatile string LastPanelsScan = "never";
    private static readonly HashSet<string> SeenEventTypes = new();

    public static void CaptureDispatcher(object dispatcher, object panel)
    {
        if (dispatcher != null && UiDispatcher == null)
        {
            UiDispatcher = dispatcher;
            EventLog.Add("capture", "UIEventDispatcher@" + Shared.PointerOf(dispatcher));
        }
        if (panel != null && Panel == null)
        {
            Panel = panel;
            EventLog.Add("capture", "BaseVisualElementPanel " + Describe.TypeName(panel));
        }
    }

    public static void CaptureEvent(object evt)
    {
        try
        {
            if (evt is UnityEngine.UIElements.EventBase uiEvent)
            {
                var typeName = evt.GetType().Name;
                if (SeenEventTypes.Count < 400 && SeenEventTypes.Add(typeName) && HttpApi.LoggingEnabled)
                {
                    EventLog.Add("ui-toolkit", "event " + typeName);
                }
                var target = uiEvent.target;
                if (target != null)
                {
                    var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)target);
                    if (pointer != IntPtr.Zero && IsVisualElementPointer(pointer))
                    {
                        var element = Il2CppObjectPool.Get<VisualElement>(pointer);
                        if (element != null)
                        {
                            CaptureRoot(element);
                        }
                    }
                }
            }
        }
        catch
        {
            // ignore
        }
    }

    public static void CaptureRoot(VisualElement element)
    {
        try
        {
            var current = element;
            var guard = 0;
            while (current.parent != null && guard++ < 256)
            {
                current = current.parent;
            }
            if (!Roots.Any(r => Shared.PointerOf(r) == Shared.PointerOf(current)))
            {
                Roots.Add(current);
                EventLog.Add("capture", "UIRoot " + Describe.TypeName(current) + " name=" + current.name + " children=" + current.childCount);
            }
        }
        catch
        {
            // ignore
        }
    }

    public static void ScanPanels()
    {
        var before = Roots.Count;
        var note = "";
        try
        {
            var manager = SI.UI.DocumentManager.Instance;
            if (manager == null)
            {
                note += "docMgr=null; ";
            }
            else
            {
                DocumentManagerRef ??= manager;
                try
                {
                    var roots = new Il2CppSystem.Collections.Generic.List<UnityEngine.UIElements.VisualElement>();
                    manager.GetRoots(roots);
                    var count = roots == null ? 0 : roots.Count;
                    if (roots != null)
                    {
                        for (var k = 0; k < roots.Count; k++)
                        {
                            var root = roots[k];
                            if (root != null)
                            {
                                CaptureRoot(root);
                            }
                        }
                    }
                    var mainRoot = manager.MainRoot;
                    if (mainRoot != null)
                    {
                        CaptureRoot(mainRoot);
                    }
                    note += "docMgr roots=" + count + " main=" + (mainRoot == null ? "null" : Describe.TypeName(mainRoot)) + "; ";
                }
                catch (Exception ex)
                {
                    note += "docMgr roots ex: " + ex.Message + "; ";
                }
            }
        }
        catch (Exception ex)
        {
            note += "docMgr ex: " + ex.Message + "; ";
        }

        if (Roots.Count == before)
        {
            try
            {
                var type = Il2CppType.Of<FM.UI.FMDocumentManager>();
                var objects = UnityEngine.Resources.FindObjectsOfTypeAll(type);
                if (objects != null)
                {
                    var cnt = 0;
                    foreach (var candidate in objects)
                    {
                        var manager = candidate?.TryCast<FM.UI.FMDocumentManager>();
                        if (manager == null)
                        {
                            continue;
                        }
                        cnt++;
                        try
                        {
                            var mainRoot = manager.MainRoot;
                            if (mainRoot != null)
                            {
                                CaptureRoot(mainRoot);
                            }
                        }
                        catch (Exception ex)
                        {
                            note += "fdm main ex: " + ex.Message + "; ";
                        }
                    }
                    note += "fdmBehaviours=" + cnt + "; ";
                }
            }
            catch (Exception ex)
            {
                note += "fdm ex: " + ex.Message + "; ";
            }
        }

        try
        {
            AddPanels(UIElementsRuntimeUtility.s_SortedPlayerPanels);
            AddPanels(UIElementsRuntimeUtility.s_SortedScreenOverlayPanels);
            AddPanels(UIElementsRuntimeUtility.s_CachedWorldSpacePanels);
        }
        catch (Exception ex)
        {
            note += "panels ex: " + ex.Message + "; ";
        }

        LastPanelsScan = note + " roots=" + Roots.Count + " panels=" + Panels.Count;
        if (Roots.Count > before || !ScanNoteLogged)
        {
            ScanNoteLogged = true;
            EventLog.Add("ui-toolkit", "scan: " + LastPanelsScan);
        }
    }

    private static bool ScanNoteLogged;

    public static void Probe()
    {
        try
        {
            ScanPanels();
            EventLog.Add("probe", "scan=" + LastPanelsScan + " roots=" + RootsJson());
        }
        catch (Exception ex)
        {
            EventLog.Add("probe", "error: " + ex);
        }
    }

    public static object DocumentManagerRef;

    private static int AddPanels(Il2CppSystem.Collections.Generic.List<BaseRuntimePanel> list)
    {
        if (list == null)
        {
            return 0;
        }
        var added = 0;
        try
        {
            for (var i = 0; i < list.Count; i++)
            {
                var panel = list[i];
                if (panel == null)
                {
                    continue;
                }
                if (!Panels.Any(p => Shared.PointerOf(p) == Shared.PointerOf(panel)))
                {
                    Panels.Add(panel);
                    UiDispatcher ??= panel;
                    UiTools.Panel ??= panel;
                }
                var root = panel.visualTree;
                if (root != null)
                {
                    CaptureRoot(root);
                }
                added++;
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "add panels: " + ex.Message);
        }
        return added;
    }

    public static string PanelsJson()
    {
        var sb = new StringBuilder();
        sb.Append('[');
        for (var i = 0; i < Panels.Count; i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            var panel = Panels[i];
            var rootCount = 0;
            try
            {
                rootCount = ((BaseRuntimePanel)panel).visualTree?.childCount ?? 0;
            }
            catch
            {
                // ignore
            }
            sb.Append("{\"index\":").Append(i)
                .Append(",\"type\":\"").Append(Json.Escape(Describe.TypeName(panel)))
                .Append("\",\"rootChildren\":").Append(rootCount)
                .Append(",\"pointer\":\"").Append(Shared.PointerOf(panel)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    public static void ScanDocuments()
    {
        try
        {
            var type = Il2CppType.Of<UIDocument>();
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(type);
            var captured = 0;
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    var document = candidate?.TryCast<UIDocument>();
                    if (document == null)
                    {
                        continue;
                    }
                    var root = document.rootVisualElement;
                    if (root != null)
                    {
                        CaptureRoot(root);
                        captured++;
                    }
                }
            }
            EventLog.Add("ui-toolkit", "scan UIDocument: " + captured + " root(s)");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "scan documents: " + ex.Message);
        }
    }

    public static string RootsJson()
    {
        var sb = new StringBuilder();
        sb.Append('[');
        for (var i = 0; i < Roots.Count; i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            var root = Roots[i];
            var name = SafeName(root);
            sb.Append("{\"index\":").Append(i)
                .Append(",\"type\":\"").Append(Json.Escape(Describe.TypeName(root)))
                .Append("\",\"name\":\"").Append(Json.Escape(name))
                .Append("\",\"children\":").Append(SafeChildCount(root))
                .Append(",\"pointer\":\"").Append(Shared.PointerOf(root)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    public static string DocumentsJson()
    {
        var sb = new StringBuilder();
        sb.Append('[');
        var first = true;
        try
        {
            var type = Il2CppType.Of<UIDocument>();
            var objects = UnityEngine.Resources.FindObjectsOfTypeAll(type);
            if (objects != null)
            {
                foreach (var candidate in objects)
                {
                    var document = candidate?.TryCast<UIDocument>();
                    if (document == null)
                    {
                        continue;
                    }
                    var root = document.rootVisualElement;
                    var goName = string.Empty;
                    try
                    {
                        goName = document.gameObject == null ? string.Empty : document.gameObject.name;
                    }
                    catch
                    {
                        // ignore
                    }
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    sb.Append("{\"go\":\"").Append(Json.Escape(goName ?? string.Empty))
                        .Append("\",\"root\":\"").Append(Json.Escape(root == null ? string.Empty : SafeName(root)))
                        .Append(",\"children\":").Append(root == null ? 0 : SafeChildCount(root))
                        .Append("\",\"pointer\":\"").Append(Shared.PointerOf(root)).Append("\"}");
                    if (root != null)
                    {
                        CaptureRoot(root);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "documents: " + ex.Message);
        }
        sb.Append(']');
        return sb.ToString();
    }

    public static string SubtreeJson(int rootIndex, string path, int depth, int limit)
    {
        try
        {
            if (rootIndex < 0 || rootIndex >= Roots.Count)
            {
                return "{\"ok\":false,\"error\":\"root out of range\"}";
            }
            var indexes = (path ?? string.Empty).Split('/', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
            var start = indexes.Count > 0 && indexes[0] == rootIndex ? 1 : 0;
            var element = Roots[rootIndex];
            for (var i = start; i < indexes.Count; i++)
            {
                element = element.ElementAt(indexes[i]);
                if (element == null)
                {
                    return "{\"ok\":false,\"error\":\"path not found at " + i + "\"}";
                }
            }
            var sb = new StringBuilder();
            var budget = Math.Clamp(limit, 10, 30000);
            sb.Append("{\"ok\":true,\"tree\":");
            AppendNode(sb, element, Math.Clamp(depth, 1, 40), 0, ref budget, path);
            sb.Append('}');
            return sb.ToString();
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string TreeJson(int rootIndex, int depth, int limit)
    {
        if (rootIndex < 0 || rootIndex >= Roots.Count)
        {
            return "{\"ok\":false,\"error\":\"root index out of range\"}";
        }
        var sb = new StringBuilder();
        var budget = Math.Clamp(limit, 10, 30000);
        sb.Append("{\"ok\":true,\"tree\":");
        AppendNode(sb, Roots[rootIndex], Math.Clamp(depth, 1, 40), 0, ref budget, rootIndex.ToString());
        sb.Append('}');
        return sb.ToString();
    }

    private static void AppendNode(StringBuilder sb, VisualElement element, int maxDepth, int depth, ref int budget, string path)
    {
        if (budget-- <= 0)
        {
            sb.Append("null");
            return;
        }
        var nodePath = path;
        sb.Append("{\"path\":\"").Append(nodePath).Append("\",\"type\":\"").Append(Json.Escape(NativeTypeOf(element)))
            .Append("\",\"name\":\"").Append(Json.Escape(SafeName(element))).Append('"');
        var text = TextOf(element);
        if (!string.IsNullOrEmpty(text))
        {
            sb.Append(",\"text\":\"").Append(Json.Escape(text)).Append('"');
        }
        try
        {
            var bound = element.worldBound;
            sb.Append(",\"rect\":[").Append((int)bound.x).Append(',').Append((int)bound.y).Append(',')
                .Append((int)bound.width).Append(',').Append((int)bound.height).Append(']');
            sb.Append(",\"visible\":").Append(element.visible ? "true" : "false");
            sb.Append(",\"enabled\":").Append(element.enabledInHierarchy ? "true" : "false");
        }
        catch
        {
            // ignore
        }
        if (depth < maxDepth && SafeChildCount(element) > 0)
        {
            var count = SafeChildCount(element);
            sb.Append(",\"children\":[");
            for (var i = 0; i < count && budget > 0; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                VisualElement child = null;
                try
                {
                    child = element.ElementAt(i);
                }
                catch
                {
                    // ignore
                }
                if (child == null)
                {
                    continue;
                }
                AppendNode(sb, child, maxDepth, depth + 1, ref budget, nodePath + "/" + i);
            }
            sb.Append(']');
        }
        sb.Append('}');
    }

    public static string FindByText(string text, int rootIndex)
    {
        var matches = new List<VisualElement>();
        foreach (var root in Roots)
        {
            Collect(root, text, matches, 0);
            if (matches.Count > 0 && rootIndex >= 0)
            {
                break;
            }
        }
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"matches\":[");
        for (var i = 0; i < Math.Min(matches.Count, 50); i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            var element = matches[i];
            sb.Append("{\"index\":").Append(i)
                .Append(",\"type\":\"").Append(Json.Escape(Describe.TypeName(element)))
                .Append("\",\"name\":\"").Append(Json.Escape(SafeName(element)))
                .Append("\",\"text\":\"").Append(Json.Escape(TryGetText(element)))
                .Append("\",\"path\":\"").Append(Json.Escape(PathOf(element)))
                .Append("\"}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static void Collect(VisualElement element, string text, List<VisualElement> matches, int depth)
    {
        if (element == null || depth > 30 || matches.Count >= 200)
        {
            return;
        }
        try
        {
            var own = TryGetText(element);
            if (!string.IsNullOrEmpty(own) && own.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                matches.Add(element);
            }
        }
        catch
        {
            // ignore
        }
        var count = SafeChildCount(element);
        for (var i = 0; i < count; i++)
        {
            Collect(element.ElementAt(i), text, matches, depth + 1);
        }
    }

    public static string ClickByPath(string path)
    {
        try
        {
            var indexes = path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
            if (Roots.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no roots captured yet\"}";
            }
            var element = Roots[0];
            for (var i = 1; i < indexes.Count; i++)
            {
                element = element.ElementAt(indexes[i]);
                if (element == null)
                {
                    return "{\"ok\":false,\"error\":\"path not found at " + i + "\"}";
                }
            }
            return DispatchClick(element);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ClickByText(string text)
    {
        try
        {
            if (Roots.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no roots captured yet\"}";
            }
            var matches = new List<VisualElement>();
            Collect(Roots[0], text, matches, 0);
            if (matches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no element with text " + Json.Escape(text) + "\"}";
            }
            return DispatchClick(matches[0]);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string DispatchClick(VisualElement element, string mode = "all", int pointerId = -1)
    {
        if (mode == "schedule")
        {
            try
            {
                var scheduled = element.schedule.Execute((Il2CppSystem.Action<UnityEngine.UIElements.TimerState>)(state =>
                {
                    try
                    {
                        DispatchClickCore(element, mode == "schedule_double" ? "double" : "all", pointerId);
                    }
                    catch (Exception ex)
                    {
                        EventLog.Add("error", "scheduled click: " + ex.Message);
                    }
                }));
                scheduled.StartingIn(16);
                return "{\"ok\":true,\"scheduled\":true}";
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "schedule click: " + ex.Message);
                return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
            }
        }
        return DispatchClickCore(element, mode, pointerId);
    }

    private static string DispatchClickCore(VisualElement element, string mode = "all", int pointerId = -1)
    {
        if (mode == "double")
        {
            var first = DispatchClickCore(element, "all", pointerId);
            var second = DispatchClickCore(element, "all", pointerId);
            return "{\"ok\":true,\"double\":true,\"first\":" + first + ",\"second\":" + second + "}";
        }
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)element);
            var handler = Il2CppObjectPool.Get<UnityEngine.UIElements.IEventHandler>(pointer);
            var rect = element.worldBound;
            var x = rect.x + rect.width / 2f;
            var y = rect.y + rect.height / 2f;
            var log = new StringBuilder();
            if (mode == "all" || mode == "pointer")
            {
            try
            {
                var down = new PointerDownEvent();
                ApplyPointerFields(down, x, y, 1, pointerId);
                down.target = handler;
                handler.SendEvent(down);
                log.Append("down;");
            }
            catch (Exception ex)
            {
                log.Append("down ex:").Append(ex.Message).Append(';');
            }
            try
            {
                var up = new PointerUpEvent();
                ApplyPointerFields(up, x, y, 1, pointerId);
                up.target = handler;
                handler.SendEvent(up);
                log.Append("up;");
            }
            catch (Exception ex)
            {
                log.Append("up ex:").Append(ex.Message).Append(';');
            }
            }
            if (mode == "all" || mode == "click")
            {
            try
            {
                var clickEvent = ClickEvent.GetPooled(null, 1);
                ApplyPointerFields(clickEvent, x, y, 1, pointerId);
                clickEvent.target = handler;
                handler.SendEvent(clickEvent);
                log.Append("click;");
            }
            catch (Exception ex)
            {
                log.Append("click ex:").Append(ex.Message).Append(';');
            }
            }
            EventLog.Add("ui-toolkit", "dispatch to " + Describe.TypeName(element) + " name=" + SafeName(element)
                + " pos=" + (int)x + "," + (int)y + " actions=" + log);
            return "{\"ok\":true,\"dispatched\":true,\"actions\":\"" + Json.Escape(log.ToString()) + "\"}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "dispatch click: " + ex.Message);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static void ApplyPointerFields(UnityEngine.UIElements.EventBase evt, float x, float y, int clickCount, int pointerId = -1)
    {
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)evt);
            if (pointerId < 0)
            {
                try
                {
                    pointerId = UnityEngine.UIElements.PointerId.mousePointerId;
                }
                catch
                {
                    pointerId = 0;
                }
            }
            InvokeIntSetter(pointer, "set_button", 0);
            InvokeIntSetter(pointer, "set_pointerId", pointerId);
            InvokeIntSetter(pointer, "set_clickCount", clickCount);
            InvokeVector3Setter(pointer, "set_position", x, y, 0);
            InvokeVector3Setter(pointer, "set_localPosition", x, y, 0);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "pointer fields: " + ex.Message);
        }
    }

    private static IntPtr FindSetterMethod(IntPtr klass, string name, int argc)
    {
        for (var depth = 0; depth < 12 && klass != IntPtr.Zero; depth++)
        {
            var method = IL2CPP.il2cpp_class_get_method_from_name(klass, name, argc);
            if (method != IntPtr.Zero)
            {
                return method;
            }
            klass = IL2CPP.il2cpp_class_get_parent(klass);
        }
        return IntPtr.Zero;
    }

    private static unsafe void InvokeIntSetter(IntPtr objPtr, string name, int value)
    {
        var klass = IL2CPP.il2cpp_object_get_class(objPtr);
        var method = FindSetterMethod(klass, name, 1);
        if (method == IntPtr.Zero)
        {
            return;
        }
        var arg = stackalloc int[1];
        arg[0] = value;
        var args = stackalloc IntPtr[1];
        args[0] = (IntPtr)arg;
        var exception = IntPtr.Zero;
        IL2CPP.il2cpp_runtime_invoke(method, objPtr, (void**)args, ref exception);
        if (exception != IntPtr.Zero)
        {
            throw new InvalidOperationException("setter " + name + " failed");
        }
    }

    private static unsafe void InvokeVector3Setter(IntPtr objPtr, string name, float x, float y, float z)
    {
        var klass = IL2CPP.il2cpp_object_get_class(objPtr);
        var method = FindSetterMethod(klass, name, 1);
        if (method == IntPtr.Zero)
        {
            return;
        }
        var arg = stackalloc float[3];
        arg[0] = x;
        arg[1] = y;
        arg[2] = z;
        var args = stackalloc IntPtr[1];
        args[0] = (IntPtr)arg;
        var exception = IntPtr.Zero;
        IL2CPP.il2cpp_runtime_invoke(method, objPtr, (void**)args, ref exception);
        if (exception != IntPtr.Zero)
        {
            throw new InvalidOperationException("setter " + name + " failed");
        }
    }

    public static string ClickTextWithAncestor(int rootIndex, string text, int levels, string mode = "all")
    {
        try
        {
            var roots = rootIndex >= 0 && rootIndex < Roots.Count ? new List<VisualElement> { Roots[rootIndex] } : Roots;
            var matches = new List<VisualElement>();
            foreach (var root in roots)
            {
                CollectQuery(root, text, null, matches, 0);
            }
            if (matches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no element with text " + Json.Escape(text) + "\"}";
            }
            var element = matches[0];
            for (var k = 0; k < levels && element.parent != null; k++)
            {
                element = element.parent;
            }
            return DispatchClick(element, mode);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string Screenshot(string path)
    {
        try
        {
            var target = path;
            if (string.IsNullOrEmpty(target))
            {
                var dir = System.IO.Path.Combine(
                    System.IO.Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".", "shots");
                System.IO.Directory.CreateDirectory(dir);
                target = System.IO.Path.Combine(dir, "shot-" + DateTime.Now.ToString("HHmmss-fff") + ".png");
            }
            UnityEngine.ScreenCapture.CaptureScreenshot(target);
            EventLog.Add("screenshot", "captured -> " + target + " screen=" + UnityEngine.Screen.width + "x" + UnityEngine.Screen.height);
            return "{\"ok\":true,\"path\":\"" + Json.Escape(target) + "\",\"width\":" + UnityEngine.Screen.width + ",\"height\":" + UnityEngine.Screen.height + "}";
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "screenshot: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ClickAt(float x, float y, string mode = "all")
    {
        try
        {
            if (Roots.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no roots\"}";
            }
            var root = Roots[0];
            var panel = Il2CppObjectPool.Get<UnityEngine.UIElements.BaseVisualElementPanel>(
                IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)root.panel));
            if (panel == null)
            {
                return "{\"ok\":false,\"error\":\"panel null\"}";
            }
            var picked = panel.Pick(new UnityEngine.Vector2(x, y));
            if (picked == null)
            {
                return "{\"ok\":false,\"error\":\"nothing at point\"}";
            }
            EventLog.Add("ui-toolkit", "pick " + (int)x + "," + (int)y + " -> " + NativeTypeOf(picked) + " name=" + SafeName(picked));
            return DispatchClick(picked, mode);
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "click_at: " + ex);
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string NativeClassName(IntPtr pointer)
    {
        try
        {
            var klass = IL2CPP.il2cpp_object_get_class(pointer);
            if (klass == IntPtr.Zero)
            {
                return string.Empty;
            }
            var name = IL2CPP.il2cpp_class_get_name_(klass) ?? string.Empty;
            var ns = IL2CPP.il2cpp_class_get_namespace_(klass) ?? string.Empty;
            return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static bool NativeDerivesFrom(IntPtr pointer, string baseName)
    {
        try
        {
            var klass = IL2CPP.il2cpp_object_get_class(pointer);
            for (var depth = 0; depth < 16 && klass != IntPtr.Zero; depth++)
            {
                var name = IL2CPP.il2cpp_class_get_name_(klass) ?? string.Empty;
                if (name == baseName)
                {
                    return true;
                }
                klass = IL2CPP.il2cpp_class_get_parent(klass);
            }
        }
        catch
        {
            // ignore
        }
        return false;
    }

    public static string TextOf(VisualElement element)
    {
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)element);
            if (NativeDerivesFrom(pointer, "TextElement"))
            {
                var textElement = Il2CppObjectPool.Get<TextElement>(pointer);
                return textElement?.text ?? string.Empty;
            }
        }
        catch
        {
            // ignore
        }
        return string.Empty;
    }

    public static string NativeTypeOf(VisualElement element)
    {
        try
        {
            var pointer = IL2CPP.Il2CppObjectBaseToPtr((Il2CppObjectBase)element);
            var name = NativeClassName(pointer);
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }
        }
        catch
        {
            // ignore
        }
        return Describe.TypeName(element);
    }

    private static string SearchTextOf(VisualElement element)
    {
        var text = TextOf(element);
        if (!string.IsNullOrEmpty(text))
        {
            return text;
        }
        try
        {
            return element.name ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    public static string Find(string text, string name, int rootIndex)
    {
        var matches = new List<VisualElement>();
        var roots = rootIndex >= 0 && rootIndex < Roots.Count ? new List<VisualElement> { Roots[rootIndex] } : Roots;
        foreach (var root in roots)
        {
            CollectQuery(root, text, name, matches, 0);
        }
        var sb = new StringBuilder();
        sb.Append("{\"ok\":true,\"matches\":[");
        for (var i = 0; i < Math.Min(matches.Count, 60); i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            var element = matches[i];
            sb.Append("{\"index\":").Append(i)
                .Append(",\"type\":\"").Append(Json.Escape(NativeTypeOf(element)))
                .Append("\",\"name\":\"").Append(Json.Escape(SafeName(element)))
                .Append("\",\"text\":\"").Append(Json.Escape(TextOf(element)))
                .Append("\",\"path\":\"").Append(Json.Escape(PathOf(element)))
                .Append("\"}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static void CollectQuery(VisualElement element, string text, string name, List<VisualElement> matches, int depth)
    {
        if (element == null || depth > 40 || matches.Count >= 200)
        {
            return;
        }
        try
        {
            var ownText = TextOf(element);
            var ownName = SafeName(element);
            var textOk = string.IsNullOrEmpty(text) || (!string.IsNullOrEmpty(ownText) && ownText.IndexOf(text, StringComparison.OrdinalIgnoreCase) >= 0);
            var nameOk = string.IsNullOrEmpty(name) || (!string.IsNullOrEmpty(ownName) && ownName.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0);
            if (textOk && nameOk && (!string.IsNullOrEmpty(text) || !string.IsNullOrEmpty(name)))
            {
                matches.Add(element);
            }
        }
        catch
        {
            // ignore
        }
        var count = SafeChildCount(element);
        for (var i = 0; i < count; i++)
        {
            CollectQuery(element.ElementAt(i), text, name, matches, depth + 1);
        }
    }

    public static string ClickByPath(int rootIndex, string path, string mode = "all")
    {
        try
        {
            if (rootIndex < 0 || rootIndex >= Roots.Count)
            {
                return "{\"ok\":false,\"error\":\"root out of range\"}";
            }
            var indexes = path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
            var start = indexes.Count > 0 && indexes[0] == rootIndex ? 1 : 0;
            var element = Roots[rootIndex];
            for (var i = start; i < indexes.Count; i++)
            {
                element = element.ElementAt(indexes[i]);
                if (element == null)
                {
                    return "{\"ok\":false,\"error\":\"path not found at " + i + "\"}";
                }
            }
            return DispatchClick(element, mode);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ClickByText(int rootIndex, string text)
    {
        try
        {
            var roots = rootIndex >= 0 && rootIndex < Roots.Count ? new List<VisualElement> { Roots[rootIndex] } : Roots;
            var matches = new List<VisualElement>();
            foreach (var root in roots)
            {
                CollectQuery(root, text, null, matches, 0);
            }
            if (matches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no element with text " + Json.Escape(text) + "\"}";
            }
            return DispatchClick(matches[0]);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    public static string ClickByName(int rootIndex, string name)
    {
        try
        {
            var roots = rootIndex >= 0 && rootIndex < Roots.Count ? new List<VisualElement> { Roots[rootIndex] } : Roots;
            var matches = new List<VisualElement>();
            foreach (var root in roots)
            {
                CollectQuery(root, null, name, matches, 0);
            }
            if (matches.Count == 0)
            {
                return "{\"ok\":false,\"error\":\"no element named " + Json.Escape(name) + "\"}";
            }
            return DispatchClick(matches[0]);
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
        }
    }

    private static bool IsVisualElementPointer(IntPtr pointer)
    {
        try
        {
            var klass = IL2CPP.il2cpp_object_get_class(pointer);
            for (var depth = 0; depth < 12 && klass != IntPtr.Zero; depth++)
            {
                var name = IL2CPP.il2cpp_class_get_name_(klass) ?? string.Empty;
                if (name == "VisualElement")
                {
                    return true;
                }
                klass = IL2CPP.il2cpp_class_get_parent(klass);
            }
        }
        catch
        {
            // ignore
        }
        return false;
    }

    private static string PathOf(VisualElement element)
    {
        var parts = new List<int>();
        var current = element;
        var guard = 0;
        while (current.parent != null && guard++ < 512)
        {
            var index = current.parent.IndexOf(current);
            parts.Add(index);
            current = current.parent;
        }
        var rootIndex = 0;
        for (var i = 0; i < Roots.Count; i++)
        {
            if (Shared.PointerOf(Roots[i]) == Shared.PointerOf(current))
            {
                rootIndex = i;
                break;
            }
        }
        parts.Reverse();
        return parts.Count > 0 ? rootIndex + "/" + string.Join("/", parts) : rootIndex.ToString();
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

    private static int SafeChildCount(VisualElement element)
    {
        try
        {
            return element.childCount;
        }
        catch
        {
            return 0;
        }
    }

    private static string TryGetText(VisualElement element)
    {
        try
        {
            if (element is TextElement textElement)
            {
                return textElement.text ?? string.Empty;
            }
            if (element is Button button)
            {
                return button.text ?? string.Empty;
            }
        }
        catch
        {
            // ignore
        }
        return string.Empty;
    }
}

/// <summary>捕获游戏事件总线上的事件对象，用于查看和重放。</summary>
public static class GameEventStore
{
    private const int Capacity = 60;
    private static readonly ConcurrentQueue<(long Seq, object Event)> Items = new();
    private static long _seq;

    public static long Store(object evt)
    {
        if (evt == null)
        {
            return 0;
        }
        var seq = System.Threading.Interlocked.Increment(ref _seq);
        Items.Enqueue((seq, evt));
        while (Items.Count > Capacity && Items.TryDequeue(out _))
        {
        }
        return seq;
    }

    public static string ListJson()
    {
        var sb = new StringBuilder();
        sb.Append('[');
        var first = true;
        foreach (var (seq, evt) in Items.ToArray())
        {
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            var typeName = Describe.TypeName(evt);
            var now = string.Empty;
            try
            {
                now = Describe.Object(evt, 20);
            }
            catch
            {
                // ignore
            }
            sb.Append("{\"seq\":").Append(seq).Append(",\"type\":\"").Append(Json.Escape(typeName))
                .Append("\",\"detail\":\"").Append(Json.Escape(now)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    public static string Replay(long seq)
    {
        if (Shared.Dispatcher is not SI.Core.EventDispatcher dispatcher)
        {
            return "{\"ok\":false,\"error\":\"dispatcher not captured\"}";
        }
        foreach (var (storedSeq, evt) in Items.ToArray())
        {
            if (storedSeq != seq)
            {
                continue;
            }
            if (evt is not SI.Core.EventBase gameEvent)
            {
                return "{\"ok\":false,\"error\":\"not a game event\"}";
            }
            try
            {
                dispatcher.SendEvent(gameEvent);
                EventLog.Add("replay", "replayed seq=" + seq + " " + Describe.TypeName(evt));
                return "{\"ok\":true}";
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"" + Json.Escape(ex.Message) + "\"}";
            }
        }
        return "{\"ok\":false,\"error\":\"seq not found\"}";
    }
}

public static class Json
{
    public static string Escape(string value)
    {
        if (value == null)
        {
            return string.Empty;
        }
        var sb = new StringBuilder(value.Length + 8);
        foreach (var c in value)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32)
                    {
                        sb.Append("\\u").Append(((int)c).ToString("x4"));
                    }
                    else
                    {
                        sb.Append(c);
                    }
                    break;
            }
        }
        return sb.ToString();
    }
}
