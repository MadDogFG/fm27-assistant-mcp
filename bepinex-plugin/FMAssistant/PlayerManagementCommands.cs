using System;
using System.Globalization;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using static FMAssistant.NegotiationActions;

namespace FMAssistant;

// Explicit normal managerial menu families; only actual game-offered DoAction leaves.
// No editor, forced transfer, attribute, balance or unrestricted raw-event operations.
public static class PlayerManagementCommands
{
    private static readonly HashSet<uint> Actions = new() {
        (uint)ActionID.PersonWithdrawContractOffer,
        (uint)ActionID.PersonMutualTerminationContract,
        (uint)ActionID.PersonReleaseClubFreeTransfer,
        (uint)ActionID.PersonStopScoutPlayersClub,
        (uint)ActionID.PersonKeepScoutReport,
        (uint)ActionID.PersonDiscardScoutReport,
        (uint)ActionID.PersonAddPlayersToShortlist,
        (uint)ActionID.PersonRemovePlayersFromShortlist,
        (uint)ActionID.PersonAddNonPlayersToShortlist,
        (uint)ActionID.PersonRemoveNonPlayersFromShortlist,
        (uint)ActionID.PersonMoveToClubShortlistPlayer,
        (uint)ActionID.PersonMoveToClubShortlistNonPlayer,
        (uint)ActionID.PersonAddPlayersToClubSquadPlanner,
        (uint)ActionID.PersonAddPlayersAsTransferTargets,
        (uint)ActionID.PersonRemovePlayersAsTransferTargets,
        (uint)ActionID.PersonAddPlayersToClubDiscardList,
        (uint)ActionID.PersonRemovePlayersFromClubDiscardList,
        (uint)ActionID.PersonEnquireAboutPlayer,
        (uint)ActionID.PersonRecallPlayerFromLoan,
        (uint)ActionID.PersonSetPlayersTransferStatus,
        (uint)ActionID.PersonRemovePlayersFromTransferList,
        (uint)ActionID.PersonRemovePlayersFromLoanList,
        (uint)ActionID.PersonSetPlayersPlayingTime,
        (uint)ActionID.PersonAllowAbsenceOfLeave,
        (uint)ActionID.PersonRecallPlayerFromHoliday,
        (uint)ActionID.PersonDisciplinePlayer,
        (uint)ActionID.PersonSendOnIntensiveLanguageCourse,
        (uint)ActionID.PersonCoachingCourse,
        (uint)ActionID.PersonLeadershipCourse,
        (uint)ActionID.PersonApplyForWorkPermit,
        (uint)ActionID.PersonTriggerAutoExtendContractClause,
        (uint)ActionID.SetForDofContractRenewalPlayer,
        (uint)ActionID.SetForReleasePlayer,
        1196634484u // HumanClubResign (MGR-O15c 辞职)
    };
    private static bool Allowed(uint action) => Actions.Contains(action);
    public static object Available(string offered)
    {
        var available = Channel(offered, "game", "Actions");
        ContractCommands.Context(available, 0x50625059, LiveTools.GetReference("human").GetPersistentIdentity());
        if (!available.ContextDescriptions.TryGetValue("Records", out var records)) throw new ArgumentException("Actual person Records required.");
        using var document = JsonDocument.Parse(records);
        var root = document.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference")
            throw new ArgumentException("Use exactly one actual person.");
        var value = Record(available.Value) ?? throw new InvalidOperationException("Game actions are not ready.");
        var actions = new List<object>();
        foreach (var id in Actions)
            if (value.TryGetValue(id, out var choice) && choice != null && !choice.IsNull &&
                !(choice.DataType?.FullName == "System.Boolean" && choice.AsString() == "False"))
                actions.Add(new { id = id.ToString(CultureInfo.InvariantCulture), name = Enum.GetName(typeof(ActionID), id) });
        return new { ok = true, actions, scope = "current_game_offered_normal_person_menu_families", liveVerified = false };
    }

    private static readonly HashSet<uint> HighRiskActions = new() {
        (uint)ActionID.PersonMutualTerminationContract,
        (uint)ActionID.PersonReleaseClubFreeTransfer,
        (uint)ActionID.PersonWithdrawContractOffer,
        (uint)ActionID.PersonRecallPlayerFromLoan,
    };

    private sealed record Prepared(uint Action, SI.Interop.InteropReference ActionRef, string Target, TypedValue Payload, string Label, bool Disabled, bool Confirmation, TypedValue ConfirmationData, string Token);
    private static Prepared Prepare(string offered, string action, string items, string entryJson)
    {
        var available = Channel(offered, "game", "Actions");
        ContractCommands.Context(available, 0x50625059, LiveTools.GetReference("human").GetPersistentIdentity());
        if (!available.ContextDescriptions.TryGetValue("Records", out var records)) throw new ArgumentException("Original person Records are required.");
        using var document = JsonDocument.Parse(records);
        var root = document.RootElement;
        if (root.GetProperty("kind").GetString() != "list" || root.GetProperty("count").GetInt32() != 1 ||
            root.GetProperty("items")[0].GetProperty("type").GetString() != "FM.UI.PersonReference")
            throw new ArgumentException("Player management require exactly one actual player reference.");
        var selected = Channel(action, "game", "Action");
        if (!selected.ContextDescriptions.TryGetValue("Records", out var selectedRecords) || selectedRecords != records)
            throw new ArgumentException("Management action reference belongs to a different actual player.");
        if (!selected.Contexts.TryGetValue("ID", out var value) || !uint.TryParse(value, out var id) || !Allowed(id))
            throw new ArgumentException("Select an explicitly supported normal person-management action.");
        var offerings = Record(available.Value);
        if (offerings == null || !offerings.TryGetValue(id, out var offeredValue) || offeredValue.IsNull ||
            (offeredValue.DataType?.FullName == "System.Boolean" && offeredValue.AsString() == "False"))
            throw new InvalidOperationException("Game does not offer this management action for this player.");
        var menu = Channel(items, action, "Items");
        if (!menu.ContextDescriptions.TryGetValue("Records", out var menuRecords) || records != menuRecords)
            throw new ArgumentException("Management menu does not belong to the same actual player.");
        var entry = JsonSerializer.Deserialize<int[]>(entryJson);
        if (entry == null || entry.Length < 1 || entry.Length > 8 || entry.Any(index => index < 0)) throw new ArgumentException("Select an original menu leaf by 1..8 indices.");
        var current = menu.Value; SI.Core.Record row = null; var disabled = false;
        foreach (var index in entry)
        {
            var list = current?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            if (list == null || index >= list.Count) throw new ArgumentException("Management menu path is outside its original list.");
            row = Record(list[index]) ?? throw new ArgumentException("Management menu entry is not a record.");
            disabled |= Flag(row, "Disabled", false);
            var children = Field(row, "ChildList", false);
            var nested = Record(Field(row, "RowData", false)); if (nested != null) row = nested;
            disabled |= Flag(row, "Disabled", false);
            current = children == null || children.IsNull ? Field(row, "ChildList", false) : children;
        }
        if (current != null && !current.IsNull && current.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()?.Count > 0)
            throw new ArgumentException("Select a concrete business leaf, not a menu heading.");
        var payload = Field(row, "ActionData");
        if (Field(row, "Event").AsString() != "44" || payload == null || payload.IsNull)
            throw new InvalidOperationException("Select the game's actual DoAction business leaf, not navigation.");
        var confirmation = Field(Record(payload), "ConfirmationDialogData", false);
        var requiresConfirmation = confirmation != null && !confirmation.IsNull;
        var label = Field(row, "Text", false)?.AsString();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { session = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            human = LiveTools.GetReference("human").GetPersistentIdentity(), id, records, payload = NativeValueFingerprint.Compute(payload), disabled, requiresConfirmation }));
        return new Prepared(id, LiveTools.GetReference(action), DispatchJournal.Fingerprint(records), TypedValue.CreateCopyFrom(payload), label, disabled, requiresConfirmation, confirmation, token);
    }
    public static object Preview(string offered, string action, string items, string entry)
    {
        var p = Prepare(offered, action, items, entry);
        return new { ok = true, actionId = p.Action.ToString(CultureInfo.InvariantCulture), label = p.Label, choiceToken = p.Token,
            disabled = p.Disabled, requiresConfirmation = p.Confirmation, confirmation = LiveTools.DescribeValue(p.ConfirmationData), silentExecutionImplemented = !p.Disabled,
            verificationScope = "person_management_menu_dispatch", liveVerified = false };
    }
    public static object Execute(string id, string offered, string action, string items, string entry, string token, bool acceptConfirmation)
    {
        var p = Prepare(offered, action, items, entry);
        if (p.Token != token) throw new InvalidOperationException("Management request changed; preview again.");
        if (p.Disabled) throw new InvalidOperationException("Game disabled this management action.");
        var isHighRisk = HighRiskActions.Contains(p.Action);
        if (isHighRisk && p.Confirmation && !acceptConfirmation)
            throw new InvalidOperationException("该操作属于高危不可逆动作（解约/撤回报价/终止租借），请先阅读确认信息并显式传入 acceptConfirmation: true。");
        var payload = TypedValue.CreateCopyFrom(p.Payload);
        if ((!isHighRisk || acceptConfirmation) && Record(payload) is { } rec && rec.ContainsKey(0x7772436fu))
            rec[0x7772436fu] = TypedValue.Create(false);
        return ActionCommands.DispatchDomain(id, "person_management_menu_action", p.Target, p.Token,
            () =>
            {
                if (p.ActionRef != null)
                    FM.Game.PluginContextActionsModule.HandleActionEvent((ActionID)p.Action, (uint)InteropEventIDs.EventFmxDoAction, p.ActionRef, payload, false, null, null);
                else
                    GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxDoAction, null, payload);
            },
            null, null, "person_management_menu_dispatch");
    }
}
