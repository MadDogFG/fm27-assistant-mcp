using System;
using System.Collections.Generic;
using FM.GamePlugin;

namespace FMAssistant;

/// <summary>转会、交易、谈判、合同、招募、财政预算与俱乐部管理 HTTP 路由。</summary>
public static partial class HttpApi
{
    private static bool TryDispatchTransfersAndClub(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand,
        out (int Status, string Json) response)
    {
        response = default;
        (int Status, string Json)? matched = ExecuteTryDispatchTransfersAndClub(method, path, query, body, RunPlayerCommand);
        if (!matched.HasValue) return false;
        response = matched.Value;
        return true;
    }

    private static (int Status, string Json)? ExecuteTryDispatchTransfersAndClub(
        string method,
        string path,
        Dictionary<string, string> query,
        string body,
        Func<Func<object>, (int Status, string Json)> RunPlayerCommand)
    {
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
        return null;
    }
}
