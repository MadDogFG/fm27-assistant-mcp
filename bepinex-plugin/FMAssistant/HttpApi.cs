using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>Tiny localhost HTTP API for the agent (no HttpListener ACL required).</summary>
public static class HttpApi
{
    public const int DefaultPort = 27190;

    public static volatile bool LoggingEnabled = true;
    public static volatile bool LogAllUiEvents;

    private static TcpListener _listener;
    private static int Port = DefaultPort;

    public static void Start()
    {
        var configured = Environment.GetEnvironmentVariable("FM_ASSISTANT_PORT");
        if (int.TryParse(configured, out var parsed) && parsed > 0 && parsed < 65536)
        {
            Port = parsed;
        }
        try
        {
            _listener = new TcpListener(IPAddress.Loopback, Port);
            _listener.Start();
            var thread = new Thread(AcceptLoop)
            {
                IsBackground = true,
                Name = "FMAssistant-Http",
            };
            thread.Start();
            EventLog.Add("system", $"HTTP listening on http://127.0.0.1:{Port}/");
        }
        catch (Exception ex)
        {
            EventLog.Add("error", "HTTP start failed: " + ex);
        }
    }

    private static void AcceptLoop()
    {
        while (true)
        {
            try
            {
                var client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
            }
            catch (Exception ex)
            {
                EventLog.Add("error", "accept failed: " + ex.Message);
                Thread.Sleep(200);
            }
        }
    }

    private static void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            {
                client.ReceiveTimeout = 5000;
                using var stream = client.GetStream();
                var (method, path, query, body) = ReadRequest(stream);
                Diagnostics.Log("http " + method + " " + path);
                var (status, json) = Dispatch(method, path, query, body);
                Diagnostics.Log("http_done " + method + " " + path + " " + status);
                WriteResponse(stream, status, json);
            }
        }
        catch (Exception ex)
        {
            Diagnostics.Log("http_error " + ex.GetType().Name + " " + ex.Message);
            EventLog.Add("error", "http handler: " + ex.Message);
        }
    }

    private static (string Method, string Path, Dictionary<string, string> Query, string Body) ReadRequest(Stream stream)
    {
        var buffer = new List<byte>(8192);
        var chunk = new byte[4096];
        var headerEnd = -1;
        while (headerEnd < 0)
        {
            var read = stream.Read(chunk, 0, chunk.Length);
            if (read <= 0)
            {
                break;
            }
            for (var i = 0; i < read; i++)
            {
                buffer.Add(chunk[i]);
            }
            var text = Encoding.UTF8.GetString(buffer.ToArray());
            headerEnd = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        }

        var all = Encoding.UTF8.GetString(buffer.ToArray());
        var split = all.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        var headerText = split >= 0 ? all.Substring(0, split) : all;
        var lines = headerText.Split("\r\n");
        var requestLine = lines.Length > 0 ? lines[0] : string.Empty;
        var parts = requestLine.Split(' ');
        var method = parts.Length > 0 ? parts[0].ToUpperInvariant() : "GET";
        var rawPath = parts.Length > 1 ? parts[1] : "/";
        var queryIndex = rawPath.IndexOf('?', StringComparison.Ordinal);
        var path = queryIndex >= 0 ? rawPath.Substring(0, queryIndex) : rawPath;
        var query = queryIndex >= 0 ? ParseQuery(rawPath.Substring(queryIndex + 1)) : new Dictionary<string, string>();

        var contentLength = 0;
        foreach (var line in lines)
        {
            var normalized = line.ToLowerInvariant();
            if (normalized.StartsWith("content-length:"))
            {
                int.TryParse(line.Substring(15).Trim(), out contentLength);
            }
        }

        var body = string.Empty;
        if (contentLength > 0)
        {
            var already = split >= 0 ? Encoding.UTF8.GetByteCount(all.Substring(split + 4)) : 0;
            var bodyBuffer = new byte[contentLength];
            var offset = 0;
            if (already > 0)
            {
                var existing = Encoding.UTF8.GetBytes(all.Substring(split + 4));
                offset = Math.Min(existing.Length, contentLength);
                Array.Copy(existing, bodyBuffer, offset);
            }
            while (offset < contentLength)
            {
                var read = stream.Read(bodyBuffer, offset, contentLength - offset);
                if (read <= 0)
                {
                    break;
                }
                offset += read;
            }
            body = Encoding.UTF8.GetString(bodyBuffer, 0, offset);
        }

        return (method, path, query, body);
    }

    private static Dictionary<string, string> ParseQuery(string raw)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in raw.Split('&'))
        {
            if (pair.Length == 0)
            {
                continue;
            }
            var index = pair.IndexOf('=', StringComparison.Ordinal);
            if (index < 0)
            {
                result[System.Net.WebUtility.UrlDecode(pair)] = string.Empty;
            }
            else
            {
                result[System.Net.WebUtility.UrlDecode(pair.Substring(0, index))] = System.Net.WebUtility.UrlDecode(pair.Substring(index + 1));
            }
        }
        return result;
    }

    private static (int Status, string Json) Dispatch(string method, string path, Dictionary<string, string> query, string body)
    {
        var requestOperationId = query.TryGetValue("id", out var operationId) ? operationId : null;
        (int Status, string Json) RunPlayerCommand(Func<object> action) => LiveTools.RunCommand(() => {
            SubstitutionCommands.ValidateChildCall(requestOperationId, path, query);
            return action();
        }, requestOperationId, path);
        try
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
            if (path.Equals("/api/v1/tactics/catalog", StringComparison.OrdinalIgnoreCase))
                return LiveTools.Run(() => InstructionCatalog.Get(query.TryGetValue("kind", out var kind) ? kind : "team"));
            if (path.StartsWith("/api/v1/tactics/suggestion", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (method == "GET") return LiveTools.Run(() => TacticSuggestionCommands.Preview(Arg("kind"), Arg("tactic"), Arg("suggestedTeam"), Arg("suggestedChanges")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => TacticSuggestionCommands.Execute(Arg("id"), Arg("kind"), Arg("tactic"), Arg("suggestedTeam"), Arg("suggestedChanges"), Arg("choiceToken")));
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
            if (path.StartsWith("/api/v1/match-preparation/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/session-confirm-preview")) return LiveTools.Run(() => MatchPreparationSessionCommands.Preview(Arg("calendar"), Arg("eventData")));
                if (path.EndsWith("/session-confirm-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => MatchPreparationSessionCommands.Execute(Arg("id"), Arg("calendar"), Arg("eventData"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown match preparation endpoint\"}");
            }
            if (path.StartsWith("/api/v1/tactics/change", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                bool? Value() => query.TryGetValue("value", out var text) ? bool.TryParse(text, out var parsed) ? parsed : throw new ArgumentException("value must be true/false.") : null;
                if (path.EndsWith("/state")) return LiveTools.Run(() => TacticChangeCommands.Read(Arg("tactic"), Arg("canRevert"), Arg("canConfirm")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TacticChangeCommands.Preview(Arg("action"), Arg("tactic"), Arg("canRevert"), Arg("canConfirm"), Value()));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TacticChangeCommands.Execute(Arg("id"), Arg("action"), Arg("tactic"), Arg("canRevert"), Arg("canConfirm"), Value(), Arg("choiceToken")));
                }
                return (404, Error("Unknown tactic change endpoint"));
            }
            if (path.StartsWith("/api/v1/tactics/opposition-apply", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (method == "GET") return LiveTools.Run(() => OppositionAdviceCommands.Preview(Arg("tactic"), Arg("suggestions")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => OppositionAdviceCommands.Execute(Arg("id"), Arg("tactic"), Arg("suggestions"), Arg("choiceToken")));
            }
            if (path.StartsWith("/api/v1/set-piece/tactic-update-", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/tactic-update-preview")) return LiveTools.Run(() => SetPieceRoutineCommands.Preview(Arg("setPiece")));
                if (path.EndsWith("/tactic-update-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => SetPieceRoutineCommands.Execute(Arg("id"), Arg("setPiece"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown set-piece endpoint\"}");
            }
            if (path.StartsWith("/api/v1/tactics/team-selection-delete", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (method == "GET") return LiveTools.Run(() => TeamSelectionConfirmCommands.DeletePreview(Arg("tactic"), Arg("selections"), Arg("optionPath")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => TeamSelectionConfirmCommands.DeleteExecute(Arg("id"), Arg("tactic"), Arg("selections"), Arg("optionPath"), Arg("choiceToken")));
            }
            if (path == "/api/v1/tactics/lineup-submission" || path == "/api/v1/tactics/submit-lineup")
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/lineup-submission")) return LiveTools.Run(() => LineupSubmissionCommands.Read(Arg("tactic"), Arg("waiting"), Arg("date"), Arg("valid"), Arg("canConfirm"), Arg("message"), Arg("lineup")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => LineupSubmissionCommands.Execute(Arg("id"), Arg("tactic"), Arg("waiting"), Arg("date"), Arg("valid"), Arg("canConfirm"), Arg("message"), Arg("lineup"), Arg("choiceToken"), ParseLong(query, "mutationCursor", -1)));
            }
            if (path.StartsWith("/api/v1/tactics/confirm-selection", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (method == "GET") return LiveTools.Run(() => TeamSelectionConfirmCommands.Preview(Arg("tactic")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => TeamSelectionConfirmCommands.Execute(Arg("id"), Arg("tactic"), Arg("choiceToken")));
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
            if (path.StartsWith("/api/v1/set-piece/creator-", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/creator-state")) return LiveTools.Run(() => SetPieceCreatorCommands.Read(Arg("creator"), Arg("started"), Arg("completed"), Arg("question"), Arg("answers"), Arg("step"), Arg("substep"), Arg("state"), Arg("final"), Arg("maxStep"), Arg("maxSubstep")));
                if (path.EndsWith("/creator-preview")) return LiveTools.Run(() => SetPieceCreatorCommands.Preview(Arg("action"), Arg("creator"), Arg("started"), Arg("completed"), Arg("question"), Arg("answers"), Arg("optionPath"), Arg("step"), Arg("substep"), Arg("state"), Arg("final"), Arg("maxStep"), Arg("maxSubstep")));
                if (path.EndsWith("/creator-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => SetPieceCreatorCommands.Execute(Arg("id"), Arg("action"), Arg("creator"), Arg("started"), Arg("completed"), Arg("question"), Arg("answers"), Arg("optionPath"), Arg("choiceToken"), Arg("step"), Arg("substep"), Arg("state"), Arg("final"), Arg("maxStep"), Arg("maxSubstep")));
                }
                return (404, Error("Unknown set-piece creator endpoint"));
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
            if (path.StartsWith("/api/v1/budget-adjustment/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => ClubBudgetAdjustmentCommands.Read(Arg("budget"), Arg("canEdit"), Arg("board"), Arg("currentSpend"), Arg("ffp"), Arg("scouting"), Arg("agentFees")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ClubBudgetAdjustmentCommands.Preview(Arg("budget"), Arg("canEdit")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ClubBudgetAdjustmentCommands.Execute(Arg("id"), Arg("budget"), Arg("canEdit"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown budget adjustment endpoint\"}");
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
            if (path.StartsWith("/api/v1/training-week-edit/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/copy-preview")) return LiveTools.Run(() => TrainingWeekEditCommands.CopyPreview(Arg("selector"), Arg("date")));
                if (path.EndsWith("/paste-preview")) return LiveTools.Run(() => TrainingWeekEditCommands.PastePreview(Arg("selector"), Arg("date"), Arg("allowed")));
                if (path.EndsWith("/paste-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TrainingWeekEditCommands.PasteExecute(Arg("id"), Arg("selector"), Arg("date"), Arg("allowed"), Arg("choiceToken")));
                }
                if (path.EndsWith("/copy-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingWeekEditCommands.CopyExecute(Arg("id"), Arg("selector"), Arg("date"), Arg("choiceToken")));
                }
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TrainingWeekEditCommands.Preview(Arg("action"), Arg("selector")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingWeekEditCommands.Execute(Arg("id"), Arg("action"), Arg("selector"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown training week edit endpoint\"}");
            }
            if (path.StartsWith("/api/v1/player-side/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/assistant-training-preview")) return LiveTools.Run(() => PlayerSideOperationCommands.AssistantTraining(Arg("training")));
                if (path.EndsWith("/assistant-training-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => PlayerSideOperationCommands.ExecuteAssistantTraining(Arg("id"), Arg("training"), Arg("choiceToken")));
                }
                if (path.EndsWith("/discard-agent-offer-preview")) return LiveTools.Run(() => PlayerSideOperationCommands.DiscardOfferPreview(Arg("person"), query.TryGetValue("all", out var all) && all == "1"));
                if (path.EndsWith("/discard-agent-offer-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => PlayerSideOperationCommands.ExecuteDiscardOffer(Arg("id"), Arg("person"), query.TryGetValue("all", out var all) && all == "1", Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown player-side endpoint\"}");
            }
            if (path.StartsWith("/api/v1/code-of-conduct/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => ClubCodeOfConductCommands.Read(Arg("coc"), Arg("fines"), Arg("finePath"), Arg("fineString"), Arg("canEdit"), Arg("canIncrement"), Arg("canDecrement")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ClubCodeOfConductCommands.Preview(Arg("action"), Arg("coc"), Arg("fines"), Arg("finePath"), Arg("canEdit"), Arg("canIncrement"), Arg("canDecrement"), Arg("fineType"), Arg("dropdown"), Arg("optionPath")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ClubCodeOfConductCommands.Execute(Arg("id"), Arg("action"), Arg("coc"), Arg("fines"), Arg("finePath"), Arg("canEdit"), Arg("canIncrement"), Arg("canDecrement"), Arg("fineType"), Arg("dropdown"), Arg("optionPath"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown code-of-conduct endpoint\"}");
            }
            if (path.StartsWith("/api/v1/captaincy/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => CaptaincyStandinCommands.Read(Arg("player"), Arg("index"), Arg("options"), Arg("canEdit")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => CaptaincyStandinCommands.Preview(Arg("player"), Arg("options"), Arg("canEdit"), Arg("optionPath")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => CaptaincyStandinCommands.Execute(Arg("id"), Arg("player"), Arg("options"), Arg("canEdit"), Arg("optionPath"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown captaincy endpoint\"}");
            }
            if (path.StartsWith("/api/v1/squad/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/player-number-preview")) return LiveTools.Run(() => SquadAdministration.PreviewPlayerNumber(Arg("team"), Arg("session"), Arg("players"), Arg("playerPath"), Arg("current"), Arg("allowed"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/player-number-state")) return LiveTools.Run(() => SquadAdministration.ReadPlayerNumber(Arg("team"), Arg("session"), Arg("players"), Arg("playerPath"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/registration-preview")) return LiveTools.Run(() => RegistrationCommands.Preview(Arg("operation"), Arg("team"), Arg("session"), Arg("selected"), Arg("allowed")));
                if (path.EndsWith("/captain-preview")) return LiveTools.Run(() => SquadAdministration.PreviewCaptain(Arg("team"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry")));
                if (path.EndsWith("/numbers-preview")) return LiveTools.Run(() => SquadAdministration.PreviewNumbers(Arg("operation"), Arg("team"), Arg("session"), Arg("players"), Arg("allowed")));
                if (method != "POST") return (405, Error("Use POST"));
                if (path.EndsWith("/player-number-execute")) return RunPlayerCommand(() => SquadAdministration.SetPlayerNumber(Arg("id"), Arg("team"), Arg("session"), Arg("players"), Arg("playerPath"), Arg("current"), Arg("allowed"), Arg("options"), Arg("optionPath"), Arg("choiceToken")));
                if (path.EndsWith("/registration-execute")) return RunPlayerCommand(() => RegistrationCommands.Execute(Arg("id"), Arg("operation"), Arg("team"), Arg("session"), Arg("selected"), Arg("allowed"), Arg("choiceToken")));
                if (path.EndsWith("/captain-execute")) return RunPlayerCommand(() => SquadAdministration.SetCaptain(Arg("id"), Arg("team"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry"), Arg("choiceToken")));
                if (path.EndsWith("/numbers-execute")) return RunPlayerCommand(() => SquadAdministration.ChangeNumbers(Arg("id"), Arg("operation"), Arg("team"), Arg("session"), Arg("players"), Arg("allowed"), Arg("choiceToken")));
                return (404, Error("Unknown squad endpoint"));
            }
            if (path.StartsWith("/api/v1/player-management/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/available")) return LiveTools.Run(() => PlayerManagementCommands.Available(Arg("offered")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => PlayerManagementCommands.Preview(Arg("offered"), Arg("action"), Arg("items"), Arg("entry")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => PlayerManagementCommands.Execute(Arg("id"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry"), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                }
                return (404, Error("Unknown player-management endpoint"));
            }
            if (path.StartsWith("/api/v1/player-training-menu/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/preview")) return LiveTools.Run(() => PlayerTrainingMenuCommands.Preview(Arg("offered"), Arg("action"), Arg("items"), Arg("entry")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => PlayerTrainingMenuCommands.Execute(Arg("id"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry"), Arg("choiceToken"), Arg("acceptConfirmation") == "true"));
                }
                return (404, Error("Unknown player-training menu endpoint"));
            }
            if (path.StartsWith("/api/v1/player-availability/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/offered")) return LiveTools.Run(() => PlayerAvailabilityCommands.Offered(Arg("source"), Arg("path"), Arg("club"), Arg("playerClub"), Arg("offered")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => PlayerAvailabilityCommands.Preview(Arg("source"), Arg("path"), Arg("club"), Arg("playerClub"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => PlayerAvailabilityCommands.Execute(Arg("id"), Arg("source"), Arg("path"), Arg("club"), Arg("playerClub"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry"), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                }
                return (404, Error("Unknown availability endpoint"));
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
            if (path.StartsWith("/api/v1/tactic-slots/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                int? OptionalChoice(string name) => query.ContainsKey(name) ? ParseInt(query, name, -1) : null;
                if (path.EndsWith("/save-file-preview") && method == "GET")
                    return LiveTools.Run(() => TacticSlotCommands.SaveFile(Arg("team"), Arg("tactic"), Arg("channels"), Arg("info"), Arg("saveMethod"), Arg("name"), Arg("id"), ""));
                if (path.EndsWith("/save-file") && method == "POST" && !string.IsNullOrEmpty(Arg("choiceToken")))
                    return RunPlayerCommand(() => TacticSlotCommands.SaveFile(Arg("team"), Arg("tactic"), Arg("channels"), Arg("info"), Arg("saveMethod"), Arg("name"), Arg("id"), Arg("choiceToken")));
                if (path.EndsWith("/creator-preview")) return method == "GET" ? LiveTools.Run(() => TacticSlotCommands.CreationPreview(
                    Arg("team"), Arg("tactic"), Arg("channels"), Arg("styles"), Arg("formations"), Arg("oopFormations"), OptionalChoice("style"), OptionalChoice("ip"), OptionalChoice("oop"))) : (405, Error("Use GET"));
                if (path.EndsWith("/creator-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TacticSlotCommands.Create(Arg("id"), Arg("team"), Arg("tactic"), Arg("channels"), Arg("styles"), Arg("formations"), Arg("oopFormations"),
                        ParseInt(query, "style", -1), ParseInt(query, "ip", -1), ParseInt(query, "oop", -1), Arg("choiceToken")));
                }
                if (path.EndsWith("/menu-options")) return LiveTools.Run(() => TacticSlotCommands.MenuRead(Arg("team"), Arg("tactic"), Arg("channels"), Arg("choices")));
                if (path.EndsWith("/menu-preview")) return LiveTools.Run(() => TacticSlotCommands.MenuPreview(Arg("team"), Arg("tactic"), Arg("channels"), Arg("choices"), Arg("path")));
                if (path.EndsWith("/menu-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TacticSlotCommands.MenuExecute(Arg("id"), Arg("team"), Arg("tactic"), Arg("channels"), Arg("choices"), Arg("path"), Arg("choiceToken"), bool.Parse(Arg("acceptDelete") == "" ? "false" : Arg("acceptDelete"))));
                }
                if (path.EndsWith("/state")) return LiveTools.Run(() => TacticSlotCommands.Read(Arg("team"), Arg("tactic"), Arg("channels"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TacticSlotCommands.Preview(Arg("action"), Arg("team"), Arg("tactic"), Arg("channels"), ParseInt(query, "slot", -1)));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TacticSlotCommands.Execute(Arg("id"), Arg("action"), Arg("team"), Arg("tactic"), Arg("channels"), ParseInt(query, "slot", -1), Arg("choiceToken")));
                }
                return (404, Error("Unknown tactic-slot endpoint"));
            }
            if (path.StartsWith("/api/v1/opposition/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/preview")) return LiveTools.Run(() => OppositionCommands.Preview(Arg("team"), Arg("tactic"), Arg("instructions"), Arg("rows"), Arg("rowPath"), Arg("mode", "players"), Arg("kind"), Arg("channels"), Arg("optionPath")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => OppositionCommands.Execute(Arg("id"), Arg("team"), Arg("tactic"), Arg("instructions"), Arg("rows"), Arg("rowPath"), Arg("mode", "players"), Arg("kind"), Arg("channels"), Arg("optionPath"), Arg("choiceToken")));
                }
                return (404, Error("Unknown opposition endpoint"));
            }
            if (path.StartsWith("/api/v1/setpiece-takers/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/state")) return LiveTools.Run(() => SetPieceTakerCommands.Read(Arg("team"), Arg("tactic"), Arg("setpiece"), Arg("candidates"), Arg("left"), Arg("right"), Arg("penalties"), Arg("takerList"), Arg("penaltyCandidates")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => SetPieceTakerCommands.Preview(Arg("action"), Arg("team"), Arg("tactic"), Arg("setpiece"), Arg("candidates"), Arg("left"), Arg("right"), Arg("penalties"), Arg("takerList"), Arg("penaltyCandidates"), Arg("paths", "[]"), ParseInt(query, "destination", -1)));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => SetPieceTakerCommands.Execute(Arg("id"), Arg("action"), Arg("team"), Arg("tactic"), Arg("setpiece"), Arg("candidates"), Arg("left"), Arg("right"), Arg("penalties"), Arg("takerList"), Arg("penaltyCandidates"), Arg("paths", "[]"), ParseInt(query, "destination", -1), Arg("choiceToken")));
                }
                return (404, Error("Unknown set-piece taker endpoint"));
            }
            if (path.StartsWith("/api/v1/set-piece/edit-", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/edit-preview")) return LiveTools.Run(() => SetPieceEditCommands.Preview(Arg("action"), Arg("team"), Arg("tactic"), Arg("setpiece"), Arg("channel"), Arg("property"), Arg("options"), Arg("optionPath"), Arg("routine")));
                if (path.EndsWith("/edit-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => SetPieceEditCommands.Execute(Arg("id"), Arg("action"), Arg("team"), Arg("tactic"), Arg("setpiece"), Arg("channel"), Arg("property"), Arg("options"), Arg("optionPath"), Arg("choiceToken"), Arg("routine")));
                }
                return (404, Error("Unknown set-piece edit endpoint"));
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
            if (path.StartsWith("/api/v1/training-management/mentoring/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/state")) return LiveTools.Run(() => MentoringCommands.Read(Arg("team"), Arg("training"), Arg("groups"), Arg("groupPath"), Arg("mode", "existing"), Arg("channels")));
                if (path.EndsWith("/create-preview")) return LiveTools.Run(() => MentoringCommands.Create(Arg("team"), Arg("training"), Arg("groups"), "", ""));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => MentoringCommands.Preview(Arg("team"), Arg("training"), Arg("groups"), Arg("groupPath"), Arg("mode", "existing"), Arg("channels"), Arg("action"), Arg("indices", "[]"), Arg("name")));
                if (method != "POST") return (405, Error("Use POST"));
                if (path.EndsWith("/create")) return RunPlayerCommand(() => MentoringCommands.Create(Arg("team"), Arg("training"), Arg("groups"), Arg("id"), Arg("choiceToken")));
                if (path.EndsWith("/execute")) return RunPlayerCommand(() => MentoringCommands.Execute(Arg("id"), Arg("team"), Arg("training"), Arg("groups"), Arg("groupPath"), Arg("mode", "existing"), Arg("channels"), Arg("action"), Arg("indices", "[]"), Arg("name"), Arg("choiceToken")));
                return (404, Error("Unknown mentoring endpoint"));
            }
            if (path.StartsWith("/api/v1/training-management/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/units")) return LiveTools.Run(() => TrainingUnitCommands.Read(Arg("team"), Arg("training"), Arg("channels")));
                if (path.EndsWith("/category-preview")) return LiveTools.Run(() => TrainingManagementCommands.PreviewCategory(Arg("team"), Arg("training"), Arg("assignments"), Arg("rows"), Arg("coachPath"), Arg("category"), Arg("categorySource"), Arg("current"), Arg("editable"), Arg("eventData"), bool.Parse(query.TryGetValue("assigned", out var assigned) ? assigned : "false")));
                if (path.EndsWith("/category-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TrainingManagementCommands.SetCategory(Arg("id"), Arg("team"), Arg("training"), Arg("assignments"), Arg("rows"), Arg("coachPath"), Arg("category"), Arg("categorySource"), Arg("current"), Arg("editable"), Arg("eventData"), bool.Parse(query.TryGetValue("assigned", out var assigned) ? assigned : "false"), Arg("choiceToken")));
                }
                if (path.EndsWith("/coach-preview")) return LiveTools.Run(() => TrainingManagementCommands.Preview(Arg("operation"), Arg("team"), Arg("training"), Arg("assignments"), Arg("rows")));
                if (path.EndsWith("/coach-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TrainingManagementCommands.Execute(Arg("id"), Arg("operation"), Arg("team"), Arg("training"), Arg("assignments"), Arg("rows"), Arg("choiceToken")));
                }
                return (404, Error("Unknown training-management endpoint"));
            }
            if (path.StartsWith("/api/v1/medical/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/preview")) return LiveTools.Run(() => MedicalCommands.Preview(Arg("offered"), Arg("action"), Arg("items"), Arg("entry")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => MedicalCommands.Execute(Arg("id"), Arg("offered"), Arg("action"), Arg("items"), Arg("entry"), Arg("choiceToken")));
                }
                return (404, Error("Unknown medical endpoint"));
            }
            if (path.StartsWith("/api/v1/registration/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/player-preview")) return LiveTools.Run(() => RegistrationSelectionCommands.Preview(Arg("team"), Arg("session"), Arg("players"), Arg("personPath"), Arg("current"), Arg("editable"), bool.Parse(Arg("selected", "false"))));
                if (path.EndsWith("/player-state")) return LiveTools.Run(() => RegistrationSelectionCommands.Observe(Arg("operationId"), Arg("team"), Arg("session"), Arg("players"), Arg("personPath"), Arg("current"), Arg("editable")));
                if (path.EndsWith("/player-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => RegistrationSelectionCommands.Execute(Arg("id"), Arg("team"), Arg("session"), Arg("players"), Arg("personPath"), Arg("current"), Arg("editable"), bool.Parse(Arg("selected", "false")), Arg("choiceToken")));
                }
                return (404, Error("Unknown registration endpoint"));
            }
            if (path.StartsWith("/api/v1/friendlies/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/date-state")) return LiveTools.Run(() => ClubBusinessCommands.DatesRead(Arg("team"), Arg("friendly"), Arg("available"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/date-preview")) return LiveTools.Run(() => ClubBusinessCommands.DatePreview(Arg("team"), Arg("friendly"), Arg("available"), Arg("current"), ParseInt(query, "index", -1)));
                if (path.EndsWith("/date-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => ClubBusinessCommands.DateExecute(Arg("id"), Arg("team"), Arg("friendly"), Arg("available"), Arg("current"), ParseInt(query, "index", -1), Arg("choiceToken")));
                }
                if (path.EndsWith("/selection-options")) return LiveTools.Run(() => ClubBusinessCommands.Read(Arg("kind"), Arg("team"), Arg("friendly"), Arg("choices")));
                if (path.EndsWith("/selection-preview")) return LiveTools.Run(() => ClubBusinessCommands.Preview(Arg("kind"), Arg("team"), Arg("friendly"), Arg("choices"), Arg("optionPath")));
                if (path.EndsWith("/selection-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => ClubBusinessCommands.Execute(Arg("id"), Arg("kind"), Arg("team"), Arg("friendly"), Arg("choices"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/preview")) return LiveTools.Run(() => FriendlyCommands.Preview(Arg("operation"), Arg("team"), Arg("friendly"), Arg("channels")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => FriendlyCommands.Execute(Arg("id"), Arg("operation"), Arg("team"), Arg("friendly"), Arg("channels"), Arg("choiceToken")));
                }
                return (404, Error("Unknown friendly endpoint"));
            }
            if (path.StartsWith("/api/v1/board/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/request-preview")) return LiveTools.Run(() => BoardRequestCommands.Preview(Arg("club"), Arg("speakto"), Arg("actions"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/request-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => BoardRequestCommands.Execute(Arg("id"), Arg("club"), Arg("speakto"), Arg("actions"), Arg("options"), Arg("optionPath"), Arg("choiceToken"), bool.Parse(query.TryGetValue("acceptConfirmation", out var accept) ? accept : "false")));
                }
                return (404, Error("Unknown board endpoint"));
            }
            if (path.StartsWith("/api/v1/administration/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/responsibility-preview")) return LiveTools.Run(() => AdministrationCommands.Preview(Arg("action"), Arg("team"), Arg("container"), Arg("session"), Arg("tabs"), Arg("tabPath"), Arg("groups"), Arg("groupPath"), Arg("responsibilities"), Arg("responsibilityPath"), Arg("current"), Arg("editable"), Arg("takeControl")));
                if (path.EndsWith("/responsibility-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => AdministrationCommands.Execute(Arg("id"), Arg("action"), Arg("team"), Arg("container"), Arg("session"), Arg("tabs"), Arg("tabPath"), Arg("groups"), Arg("groupPath"), Arg("responsibilities"), Arg("responsibilityPath"), Arg("current"), Arg("editable"), Arg("takeControl"), Arg("choiceToken")));
                }
                return (404, Error("Unknown administration endpoint"));
            }
            if (path.StartsWith("/api/v1/recruitment/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/lifecycle-preview")) return LiveTools.Run(() => RecruitmentLifecycle.Preview(Arg("action"), Arg("info"), Arg("source"), Arg("path"), Arg("uniqueId"), Arg("complete"), Arg("name")));
                if (path.EndsWith("/lifecycle-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => RecruitmentLifecycle.Execute(Arg("id"), Arg("action"), Arg("info"), Arg("source"), Arg("path"), Arg("uniqueId"), Arg("complete"), Arg("name"), Arg("choiceToken"), bool.Parse(query.TryGetValue("acceptConfirmation", out var accept) ? accept : "false")));
                }
                if (path.EndsWith("/staff-state")) return LiveTools.Run(() => RecruitmentStaff.Read(Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("any"), Arg("operationId")));
                if (path.EndsWith("/staff-preview")) return LiveTools.Run(() => RecruitmentStaff.Preview(Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("any"), Arg("team"), Arg("container"), Arg("choices"), Arg("selection"), Arg("personPaths")));
                if (path.EndsWith("/staff-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => RecruitmentStaff.Execute(Arg("id"), Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("any"), Arg("team"), Arg("container"), Arg("choices"), Arg("selection"), Arg("personPaths"), Arg("choiceToken")));
                }
                if (path.EndsWith("/area-state")) return LiveTools.Run(() => RecruitmentAreas.Read(Arg("info"), Arg("source"), Arg("path"), Arg("areas"), Arg("areaKey"), Arg("operationId")));
                if (path.EndsWith("/area-preview")) return LiveTools.Run(() => RecruitmentAreas.Preview(Arg("info"), Arg("source"), Arg("path"), Arg("areas"), Arg("team"), Arg("choices"), Arg("selector"), Arg("action"), Arg("optionPath")));
                if (path.EndsWith("/area-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => RecruitmentAreas.Execute(Arg("id"), Arg("info"), Arg("source"), Arg("path"), Arg("areas"), Arg("team"), Arg("choices"), Arg("selector"), Arg("action"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/recipes")) return LiveTools.Run(RecruitmentCommands.Routing);
                if (path.EndsWith("/state")) return LiveTools.Run(() => RecruitmentCommands.Read(Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => RecruitmentCommands.Preview(Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("choices"), ParseInt(query, "option", -1), Arg("optionPath"), Arg("input"), Arg("simplified"), Arg("increment"), Arg("decrement")));
                if (path.EndsWith("/snapshot")) return LiveTools.Run(() => RecruitmentCommands.Snapshot(Arg("info"), Arg("source"), Arg("path"), Arg("fields")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => RecruitmentCommands.Execute(Arg("id"), Arg("info"), Arg("source"), Arg("path"), Arg("kind"), Arg("current"), Arg("choices"), ParseInt(query, "option", -1), Arg("optionPath"), Arg("input"), Arg("simplified"), Arg("increment"), Arg("decrement"), Arg("choiceToken")));
                }
                if (path.EndsWith("/complete"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => RecruitmentCommands.Complete(Arg("id"), Arg("action"), Arg("info"), Arg("source"), Arg("path"), Arg("fields"), Arg("draftToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown recruitment endpoint\"}");
            }
            if (path.StartsWith("/api/v1/club-vision/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => ClubVisionCommands.Read(Arg("session"), Arg("canEdit"), Arg("canUndo"), Arg("canRevert"), Arg("canConfirm"), Arg("canSuggest"), Arg("possible")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ClubVisionCommands.Preview(Arg("action"), Arg("session"), Arg("canEdit"), Arg("canUndo"), Arg("canRevert"), Arg("canConfirm"), Arg("canSuggest"), Arg("possible"), Arg("optionPath"), Arg("objectives"), Arg("objectivePath")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ClubVisionCommands.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("canEdit"), Arg("canUndo"), Arg("canRevert"), Arg("canConfirm"), Arg("canSuggest"), Arg("possible"), Arg("optionPath"), Arg("choiceToken"), Arg("objectives"), Arg("objectivePath")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown club vision endpoint\"}");
            }
            if (path.StartsWith("/api/v1/club-affiliate/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => ClubAffiliateCommands.Read(Arg("session"), Arg("club"), Arg("canCommit"), Arg("count"), Arg("proposed"), Arg("selected")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ClubAffiliateCommands.Preview(Arg("action"), Arg("session"), Arg("club"), Arg("canCommit"), Arg("count"), Arg("proposed"), ParseInt(query, "index", -1)));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ClubAffiliateCommands.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("club"), Arg("canCommit"), Arg("count"), Arg("proposed"), ParseInt(query, "index", -1), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown club affiliate endpoint\"}");
            }
            if (path.StartsWith("/api/v1/training-schedule/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/delete-preview")) return LiveTools.Run(() => TrainingScheduleCommands.DeletePreview(Arg("calendar"), Arg("schedules"), Arg("optionPath")));
                if (path.EndsWith("/delete-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingScheduleCommands.DeleteExecute(Arg("id"), Arg("calendar"), Arg("schedules"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/confirm-preview")) return LiveTools.Run(() => TrainingScheduleCommands.ConfirmPreview(Arg("schedule"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/confirm-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingScheduleCommands.ConfirmExecute(Arg("id"), Arg("schedule"), Arg("options"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/state")) return LiveTools.Run(() => TrainingScheduleCommands.Read(Arg("schedule"), Arg("canSave"), Arg("canClear"), Arg("dropdownName"), Arg("scheduleName")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TrainingScheduleCommands.Preview(Arg("action"), Arg("schedule"), Arg("canSave"), Arg("canClear"), Arg("name")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingScheduleCommands.Execute(Arg("id"), Arg("action"), Arg("schedule"), Arg("canSave"), Arg("canClear"), Arg("name"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown training schedule endpoint\"}");
            }
            if (path.StartsWith("/api/v1/team-training/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/intensity-state")) return LiveTools.Run(() => TeamTrainingIntensityCommands.Read(Arg("training"), Arg("selected"), Arg("options"), Arg("operationId")));
                if (path.EndsWith("/intensity-preview")) return LiveTools.Run(() => TeamTrainingIntensityCommands.Preview(Arg("training"), Arg("selected"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/intensity-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TeamTrainingIntensityCommands.Execute(Arg("id"), Arg("training"), Arg("selected"), Arg("options"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/session-state")) return LiveTools.Run(() => TeamSessionCommands.Read(Arg("calendar"), Arg("days"), Arg("dayPath"), Arg("date"), Arg("events"), Arg("eventPath"), Arg("current"), Arg("index"), Arg("control"), Arg("operationId")));
                if (path.EndsWith("/session-preview")) return LiveTools.Run(() => TeamSessionCommands.Preview(Arg("calendar"), Arg("days"), Arg("dayPath"), Arg("date"), Arg("events"), Arg("eventPath"), Arg("current"), Arg("index"), Arg("editable"), Arg("passed"), Arg("control"), Arg("menu"), Arg("optionPath"), Arg("delegation", "respect")));
                if (path.EndsWith("/session-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TeamSessionCommands.Execute(Arg("id"), Arg("calendar"), Arg("days"), Arg("dayPath"), Arg("date"), Arg("events"), Arg("eventPath"), Arg("current"), Arg("index"), Arg("editable"), Arg("passed"), Arg("control"), Arg("menu"), Arg("optionPath"), Arg("choiceToken"), Arg("delegation", "respect")));
                }
                if (path.EndsWith("/state")) return LiveTools.Run(() => TeamScheduleCommands.Read(Arg("calendar"), Arg("weeks"), Arg("weekPath"), Arg("date")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TeamScheduleCommands.Preview(Arg("calendar"), Arg("weeks"), Arg("weekPath"), Arg("date"), Arg("editable"), Arg("control"), Arg("categories"), Arg("categoryPath"), Arg("schedules"), Arg("schedulePath"), Arg("eventData"), Arg("delegation", "respect")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TeamScheduleCommands.Execute(Arg("id"), Arg("calendar"), Arg("weeks"), Arg("weekPath"), Arg("date"), Arg("editable"), Arg("control"), Arg("categories"), Arg("categoryPath"), Arg("schedules"), Arg("schedulePath"), Arg("eventData"), Arg("choiceToken"), Arg("delegation", "respect")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown team training endpoint\"}");
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
            if (path.StartsWith("/api/v1/transfers/activity/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => TransferActivityCommands.Read(Arg("club"), Arg("activity"), Arg("people"), Arg("personPath"), Arg("offers"), Arg("offerPath"), Arg("channels"), Arg("action"), Arg("operationId")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TransferActivityCommands.Execute(Arg("id"), Arg("club"), Arg("activity"), Arg("people"), Arg("personPath"), Arg("offers"), Arg("offerPath"), Arg("channels"), Arg("action"), Arg("choiceToken")));
                }
                return (404, Error("Unknown transfer-activity endpoint"));
            }
            if (path.StartsWith("/api/v1/trades/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/state")) return LiveTools.Run(() => TradeOfferCommands.Read(Arg("session"), Arg("club"), Arg("tradeType"), Arg("humanIsBuying"),
                    Arg("otherClub"), Arg("negotiable"), Arg("negotiableEnabled"), Arg("negotiableVisible"), Arg("humanAssets"), Arg("otherAssets"),
                    Arg("humanAvailable"), Arg("otherAvailable")));
                if (path.EndsWith("/cash-state")) return LiveTools.Run(() => TradeOfferCommands.CashRead(Arg("session"), Arg("club"), Arg("kind"), Arg("selector"), Arg("intervals")));
                if (path.EndsWith("/cash-preview")) return LiveTools.Run(() => TradeOfferCommands.CashPreview(Arg("session"), Arg("club"), Arg("kind"), Arg("selector"), Arg("intervals"), Arg("amount")));
                if (path.EndsWith("/cash-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TradeOfferCommands.CashExecute(Arg("id"), Arg("session"), Arg("club"), Arg("kind"), Arg("selector"), Arg("intervals"), Arg("amount"), Arg("choiceToken")));
                }
                if (path.EndsWith("/asset-preview")) return LiveTools.Run(() => TradeOfferCommands.ChangeAssetPreview(Arg("asset"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/asset-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TradeOfferCommands.ChangeAssetExecute(Arg("id"), Arg("asset"), Arg("options"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/valuation-preview")) return LiveTools.Run(() => TradeOfferCommands.ValuationPreview(Arg("session"), Arg("club")));
                if (path.EndsWith("/valuation-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TradeOfferCommands.ValuationExecute(Arg("id"), Arg("session"), Arg("club"), Arg("choiceToken")));
                }
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TradeOfferCommands.Preview(Arg("action"), Arg("session"), Arg("club"),
                    Arg("options"), Arg("optionPath"), Arg("collection"), Arg("assetPath"), Arg("negotiableEnabled")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => TradeOfferCommands.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("club"), Arg("options"),
                        Arg("optionPath"), Arg("collection"), Arg("assetPath"), Arg("negotiableEnabled"), Arg("choiceToken")));
                }
                return (404, Error("Unknown trade offer endpoint"));
            }
            if (path.StartsWith("/api/v1/transfers/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path == "/api/v1/transfers/negotiation/execute") return method == "POST" ? RunPlayerCommand(() => NegotiationActions.Execute(
                    Arg("id"), "transfer", Arg("session"), Arg("club"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"),
                    ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false")))) : (405, Error("Use POST"));
                if (path == "/api/v1/transfers/draft-start-preview") return method == "GET" ? LiveTools.Run(() => TransferCommands.PreviewDraft(
                    Arg("session"), Arg("club"), Arg("selling"), Arg("offered"), Arg("allowed"))) : (405, Error("Use GET"));
                if (path == "/api/v1/transfers/open-draft") return method == "POST" ? RunPlayerCommand(() => TransferCommands.OpenDraft(
                    Arg("id"), Arg("session"), Arg("club"), Arg("selling"), Arg("offered"), Arg("allowed"), Arg("choiceToken"))) : (405, Error("Use POST"));
                if (path == "/api/v1/transfers/draft-observation") return method == "GET" ? LiveTools.Run(() => TransferCommands.ObserveDraft(
                    Arg("operationId"), Arg("session"), Arg("club"), Arg("buying"), Arg("editable"), Arg("offerType"))) : (405, Error("Use GET"));
                if (path.EndsWith("/lifecycle-recipes")) return LiveTools.Run(NegotiationLifecycle.Routing);
                if (path.EndsWith("/date-preview")) return LiveTools.Run(() => NegotiationLifecycle.DatePreview(Arg("kind"), Arg("session"), Arg("club"), Arg("editable"), Arg("collection"), Arg("clausePath"), Arg("enabled"), Arg("selector"), Arg("dateSource"), Arg("datePath")));
                if (path.EndsWith("/date-state")) return LiveTools.Run(() => NegotiationLifecycle.DateRead(Arg("kind"), Arg("session"), Arg("club"), Arg("collection"), Arg("clausePath"), Arg("selector"), Arg("operationId")));
                if (path.EndsWith("/date-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => NegotiationLifecycle.DateExecute(Arg("id"), Arg("kind"), Arg("session"), Arg("club"), Arg("editable"), Arg("collection"), Arg("clausePath"), Arg("enabled"), Arg("selector"), Arg("dateSource"), Arg("datePath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/lifecycle-preview")) return LiveTools.Run(() => NegotiationLifecycle.Preview(Arg("kind"), Arg("session"), Arg("club"), Arg("editable"), Arg("collection"), Arg("playerPath"), Arg("current"), bool.Parse(Arg("selected", "false"))));
                if (path.EndsWith("/lifecycle-state")) return LiveTools.Run(() => NegotiationLifecycle.Read(Arg("kind"), Arg("session"), Arg("club"), Arg("editable"), Arg("collection"), Arg("playerPath"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/lifecycle-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => NegotiationLifecycle.Execute(Arg("id"), Arg("kind"), Arg("session"), Arg("club"), Arg("editable"), Arg("collection"), Arg("playerPath"), Arg("current"), bool.Parse(Arg("selected", "false")), Arg("choiceToken")));
                }
                if (path.EndsWith("/structure-recipes")) return LiveTools.Run(TransferStructure.Routing);
                if (path.EndsWith("/type-state")) return LiveTools.Run(() => TransferStructure.ObserveType(Arg("operationId"), Arg("session"), Arg("club"), Arg("current")));
                if (path.EndsWith("/structure-preview")) return LiveTools.Run(() => TransferStructure.Preview(Arg("action"), Arg("session"), Arg("club"), Arg("editable"), Arg("options"), Arg("optionPath"), Arg("collection"), Arg("clausePath"), Arg("canRemove"), Arg("current")));
                if (path.EndsWith("/structure-execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TransferStructure.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("club"), Arg("editable"), Arg("options"), Arg("optionPath"), Arg("collection"), Arg("clausePath"), Arg("canRemove"), Arg("current"), Arg("choiceToken")));
                }
                if (path.EndsWith("/recipes")) return LiveTools.Run(TransferCommands.Routing);
                if (path.EndsWith("/state")) return LiveTools.Run(() => TransferCommands.Read(Arg("kind"), Arg("session"), Arg("club"), Arg("collection"), Arg("clausePath"), Arg("current"), Arg("cash"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TransferCommands.Preview(Arg("kind"), Arg("session"), Arg("club"), Arg("collection"), Arg("clausePath"), Arg("current"), Arg("cash"), Arg("choices"), Arg("offerEditable"), Arg("clauseEnabled"), ParseInt(query, "option", -1), Arg("amount")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TransferCommands.Execute(Arg("id"), Arg("kind"), Arg("session"), Arg("club"), Arg("collection"), Arg("clausePath"), Arg("current"), Arg("cash"), Arg("choices"), Arg("offerEditable"), Arg("clauseEnabled"), ParseInt(query, "option", -1), Arg("amount"), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown transfer endpoint\"}");
            }
            if (path.StartsWith("/api/v1/negotiations/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/describe")) return LiveTools.Run(() => NegotiationActions.Describe(Arg("domain"), Arg("session"), Arg("club"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => NegotiationActions.Execute(Arg("id"), Arg("domain"), Arg("session"), Arg("club"), Arg("speakto"), Arg("actions"), Arg("primary"), Arg("groups"), Arg("options"), Arg("bucket"), ParseInt(query, "option", -1), Arg("choiceToken"), bool.Parse(Arg("acceptConfirmation", "false"))));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown negotiation endpoint\"}");
            }
            if (path.StartsWith("/api/v1/contracts/promises/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (path.EndsWith("/recipes")) return (200, LiveTools.JsonText(PreContractCommands.Routing()));
                if (path.EndsWith("/state")) return LiveTools.Run(() => PreContractCommands.Read(Arg("action"), Arg("session"), Arg("club"), Arg("collection"), Arg("componentPath"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => PreContractCommands.Preview(Arg("action"), Arg("session"), Arg("club"), Arg("readOnly"), Arg("willing"), Arg("collection"), Arg("componentPath"), Arg("owner"), Arg("baseInfo"), Arg("permission"), Arg("current"), Arg("options"), Arg("optionPath"), Arg("value")));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => PreContractCommands.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("club"), Arg("readOnly"), Arg("willing"), Arg("collection"), Arg("componentPath"), Arg("owner"), Arg("baseInfo"), Arg("permission"), Arg("current"), Arg("options"), Arg("optionPath"), Arg("value"), Arg("choiceToken")));
                }
                return (404, Error("Unknown pre-contract promises endpoint"));
            }
            if (path.StartsWith("/api/v1/contracts/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                int[] DraftEntry() => System.Text.Json.JsonSerializer.Deserialize<int[]>(Arg("entry", "[]"));
                if (path == "/api/v1/contracts/draft-start-preview") return method == "GET" ? LiveTools.Run(() => ContractCommands.PreviewDraft(
                    Arg("session"), Arg("club"), Arg("offered"), Arg("action"), Arg("items"), DraftEntry())) : (405, Error("Use GET"));
                if (path == "/api/v1/contracts/open-draft") return method == "POST" ? RunPlayerCommand(() => ContractCommands.OpenDraft(
                    Arg("id"), Arg("session"), Arg("club"), Arg("offered"), Arg("action"), Arg("items"), DraftEntry(), Arg("choiceToken"))) : (405, Error("Use POST"));
                if (path == "/api/v1/contracts/draft-observation") return method == "GET" ? LiveTools.Run(() => ContractCommands.ObserveDraft(
                    Arg("operationId"), Arg("session"), Arg("club"), Arg("readOnly"), Arg("willing"), Arg("wage"))) : (405, Error("Use GET"));
                if (path.EndsWith("/structure-recipes")) return LiveTools.Run(ContractStructure.Routing);
                if (path.EndsWith("/structure-preview")) return LiveTools.Run(() => ContractStructure.Preview(Arg("action"), Arg("session"), Arg("club"), Arg("readOnly"), Arg("willing"), Arg("collection"), Arg("componentPath"), Arg("baseInfo"), Arg("permission"), Arg("current"), Arg("options"), Arg("optionPath")));
                if (path.EndsWith("/structure-execute"))
                {
                    if (method != "POST") return (405, Error("Use POST"));
                    return RunPlayerCommand(() => ContractStructure.Execute(Arg("id"), Arg("action"), Arg("session"), Arg("club"), Arg("readOnly"), Arg("willing"), Arg("collection"), Arg("componentPath"), Arg("baseInfo"), Arg("permission"), Arg("current"), Arg("options"), Arg("optionPath"), Arg("choiceToken")));
                }
                if (path.EndsWith("/recipes")) return LiveTools.Run(ContractCommands.Routing);
                if (path.EndsWith("/cash-state")) return LiveTools.Run(() => ContractCommands.ReadCash(Arg("kind"), Arg("session"), Arg("club"), Arg("owner"), Arg("cash"), Arg("operationId")));
                if (path.EndsWith("/cash-preview")) return LiveTools.Run(() => ContractCommands.PreviewAmount(Arg("kind"), Arg("session"), Arg("club"), Arg("owner"), Arg("cash"), Arg("readOnly"), Arg("willing"), Arg("amount")));
                if (path.EndsWith("/input-amount"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ContractCommands.InputAmount(Arg("id"), Arg("kind"), Arg("session"), Arg("club"), Arg("owner"), Arg("cash"), Arg("readOnly"), Arg("willing"), Arg("amount"), Arg("choiceToken")));
                }
                if (path.EndsWith("/state")) return LiveTools.Run(() => ContractCommands.Read(Arg("kind"), Arg("session"), Arg("club"), Arg("current"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => ContractCommands.Preview(Arg("kind"), Arg("session"), Arg("club"), Arg("current"), Arg("owner"), Arg("options"), Arg("readOnly"), Arg("willing"), ParseInt(query, "option", -1)));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => ContractCommands.Execute(Arg("id"), Arg("kind"), Arg("session"), Arg("club"), Arg("current"), Arg("owner"), Arg("options"), Arg("readOnly"), Arg("willing"), ParseInt(query, "option", -1), Arg("choiceToken")));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown contract endpoint\"}");
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
            if (path.StartsWith("/api/v1/training/", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name, string fallback = "") => query.TryGetValue(name, out var value) ? value : fallback;
                if (path.EndsWith("/recipes")) return LiveTools.Run(TrainingCommands.Routing);
                if (path.EndsWith("/state")) return LiveTools.Run(() => TrainingCommands.Read(Arg("kind"), Arg("training"), Arg("owner"), Arg("operationId")));
                if (path.EndsWith("/preview")) return LiveTools.Run(() => TrainingCommands.Preview(Arg("kind"), Arg("training"), Arg("owner"), Arg("options"), Arg("editable"), ParseInt(query, "option", -1), Arg("delegation", "respect"), ParseInt(query, "roleIndex", -1)));
                if (path.EndsWith("/execute"))
                {
                    if (method != "POST") return (405, "{\"ok\":false,\"error\":\"Use POST\"}");
                    return RunPlayerCommand(() => TrainingCommands.Execute(Arg("id"), Arg("kind"), Arg("training"), Arg("owner"), Arg("options"), Arg("editable"), ParseInt(query, "option", -1), Arg("choiceToken"), Arg("delegation", "respect"), ParseInt(query, "roleIndex", -1)));
                }
                return (404, "{\"ok\":false,\"error\":\"Unknown training endpoint\"}");
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
            if (path.StartsWith("/ui/click", StringComparison.OrdinalIgnoreCase) || path.Equals("/dialog/click", StringComparison.OrdinalIgnoreCase))
                return (410, "{\"ok\":false,\"error\":\"UI input is disabled. Use game commands.\"}");
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
        catch (Exception ex)
        {
            EventLog.Add("error", "dispatch " + path + ": " + ex);
            return (500, Error(ex.Message));
        }
    }


    private static long ParseLong(Dictionary<string, string> query, string key, long fallback)
    {
        if (query != null && query.TryGetValue(key, out var text) && long.TryParse(text, out var value))
        {
            return value;
        }
        return fallback;
    }

    private static float ParseFloat(Dictionary<string, string> query, string key, float fallback)
    {
        if (query != null && query.TryGetValue(key, out var text) && float.TryParse(text, out var value))
        {
            return value;
        }
        return fallback;
    }

    private static int ParseInt(Dictionary<string, string> query, string key, int fallback)
    {
        if (query != null && query.TryGetValue(key, out var text) && int.TryParse(text, out var value))
        {
            return value;
        }
        return fallback;
    }
    private static string Health()
    {
        var sb = new StringBuilder();
        sb.Append('{');
        sb.Append("\"ok\":true,");
        sb.Append("\"plugin\":\"FMAssistant\",");
        sb.Append("\"version\":\"" + Js(Plugin.Version) + "\",");
        sb.Append("\"loadedAssemblyId\":\"").Append(typeof(Plugin).Module.ModuleVersionId.ToString("D")).Append("\",");
        sb.Append("\"patchesApplied\":").Append(Patches.Applied ? "true" : "false").Append(',');
        sb.Append("\"interopInstance\":\"" + Js(Shared.PointerOf(Shared.InteropSubsystem)) + "\",");
        sb.Append("\"gamePluginInstance\":\"" + Js(Shared.PointerOf(Shared.GamePlugin)) + "\",");
        sb.Append("\"dispatcherInstance\":\"" + Js(Shared.PointerOf(Shared.Dispatcher)) + "\",");
        sb.Append("\"logCount\":").Append(EventLog.Count).Append(',');
        sb.Append("\"pendingActions\":").Append(MainThread.Pending).Append(',');
        sb.Append("\"mainThread\":").Append(LiveTools.JsonText(MainThreadDriver.ReadHeartbeat())).Append(',');
        sb.Append("\"loggingEnabled\":").Append(LoggingEnabled ? "true" : "false").Append(',');
        sb.Append("\"logAllUiEvents\":").Append(LogAllUiEvents ? "true" : "false");
        sb.Append('}');
        return sb.ToString();
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

    private static void WriteResponse(Stream stream, int status, string json)
    {
        var body = Encoding.UTF8.GetBytes(json);
        var header = Encoding.UTF8.GetBytes(
            "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 404 ? "Not Found" : "Internal Server Error") + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Connection: close\r\n\r\n");
        stream.Write(header, 0, header.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static string Error(string message) => "{\"ok\":false,\"error\":\"" + Js(message) + "\"}";

    private static string Js(string value)
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
