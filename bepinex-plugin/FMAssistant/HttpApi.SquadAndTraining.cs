using System;
using System.Collections.Generic;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>阵容、医疗、注册、队长、团队/个人训练与导师小组 HTTP 路由。</summary>
public static partial class HttpApi
{
    private static bool TryDispatchSquadAndTraining(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand,
        out (int Status, string Json) response)
    {
        response = default;
        (int Status, string Json)? matched = ExecuteTryDispatchSquadAndTraining(method, path, query, body, RunPlayerCommand);
        if (!matched.HasValue) return false;
        response = matched.Value;
        return true;
    }

    private static (int Status, string Json)? ExecuteTryDispatchSquadAndTraining(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand)
    {
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
        return null;
    }
}
