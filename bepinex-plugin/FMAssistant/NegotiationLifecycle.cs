using System;
using System.Linq;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// TransferOfferPotentialExchangeSelectionCell and TransferOfferTargetsPhoneBlock
// expose these normal checkbox setters. They edit an offer/proposal draft only.
public static class NegotiationLifecycle
{
    public sealed record Recipe(string Kind, string Property, bool Exchange);
    private static readonly Recipe[] Recipes = {
        new("exchange-player", "IsSelectedForPlayerExchange", true),
        new("exclude-rivals", "ProposalExcludeRivalClubs", false),
        new("exclude-overseas", "ProposalExcludeOverseasClubs", false),
        new("exclude-domestic", "ProposalExcludeDomesticClubs", false),
        new("exclude-non-top-division", "ProposalExcludeNonTopDivClubs", false)
    };
    public static object Routing() => new { ok = true, recipes = Recipes, exchangeCollection = "PotentialExchangePlayersDetailedList", liveVerified = false };
    private static Recipe Find(string kind) => Recipes.SingleOrDefault(recipe => recipe.Kind == kind) ?? throw new ArgumentException("Unknown transfer proposal operation.");
    private static (InteropReference Root, InteropReference Target, bool Current) Resolve(string kind, string session, string club, string editable, string collection, string playerPath, string current)
    {
        var recipe = Find(kind); var root = NegotiationActions.Target("transfer", session, club); var target = root;
        var edit = NegotiationActions.Channel(editable, session, "CanMakeChangesToOffer");
        if (!bool.TryParse(edit.Value?.AsString(), out var allowed) || !allowed) throw new InvalidOperationException("Game does not permit editing this offer.");
        LiveTools.Snapshot value;
        if (recipe.Exchange)
        {
            NegotiationActions.Channel(collection, session, "PotentialExchangePlayersDetailedList");
            if (string.IsNullOrWhiteSpace(playerPath)) throw new ArgumentException("Choose an original potential exchange player path.");
            target = LiveTools.GetReference(collection, playerPath);
            if (target.GetIl2CppType().FullName != "FM.UI.TransferOfferPotentialExchangePersonReference")
                throw new ArgumentException("Resolve the original potential-exchange player reference, not a person ID.");
            value = NegotiationActions.Channel(current, collection, recipe.Property, playerPath);
        }
        else value = NegotiationActions.Channel(current, session, recipe.Property);
        if (value.Identity != target.GetPersistentIdentity() || !bool.TryParse(value.Value?.AsString(), out var selected))
            throw new ArgumentException("Native checkbox value is unavailable or belongs to another target.");
        return (root, target, selected);
    }
    private static string Token(string kind, InteropReference root, InteropReference target, bool current, bool requested) =>
        DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, kind,
            root = root.GetPersistentIdentity(), target = target.GetPersistentIdentity(), current, requested, revision = NegotiationActions.Revision(root.GetPersistentIdentity()) }));
    public static object Preview(string kind, string session, string club, string editable, string collection, string playerPath, string current, bool selected)
    {
        var p = Resolve(kind, session, club, editable, collection, playerPath, current);
        return new { ok = true, kind, current = p.Current, requested = selected, choiceToken = Token(kind, p.Root, p.Target, p.Current, selected),
            targetIdentity = p.Target.GetPersistentIdentity(), draftOnly = true, liveVerified = false };
    }
    public static object Execute(string id, string kind, string session, string club, string editable, string collection, string playerPath, string current, bool selected, string token)
    {
        var p = Resolve(kind, session, club, editable, collection, playerPath, current);
        if (Token(kind, p.Root, p.Target, p.Current, selected) != token) throw new InvalidOperationException("Offer or exchange selection changed; refresh its preview.");
        LiveTools.RequireUnusedDraft(p.Root);
        return ActionCommands.DispatchDomain(id, "transfer_proposal_" + kind, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Root.GetPersistentIdentity()); LiveTools.UpdateProperty(current, TypedValue.Create(selected));
        }, p.Current.ToString(), selected.ToString(), "transfer_proposal_draft." + kind);
    }
    public static object Read(string kind, string session, string club, string editable, string collection, string playerPath, string current, string operationId)
    {
        var p = Resolve(kind, session, club, editable, collection, playerPath, current);
        return string.IsNullOrEmpty(operationId) ? new { ok = true, kind, current = p.Current, targetIdentity = p.Target.GetPersistentIdentity(), liveVerified = false } :
            ActionCommands.ObserveDomain(operationId, p.Target.GetPersistentIdentity(), "transfer_proposal_draft." + kind, p.Current.ToString());
    }
    private static (InteropReference Root, InteropReference Clause, TypedValue Date, string Before, string Desired, string Token) DatePrepare(
        string kind, string session, string club, string editable, string collection, string clausePath, string enabled, string selector, string dateSource, string datePath)
    {
        if (kind != "start-date" && kind != "end-date") throw new ArgumentException("Choose start-date or end-date.");
        var root = NegotiationActions.Target("transfer", session, club);
        var clause = TransferCommands.Clause(session, club, collection, clausePath);
        if (!bool.TryParse(NegotiationActions.Channel(editable, session, "CanMakeChangesToOffer").Value?.AsString(), out var allowed) || !allowed ||
            !bool.TryParse(NegotiationActions.Channel(enabled, collection, "IsEnabled", clausePath).Value?.AsString(), out var active) || !active)
            throw new InvalidOperationException("Game does not permit editing this offer clause.");
        var selected = NegotiationActions.Channel(selector, collection, kind == "start-date" ? "TransferOfferClauseStartDateSelection" : "TransferOfferClauseEndDateSelection", clausePath);
        if (selected.Identity != clause.GetPersistentIdentity()) throw new ArgumentException("Date selector belongs to another clause.");
        var props = NegotiationActions.Record(selected.Value) ?? throw new ArgumentException("Native date-selector properties are unavailable.");
        var date = LiveTools.GetValue(dateSource, datePath);
        var earliest = NegotiationActions.Field(props, "EarliestDate"); var latest = NegotiationActions.Field(props, "LatestDate");
        if (date?.DataType?.FullName != "FM.GamePlugin.GameDate" || earliest?.DataType?.FullName != "FM.GamePlugin.GameDate" || latest?.DataType?.FullName != "FM.GamePlugin.GameDate")
            throw new ArgumentException("Use actual native GameDate values for selection and its original bounds.");
        var value = date.Get<GameDate>();
        if (value.CompareTo(earliest.Get<GameDate>()) < 0 || value.CompareTo(latest.Get<GameDate>()) > 0)
            throw new ArgumentException("Selected date is outside this clause's legal calendar range.");
        var before = NativeValueFingerprint.Compute(NegotiationActions.Field(props, "Date"));
        var desired = NativeValueFingerprint.Compute(date);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, kind,
            root = root.GetPersistentIdentity(), clause = clause.GetPersistentIdentity(), before, desired,
            selector = NativeValueFingerprint.Compute(selected.Value), revision = NegotiationActions.Revision(root.GetPersistentIdentity()) }));
        return (root, clause, TypedValue.CreateCopyFrom(date), before, desired, token);
    }
    public static object DatePreview(string kind, string session, string club, string editable, string collection, string clausePath, string enabled, string selector, string dateSource, string datePath)
    {
        var p = DatePrepare(kind, session, club, editable, collection, clausePath, enabled, selector, dateSource, datePath);
        return new { ok = true, kind, choiceToken = p.Token, before = p.Before, requested = p.Desired,
            date = LiveTools.DescribeValue(p.Date), draftOnly = true, liveVerified = false };
    }
    public static object DateExecute(string id, string kind, string session, string club, string editable, string collection, string clausePath, string enabled, string selector, string dateSource, string datePath, string token)
    {
        var p = DatePrepare(kind, session, club, editable, collection, clausePath, enabled, selector, dateSource, datePath);
        if (p.Token != token) throw new InvalidOperationException("Offer date, bounds or selected native date changed; refresh the preview.");
        LiveTools.RequireUnusedDraft(p.Root);
        return ActionCommands.DispatchDomain(id, "transfer_clause_" + kind, p.Clause.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Root.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(kind == "start-date" ? 128u : 129u, p.Clause, p.Date);
        }, p.Before, p.Desired, "transfer_clause_date_draft." + kind);
    }
    public static object DateRead(string kind, string session, string club, string collection, string clausePath, string selector, string operationId)
    {
        if (kind != "start-date" && kind != "end-date") throw new ArgumentException("Choose start-date or end-date.");
        var clause = TransferCommands.Clause(session, club, collection, clausePath);
        var values = NegotiationActions.Channel(selector, collection, kind == "start-date" ? "TransferOfferClauseStartDateSelection" : "TransferOfferClauseEndDateSelection", clausePath);
        if (values.Identity != clause.GetPersistentIdentity()) throw new ArgumentException("Date selector belongs to another clause.");
        var props = NegotiationActions.Record(values.Value) ?? throw new ArgumentException("Native calendar properties unavailable.");
        var date = NegotiationActions.Field(props, "Date");
        return string.IsNullOrEmpty(operationId) ? new { ok = true, kind, date = LiveTools.DescribeValue(date),
            earliest = LiveTools.DescribeValue(NegotiationActions.Field(props, "EarliestDate")), latest = LiveTools.DescribeValue(NegotiationActions.Field(props, "LatestDate")), liveVerified = false } :
            ActionCommands.ObserveDomain(operationId, clause.GetPersistentIdentity(), "transfer_clause_date_draft." + kind, NativeValueFingerprint.Compute(date));
    }
}
