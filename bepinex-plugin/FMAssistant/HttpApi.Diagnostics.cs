using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>开发诊断与历史调试 HTTP 路由。生产模式下全部返回 403 Forbidden，仅在显式开启 DevMode 时可用。</summary>
public static partial class HttpApi
{
    private static (int Status, string Json) DispatchDiagnostics(
        string method,
        string path,
        Dictionary<string, string> query,
        string body)
    {
        if (!AuthGuard.IsDevMode)
        {
            if (path.StartsWith("/ui/click", StringComparison.OrdinalIgnoreCase) || path.Equals("/dialog/click", StringComparison.OrdinalIgnoreCase))
                return (410, Error("UI input is disabled. Use game commands."));
            return (403, Error("Development diagnostic endpoint is disabled in production mode. Set FM_ASSISTANT_DEV_MODE=1 for local diagnostics."));
        }

            if (path == "/api/v1/testing/background-audio")
            {
                if (method == "GET") return LiveTools.Run(BackgroundAudio.State);
                if (method != "POST" || !query.TryGetValue("muted", out var text) || !bool.TryParse(text, out var muted))
                    return (400, Error("Use POST muted=true/false, or GET state."));
                return LiveTools.Run(() => BackgroundAudio.Set(muted));
            }
            if (path == "/api/v1/testing/quit")
            {
                if (method != "POST" || !query.TryGetValue("discardTestSession", out var discard) || discard != "true") return (400, Error("Explicit POST discardTestSession=true is required; only discard an agent-owned test session after preserving the player's save."));
                MainThread.Enqueue(() => { BackgroundAudio.Restore(); FM.UI.GlobalGameModule.ForceQuitGame(0); });
                return (200, "{\"ok\":true,\"queued\":true,\"scope\":\"discard_test_session_exit_request\"}");
            }
            if (path == "/api/v1/diagnostics/client-writes") return (200, LiveTools.JsonText(MutationActivity.Recent(ParseLong(query, "since", 0))));
            if (path.StartsWith("/ui/click", StringComparison.OrdinalIgnoreCase) || path.Equals("/dialog/click", StringComparison.OrdinalIgnoreCase))
                return (410, "{\"ok\":false,\"error\":\"UI input is disabled. Use game commands.\"}");
            switch (path.ToLowerInvariant())
            {
                case "/health":
                    return (200, Health());
                case "/log":
                    return (200, Log(query));
                case "/clear":
                    EventLog.Clear();
                    Throttle.Reset();
                    return (200, "{\"ok\":true}");
                case "/settings":
                    if (query.TryGetValue("logging", out var logging))
                    {
                        LoggingEnabled = logging != "0" && !string.Equals(logging, "false", StringComparison.OrdinalIgnoreCase);
                    }
                    if (query.TryGetValue("allUi", out var allUi))
                    {
                        LogAllUiEvents = allUi == "1" || string.Equals(allUi, "true", StringComparison.OrdinalIgnoreCase);
                    }
                    return (200, Health());
                case "/selftest":
                    MainThread.Enqueue(() =>
                    {
                        try
                        {
                            UnityEngine.Debug.Log("FMAS selftest " + DateTimeOffset.Now.ToString("HH:mm:ss.fff"));
                            EventLog.Add("selftest", "main-thread selftest ran");
                        }
                        catch (Exception ex)
                        {
                            EventLog.Add("error", "selftest: " + ex.Message);
                        }
                    });
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/patches": {
                    var patched = HarmonyLib.Harmony.GetAllPatchedMethods().Select(m => (m.DeclaringType == null ? "?" : m.DeclaringType.FullName) + "." + m.Name).ToArray();
                    return (200, "{\"ok\":true,\"patched\":" + patched.Length + ",\"methods\":[" + string.Join(",", patched.Select(pm => "\"" + Json.Escape(pm) + "\"")) + "]}");
                }
                case "/nudge":
                    MainThread.Enqueue(() => EventLog.Add("nudge", "main-thread action ran at " + DateTimeOffset.Now.ToString("HH:mm:ss.fff")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/enum":
                    return (200, EnumDump(query));
                case "/types":
                    return (200, Types(query));
                case "/methods":
                    return (200, Methods(query));
                case "/screenshot": {
                    query.TryGetValue("path", out var shotPath);
                    MainThread.Enqueue(() => EventLog.Add("screenshot", "result " + UiTools.Screenshot(shotPath)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ui/click_at": {
                    var x = ParseFloat(query, "x", 0);
                    var y = ParseFloat(query, "y", 0);
                    query.TryGetValue("mode", out var atMode);
                    MainThread.Enqueue(() => EventLog.Add("ui-toolkit", "click_at result " + UiTools.ClickAt(x, y, atMode ?? "all")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/game/event": {
                    var eventId = ParseInt(query, "id", 0);
                    if (eventId <= 0)
                    {
                        return (400, Error("id required"));
                    }
                    MainThread.Enqueue(() => EventLog.Add("game", "send event result " + GameTools.SendEvent((uint)eventId)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/dialog/current":
                    MainThread.Enqueue(() => EventLog.Add("game", "dialog current result " + GameTools.DialogCurrent()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/dialog/click": {
                    var btn = ParseInt(query, "button", 0);
                    MainThread.Enqueue(() => EventLog.Add("game", "dialog click result " + GameTools.DialogClick(btn)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/game/loadlast2":
                    MainThread.Enqueue(() => EventLog.Add("game", "loadlast2 result " + GameTools.LoadLastSaveWithContext()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/game/startload": {
                    query.TryGetValue("suffix", out var suffix);
                    MainThread.Enqueue(() => EventLog.Add("game", "startload result " + GameTools.StartLoadFromBinding(suffix)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/game/dialoginfo":
                    MainThread.Enqueue(() => EventLog.Add("game", "dialog info result " + GameTools.DialogInfo()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/tactic/binddata": {
                    var bdIndex = ParseInt(query, "index", -1);
                    MainThread.Enqueue(() => EventLog.Add("game", "binddata result " + TacticTools.BindPitchData(bdIndex)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/tactic/info":
                    MainThread.Enqueue(() => EventLog.Add("game", "tactic info result " + TacticTools.Info()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/tactic/roleoptions":
                    MainThread.Enqueue(() => EventLog.Add("game", "role options result " + TacticTools.DumpRoleOptions()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/tactic/setrole": {
                    var roleIndex = ParseInt(query, "index", 0);
                    MainThread.Enqueue(() => EventLog.Add("game", "setrole result " + TacticTools.SetRole(roleIndex)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ref/create": {
                    query.TryGetValue("type", out var rt);
                    query.TryGetValue("pairs", out var rp);
                    MainThread.Enqueue(() => EventLog.Add("game", "ref create result " + GameTools.RefCreate(rt ?? "Tactic", rp ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ref/tactic": {
                    query.TryGetValue("key", out var tk);
                    MainThread.Enqueue(() => EventLog.Add("game", "ref tactic result " + GameTools.RefFireOnTactic(tk ?? "0", 0)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ref/probe": {
                    query.TryGetValue("key", out var pk);
                    MainThread.Enqueue(() => EventLog.Add("game", "ref probe result " + GameTools.RefProbe(pk ?? "0")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ref/inspect": {
                    query.TryGetValue("key", out var rk);
                    MainThread.Enqueue(() => EventLog.Add("game", "ref inspect result " + GameTools.RefInspect(rk ?? "0")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/bind/open": {
                    query.TryGetValue("root", out var broot2);
                    query.TryGetValue("path", out var bpath);
                    MainThread.Enqueue(() => EventLog.Add("game", "bindopen result " + GameTools.BindOpen(broot2 ?? "0", bpath ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/tactic/selectrole3": {
                    query.TryGetValue("pairs", out var s3Pairs);
                    query.TryGetValue("sel", out var s3Sel);
                    query.TryGetValue("inp", out var s3Inp);
                    query.TryGetValue("roleId", out var s3Role);
                    query.TryGetValue("mode", out var s3Mode);
                    int.TryParse(s3Sel, out var s3SelV);
                    int.TryParse(s3Role, out var s3RoleV);
                    int.TryParse(s3Mode, out var s3ModeV);
                    var s3InpV = s3Inp == "1";
                    MainThread.Enqueue(() => EventLog.Add("game", "selectrole3 result " + GameTools.SelectRole3(s3Pairs, s3SelV, s3InpV, s3RoleV, s3ModeV)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/tactic/selectrole2": {
                    query.TryGetValue("pairs", out var srPairs);
                    query.TryGetValue("sel", out var srSel);
                    query.TryGetValue("inp", out var srInp);
                    query.TryGetValue("roleId", out var srRole);
                    query.TryGetValue("mode", out var srMode);
                    int.TryParse(srSel, out var srSelV);
                    int.TryParse(srRole, out var srRoleV);
                    int.TryParse(srMode, out var srModeV);
                    var srInpV = srInp == "1";
                    MainThread.Enqueue(() => EventLog.Add("game", "selectrole2 result " + GameTools.SelectRole2(srPairs, srSelV, srInpV, srRoleV, srModeV)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/tactic/nativerole": {
                    query.TryGetValue("tactic", out var nt);
                    query.TryGetValue("role", out var nr);
                    query.TryGetValue("sel", out var nsel);
                    query.TryGetValue("inp", out var ninp);
                    var selIndex = 0;
                    int.TryParse(nsel, out selIndex);
                    var inPoss = ninp == "1";
                    MainThread.Enqueue(() => EventLog.Add("game", "nativerole result " + GameTools.FireNativeRole(nt ?? "0", selIndex, inPoss, nr ?? "0")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/bindings/getpath": {
                    query.TryGetValue("path", out var bp);
                    MainThread.Enqueue(() => EventLog.Add("game", "getpath result " + GameTools.GetPath(bp ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/bindings/getrel": {
                    query.TryGetValue("root", out var broot);
                    query.TryGetValue("path", out var brel);
                    MainThread.Enqueue(() => EventLog.Add("game", "getrel result " + GameTools.GetRelative(broot ?? "0", brel ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/bindings/makekey": {
                    query.TryGetValue("path", out var mkp);
                    MainThread.Enqueue(() => EventLog.Add("game", "makekey result " + GameTools.MakeKeyForPath(mkp ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/panel/params": {
                    query.TryGetValue("name", out var pname);
                    MainThread.Enqueue(() => EventLog.Add("game", "panel params result " + GameTools.PanelParams(pname ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/panel/openparams": {
                    query.TryGetValue("name", out var pname2);
                    MainThread.Enqueue(() => EventLog.Add("game", "panel openparams result " + GameTools.OpenPanelWithParams(pname2 ?? string.Empty)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/panel/assets":
                    MainThread.Enqueue(() => EventLog.Add("game", "panel assets result " + GameTools.PanelAssets()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/panel/openid": {
                    var panelId2 = ParseInt(query, "id", 0);
                    MainThread.Enqueue(() => EventLog.Add("game", "panel openid result " + GameTools.OpenPanelAsset((uint)panelId2)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/panel/showtab": {
                    query.TryGetValue("suffix", out var showSuffix);
                    if (string.IsNullOrEmpty(showSuffix))
                    {
                        return (400, Error("suffix required"));
                    }
                    MainThread.Enqueue(() => EventLog.Add("game", "showtab result " + GameTools.ShowPanelBySuffix(showSuffix)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/panel/list":
                    MainThread.Enqueue(() => EventLog.Add("game", "panel list result " + GameTools.PanelList()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/panel/open": {
                    var panelId = ParseInt(query, "id", 0);
                    MainThread.Enqueue(() => EventLog.Add("game", "panel open result " + GameTools.OpenPanelById((uint)panelId)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/nav/opentab": {
                    query.TryGetValue("suffix", out var tabSuffix);
                    if (string.IsNullOrEmpty(tabSuffix))
                    {
                        return (400, Error("suffix required"));
                    }
                    MainThread.Enqueue(() => EventLog.Add("game", "opentab result " + GameTools.OpenTabPanel(tabSuffix)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/nav/list":
                    MainThread.Enqueue(() => EventLog.Add("game", "nav list result " + GameTools.NavList()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/nav/open": {
                    var idx = ParseInt(query, "index", 0);
                    MainThread.Enqueue(() => EventLog.Add("game", "nav open result " + GameTools.NavOpen(idx)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/game/continuedirect":
                    return (410, Error("Unconditional direct continuation retired. Use guarded continuation and process required manager messages through their actual business actions."));
                case "/game/loadrecord":
                    MainThread.Enqueue(() => EventLog.Add("game", "loadrecord result " + GameTools.LoadRecord()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/game/loadlast":
                    MainThread.Enqueue(() => EventLog.Add("game", "loadlast result " + GameTools.LoadLastSave()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/game/continue":
                    return (410, Error("Unconditional continuation is retired: preview /api/v1/game/continue-state and POST /api/v1/game/request-continue with its token, identity, cursor and operation ID."));
                case "/event/send": {
                    query.TryGetValue("name", out var evtName);
                    if (string.IsNullOrEmpty(evtName))
                    {
                        return (400, Error("name required"));
                    }
                    MainThread.Enqueue(() => EventLog.Add("game", "event send result " + GameTools.SendEventByName(evtName)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/game/lastsave":
                    MainThread.Enqueue(() => EventLog.Add("game", "lastsave result " + GameTools.ConfirmLastSave()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/game/confirmload":
                    MainThread.Enqueue(() => EventLog.Add("game", "confirmload result " + GameTools.ConfirmLastSaveOnClick()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/game/probe":
                    MainThread.Enqueue(() => EventLog.Add("game", "probe " + GameTools.Probe()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/ui/probe":
                    MainThread.Enqueue(UiTools.Probe);
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/ui/panels":
                    return (200, UiTools.PanelsJson());
                case "/ui/documents":
                    return (200, UiTools.DocumentsJson());
                case "/ui/subtree": {
                    query.TryGetValue("path", out var subPath);
                    return (200, UiTools.SubtreeJson(ParseInt(query, "root", 0), subPath ?? string.Empty, ParseInt(query, "depth", 5), ParseInt(query, "limit", 3000)));
                }
                case "/ui/roots":
                    return (200, UiTools.RootsJson());
                case "/ui/scan":
                    MainThread.Enqueue(() => { UiTools.ScanPanels(); UiTools.ScanDocuments(); });
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/ui/tree": {
                    var rootIndex = ParseInt(query, "root", 0);
                    var depth = ParseInt(query, "depth", 4);
                    var limit = ParseInt(query, "limit", 800);
                    return (200, UiTools.TreeJson(rootIndex, depth, limit));
                }
                case "/ui/find": {
                    query.TryGetValue("text", out var text);
                    query.TryGetValue("name", out var name);
                    return (200, UiTools.Find(text ?? string.Empty, name ?? string.Empty, ParseInt(query, "root", -1)));
                }
                case "/ui/click": {
                    query.TryGetValue("path", out var clickPath);
                    if (string.IsNullOrEmpty(clickPath))
                    {
                        return (400, Error("path required"));
                    }
                    var root = ParseInt(query, "root", 0);
                    query.TryGetValue("mode", out var clickMode);
                    MainThread.Enqueue(() => EventLog.Add("ui-toolkit", "click result " + UiTools.ClickByPath(root, clickPath, clickMode ?? "all")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ui/click_text": {
                    query.TryGetValue("text", out var clickText);
                    if (string.IsNullOrEmpty(clickText))
                    {
                        return (400, Error("text required"));
                    }
                    var root = ParseInt(query, "root", 0);
                    var levels = ParseInt(query, "levels", 0);
                    query.TryGetValue("mode", out var clickMode2);
                    MainThread.Enqueue(() => EventLog.Add("ui-toolkit", "click_text result " + UiTools.ClickTextWithAncestor(root, clickText, levels, clickMode2 ?? "all")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/ui/click_name": {
                    query.TryGetValue("name", out var clickName);
                    if (string.IsNullOrEmpty(clickName))
                    {
                        return (400, Error("name required"));
                    }
                    var root = ParseInt(query, "root", 0);
                    MainThread.Enqueue(() => EventLog.Add("ui-toolkit", "click_name result " + UiTools.ClickByName(root, clickName)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/evsub":
                    return (200, "{\"ok\":true,\"subsystem\":\"" + Shared.PointerOf(Shared.EventSubsystem) + "\",\"dispatcher\":\"" + Shared.PointerOf(Shared.Dispatcher) + "\"}");
                case "/events": {
                    query.TryGetValue("kind", out var kindFilter);
                    return (200, Observe.ListJson(kindFilter ?? string.Empty, ParseLong(query, "since", 0), ParseInt(query, "limit", 80)));
                }
                case "/events/clear":
                    return (200, Observe.Clear());
                case "/observe": {
                    query.TryGetValue("on", out var onValue);
                    if (onValue != null)
                    {
                        Observe.Enabled = onValue != "0";
                    }
                    query.TryGetValue("deep", out var deepValue);
                    if (deepValue != null)
                    {
                        Observe.Deep = deepValue == "1";
                    }
                    query.TryGetValue("bindings", out var bindingsValue);
                    if (bindingsValue != null)
                    {
                        Observe.BindingsEnabled = bindingsValue == "1";
                    }
                    return (200, "{\"ok\":true,\"enabled\":" + (Observe.Enabled ? "true" : "false") + ",\"deep\":" + (Observe.Deep ? "true" : "false") + ",\"bindings\":" + (Observe.BindingsEnabled ? "true" : "false") + "}");
                }
                case "/bindings/walk": {
                    query.TryGetValue("filter", out var filter);
                    var depth = ParseInt(query, "depth", 10);
                    var max = ParseInt(query, "max", 3000);
                    MainThread.Enqueue(() => EventLog.Add("bindings", "walk result " + BindingTools.Walk(filter ?? string.Empty, depth, max, query.TryGetValue("values", out var v1) && v1 == "1")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/bindings/walknow": {
                    query.TryGetValue("filter", out var filter2);
                    return (200, BindingTools.Walk(filter2 ?? string.Empty, ParseInt(query, "depth", 10), ParseInt(query, "max", 3000), query.TryGetValue("values", out var v2) && v2 == "1"));
                }
                case "/bindings/set": {
                    query.TryGetValue("key", out var keyHex);
                    query.TryGetValue("value", out var val);
                    query.TryGetValue("string", out var isString);
                    MainThread.Enqueue(() => EventLog.Add("bindings", "set result " + BindingTools.SetByKey(keyHex ?? string.Empty, val ?? "0", isString == "1")));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                case "/modules":
                    MainThread.Enqueue(() => EventLog.Add("game", "modules result " + GameTools.ProbeModules()));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                case "/replay": {
                    var seq = ParseInt(query, "seq", 0);
                    MainThread.Enqueue(() => EventLog.Add("replay", "replay result " + GameEventStore.Replay(seq)));
                    return (200, "{\"ok\":true,\"queued\":true,\"pending\":" + MainThread.Pending + "}");
                }
                default:
                    return (404, Error("unknown path: " + path));
            }
    }

    private static string Log(Dictionary<string, string> query)
    {
        var limit = 200;
        if (query.TryGetValue("limit", out var limitText))
        {
            int.TryParse(limitText, out limit);
        }
        query.TryGetValue("category", out var category);
        long since = 0;
        if (query.TryGetValue("since", out var sinceText))
        {
            long.TryParse(sinceText, out since);
        }
        var entries = EventLog.Snapshot(limit, category, since);
        var sb = new StringBuilder();
        sb.Append('[');
        for (var i = 0; i < entries.Count; i++)
        {
            if (i > 0)
            {
                sb.Append(',');
            }
            var entry = entries[i];
            sb.Append("{\"seq\":").Append(entry.Seq)
                .Append(",\"time\":").Append(entry.TimeUtcMs)
                .Append(",\"category\":\"").Append(Js(entry.Category))
                .Append("\",\"message\":\"").Append(Js(entry.Message)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static string EnumDump(Dictionary<string, string> query)
    {
        query.TryGetValue("name", out var name);
        var sb = new StringBuilder();
        sb.Append('[');
        var first = true;
        foreach (var type in LoadedTypes().Where(t => t.IsEnum))
        {
            if (!string.IsNullOrEmpty(name) && type.Name.IndexOf(name, StringComparison.OrdinalIgnoreCase) < 0)
            {
                continue;
            }
            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                sb.Append("{\"enum\":\"").Append(Js(type.Name)).Append("\",\"name\":\"").Append(Js(field.Name))
                    .Append("\",\"value\":").Append(Convert.ToUInt64(field.GetRawConstantValue())).Append('}');
            }
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static string Types(Dictionary<string, string> query)
    {
        query.TryGetValue("filter", out var filter);
        var limit = 300;
        if (query.TryGetValue("limit", out var limitText))
        {
            int.TryParse(limitText, out limit);
        }
        var sb = new StringBuilder();
        sb.Append('[');
        var first = true;
        var count = 0;
        foreach (var type in LoadedTypes().OrderBy(t => t.FullName, StringComparer.Ordinal))
        {
            if (!string.IsNullOrEmpty(filter) && type.FullName != null
                && type.FullName.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0)
            {
                continue;
            }
            if (count++ >= limit)
            {
                break;
            }
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            sb.Append("{\"name\":\"").Append(Js(type.FullName)).Append("\",\"assembly\":\"").Append(Js(type.Assembly.GetName().Name)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static string Methods(Dictionary<string, string> query)
    {
        query.TryGetValue("type", out var typeName);
        if (string.IsNullOrEmpty(typeName))
        {
            return Error("type required");
        }
        var type = ResolveType(typeName);
        if (type == null)
        {
            return Error("type not found: " + typeName);
        }
        var sb = new StringBuilder();
        sb.Append('[');
        var first = true;
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                     .OrderBy(m => m.Name, StringComparer.Ordinal))
        {
            if (!first)
            {
                sb.Append(',');
            }
            first = false;
            var parameters = string.Join(",", method.GetParameters().Select(p => p.ParameterType.Name + " " + p.Name));
            sb.Append("{\"name\":\"").Append(Js(method.Name)).Append("\",\"static\":").Append(method.IsStatic ? "true" : "false")
                .Append(",\"params\":\"").Append(Js(parameters)).Append("\",\"returnType\":\"").Append(Js(method.ReturnType.Name)).Append("\"}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static IEnumerable<Type> LoadedTypes()
    {
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type[] types;
            try
            {
                types = assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                types = ex.Types.Where(t => t != null).ToArray();
            }
            catch
            {
                continue;
            }
            foreach (var type in types)
            {
                yield return type;
            }
        }
    }

    private static Type ResolveType(string name)
    {
        var direct = Type.GetType(name);
        if (direct != null)
        {
            return direct;
        }
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            var candidate = assembly.GetType(name);
            if (candidate != null)
            {
                return candidate;
            }
        }
        return null;
    }
}
