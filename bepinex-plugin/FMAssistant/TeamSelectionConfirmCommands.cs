using System;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Confirm the currently shown team selection (FullScreenTeamSelection asset, current build):
// event 1714714946 with target=Tactic and data=const.True. The UI string pair "Tactic"/"const.True"
// and the event id are static evidence only (evidence/v85-team-selection-confirm.json); no live dispatch.
public static class TeamSelectionConfirmCommands
{
    private static InteropReference Resolve(string tactic)
    {
        var target = LiveTools.GetReference(tactic);
        var snapshot = LiveTools.GetSnapshot(tactic);
        var type = target.GetIl2CppType().FullName ?? "";
        if (!type.EndsWith("TacticReference", StringComparison.Ordinal) || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("Tactic"))
            throw new ArgumentException("Resolve the actual current Tactic reference from the live tactic subscription.");
        return target;
    }
    private static string Token(InteropReference target) => DispatchJournal.Fingerprint(LiveTools.JsonText(new {
        sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action = "confirm-shown-team-selection",
        identity = target.GetPersistentIdentity(), revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
    public static object Preview(string tactic)
    {
        var target = Resolve(tactic);
        return new { ok = true, nativeEvent = 1714714946u, choiceToken = Token(target), payload = true,
            draftOnly = true, liveVerified = false,
            note = "确认当前显示的球队选择；确认结果与是否已提交比赛阵容仍需独立读回。" };
    }
    public static object Execute(string id, string tactic, string token)
    {
        var target = Resolve(tactic);
        var expected = Token(target);
        if (token != expected) throw new InvalidOperationException("Current tactic or selection changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "confirm_shown_team_selection", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1714714946u, target, TypedValue.Create(true));
        }, null, null, "team_selection_confirm");
    }

    // DeleteTeamSelection 1312180533: target=Tactic, data=the selected entry from Tactic.TeamSelections
    // (evidence/v93-team-selection-delete.json). Static evidence only; no live dispatch.
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Selection(string selections, string tactic, string optionPath)
    {
        if (string.IsNullOrWhiteSpace(optionPath)) throw new ArgumentException("Select an actual team selection path.");
        var list = LiveTools.GetSnapshot(selections);
        if (!list.Ready || list.Source != tactic || !string.IsNullOrEmpty(list.SourcePath) ||
            list.Property != InternalCommands.PropertyId("TeamSelections"))
            throw new ArgumentException("Use the current tactic's actual TeamSelections list.");
        var option = LiveTools.GetValue(selections, optionPath);
        var row = Record(option) ?? throw new ArgumentException("Selected team selection is not a native record.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; row = Record(option); }
        if (row == null) throw new ArgumentException("Selected team selection row is empty.");
        return TypedValue.CreateCopyFrom(option);
    }
    public static object DeletePreview(string tactic, string selections, string optionPath)
    {
        var target = Resolve(tactic);
        var payload = Selection(selections, tactic, optionPath);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "delete-team-selection", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        return new { ok = true, nativeEvent = 1312180533u, choiceToken = token, payload = LiveTools.DescribeValue(payload),
            draftOnly = true, liveVerified = false };
    }
    public static object DeleteExecute(string id, string tactic, string selections, string optionPath, string token)
    {
        var target = Resolve(tactic);
        var payload = Selection(selections, tactic, optionPath);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "delete-team-selection", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        if (token != expected) throw new InvalidOperationException("Team selection list changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "delete_team_selection", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1312180533u, target, payload);
        }, null, null, "delete_team_selection");
    }
}
