using System;
using System.Collections.Generic;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>比赛、新闻收件箱、会谈、时间推进、能力探测、Live 订阅与内部白名单 HTTP 路由。</summary>
public static partial class HttpApi
{
    private static bool TryDispatchMatchAndManager(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand,
        out (int Status, string Json) response)
    {
        response = default;
        (int Status, string Json)? matched = ExecuteTryDispatchMatchAndManager(method, path, query, body, RunPlayerCommand);
        if (!matched.HasValue) return false;
        response = matched.Value;
        return true;
    }

    private static (int Status, string Json)? ExecuteTryDispatchMatchAndManager(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand)
    {
            if (path.Equals("/api/v1/capabilities", StringComparison.OrdinalIgnoreCase))
                return method == "GET" ? (200, LiveTools.JsonText(RuntimeCapabilities.Read())) : (405, "{\"ok\":false,\"error\":\"Use GET\"}");
            if (path.StartsWith("/api/v1/game/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.Equals("/api/v1/game/continue-receipt", StringComparison.OrdinalIgnoreCase))
                    return method == "GET" ? LiveTools.Run(() => ContinueCommands.Lookup(Arg("id"))) : (405, Error("Use GET"));
                if (path.Equals("/api/v1/game/continue-state", StringComparison.OrdinalIgnoreCase))
                    return method == "GET" ? LiveTools.Run(() => ContinueCommands.Read(Arg("waiting"), Arg("date"), Arg("operationId"))) : (405, Error("Use GET"));
                if (path.Equals("/api/v1/game/request-continue", StringComparison.OrdinalIgnoreCase))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => ContinueCommands.Execute(Arg("id"), Arg("waiting"), Arg("date"), Arg("gameIdentity"), Arg("choiceToken"),
                        long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture)));
                }
                return (404, Error("Unknown game command endpoint"));
            }
            if (path.StartsWith("/api/v1/staff-meeting/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/apply-all-preview")) return LiveTools.Run(() => StaffMeetingCommands.Preview(Arg("staffMeeting")));
                if (path.EndsWith("/apply-all-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => StaffMeetingCommands.Execute(Arg("id"), Arg("staffMeeting"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown staff meeting endpoint\"}");
            }
            if (path.StartsWith("/api/v1/induction/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/read")) return LiveTools.Run(() => InductionCommands.Read(Arg("inbox"), Arg("path"), Arg("induction"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("complete"), Arg("step"), Arg("maxStep")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => InductionCommands.Execute(Arg("id"), Arg("inbox"), Arg("path"), Arg("induction"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("complete"), Arg("step"), Arg("maxStep"), ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation") == "" ? "false" : Arg("acceptConfirmation"))));
                }
                return (404, Error("Unknown induction endpoint"));
            }
            if (path.StartsWith("/api/v1/communication/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/actions")) return LiveTools.Run(() => CommunicationCommands.Describe(Arg("source"), Arg("path"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => CommunicationCommands.Execute(Arg("id"), Arg("source"), Arg("path"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(query.TryGetValue("acceptConfirmation", out var accept) ? accept : "false")));
                }
                return (404, Error("Unknown communication endpoint"));
            }
            if (path.StartsWith("/api/v1/staff-advice/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/full-preview")) return LiveTools.Run(() => StaffAdviceCommands.PreviewFullAdvice());
                if (path.EndsWith("/full-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => StaffAdviceCommands.ExecuteFullAdvice(Arg("id"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown staff advice endpoint\"}");
            }
            if (path.StartsWith("/api/v1/conversations/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/replies")) return LiveTools.Run(() => ConversationReplyCommands.Describe(Arg("source"), Arg("path"), Arg("session"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), Arg("flat", "{}")));
                if (path.EndsWith("/reply"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => ConversationReplyCommands.Execute(Arg("id"), Arg("source"), Arg("path"), Arg("session"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), ParseInt(query, "index", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                }
                return (404, Error("Unknown conversation endpoint"));
            }
            if (path.StartsWith("/api/v1/news/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/read-state")) return LiveTools.Run(() => NewsCommands.ReadFlag(Arg("inbox"), Arg("path"), Arg("team"), Arg("readFlag"), Arg("expectedNewsIdentity"), Arg("operationId")));
                if (path.EndsWith("/set-read-state"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => NewsCommands.SetRead(Arg("id"), Arg("inbox"), Arg("path"), Arg("team"), Arg("readFlag"), Arg("expectedNewsIdentity"), Arg("choiceToken"), bool.Parse(Arg("isRead", "true"))));
                }
                if (path.EndsWith("/set-unread-state"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => NewsCommands.SetUnread(Arg("id"), Arg("inbox"), Arg("path"), Arg("team"), Arg("readFlag"), Arg("expectedNewsIdentity"), Arg("choiceToken")));
                }
                if (path.EndsWith("/mark-all-read-preview")) return LiveTools.Run(() => InboxManagement.Preview(Arg("team"), Arg("unread"), Arg("operationId")));
                if (path.EndsWith("/mark-all-read"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => InboxManagement.Execute(Arg("id"), Arg("team"), Arg("unread"), Arg("choiceToken")));
                }
                if (path.EndsWith("/describe")) return LiveTools.Run(() => NewsCommands.Describe(Arg("inbox"), Arg("path"), Arg("canRespond"), Arg("hasResponded"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), Arg("title")));
                if (path.EndsWith("/state")) return LiveTools.Run(() => NewsCommands.Read(Arg("inbox"), Arg("path"), Arg("canRespond"), Arg("hasResponded")));
                if (path.EndsWith("/open-press-conference"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => NewsCommands.OpenPressConference(Arg("id"), Arg("expectedNewsIdentity"),
                        Arg("inbox"), Arg("path"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options")));
                }
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => NewsCommands.Execute(Arg("id"), Arg("inbox"), Arg("path"), Arg("canRespond"), Arg("hasResponded"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown news endpoint\"}");
            }
            if (path.StartsWith("/api/v1/match/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/controller-diagnostics"))
                {
                    if (method != "GET") return (405, Error("Use GET"));
                    return LiveTools.Run(MatchCommands.DiagnoseControllers);
                }
                if (path.StartsWith("/api/v1/match/shouts/", StringComparison.OrdinalIgnoreCase))
                {
                    if (path.EndsWith("/players-state")) return LiveTools.Run(() => MatchShoutCommands.ReadPlayers(Arg("tactic"), Arg("channels"), Arg("operationId")));
                    if (path.EndsWith("/players-preview")) return LiveTools.Run(() => MatchShoutCommands.PreviewPlayers(Arg("tactic"), Arg("channels"), Arg("playerIndices", "[]")));
                    if (path.EndsWith("/players-execute"))
                    {
                        if (method != "POST") return (405, Error("Use POST"));
                        return RunPlayerCommand(() => MatchShoutCommands.SelectPlayers(Arg("id"), Arg("tactic"), Arg("channels"), Arg("playerIndices", "[]"), Arg("choiceToken")));
                    }
                    if (path.EndsWith("/state")) return LiveTools.Run(() => MatchShoutCommands.Read(Arg("tactic"), Arg("channels")));
                    if (path.EndsWith("/preview")) return LiveTools.Run(() => MatchShoutCommands.Preview(Arg("tactic"), Arg("channels"), Arg("kind"), ParseInt(query, "option", -1)));
                    if (path.EndsWith("/execute"))
                    {
                        if (method != "POST") return (405, Error("Use POST"));
                        return RunPlayerCommand(() => MatchShoutCommands.Execute(Arg("id"), Arg("tactic"), Arg("channels"), Arg("kind"), ParseInt(query, "option", -1), Arg("choiceToken")));
                    }
                    return (404, Error("Unknown match-shout endpoint"));
                }
                if (path.StartsWith("/api/v1/match/team-talk/", StringComparison.OrdinalIgnoreCase))
                {
                    if (path.EndsWith("/state")) return LiveTools.Run(() => TeamTalkCommands.Read(Arg("tactic"), Arg("talk"), Arg("channels"), Arg("config"), Arg("operationId")));
                    if (path.EndsWith("/actions")) return LiveTools.Run(() => TeamTalkCommands.Describe(Arg("tactic"), Arg("talk"), Arg("channels"), Arg("config"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket")));
                    if (path.EndsWith("/selection-preview")) return LiveTools.Run(() => TeamTalkCommands.PreviewSelection(Arg("tactic"), Arg("talk"), Arg("channels"), Arg("config"), Arg("kind"), ParseInt(query, "option", -1), Arg("playerPaths", "[]")));
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    if (path.EndsWith("/select")) return RunPlayerCommand(() => TeamTalkCommands.Select(Arg("id"), Arg("tactic"), Arg("talk"), Arg("channels"), Arg("config"), Arg("kind"), ParseInt(query, "option", -1), Arg("playerPaths", "[]"), Arg("choiceToken")));
                    if (path.EndsWith("/execute")) return RunPlayerCommand(() => TeamTalkCommands.Execute(Arg("id"), Arg("tactic"), Arg("talk"), Arg("channels"), Arg("config"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                    return (404, "{\"ok\":false,\"error\":\"Unknown team-talk endpoint\"}");
                }
                if (path.EndsWith("/substitution-preview")) return LiveTools.Run(() => SubstitutionCommands.Preview(Arg("tactic"), Arg("options"), Arg("current"), Arg("pending"), ParseInt(query, "option", -1), ParseInt(query, "slot", -1), Arg("playbackPolicy", "restore")));
                if (path.EndsWith("/substitution-status")) return LiveTools.Run(() => SubstitutionCommands.Status(Arg("id")));
                if (path.EndsWith("/stage-state")) return LiveTools.Run(() => MatchStageCommands.Read(Arg("waiting"), Arg("date"), Arg("tactic"), Arg("pending"), Arg("managerSide"), Arg("operationId")));
                if (path.EndsWith("/stage-continue"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => MatchStageCommands.Execute(Arg("id"), Arg("waiting"), Arg("date"), Arg("tactic"), Arg("pending"), Arg("managerSide"), Arg("matchIdentity"), Arg("choiceToken"),
                        long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture)));
                }
                if (path.EndsWith("/simulation-state")) return LiveTools.Run(SimulationState.Read);
                if (path.EndsWith("/state")) return LiveTools.Run(() => MatchCommands.State(Arg("operationId")));
                if (path.EndsWith("/person-key")) return LiveTools.Run(() => MatchCommands.PersonKey(Arg("source"), Arg("path")));
                if (path.EndsWith("/activity-state")) return LiveTools.Run(() => MatchCommands.Activity(long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture), Arg("owner")));
                if (path.EndsWith("/draft-state")) return LiveTools.Run(() => MatchCommands.ObserveDraft(Arg("operationId"), Arg("action"), Arg("tactic"), Arg("pending")));
                if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                if (path.EndsWith("/substitution-register")) return RunPlayerCommand(() => SubstitutionCommands.Register(Arg("id"), Arg("tactic"), Arg("options"), Arg("current"), Arg("pending"), ParseInt(query, "option", -1), ParseInt(query, "slot", -1), Arg("playbackPolicy", "restore"), Arg("planToken")));
                if (path.EndsWith("/substitution-phase")) return RunPlayerCommand(() => SubstitutionCommands.Phase(Arg("id"), Arg("phase"), Arg("action"), Arg("error"), Arg("tactic"), Arg("ip"), Arg("oop")));
                if (path.EndsWith("/substitution-baseline")) return RunPlayerCommand(() => SubstitutionCommands.Baseline(Arg("id"), Arg("roster"), Arg("resolutions")));
                if (path.EndsWith("/substitution-observe")) return RunPlayerCommand(() => SubstitutionCommands.Observe(Arg("id"), Arg("roster"), Arg("resolutions")));
                if (path.EndsWith("/set-playing")) return RunPlayerCommand(() => MatchCommands.SetPlaying(Arg("id"), bool.Parse(Arg("playing")), bool.Parse(Arg("expected")),
                    ParseLong(query, "mutationCursor", -1), Arg("matchIdentity"), Arg("sessionId"), ParseInt(query, "epoch", -1)));
                if (path.EndsWith("/begin-draft")) return RunPlayerCommand(() => MatchCommands.BeginDraft(Arg("id"), Arg("tactic"), long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture), Arg("data")));
                if (path.EndsWith("/draft")) return RunPlayerCommand(() => MatchCommands.ChangeDraft(Arg("id"), Arg("action"), Arg("tactic"), Arg("pending"), Arg("valid"), bool.Parse(Arg("expected")), long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture)));
                return (404, "{\"ok\":false,\"error\":\"Unknown match endpoint\"}");
            }
            if (path.StartsWith("/api/v1/actions/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/offered")) return LiveTools.Run(() => ActionCommands.Describe(Arg("offered")));
                if (path.EndsWith("/initiation")) return LiveTools.Run(ActionCommands.Initiation);
                var entry = System.Text.Json.JsonSerializer.Deserialize<int[]>(Arg("entry", "[]"));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ActionCommands.Preview(Arg("offered"), Arg("action"), Arg("items"), entry));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ActionCommands.Execute(Arg("id"), Arg("offered"), Arg("action"), Arg("items"), entry, long.Parse(Arg("expectedRevision")), Arg("expectedChoiceToken"), Arg("source"), Arg("path")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown action endpoint\"}");
            }
            if (path.StartsWith("/api/v1/internal/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var text) ? text : fallback;
                if (path.EndsWith("/registry")) return LiveTools.Run(() => InternalCommands.Registry(Arg("kind", "properties"), Arg("filter")));
                if (path.EndsWith("/continue-state")) return LiveTools.Run(InternalCommands.ContinueState);
                if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                if (path.EndsWith("/event")) return LiveTools.Run(() => InternalCommands.Send(Arg("id"), Arg("event"), Arg("source", "none"), Arg("path"), body, Arg("apply") == "true"));
                if (path.EndsWith("/update")) return LiveTools.Run(() => InternalCommands.Update(Arg("handle"), body, Arg("apply") == "true"));
                return (404, "{\"ok\":false,\"error\":\"Unknown internal endpoint\"}");
            }
            if (path.StartsWith("/api/v1/commands/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var text) ? text : fallback;
                if (path.EndsWith("/pick-preview")) return LiveTools.Run(() => LineupCommands.Preview(Arg("tactic"), Arg("options"), Arg("current"), ParseInt(query, "option", -1), ParseInt(query, "slot", -1), Arg("variant")));
                if (path.EndsWith("/pick-state")) return LiveTools.Run(() => LineupCommands.Read(Arg("tactic"), Arg("current"), ParseInt(query, "slot", -1), Arg("operationId")));
                if (path.EndsWith("/set-mentality") || path.EndsWith("/set-instruction") || path.EndsWith("/pick-player"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    if (path.EndsWith("/set-mentality")) return RunPlayerCommand(() => PlayerCommands.Mentality(Arg("id"), Arg("tactic"),
                        Arg("current"), Arg("write"), Arg("options"), Arg("optionPath"), Arg("expected")));
                    if (path.EndsWith("/pick-player")) return RunPlayerCommand(() => LineupCommands.Execute(Arg("id"), Arg("tactic"),
                        Arg("options"), Arg("current"), ParseInt(query, "option", -1), ParseInt(query, "slot", -1), Arg("expected"), Arg("choiceToken"), long.Parse(Arg("mutationCursor", "-1"), System.Globalization.CultureInfo.InvariantCulture), Arg("variant")));
                    return RunPlayerCommand(() => PlayerCommands.Instruction(Arg("id"), Arg("tactic"), Arg("current"), Arg("locked"), Arg("kind"),
                        ParseInt(query, "group", -1), LiveTools.ParseId(Arg("option")), ParseInt(query, "slot", -1), bool.Parse(Arg("inPossession", "true")), Arg("expected")));
                }
                if (path.EndsWith("/stage-budget-allocation"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => BudgetCommands.Adjust(Arg("id"), Arg("budget"), Arg("current"), Arg("limits"), Arg("editable"), ParseInt(query, "index", -1), Arg("expected")));
                }
                if (path.EndsWith("/preview-budget-confirm")) return LiveTools.Run(() => BudgetCommands.PreviewConfirm(Arg("budget"), Arg("current"), Arg("editable"), Arg("transfer"), Arg("other")));
                if (path.EndsWith("/confirm-budget-allocation"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => BudgetCommands.Confirm(Arg("id"), Arg("budget"), Arg("current"), Arg("editable"), Arg("transfer"), Arg("other"), Arg("confirmationToken")));
                }
                if (path.Equals("/api/v1/commands/set-role", StringComparison.OrdinalIgnoreCase))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TacticCommands.SetRole(Arg("id"), Arg("tactic"), Arg("options"), Arg("current"),
                        ParseInt(query, "option", -1), ParseInt(query, "slot", -1), bool.Parse(Arg("inPossession")), Arg("expected")));
                }
                if (path.Equals("/api/v1/commands/status", StringComparison.OrdinalIgnoreCase))
                    return LiveTools.Run(() => SubstitutionCommands.ContainsRoot(Arg("id")) ? SubstitutionCommands.Status(Arg("id")) : CommandOperations.Contains(Arg("id")) ? CommandOperations.Get(Arg("id")) :
                        TacticCommands.Contains(Arg("id")) ? TacticCommands.Get(Arg("id")) : ActionCommands.Status(Arg("id")));
                if (path.Equals("/api/v1/commands/set-formation", StringComparison.OrdinalIgnoreCase))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TacticCommands.SetFormation(Arg("id"), Arg("tactic"), Arg("options"), Arg("current"),
                        Arg("optionPath"), bool.Parse(Arg("inPossession")), Arg("expected")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown command\"}");
            }
            if (path.StartsWith("/api/v1/live/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var text) ? text : fallback;
                if (method != "GET" && method != "POST") return (405, "{\"ok\":false,\"error\":\"Unsupported method\"}");
                switch (path.ToLowerInvariant())
                {
                    case "/api/v1/live/properties":
                        return LiveTools.Run(() => LiveTools.Properties(Arg("source", "game"), Arg("path"), Arg("filter")));
                    case "/api/v1/live/open":
                        if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                        return LiveTools.Run(() => LiveTools.Open(Arg("source", "game"), Arg("path"), LiveTools.ParseId(Arg("property")), Arg("contexts")));
                    case "/api/v1/live/read":
                        return LiveTools.Run(() => LiveTools.Read(Arg("handle"), Arg("path"), ParseInt(query, "depth", 3)));
                    case "/api/v1/live/close":
                        if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                        return LiveTools.Run(() => LiveTools.Close(Arg("handle")));
                    case "/api/v1/live/selftest":
                        return LiveTools.Run(LiveTools.SelfTest);
                    default: return (404, "{\"ok\":false,\"error\":\"Unknown live endpoint\"}");
                }
            }
        return null;
    }
}
