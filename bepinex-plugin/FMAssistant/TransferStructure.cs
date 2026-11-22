using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

public static class TransferStructure
{
    private static readonly string[] Available = { "TransferOfferAvailableAdditionalFees", "TransferOfferAvailableInstallmentFees",
        "TransferOfferAvailableBonusesBase", "TransferOfferAvailableBonusesCompetition", "TransferOfferAvailableAdditionalClauses",
        "TransferOfferAvailableAdditionalClausesWithProperties", "TransferOfferLoanAvailableAdditionalClauses", "TransferOfferLoanAvailableAdditionalOptions",
        "TransferOfferLoanAvailableFutureLoanToBuyFees", "TransferOfferLoanAvailableAdditionalFutureFees", "TransferOfferLoanAvailableAdditionalFutureClauses" };
    public static object Routing() => new { ok = true, candidateProperties = Available, liveVerified = false };
    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Value(SI.Core.Record record) => record != null && record.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var value)
        ? value : throw new ArgumentException("Select a native option record with PropertyValue.");
    private static void Enabled(TypedValue value)
    {
        var row = Record(value);
        if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
            throw new InvalidOperationException("Game disabled this option or its parent group.");
    }
    private static LiveTools.Snapshot Channel(string handle, string session, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != session || !string.IsNullOrEmpty(snapshot.SourcePath) || snapshot.Property != InternalCommands.PropertyId(property))
            throw new ArgumentException("Wrong offer subscription: " + property);
        return snapshot;
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete native option path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++) Enabled(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
        var option = LiveTools.GetValue(handle, path);
        var row = Record(option) ?? throw new ArgumentException("Selected option is not a record.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; Enabled(option); }
        Value(Record(option));
        return option;
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Before, string Desired, string Token) Prepare(
        string action, string session, string club, string editable, string options, string optionPath, string collection, string clausePath, string canRemove, string current)
    {
        var target = NegotiationActions.Target("transfer", session, club);
        var edit = Channel(editable, session, "CanMakeChangesToOffer");
        if (!bool.TryParse(edit.Value?.AsString(), out var allowed) || !allowed) throw new InvalidOperationException("Game does not permit changing this offer.");
        TypedValue payload;
        string before = null, desired = null;
        uint eventId;
        if (action == "remove-clause")
        {
            var clause = TransferCommands.Clause(session, club, collection, clausePath);
            var permission = LiveTools.GetSnapshot(canRemove);
            if (!permission.Ready || permission.Source != collection || permission.SourcePath != clausePath || permission.Identity != clause.GetPersistentIdentity() ||
                permission.Property != InternalCommands.PropertyId("CanRemoveClause") || !bool.TryParse(permission.Value?.AsString(), out var remove) || !remove)
                throw new InvalidOperationException("Game does not allow removing this clause.");
            payload = TypedValue.CreateCopyFrom(LiveTools.GetValue(collection, clausePath));
            eventId = 123;
        }
        else if (action == "add-clause")
        {
            var offered = LiveTools.GetSnapshot(options);
            if (offered.Source != session) Channel(offered.Source, session, "TransferOfferClientContext");
            if (!offered.Ready || !string.IsNullOrEmpty(offered.SourcePath) ||
                !Available.Any(name => offered.Property == InternalCommands.PropertyId(name))) throw new ArgumentException("Use the game's current available clause/fee list.");
            payload = Option(options, optionPath);
            if (!uint.TryParse(Value(Record(payload)).AsString(), out var id) || id == 0) throw new ArgumentException("Select a concrete fee/clause, not a header.");
            eventId = 122;
        }
        else if (action == "offer-type")
        {
            var snap = LiveTools.GetSnapshot(options);
            var owner = snap.Source;
            if (owner != session) Channel(owner, session, "TransferOfferClientContext");
            var propName = snap.Property == InternalCommands.PropertyId("TypeOptionList") ? "TypeOptionList" : "TransferOfferTypeList";
            Channel(options, owner, propName);
            var selected = Option(options, optionPath);
            payload = TypedValue.CreateCopyFrom(Value(Record(selected)));
            var old = Channel(current, session, "TransferOfferTypeDropdownSelection").Value;
            before = (Record(old) is { } record ? Value(record) : old).AsString();
            desired = payload.AsString();
            eventId = 33;
        }
        else throw new ArgumentException("Unknown transfer structure operation.");
        var identity = target.GetPersistentIdentity();
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, action, identity,
            revision = NegotiationActions.Revision(identity), before, desired, payload = NativeValueFingerprint.Compute(payload),
            collection = action == "remove-clause" ? NativeValueFingerprint.Compute(LiveTools.GetSnapshot(collection).Value) : null }));
        return (target, payload, eventId, before, desired, token);
    }
    public static object Preview(string action, string session, string club, string editable, string options, string optionPath, string collection, string clausePath, string canRemove, string current)
    {
        var prepared = Prepare(action, session, club, editable, options, optionPath, collection, clausePath, canRemove, current);
        return new { ok = true, choiceToken = prepared.Token, before = prepared.Before, requested = prepared.Desired,
            payload = LiveTools.DescribeValue(prepared.Payload), liveVerified = false };
    }
    public static object Execute(string id, string action, string session, string club, string editable, string options, string optionPath, string collection, string clausePath, string canRemove, string current, string token)
    {
        var prepared = Prepare(action, session, club, editable, options, optionPath, collection, clausePath, canRemove, current);
        if (token != prepared.Token) throw new InvalidOperationException("Offer structure or legal option changed since preview.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        return ActionCommands.DispatchDomain(id, "transfer_structure_" + action, prepared.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(prepared.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(prepared.Event, prepared.Target, prepared.Payload);
        }, prepared.Before, prepared.Desired, action == "offer-type" ? "transfer_offer_type_draft" : "transfer_structure_dispatch");
    }
    public static object ObserveType(string id, string session, string club, string current)
    {
        var target = NegotiationActions.Target("transfer", session, club);
        var value = Channel(current, session, "TransferOfferTypeDropdownSelection").Value;
        var row = Record(value);
        return ActionCommands.ObserveDomain(id, target.GetPersistentIdentity(), "transfer_offer_type_draft", (row == null ? value : Value(row)).AsString());
    }
}
