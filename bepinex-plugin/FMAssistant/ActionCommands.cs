// Menu protocol informed by FootballManagerMCP (MIT), see THIRD_PARTY_NOTICES.md.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

public static class ActionCommands
{
    private static readonly Lazy<DispatchJournal> Journal = new(() => new DispatchJournal(Path.Combine(
        Path.GetDirectoryName(typeof(Plugin).Assembly.Location), "state", "player-actions.jsonl"), LiveTools.SessionId));
    // Other actions may open a panel or share a UI editing session. Discover them, but recover that protocol
    // before publishing them as silent operations. These six have an existing native menu protocol reference.
    private static readonly HashSet<uint> DirectActions = new() {
        1363818831, 1097488485, 1500280650, 1749513580, 1951493231, 1299399024,
        // 放行已核验的常规 DoAction (Event 44) 球员管理与状态菜单：
        // 阵容规划器(2002351944)、领导力课程(1297173097)、训练报告(1681151065)、上场时间预期(1714897475)、转会/租借状态(1766943801)
        // 以及职员招聘广告菜单(880036918/1951295084/1852196152/1816937269)
        2002351944, 1297173097, 1681151065, 1714897475, 1766943801,
        880036918, 1951295084, 1852196152, 1816937269
    };
    // Negotiation-initiation actions whose native action handler was recovered from game_plugin.dll
    // (build 26577676). Dispatch: FUN_1801fe730 / FUN_1802047f0 construct the per-ActionID handler object;
    // the generic action-data slot is FUN_1801fbce0 (reads the request record at +0x44 == "ITMS" and writes
    // the "actp"/"pact" action-data keys). Handler vtables: 0x184be79f8 OFFER_CONTRACT_ACTION_UI_HANDLER,
    // 0x184bfe088 OFFER_CONTRACT_ACTION_UI_HANDLER_SERVER, 0x184be8ca8 APPROACH_TO_SIGN_UI_HANDLER.
    // The dispatch mapping is recovered, but the accepted DoAction payload shape and whether the call stays
    // panel-free are not. They are therefore catalogued and previewable only and stay out of DirectActions
    // until that is established; see evidence/v69-action-initiation-catalog.md and the v68 files.
    public sealed record InitiationAction(uint Id, string Name, string NativeHandler, string ServerHandler,
        string DispatchEvidence, string BlockingReason);
    private static readonly InitiationAction[] InitiationActions = {
        new(2000111204, "PersonOfferContract", "OFFER_CONTRACT_ACTION_UI_HANDLER", "OFFER_CONTRACT_ACTION_UI_HANDLER_SERVER",
            "v68-contract-init-action-dispatch.txt (FUN_1801fe730:27b4); v68-contract-init-action-vtables.json",
            "silent_panel_free_execution_and_accepted_action_data_unverified"),
        new(1749837424, "PersonApproachToSign", "APPROACH_TO_SIGN_UI_HANDLER", "",
            "v68-contract-init-action-dispatch.txt (FUN_1801fe730:27b4); v68-contract-init-action-vtables.json",
            "silent_panel_free_execution_and_accepted_action_data_unverified")
    };
    private static InitiationAction Initiation(uint id) => InitiationActions.FirstOrDefault(a => a.Id == id);
    private static object InitiationView(InitiationAction action) => action == null ? null : new {
        id = action.Id.ToString(CultureInfo.InvariantCulture), name = action.Name,
        nativeHandler = action.NativeHandler, serverHandler = string.IsNullOrEmpty(action.ServerHandler) ? null : action.ServerHandler,
        dispatchEvidence = action.DispatchEvidence, silentExecutionImplemented = false, liveVerified = false,
        draftOpeningTool = action.Id == 2000111204 ? "open_contract_draft" : null,
        blockingReason = action.BlockingReason };
    public static object Initiation() => new { ok = true, domain = "negotiation_initiation_action_catalog",
        actions = InitiationActions.Select(InitiationView).ToArray(), executionImplemented = false, liveVerified = false,
        note = "原生 handler/dispatch 已恢复；静默无面板与游戏接受的 DoAction action-data 载荷未验证，故未加入 DirectActions。" };
    public static bool Contains(string id) => Journal.Value.Contains(id);
    public static object Status(string id) => Journal.Value.Get(id);
    internal static DispatchJournal.Receipt DispatchDomain(string id, string command, string target, string semantic, Action action,
        string before, string requested, string scope)
    {
        if (CommandOperations.Contains(id) || TacticCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id)) throw new ArgumentException("Operation ID belongs to another command.");
        return Journal.Value.Dispatch(id, command, target, LiveTools.CurrentEpoch, semantic, action, before, requested, scope);
    }
    internal static object ObserveDomain(string id, string target, string scope, string observed) =>
        Journal.Value.Observe(id, target, LiveTools.CurrentEpoch, scope, observed);
    internal static DispatchJournal.Receipt DispatchOnce(string id, string command, string target, string token, string scope,
        Func<ContinueRequestGuard.Preflight> read, Action dispatch)
    {
        if (CommandOperations.Contains(id) || TacticCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id))
            throw new ArgumentException("Operation ID belongs to another command.");
        return ContinueRequestGuard.DispatchOnce(Journal.Value, id, command, scope, target, LiveTools.CurrentEpoch, token, read, dispatch);
    }
    internal static DispatchJournal.Receipt Continue(string id, string target, string token,
        Func<ContinueRequestGuard.Preflight> read, Action dispatch)
    {
        if (CommandOperations.Contains(id) || TacticCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id))
            throw new ArgumentException("Operation ID belongs to another command.");
        return ContinueRequestGuard.Dispatch(Journal.Value, id, target, LiveTools.CurrentEpoch, token, read, dispatch);
    }
    internal static DispatchJournal.Receipt ContinueStage(string id, string target, string token,
        Func<ContinueRequestGuard.Preflight> read, Action dispatch)
    {
        if (CommandOperations.Contains(id) || TacticCommands.Contains(id) || SubstitutionCommands.ContainsRoot(id))
            throw new ArgumentException("Operation ID belongs to another command.");
        return ContinueRequestGuard.DispatchOnce(Journal.Value, id, MatchStageCommands.Command, "match_stage_dispatch_only",
            target, LiveTools.CurrentEpoch, token, read, dispatch);
    }

    private static SI.Core.Record Record(TypedValue value) => value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    private static TypedValue Field(SI.Core.Record record, string name) => record != null && record.TryGetValue(InternalCommands.PropertyId(name), out var value) ? value : null;
    private static string Text(SI.Core.Record record, string name) => Field(record, name)?.AsString();

    private static LiveTools.Snapshot Offered(string handle)
    {
        var value = LiveTools.GetSnapshot(handle);
        if (!value.Ready || value.Source != "game" || !string.IsNullOrEmpty(value.SourcePath) || value.Property != InternalCommands.PropertyId("Actions") ||
            !value.ContextDescriptions.ContainsKey("Records")) throw new ArgumentException("A current game.Actions subscription with real Records is required.");
        using var records = JsonDocument.Parse(value.ContextDescriptions["Records"]);
        var root = records.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference")
            throw new ArgumentException("Player action commands currently require exactly one real person record.");
        return value;
    }

    public static object Describe(string offered)
    {
        var snapshot = Offered(offered);
        var record = Record(snapshot.Value) ?? throw new InvalidOperationException("Game has not returned its actions record.");
        var actions = new List<object>();
        foreach (var pair in record)
        {
            var initiation = Initiation(pair.Key);
            actions.Add(new { id = pair.Key.ToString(CultureInfo.InvariantCulture), name = Enum.GetName(typeof(ActionID), pair.Key),
                silentExecutionImplemented = DirectActions.Contains(pair.Key), liveVerified = false,
                initiation = InitiationView(initiation) });
        }
        return new { ok = true, source = "game_offered_actions", epoch = LiveTools.CurrentEpoch, revision = snapshot.Revision, actions };
    }

    private static (LiveTools.Snapshot Snapshot, uint Action) Menu(string offered, string action, string items)
    {
        var available = Offered(offered);
        var reference = LiveTools.GetSnapshot(action);
        if (!reference.Ready || reference.Source != "game" || reference.Property != InternalCommands.PropertyId("Action") ||
            !reference.Contexts.TryGetValue("ID", out var idText) || !uint.TryParse(idText, out var id))
            throw new ArgumentException("A game.Action subscription with the action ID is required.");
        var availableRecord = Record(available.Value);
        if (availableRecord == null || !availableRecord.TryGetValue(id, out var offeredValue) ||
            (offeredValue.DataType?.FullName == "System.Boolean" && offeredValue.AsString() == "False"))
            throw new InvalidOperationException("Game no longer offers this action for these records.");
        var menu = LiveTools.GetSnapshot(items);
        if (!menu.Ready || menu.Source != action || !string.IsNullOrEmpty(menu.SourcePath) || menu.Property != InternalCommands.PropertyId("Items") ||
            !menu.ContextDescriptions.TryGetValue("Records", out var records) || records != available.ContextDescriptions["Records"])
            throw new ArgumentException("Menu items do not belong to the same records as the offered action.");
        return (menu, id);
    }

    private static (SI.Core.Record Row, TypedValue Data, bool Disabled, string Label, bool Confirmation) Entry(string items, int[] indices, string requiredEvent = "44")
    {
        if (indices == null || indices.Length == 0 || indices.Length > 8 || indices.Any(i => i < 0)) throw new ArgumentException("Select a menu entry by 1..8 nonnegative list indices.");
        var value = LiveTools.GetValue(items);
        SI.Core.Record row = null;
        var disabled = false;
        foreach (var index in indices)
        {
            var list = value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list == null || index >= list.Count) throw new ArgumentException("Menu entry is outside the game's current menu.");
            row = Record(list[index]) ?? throw new ArgumentException("Menu entry is not a record.");
            disabled |= string.Equals(Text(row, "Disabled"), "True", StringComparison.OrdinalIgnoreCase);
            var children = Field(row, "ChildList");
            var dataRow = Record(Field(row, "RowData"));
            if (dataRow != null) row = dataRow;
            disabled |= string.Equals(Text(row, "Disabled"), "True", StringComparison.OrdinalIgnoreCase);
            value = children ?? Field(row, "ChildList");
        }
        var data = Field(row, "ActionData");
        if (Text(row, "Event") != requiredEvent || data == null || data.IsNull) throw new ArgumentException("Choose an original menu entry for the requested action.");
        var confirmation = Field(Record(data), "ConfirmationDialogData");
        return (row, data, disabled, Text(row, "Text"), confirmation != null && !confirmation.IsNull);
    }

    internal static (string Label, string Fingerprint) ContractDraftChoice(string offered, string action, string items, int[] entry, string personIdentity)
    {
        var menu = Menu(offered, action, items);
        if (menu.Action != 2000111204) throw new ArgumentException("Use the game's offered PersonOfferContract action.");
        using var records = JsonDocument.Parse(menu.Snapshot.ContextDescriptions["Records"]);
        if (records.RootElement.GetProperty("items")[0].GetProperty("identity").GetString() != personIdentity)
            throw new InvalidOperationException("The offer menu belongs to another person.");
        var option = Entry(items, entry, "0");
        var data = Record(option.Data);
        if (option.Disabled || option.Confirmation || Text(option.Row, "IsOpenPanelAction") != "True" ||
            Text(data, "NewsAction") != "7" || Text(data, "DynamicCardId") != "-1" ||
            !option.Row.TryGetValue(0x69642020, out var id) || id.AsString() != "2000111204")
            throw new InvalidOperationException("The normal start-contract-negotiation option is unavailable or changed.");
        return (option.Label, NativeValueFingerprint.Compute(option.Data));
    }

    internal static void RequireOfferedPersonAction(string offered, string personIdentity, uint action)
    {
        var available = Offered(offered);
        using var records = JsonDocument.Parse(available.ContextDescriptions["Records"]);
        if (records.RootElement.GetProperty("items")[0].GetProperty("identity").GetString() != personIdentity ||
            Record(available.Value) is not { } menu || !menu.TryGetValue(action, out var allowed) || allowed == null || allowed.IsNull ||
            (allowed.DataType?.FullName == "System.Boolean" && allowed.AsString() != "True"))
            throw new InvalidOperationException("The game does not offer this action for the current person.");
    }

    public static object Preview(string offered, string action, string items, int[] entry)
    {
        var menu = Menu(offered, action, items);
        var selected = Entry(items, entry);
        var choiceToken = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = menu.Action,
            records = menu.Snapshot.ContextDescriptions["Records"], payloadHash = NativeValueFingerprint.Compute(selected.Data) }));
        return new { ok = true, actionId = menu.Action, revision = menu.Snapshot.Revision, label = selected.Label, choiceToken,
            disabled = selected.Disabled, requiresConfirmationProtocol = selected.Confirmation,
            silentExecutionImplemented = DirectActions.Contains(menu.Action), liveVerified = false,
            initiation = InitiationView(Initiation(menu.Action)), data = LiveTools.DescribeValue(selected.Data) };
    }

    public static object Execute(string id, string offered, string action, string items, int[] entry, long expectedRevision, string expectedChoiceToken, string source = "", string path = "")
    {
        if (CommandOperations.Contains(id) || TacticCommands.Contains(id)) throw new ArgumentException("Operation ID belongs to another command.");
        var menu = Menu(offered, action, items);
        var selected = Entry(items, entry);
        if (!DirectActions.Contains(menu.Action)) throw new InvalidOperationException("The silent execution protocol for this action has not been implemented yet.");
        if (selected.Disabled) throw new InvalidOperationException("Game disabled this menu entry.");
        if (selected.Confirmation) throw new InvalidOperationException("This entry requires a confirmation protocol that is not yet implemented silently.");
        if (menu.Snapshot.Revision != expectedRevision) throw new InvalidOperationException("Menu changed since preview; read it again before executing.");
        var records = menu.Snapshot.ContextDescriptions["Records"];
        var payloadHash = NativeValueFingerprint.Compute(selected.Data);
        var choiceToken = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = menu.Action, records, payloadHash }));
        if (choiceToken != expectedChoiceToken) throw new InvalidOperationException("Selected native action changed; refresh its menu before executing.");
        var semantic = LiveTools.JsonText(new { action = menu.Action, records, payloadHash });
        var target = DispatchJournal.Fingerprint(records);
        if (CommandOperations.HasPending(target) || TacticCommands.HasPending(target)) throw new InvalidOperationException("Another operation on this subject is pending.");
        // 若提供了目标球员引用，则作为原生动作的 target 传递；否则回退为 null 兼容旧调用
        InteropReference targetRef = null;
        if (!string.IsNullOrEmpty(source))
        {
            try { targetRef = LiveTools.GetReference(source, path ?? ""); }
            catch { /* 容错保留 null */ }
        }
        // Full original native value, including numeric types and object references, is preserved.
        return Journal.Value.Dispatch(id, "player_menu_action", target, LiveTools.CurrentEpoch, semantic, () =>
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxDoAction, targetRef, TypedValue.CreateCopyFrom(selected.Data)));
    }
}
