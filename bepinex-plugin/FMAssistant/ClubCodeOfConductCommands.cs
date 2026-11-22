using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Club code-of-conduct fine draft. Current build registries (evidence/v80-code-of-conduct.json):
// CodeOfConductReference = Fines / MostRecentOffenceString / OffencesThisSeasonString / PreviousPlayerOffences / CanEdit / Status;
// CodeOfConductFineReference = Fine / FineAndOffenceType / FineDropdown / FineString / CanDecrementValue / CanEdit / CanIncrementValue.
// ClubCodeOfConductFineCell asset: increment 80, decrement 79 (data binding.FineAndOffenceType),
// dropdown change 1850488427 (data selected_value). Not live-verified.
public static class ClubCodeOfConductCommands
{
    private static InteropReference Resolve(string coc)
    {
        var target = LiveTools.GetReference(coc);
        var snapshot = LiveTools.GetSnapshot(coc);
        if (target.GetIl2CppType().FullName != "FM.UI.CodeOfConductReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("CodeOfConduct"))
            throw new ArgumentException("Resolve the actual Club.CodeOfConduct reference.");
        return target;
    }
    private static LiveTools.Snapshot RowChannel(string handle, string fines, string finePath, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != fines || (snapshot.SourcePath ?? "") != finePath ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong code-of-conduct fine subscription: " + property);
        return snapshot;
    }
    private static InteropReference Row(string fines, string finePath)
    {
        if (string.IsNullOrWhiteSpace(finePath)) throw new ArgumentException("Select an actual fine row path.");
        var row = LiveTools.GetReference(fines, finePath);
        if (row.GetIl2CppType().FullName != "FM.UI.CodeOfConductFineReference") throw new ArgumentException("Fine row reference does not match CodeOfConductFineReference.");
        return row;
    }
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static bool Flag(string handle, string fines, string finePath, string property) =>
        bool.TryParse(RowChannel(handle, fines, finePath, property).Value?.AsString(), out var flag)
            ? flag : throw new ArgumentException("Native fine flag is not ready: " + property);
    public static object Read(string coc, string fines, string finePath, string fineString, string canEdit, string canIncrement, string canDecrement)
    {
        var target = Resolve(coc);
        var row = Row(fines, finePath);
        return new { ok = true, codeOfConductIdentity = target.GetPersistentIdentity(), fineIdentity = row.GetPersistentIdentity(),
            fineString = LiveTools.DescribeValue(RowChannel(fineString, fines, finePath, "FineString").Value),
            canEdit = Flag(canEdit, fines, finePath, "CanEdit"), canIncrement = Flag(canIncrement, fines, finePath, "CanIncrementValue"),
            canDecrement = Flag(canDecrement, fines, finePath, "CanDecrementValue"), draftOnly = true, liveVerified = false };
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete fine option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var row = Record(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
            if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
                throw new InvalidOperationException("Game disabled this fine option or its parent group.");
        }
        var option = LiveTools.GetValue(handle, path);
        var selected = Record(option) ?? throw new ArgumentException("Selected fine option is not a native record.");
        if (selected.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; selected = Record(option); }
        if (selected != null && selected.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var value))
            return TypedValue.CreateCopyFrom(value);
        return option;
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Scope, string Token) Prepare(
        string action, string coc, string fines, string finePath, string canEdit, string canIncrement, string canDecrement,
        string fineType, string dropdown, string optionPath)
    {
        var target = Resolve(coc);
        Row(fines, finePath);
        TypedValue payload;
        uint eventId;
        string scope;
        if (action == "increment" || action == "decrement")
        {
            if (!Flag(canEdit, fines, finePath, "CanEdit")) throw new InvalidOperationException("Game does not allow editing this fine row.");
            var permission = action == "increment" ? "CanIncrementValue" : "CanDecrementValue";
            var permissionHandle = action == "increment" ? canIncrement : canDecrement;
            if (!Flag(permissionHandle, fines, finePath, permission)) throw new InvalidOperationException("Game does not allow this fine " + action + ".");
            payload = TypedValue.CreateCopyFrom(RowChannel(fineType, fines, finePath, "FineAndOffenceType").Value);
            eventId = action == "increment" ? 80u : 79u; scope = "code_of_conduct_fine_" + action;
        }
        else if (action == "change")
        {
            if (!Flag(canEdit, fines, finePath, "CanEdit")) throw new InvalidOperationException("Game does not allow editing this fine row.");
            var list = LiveTools.GetSnapshot(dropdown);
            if (!list.Ready || list.Source != fines || (list.SourcePath ?? "") != finePath ||
                list.Property != InternalCommands.PropertyId("FineDropdown")) throw new ArgumentException("Use the fine row's actual FineDropdown list.");
            payload = Option(dropdown, optionPath); eventId = 1850488427u; scope = "code_of_conduct_fine_change";
        }
        else throw new ArgumentException("Use increment, decrement or change.");
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity = target.GetPersistentIdentity(), fine = finePath, payload = NativeValueFingerprint.Compute(payload),
            revision = NegotiationActions.Revision(target.GetPersistentIdentity()) }));
        return (target, payload, eventId, scope, token);
    }
    public static object Preview(string action, string coc, string fines, string finePath, string canEdit, string canIncrement, string canDecrement,
        string fineType, string dropdown, string optionPath)
    {
        var p = Prepare(action, coc, fines, finePath, canEdit, canIncrement, canDecrement, fineType, dropdown, optionPath);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = LiveTools.DescribeValue(p.Payload), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string coc, string fines, string finePath, string canEdit, string canIncrement, string canDecrement,
        string fineType, string dropdown, string optionPath, string token)
    {
        var p = Prepare(action, coc, fines, finePath, canEdit, canIncrement, canDecrement, fineType, dropdown, optionPath);
        if (token != p.Token) throw new InvalidOperationException("Code-of-conduct fine draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "code_of_conduct_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, p.Scope);
    }
}
