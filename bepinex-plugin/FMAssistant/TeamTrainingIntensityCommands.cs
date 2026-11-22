using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Team training intensity. Event 1681470056 SetTrainingIntensity, captured on the current build from
// TrainingIntensityByConditionSelection (rid1052): target Team.TeamTraining, data selectedintensity.
// Current selection comes from the TrainingIntensitySettingsForConditionRanges record, not the root property.
// The selected intensity is copied from the native candidate list; native acceptance/condition effects
// are not verified yet.
public static class TeamTrainingIntensityCommands
{
    private const string Scope = "team_training_intensity_draft";
    private static InteropReference Resolve(string training)
    {
        var target = LiveTools.GetReference(training);
        var snapshot = LiveTools.GetSnapshot(training);
        if (target.GetIl2CppType().FullName != "FM.UI.TeamTrainingReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("TeamTraining"))
            throw new ArgumentException("Resolve the actual team training reference.");
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string training, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != training || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong team training subscription: " + property);
        return snapshot;
    }
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete training intensity option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var row = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
                throw new InvalidOperationException("Game disabled this training intensity or its parent group.");
        }
        var option = LiveTools.GetValue(handle, path);
        var selected = Record(option) ?? throw new ArgumentException("Selected training intensity is not a native record.");
        if (selected.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; selected = Record(option); }
        if (selected == null || !selected.ContainsKey(InternalCommands.PropertyId("PropertyValue")))
            throw new ArgumentException("Selected training intensity has no PropertyValue.");
        return option;
    }
    private static TypedValue Current(string selected, string options, string training)
    {
        var state = Channel(selected, training, "TrainingIntensitySettingsForConditionRanges");
        var candidates = Channel(options, training, "TrainingIntensities");
        // Compare all context values: both native channels must describe the same condition range.
        if (state.Contexts.Count != candidates.Contexts.Count || state.Contexts.Any(kv =>
            !candidates.Contexts.TryGetValue(kv.Key, out var value) || value != kv.Value))
            throw new ArgumentException("Training intensity channels have different contexts.");
        var row = Record(state.Value) ?? throw new InvalidOperationException("Training intensity setting is unavailable.");
        if (!row.TryGetValue(InternalCommands.PropertyId("Condition"), out var condition) ||
            !row.TryGetValue(InternalCommands.PropertyId("TrainingSelectedIntensity"), out var current) || Record(current) == null)
            throw new InvalidOperationException("Training intensity setting has no current selection.");
        var selectedRow = Record(current);
        if (!state.Contexts.TryGetValue("ConditionRange", out var expectedRange) ||
            !selectedRow.TryGetValue(InternalCommands.PropertyId("Condition"), out var range) ||
            condition.AsString() != range.AsString() || range.AsString() != expectedRange)
            throw new InvalidOperationException("Training intensity condition does not match selection.");
        return current;
    }
    public static object Read(string training, string selected, string options, string operationId = "")
    {
        var target = Resolve(training);
        var current = Current(selected, options, training);
        var candidates = Channel(options, training, "TrainingIntensities").Value;
        var fingerprint = NativeValueFingerprint.Compute(current);
        var receipt = string.IsNullOrWhiteSpace(operationId) ? null :
            ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), Scope, fingerprint);
        return new { ok = true, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            trainingIdentity = target.GetPersistentIdentity(), currentFingerprint = fingerprint, receipt,
            current = LiveTools.DescribeValue(current), candidates = LiveTools.DescribeValue(candidates, 6),
            draftOnly = true, liveVerified = false };
    }
    private static (InteropReference Target, TypedValue Payload, string Token, string Before, string Requested) Prepare(
        string training, string selected, string options, string optionPath)
    {
        var target = Resolve(training);
        var before = Current(selected, options, training);
        Channel(options, training, "TrainingIntensities");
        var payload = Option(options, optionPath);
        var currentRow = Record(before);
        var payloadRow = Record(payload);
        if (!currentRow.TryGetValue(InternalCommands.PropertyId("Condition"), out var currentRange) ||
            !payloadRow.TryGetValue(InternalCommands.PropertyId("Condition"), out var payloadRange) ||
            currentRange.AsString() != payloadRange.AsString())
            throw new InvalidOperationException("Candidate condition range does not match current setting.");
        var requested = NativeValueFingerprint.Compute(payload);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "set-team-training-intensity", identity = target.GetPersistentIdentity(),
            before = NativeValueFingerprint.Compute(before), requested, revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, token, NativeValueFingerprint.Compute(before), requested);
    }
    public static object Preview(string training, string selected, string options, string optionPath)
    {
        var p = Prepare(training, selected, options, optionPath);
        return new { ok = true, nativeEvent = 1681470056u, choiceToken = p.Token, before = p.Before, requested = p.Requested,
            payload = LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false,
            note = "TrainingIntensities 候选的 PropertyValue 原样发送；原生接受与 condition 影响未真机。" };
    }
    public static object Execute(string id, string training, string selected, string options, string optionPath, string token)
    {
        var p = Prepare(training, selected, options, optionPath);
        if (token != p.Token) throw new InvalidOperationException("Team training intensity or legal option changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "team_training_intensity", p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1681470056u, p.Target, p.Payload);
        }, p.Before, p.Requested, Scope);
    }
}
