using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Current shipped ContractTermsBlock/ContractNegotiationAddOnItem business
// bindings. Edits only the original negotiation draft through normal commands.
public static class ContractStructure
{
    public static object Routing() => new { ok = true, collections = new[] { "AddOnList", "BonusesList", "ClausesList" },
        actions = new[] { "add-bonus", "add-clause", "remove-addon", "numeric", "lock", "cash-increase", "cash-decrease", "reset", "use-existing" },
        candidateProperties = new[] { "BonusesCanAdd", "BonusesTabCanAdd", "ClausesCanAdd" }, liveVerified = false };
    private static LiveTools.Snapshot Channel(string handle, string source, string property, string path = "") => NegotiationActions.Channel(handle, source, property, path);
    private static void Flag(TypedValue value, bool expected, string message)
    { if (!bool.TryParse(value?.AsString(), out var actual) || actual != expected) throw new InvalidOperationException(message); }
    private static TypedValue Option(string options, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose an original native option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++)
        {
            var parent = NegotiationActions.Record(LiveTools.GetValue(options, string.Join('/', parts.Take(i))));
            if (parent != null && parent.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled))
                Flag(disabled, false, "Game disabled this option or its parent.");
        }
        var value = LiveTools.GetValue(options, path);
        var row = NegotiationActions.Record(value) ?? throw new ArgumentException("Select a native choice record.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) value = nested;
        row = NegotiationActions.Record(value) ?? throw new ArgumentException("Choice data is not a record.");
        if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var off)) Flag(off, false, "Game disabled this choice.");
        NegotiationActions.Field(row, "PropertyValue");
        return TypedValue.CreateCopyFrom(value);
    }
    private static (InteropReference Root, InteropReference Target, TypedValue Payload, uint Event, string Update, string Token) Prepare(
        string action, string session, string club, string readOnly, string willing, string collection, string componentPath,
        string baseInfo, string permission, string current, string options, string optionPath)
    {
        var root = ContractCommands.Target(session, club);
        Flag(Channel(readOnly, session, "NegotiationReadOnly").Value, false, "Contract negotiation is read-only.");
        Flag(Channel(willing, session, "IsWillingToEnterNegotiations").Value, true, "Other party is unwilling to negotiate.");
        var target = root; TypedValue payload = null; uint eventId = 0; string update = null;
        if (action == "add-bonus" || action == "add-clause")
        {
            var list = LiveTools.GetSnapshot(options);
            var properties = action == "add-bonus" ? new[] { "BonusesCanAdd", "BonusesTabCanAdd" } : new[] { "ClausesCanAdd" };
            if (!list.Ready || list.Source != session || !string.IsNullOrEmpty(list.SourcePath) || !properties.Any(p => list.Property == InternalCommands.PropertyId(p)))
                throw new ArgumentException("Use the original current contract bonus/clause choices.");
            payload = Option(options, optionPath);
            var selected = NegotiationActions.Field(NegotiationActions.Record(payload), "PropertyValue");
            if (selected == null || selected.IsNull || selected.AsString() == "0" || selected.AsString() == "-1")
                throw new ArgumentException("Choose a concrete contract bonus/clause, not a menu header.");
            eventId = action == "add-bonus" ? 1668685894u : 1936536162u;
        }
        else if (action == "reset" || action == "use-existing")
        {
            Flag(Channel(permission, session, action == "reset" ? "CanResetTerms" : "CanUseExistingContract").Value,
                true, "Game does not currently permit this contract reset or existing-contract action.");
            eventId = action == "reset" ? 91u : 92u;
        }
        else
        {
            var list = LiveTools.GetSnapshot(collection);
            if (!list.Ready || list.Source != session || !string.IsNullOrEmpty(list.SourcePath) ||
                !new[] { "AddOnList", "BonusesList", "ClausesList" }.Any(p => list.Property == InternalCommands.PropertyId(p)))
                throw new ArgumentException("Resolve a current contract add-on from its actual draft collection.");
            target = LiveTools.GetReference(collection, componentPath);
            if (target.GetIl2CppType().FullName != "FM.UI.ContractEditSessionAddOnComponentReference")
                throw new ArgumentException("Select the original contract add-on reference, not a numeric ID.");
            var info = Channel(baseInfo, collection, "BaseComponentData", componentPath);
            var data = NegotiationActions.Record(info.Value) ?? throw new ArgumentException("Add-on base data unavailable.");
            Flag(NegotiationActions.Field(data, "IsDisabled"), false, "Game disabled this contract component.");
            if (action == "remove-addon")
            { Flag(Channel(permission, collection, "AddOnCanBeRemoved", componentPath).Value, true, "Game does not permit removing this add-on."); eventId = 48; }
            else if (action == "numeric" || action == "lock")
            {
                if (action == "lock") Flag(NegotiationActions.Field(data, "DisableLock"), false, "Game disabled this lock control.");
                var property = action == "numeric" ? "AddOnNumericValue" : "AddOnLockStatus";
                Channel(current, collection, property, componentPath);
                if (action == "numeric")
                { Channel(options, collection, "AddOnPossibleNumericValues", componentPath); Flag(Channel(permission, collection, "AddOnRequiresNumericValue", componentPath).Value, true, "This add-on has no numeric selector."); }
                else Channel(options, baseInfo, "PossibleLockStatuses");
                payload = Option(options, optionPath); update = current;
            }
            else if (action == "cash-increase" || action == "cash-decrease")
            { Flag(Channel(permission, collection, "AddOnRequiresCashValue", componentPath).Value, true, "This add-on has no cash selector."); eventId = action == "cash-increase" ? 51u : 52u; }
            else throw new ArgumentException("Unknown contract structure action.");
        }
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, root = root.GetPersistentIdentity(), target = target.GetPersistentIdentity(), revision = NegotiationActions.Revision(root.GetPersistentIdentity()),
            payload = payload == null ? null : NativeValueFingerprint.Compute(payload),
            collection = string.IsNullOrEmpty(collection) ? null : NativeValueFingerprint.Compute(LiveTools.GetSnapshot(collection).Value),
            before = string.IsNullOrEmpty(current) ? null : NativeValueFingerprint.Compute(LiveTools.GetSnapshot(current).Value) }));
        return (root, target, payload, eventId, update, token);
    }
    public static object Preview(string action, string session, string club, string readOnly, string willing, string collection, string componentPath,
        string baseInfo, string permission, string current, string options, string optionPath)
    {
        var p = Prepare(action, session, club, readOnly, willing, collection, componentPath, baseInfo, permission, current, options, optionPath);
        return new { ok = true, choiceToken = p.Token, action, eventId = p.Event, payload = p.Payload == null ? null : LiveTools.DescribeValue(p.Payload),
            verificationScope = "contract_structure_dispatch", draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string action, string session, string club, string readOnly, string willing, string collection, string componentPath,
        string baseInfo, string permission, string current, string options, string optionPath, string token)
    {
        var p = Prepare(action, session, club, readOnly, willing, collection, componentPath, baseInfo, permission, current, options, optionPath);
        if (p.Token != token) throw new InvalidOperationException("Contract add-on or legal choices changed; refresh the preview.");
        LiveTools.RequireUnusedDraft(p.Root);
        return ActionCommands.DispatchDomain(id, "contract_structure_" + action, p.Root.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Root.GetPersistentIdentity());
            if (p.Update != null) LiveTools.UpdateProperty(p.Update, p.Payload);
            else SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, "contract_structure_dispatch");
    }
}
