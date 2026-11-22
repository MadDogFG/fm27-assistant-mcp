using System;
using System.Globalization;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// TransferOfferClause UI bindings and native 1807189c0: operations on an actual
// clause in the current offer, including the game's own cash validation/rounding path.
public static class TransferCommands
{
    private const string OpenDraftCommand = "open_transfer_offer_draft";
    private const string OpenDraftScope = "observed_editable_buying_club_offer_draft";

    private static (InteropReference Target, string Person, string Buyer, string Seller, string Token) DraftStart(
        string session, string club, string selling, string offered, string allowed)
    {
        var target = NegotiationActions.Target("transfer", session, club);
        var origin = LiveTools.GetSnapshot(session);
        var person = LiveTools.GetReference(origin.Source, origin.SourcePath).GetPersistentIdentity();
        var buyer = LiveTools.GetReference(club).GetPersistentIdentity();
        var sellerChannel = NegotiationActions.Channel(selling, origin.Source, "Club", origin.SourcePath);
        var seller = LiveTools.GetReference(selling).GetPersistentIdentity();
        if (sellerChannel.Identity != person || seller == buyer)
            throw new InvalidOperationException("A new offer requires the player's actual club and a different buying club.");
        ContractCommands.Context(origin, 0x43627963, buyer);
        ContractCommands.Context(origin, 0x43736c63, seller);
        var targetClubContext = new SI.Bindable.Reference.Core.ContextID(0x4733636a).ToString().Split(':')[0];
        if (origin.ContextDescriptions.TryGetValue(targetClubContext, out var thirdClub) && thirdClub != "null")
            throw new InvalidOperationException("Start a standard offer between the buying and selling clubs.");
        var permission = NegotiationActions.Channel(allowed, origin.Source, "CanHumanMakeTransferOffer", origin.SourcePath);
        if (permission.Identity != person || permission.Value?.DataType?.FullName != "System.Boolean" || permission.Value.AsString() != "True")
            throw new InvalidOperationException("The game does not permit the current manager to make an offer for this player.");
        ActionCommands.RequireOfferedPersonAction(offered, person, (uint)ActionID.PersonMakeOfferForPlayer);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            offer = target.GetPersistentIdentity(), person, buyer, seller, cursor = MutationActivity.Cursor }));
        return (target, person, buyer, seller, token);
    }

    public static object PreviewDraft(string session, string club, string selling, string offered, string allowed)
    {
        var p = DraftStart(session, club, selling, offered, allowed);
        return new { ok = true, choiceToken = p.Token, personIdentity = p.Person, buyingClubIdentity = p.Buyer,
            sellingClubIdentity = p.Seller, targetIdentity = p.Target.GetPersistentIdentity(), sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch };
    }

    public static object OpenDraft(string id, string session, string club, string selling, string offered, string allowed, string token)
    {
        var p = DraftStart(session, club, selling, offered, allowed);
        if (p.Token != token) throw new InvalidOperationException("Player, offer permissions or clubs changed. Refresh the preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        object query = null;
        var receipt = ActionCommands.DispatchDomain(id, OpenDraftCommand, p.Target.GetPersistentIdentity(), token, () =>
            query = LiveTools.Open(session, "", InternalCommands.PropertyId("HumanIsBuying"), "{}", transient: true), null, "True", OpenDraftScope);
        return new { receipt, query };
    }

    public static object ObserveDraft(string id, string session, string club, string buying, string editable, string offerType)
    {
        var target = NegotiationActions.Target("transfer", session, club);
        if (ActionCommands.Status(id) is not DispatchJournal.Receipt previous || previous.command != OpenDraftCommand)
            throw new ArgumentException("Use the original transfer draft opening operation ID.");
        var buyValue = NegotiationActions.Channel(buying, session, "HumanIsBuying").Value;
        var editValue = NegotiationActions.Channel(editable, session, "CanMakeChangesToOffer").Value;
        var type = Selection(NegotiationActions.Channel(offerType, session, "TransferOfferTypeDropdownSelection").Value);
        var isBuying = buyValue?.AsString() == "True";
        var canEdit = editValue?.AsString() == "True";
        var hasType = type != null && !type.IsNull && int.TryParse(type.AsString(), out var number) && number >= 0;
        var receipt = ActionCommands.ObserveDomain(id, target.GetPersistentIdentity(), OpenDraftScope, (isBuying && canEdit && hasType).ToString());
        return new { receipt, isBuying, canEdit, offerType = hasType ? LiveTools.DescribeValue(type) : null, operationSubmitsOffer = false };
    }

    public sealed record Recipe(string Kind, string Current, string Choices, uint Event);
    private static readonly Recipe[] Recipes = {
        new("primary", "TransferOfferClauseDropdownValue", "TransferOfferClauseDropdownValueSelectionList", 124),
        new("secondary", "TransferOfferClauseSecondaryValue", "TransferOfferClauseSecondaryValueSelectionList", 125),
        new("left-right", "TransferOfferClauseLeftRightValue", "TransferOfferClauseLeftRightValueSelectionList", 126),
        new("cash", "TransferOfferClauseCashValue", "TransferOfferClauseCashValueListProps", 73)
    };
    private static readonly string[] Collections = {
        "TransferOfferTransferBaseOptions", "TransferOfferLoanBaseOptions", "TransferOfferAdditionalFees", "TransferOfferAdditionalClauses",
        "TransferOfferInstallmentFees", "TransferOfferLoanAdditionalOptions", "TransferOfferLoanAdditionalClauses",
        "TransferOfferLoanFutureLoanToBuyFees", "TransferOfferLoanAdditionalFutureFees", "TransferOfferLoanAdditionalFutureClauses"
    };
    public static object Routing() => new { ok = true, recipes = Recipes, collections = Collections, liveVerified = false };
    private static Recipe Find(string kind) => Recipes.SingleOrDefault(recipe => recipe.Kind == kind) ?? throw new ArgumentException("Unknown transfer clause value kind.");
    private static SI.Core.Record Record(TypedValue value) => value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    private static TypedValue Field(SI.Core.Record record, string name) => record != null && record.TryGetValue(InternalCommands.PropertyId(name), out var value)
        ? value : throw new ArgumentException("Native transfer value is missing " + name);
    private static TypedValue Selection(TypedValue value)
    {
        var type = value?.DataType?.FullName ?? "";
        if (type == "SI.Core.DynamicNumber" || type.StartsWith("System.Int") || type.StartsWith("System.UInt") || type == "System.String" || type == "System.Boolean") return value;
        var row = Record(value);
        return row != null && row.TryGetValue(InternalCommands.PropertyId("PropertyValue"), out var field) ? field : value;
    }
    internal static InteropReference Clause(string session, string club, string collection, string clausePath)
    {
        NegotiationActions.Target("transfer", session, club);
        var source = LiveTools.GetSnapshot(collection);
        if (!source.Ready || source.Source != session || !string.IsNullOrEmpty(source.SourcePath) ||
            !Collections.Any(name => source.Property == InternalCommands.PropertyId(name))) throw new ArgumentException("Use a native clause collection belonging to this transfer offer.");
        var clause = LiveTools.GetReference(collection, clausePath);
        if (clause.GetIl2CppType().FullName != "FM.UI.TransferOfferClauseReference") throw new ArgumentException("Select a real transfer clause reference from that collection.");
        return clause;
    }
    private static LiveTools.Snapshot Channel(string handle, string collection, string clausePath, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != collection || snapshot.SourcePath != clausePath ||
            snapshot.Property != InternalCommands.PropertyId(property) || snapshot.Identity != LiveTools.GetReference(collection, clausePath).GetPersistentIdentity())
            throw new ArgumentException("Wrong transfer clause subscription: " + property);
        return snapshot;
    }
    private static void Editable(string session, string collection, string clausePath, string offerEditable, string clauseEnabled)
    {
        var offer = LiveTools.GetSnapshot(offerEditable);
        if (!offer.Ready || offer.Source != session || !string.IsNullOrEmpty(offer.SourcePath) || offer.Property != InternalCommands.PropertyId("CanMakeChangesToOffer") ||
            !bool.TryParse(offer.Value?.AsString(), out var canEdit) || !canEdit) throw new InvalidOperationException("Game does not permit changes to this transfer offer.");
        var enabled = Channel(clauseEnabled, collection, clausePath, "IsEnabled");
        if (!bool.TryParse(enabled.Value?.AsString(), out var allowed) || !allowed) throw new InvalidOperationException("Game disabled this transfer clause.");
    }
    private static string Current(Recipe recipe, string collection, string clausePath, string current)
    {
        var value = Channel(current, collection, clausePath, recipe.Current).Value;
        return NativeValueFingerprint.Compute(Selection(value));
    }
    private static string Foreign(string collection, string clausePath, string cash)
    {
        var info = Record(Channel(cash, collection, clausePath, "TransferOfferClauseCashValueListProps").Value);
        var value = Selection(Field(info, "ForeignValue"));
        if (!long.TryParse(value.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)) throw new ArgumentException("Cash input is not a signed 64-bit integer.");
        return number.ToString(CultureInfo.InvariantCulture);
    }
    public static object Read(string kind, string session, string club, string collection, string clausePath, string current, string cash, string operationId)
    {
        var recipe = Find(kind);
        var clause = Clause(session, club, collection, clausePath);
        var value = kind == "cash" ? Foreign(collection, clausePath, cash) : Current(recipe, collection, clausePath, current);
        return string.IsNullOrEmpty(operationId)
            ? new { ok = true, kind, current = value, clauseIdentity = clause.GetPersistentIdentity(), epoch = LiveTools.CurrentEpoch, sessionId = LiveTools.SessionId }
            : ActionCommands.ObserveDomain(operationId, clause.GetPersistentIdentity(), "transfer_offer_clause." + kind, value);
    }
    private static (InteropReference Clause, string Before, string Desired, TypedValue Payload, string Token) Prepare(
        string kind, string session, string club, string collection, string clausePath, string current, string cash, string choices,
        string offerEditable, string clauseEnabled, int index, string amount)
    {
        var recipe = Find(kind);
        var clause = Clause(session, club, collection, clausePath);
        Editable(session, collection, clausePath, offerEditable, clauseEnabled);
        string before, desired;
        TypedValue payload;
        if (kind == "cash")
        {
            if (!long.TryParse(amount, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)) throw new ArgumentException("Cash input must be a decimal string in the game's ForeignValue.PropertyValue units.");
            before = Foreign(collection, clausePath, cash);
            desired = number.ToString(CultureInfo.InvariantCulture);
            var record = new SI.Core.Record();
            record[0x69797a6d] = TypedValue.Create(number);
            payload = GameTools.MakeObjectTypedValue(record);
        }
        else
        {
            before = Current(recipe, collection, clausePath, current);
            var values = Channel(choices, collection, clausePath, recipe.Choices).Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()
                ?? throw new ArgumentException("Game has not offered a value list for this clause field.");
            if (index < 0 || index >= values.Count) throw new ArgumentException("Select an existing native clause option.");
            payload = values[index];
            var row = Record(payload) ?? throw new ArgumentException("Clause option is not a native record.");
            if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False") throw new InvalidOperationException("Game disabled this clause option.");
            if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested))
            {
                payload = nested;
                row = Record(payload) ?? throw new ArgumentException("Clause choice data is invalid.");
                if (row.TryGetValue(InternalCommands.PropertyId("Disabled"), out disabled) && disabled.AsString() != "False") throw new InvalidOperationException("Game disabled this clause option.");
            }
            desired = NativeValueFingerprint.Compute(Selection(payload));
        }
        var parent = NegotiationActions.Target("transfer", session, club);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            parent = parent.GetPersistentIdentity(), clause = clause.GetPersistentIdentity(), kind, before, desired,
            payload = NativeValueFingerprint.Compute(payload),
            cash = kind == "cash" ? NativeValueFingerprint.Compute(LiveTools.GetSnapshot(cash).Value) : null }));
        return (clause, before, desired, payload, token);
    }
    public static object Preview(string kind, string session, string club, string collection, string clausePath, string current, string cash, string choices,
        string offerEditable, string clauseEnabled, int index, string amount)
    {
        var prepared = Prepare(kind, session, club, collection, clausePath, current, cash, choices, offerEditable, clauseEnabled, index, amount);
        return new { ok = true, before = prepared.Before, requested = prepared.Desired, choiceToken = prepared.Token,
            verificationScope = "transfer_offer_clause." + kind, liveVerified = false };
    }
    public static object Execute(string id, string kind, string session, string club, string collection, string clausePath, string current, string cash, string choices,
        string offerEditable, string clauseEnabled, int index, string amount, string token)
    {
        var prepared = Prepare(kind, session, club, collection, clausePath, current, cash, choices, offerEditable, clauseEnabled, index, amount);
        if (prepared.Token != token) throw new InvalidOperationException("Transfer offer clause or choice changed since preview.");
        var parent = NegotiationActions.Target("transfer", session, club);
        LiveTools.RequireUnusedDraft(parent);
        LiveTools.RequireUnusedDraft(prepared.Clause);
        return ActionCommands.DispatchDomain(id, "stage_transfer_clause_" + kind, prepared.Clause.GetPersistentIdentity(),
            LiveTools.JsonText(new { kind, prepared.Before, prepared.Desired }), () => {
                NegotiationActions.Touch(parent.GetPersistentIdentity());
                SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(Find(kind).Event, prepared.Clause, TypedValue.CreateCopyFrom(prepared.Payload));
            }, prepared.Before, prepared.Desired, "transfer_offer_clause." + kind);
    }
}
