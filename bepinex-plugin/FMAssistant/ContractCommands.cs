using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using SI.Core;
using SI.Interop;
using SI.Bindable.Reference.Core;
using FM.GamePlugin;

namespace FMAssistant;

// Native 1802ef4c0 handles these normal channel updates. Select the complete original
// game option record from each component's PossibleValues, never an invented numeric payload.
public static class ContractCommands
{
    public sealed record Recipe(string Kind, string Owner, string Current, bool Cash = false, long CashSelector = 0)
    {
        public string Choices => Cash ? "IntervalValues" : "PossibleValues";
    }
    private static readonly Recipe[] Recipes = {
        new("contract-status", "ContractStatusComponentInfo", "ContractStatus"),
        new("start-date", "StartDateComponentInfo", "StartDate"),
        new("end-date", "EndDateComponentInfo", "EndDate"),
        new("wage", "WeeklyWageComponentInfo", "Wage", true, 8),
        new("loyalty-bonus", "LoyaltyBonusComponentInfo", "LoyaltyBonus", true, 64),
        new("agent-fee", "AgentFeeComponentInfo", "AgentFee", true, 128)
    };
    private const string Scope = "contract_draft_term";
    private static Recipe Find(string kind) => Recipes.SingleOrDefault(recipe => recipe.Kind == kind)
        ?? throw new ArgumentException("Unknown contract term kind.");
    public static object Routing() => new { ok = true, recipes = Recipes, liveVerified = false,
        scope = Scope, note = "Draft term selection only. This does not submit or agree a contract." };
    private static SI.Core.Record Record(TypedValue value) => value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    private static TypedValue Field(SI.Core.Record record, string name) => record != null && record.TryGetValue(InternalCommands.PropertyId(name), out var field)
        ? field : throw new ArgumentException("Native contract data is missing " + name);
    private static void RequireBoolean(TypedValue value, bool expected, string message)
    {
        if (!bool.TryParse(value?.AsString(), out var actual) || actual != expected) throw new InvalidOperationException(message);
    }
    internal static void Context(LiveTools.Snapshot snapshot, uint contextId, string identity)
    {
        var name = new ContextID(contextId).ToString().Split(':')[0];
        if (!snapshot.ContextDescriptions.TryGetValue(name, out var description)) throw new ArgumentException("Contract session is missing its original actor context.");
        using var document = JsonDocument.Parse(description);
        if (!document.RootElement.TryGetProperty("identity", out var value) || value.GetString() != identity)
            throw new ArgumentException("Contract session belongs to a different actor or club.");
    }
    internal static InteropReference Target(string session, string club)
    {
        var human = LiveTools.GetReference("human");
        var clubSnapshot = LiveTools.GetSnapshot(club);
        if (!clubSnapshot.Ready || clubSnapshot.Source != "human" || !string.IsNullOrEmpty(clubSnapshot.SourcePath) ||
            clubSnapshot.Property != InternalCommands.PropertyId("Club") || clubSnapshot.Identity != human.GetPersistentIdentity())
            throw new ArgumentException("Use the active manager's actual club reference.");
        var target = LiveTools.GetReference(session);
        var snapshot = LiveTools.GetSnapshot(session);
        if (target.GetIl2CppType().FullName != "FM.UI.ContractEditSessionReference" || !snapshot.Ready ||
            snapshot.Property != InternalCommands.PropertyId("ContractEditSession") ||
            LiveTools.GetReference(snapshot.Source, snapshot.SourcePath).GetIl2CppType().FullName != "FM.UI.PersonReference")
            throw new ArgumentException("Resolve the contract session from a real person reference.");
        // Current native constructor 1802ef430: person, human, buying club.
        Context(snapshot, 0x50625059, human.GetPersistentIdentity());
        Context(snapshot, 0x43627963, LiveTools.GetReference(club).GetPersistentIdentity());
        return target;
    }
    private static LiveTools.Snapshot Channel(string handle, string source, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != source || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong contract subscription: " + property);
        return snapshot;
    }

    private const string OpenDraftCommand = "open_contract_draft";
    private const string OpenDraftScope = "observed_editable_contract_draft";

    private static (InteropReference Target, string PersonIdentity, string Label, string Token) DraftChoice(
        string session, string club, string offered, string action, string items, int[] entry)
    {
        var target = Target(session, club);
        var snapshot = LiveTools.GetSnapshot(session);
        var person = LiveTools.GetReference(snapshot.Source, snapshot.SourcePath).GetPersistentIdentity();
        var choice = ActionCommands.ContractDraftChoice(offered, action, items, entry, person);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), person, entry, choice.Fingerprint }));
        return (target, person, choice.Label, token);
    }

    public static object PreviewDraft(string session, string club, string offered, string action, string items, int[] entry)
    {
        var draft = DraftChoice(session, club, offered, action, items, entry);
        return new { ok = true, choiceToken = draft.Token, personIdentity = draft.PersonIdentity,
            targetIdentity = draft.Target.GetPersistentIdentity(), label = draft.Label, sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch };
    }

    public static object OpenDraft(string id, string session, string club, string offered, string action, string items, int[] entry, string token)
    {
        var draft = DraftChoice(session, club, offered, action, items, entry);
        if (draft.Token != token) throw new InvalidOperationException("The contract candidate or its original negotiation option changed; preview again.");
        LiveTools.RequireUnusedDraft(draft.Target);
        object query = null;
        var receipt = ActionCommands.DispatchDomain(id, OpenDraftCommand, draft.Target.GetPersistentIdentity(), token, () =>
            query = LiveTools.Open(session, "", InternalCommands.PropertyId("SalaryBudgetImpact"), "{}", transient: true),
            null, "True", OpenDraftScope);
        return new { receipt, query };
    }

    public static object ObserveDraft(string id, string session, string club, string readOnly, string willing, string wage)
    {
        var target = Target(session, club);
        if (ActionCommands.Status(id) is not DispatchJournal.Receipt previous || previous.command != OpenDraftCommand)
            throw new ArgumentException("Use the original contract draft operation ID.");
        if (!bool.TryParse(Channel(readOnly, session, "NegotiationReadOnly").Value?.AsString(), out var locked) ||
            !bool.TryParse(Channel(willing, session, "IsWillingToEnterNegotiations").Value?.AsString(), out var accepted))
            throw new InvalidOperationException("Native negotiation readiness is unavailable.");
        var current = Selection(Channel(wage, session, "Wage").Value);
        var draftHasWage = long.TryParse(current?.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var amount) && amount >= 0;
        var receipt = ActionCommands.ObserveDomain(id, target.GetPersistentIdentity(), OpenDraftScope, (!locked && accepted && draftHasWage).ToString());
        return new { receipt, readOnly = locked, willing = accepted, wage = draftHasWage ? LiveTools.DescribeValue(current) : null, operationSubmitsContract = false };
    }
    private static TypedValue Selection(TypedValue value) => Field(Record(value), "PropertyValue");
    private static void Editable(string session, string owner, string readOnly, string willing, Recipe recipe)
    {
        RequireBoolean(Channel(readOnly, session, "NegotiationReadOnly").Value, false, "Game has made this negotiation read-only.");
        RequireBoolean(Channel(willing, session, "IsWillingToEnterNegotiations").Value, true, "The other party is not willing to enter negotiations.");
        var component = Channel(owner, session, recipe.Owner);
        var data = Record(component.Value) ?? throw new ArgumentException("Contract component is not a native record.");
        RequireBoolean(Field(data, "IsHidden"), false, "Game has hidden this contract term.");
        RequireBoolean(Field(Record(Field(data, "BaseComponentData")), "IsDisabled"), false, "Game has disabled this contract term.");
    }
    private static string ForeignValue(string session, string owner, string cash, Recipe recipe)
    {
        if (!recipe.Cash) throw new ArgumentException("This contract term is not a cash input.");
        Channel(owner, session, recipe.Owner);
        var info = Record(Channel(cash, owner, "CashSelectionIntervalsInfo").Value);
        var value = Selection(Field(info, "ForeignValue"));
        if (!long.TryParse(value.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
            throw new ArgumentException("Native cash input is not a signed 64-bit integer.");
        return number.ToString(CultureInfo.InvariantCulture);
    }
    public static object ReadCash(string kind, string session, string club, string owner, string cash, string operationId)
    {
        var recipe = Find(kind);
        var target = Target(session, club);
        var value = ForeignValue(session, owner, cash, recipe);
        return string.IsNullOrEmpty(operationId)
            ? new { ok = true, kind, current = value, unit = "native_cash_combobox_foreign_value", epoch = LiveTools.CurrentEpoch }
            : ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), "contract_draft_cash_input." + kind, value);
    }

    public static object Read(string kind, string session, string club, string current, string operationId)
    {
        var recipe = Find(kind);
        var target = Target(session, club);
        var snapshot = Channel(current, session, recipe.Current);
        var value = Selection(snapshot.Value);
        var currentToken = NativeValueFingerprint.Compute(value);
        return string.IsNullOrEmpty(operationId)
            ? new { ok = true, kind, current = currentToken, value = LiveTools.DescribeValue(value),
                targetIdentity = target.GetPersistentIdentity(), epoch = LiveTools.CurrentEpoch, sessionId = LiveTools.SessionId }
            : ActionCommands.ObserveDomain(operationId, target.GetPersistentIdentity(), Scope + "." + kind, currentToken);
    }

    private static (InteropReference Target, TypedValue Payload, string Before, string Desired, string Token) Prepare(
        string kind, string session, string club, string current, string owner, string options, string readOnly, string willing, int index)
    {
        var recipe = Find(kind);
        var target = Target(session, club);
        Editable(session, owner, readOnly, willing, recipe);
        var choicesSource = owner;
        if (recipe.Cash)
        {
            // The native CashSelection builder returns raw amounts in IntervalValues.PropertyValue
            // and separately formatted ForeignValue for display. Preserve the original raw choice;
            // never parse currency text or infer weekly/yearly or exchange-rate conversions.
            choicesSource = LiveTools.GetSnapshot(options).Source;
            Channel(choicesSource, owner, "CashSelectionIntervalsInfo");
        }
        var choices = Channel(options, choicesSource, recipe.Choices).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
            ?? throw new ArgumentException("Contract term has no native choice list.");
        if (index < 0 || index >= choices.Count) throw new ArgumentException("Choose an existing contract term option.");
        var option = choices[index];
        var row = Record(option) ?? throw new ArgumentException("Contract option is not a record.");
        if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var outerDisabled))
            RequireBoolean(outerDisabled, false, "Game disabled this contract option.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested))
        { option = nested; row = Record(option) ?? throw new ArgumentException("Contract choice data is not a record."); }
        if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled))
            RequireBoolean(disabled, false, "Game disabled this contract option.");
        var desired = NativeValueFingerprint.Compute(Selection(option));
        var before = NativeValueFingerprint.Compute(Selection(Channel(current, session, recipe.Current).Value));
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), kind, before, desired, payload = NativeValueFingerprint.Compute(option) }));
        return (target, option, before, desired, token);
    }
    public static object Preview(string kind, string session, string club, string current, string owner, string options, string readOnly, string willing, int index)
    {
        var prepared = Prepare(kind, session, club, current, owner, options, readOnly, willing, index);
        return new { ok = true, before = prepared.Before, requested = prepared.Desired, choiceToken = prepared.Token,
            option = LiveTools.DescribeValue(prepared.Payload), liveVerified = false, verificationScope = Scope + "." + kind };
    }
    public static object Execute(string id, string kind, string session, string club, string current, string owner, string options, string readOnly, string willing, int index, string token)
    {
        var prepared = Prepare(kind, session, club, current, owner, options, readOnly, willing, index);
        if (prepared.Token != token) throw new InvalidOperationException("Contract term or legal choice changed; refresh before applying.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        return ActionCommands.DispatchDomain(id, "stage_contract_term_" + kind, prepared.Target.GetPersistentIdentity(),
            LiveTools.JsonText(new { kind, prepared.Before, prepared.Desired }),
            () => { NegotiationActions.Touch(prepared.Target.GetPersistentIdentity()); LiveTools.UpdateProperty(current, TypedValue.CreateCopyFrom(prepared.Payload)); },
            prepared.Before, prepared.Desired, Scope + "." + kind);
    }

    private static (InteropReference Target, SI.Core.Record Payload, string Before, string Desired, string Token) PrepareAmount(
        string kind, string session, string club, string owner, string cash, string readOnly, string willing, string amount)
    {
        var recipe = Find(kind);
        if (!recipe.Cash || !long.TryParse(amount, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
            throw new ArgumentException("Use a decimal string in the same numeric units as the game's cash combobox ForeignValue.PropertyValue.");
        var target = Target(session, club);
        Editable(session, owner, readOnly, willing, recipe);
        var component = Record(Channel(owner, session, recipe.Owner).Value);
        var selector = Field(component, "CashSelectionIdentifier");
        if (!long.TryParse(selector.AsString(), out var identifier) || identifier != recipe.CashSelector)
            throw new ArgumentException("Native cash selector does not match this contract term.");
        var before = ForeignValue(session, owner, cash, recipe);
        var requested = number.ToString(CultureInfo.InvariantCulture);
        // Current native 1802fd2a0, EventFmxValidateCashValue (73): reads the game's
        // selector identity (mdEW) and foreign currency/period input (iyzm), then
        // performs its normal conversion, bounds and wage rounding before updating its draft.
        var payload = new SI.Core.Record();
        payload[0x6d444557] = TypedValue.CreateCopyFrom(selector);
        payload[0x69797a6d] = TypedValue.Create(number);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            target = target.GetPersistentIdentity(), kind, before, requested, selector = NativeValueFingerprint.Compute(selector),
            component = NativeValueFingerprint.Compute(Channel(owner, session, recipe.Owner).Value) }));
        return (target, payload, before, requested, token);
    }
    public static object PreviewAmount(string kind, string session, string club, string owner, string cash, string readOnly, string willing, string amount)
    {
        var prepared = PrepareAmount(kind, session, club, owner, cash, readOnly, willing, amount);
        return new { ok = true, before = prepared.Before, requested = prepared.Desired, choiceToken = prepared.Token,
            unit = "native_cash_combobox_foreign_value", normalization = "The game may round or clamp input. Read the actual resulting draft before submission.", liveVerified = false };
    }
    public static object InputAmount(string id, string kind, string session, string club, string owner, string cash, string readOnly, string willing, string amount, string token)
    {
        var prepared = PrepareAmount(kind, session, club, owner, cash, readOnly, willing, amount);
        if (prepared.Token != token) throw new InvalidOperationException("Cash input or contract draft changed since preview.");
        LiveTools.RequireUnusedDraft(prepared.Target);
        return ActionCommands.DispatchDomain(id, "input_contract_amount_" + kind, prepared.Target.GetPersistentIdentity(),
            LiveTools.JsonText(new { kind, prepared.Before, prepared.Desired }), () => {
                NegotiationActions.Touch(prepared.Target.GetPersistentIdentity());
                SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent((uint)InteropEventIDs.EventFmxValidateCashValue,
                    prepared.Target, GameTools.MakeObjectTypedValue(prepared.Payload)); },
            prepared.Before, prepared.Desired, "contract_draft_cash_input." + kind);
    }
}
