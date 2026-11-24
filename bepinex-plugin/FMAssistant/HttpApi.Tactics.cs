using System;
using System.Collections.Generic;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>战术、阵型、槽位、针对性指令、定位球与赛前准备 HTTP 路由。</summary>
public static partial class HttpApi
{
    private static bool TryDispatchTactics(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand,
        out (int Status, string Json) response)
    {
        response = default;
        (int Status, string Json)? matched = ExecuteTryDispatchTactics(method, path, query, body, RunPlayerCommand);
        if (!matched.HasValue) return false;
        response = matched.Value;
        return true;
    }

    private static (int Status, string Json)? ExecuteTryDispatchTactics(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand)
    {
            if (path.Equals("/api/v1/tactics/catalog", StringComparison.OrdinalIgnoreCase))
                return LiveTools.Run(() => InstructionCatalog.Get(query.TryGetValue("kind", out var kind) ? kind : "team"));
            if (path.StartsWith("/api/v1/tactics/suggestion", StringComparison.OrdinalIgnoreCase))
            {
                string Arg(string name) => query.TryGetValue(name, out var value) ? value : "";
                if (method == "GET") return LiveTools.Run(() => TacticSuggestionCommands.Preview(Arg("kind"), Arg("tactic"), Arg("suggestedTeam"), Arg("suggestedChanges")));
                if (method != "POST") return (405, Error("Use POST"));
                return RunPlayerCommand(() => TacticSuggestionCommands.Execute(Arg("id"), Arg("kind"), Arg("tactic"), Arg("suggestedTeam"), Arg("suggestedChanges"), Arg("choiceToken")));
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
        return null;
    }
}
