using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using SI.Core;
using SI.Interop;
using FM.GamePlugin;

namespace FMAssistant;

// Original TransferOfferResponseAccept/Stall/CancelRejectCell events target the
// actual transfer-activity offer, with null data. No selected-row UI state is edited.
public static class TransferActivityCommands
{
    private static readonly string[] Names = { "UniqueId", "CanAcceptOffer", "CanStallOffer", "CanRejectCancelWithdrawOffer",
        "OfferRequiresResponse", "TransferOfferStatus", "TransferOfferStatusString", "BuyingClub", "SellingClub" };
    private static readonly string[] TradeNames = { "CanAcceptOffer", "CanRejectCancelWithdrawOffer", "OfferRequiresResponse",
        "TransferOfferStatus", "TransferOfferStatusString", "BuyingClub", "SellingClub", "RejectCancelWithdrawOfferActionString" };
    private sealed record Context(InteropReference Offer, Dictionary<string, LiveTools.Snapshot> Values, string Club, string Human, bool Trade);
    private static void Index(string path)
    {
        if (!int.TryParse(path, NumberStyles.None, CultureInfo.InvariantCulture, out var i) || i < 0 || path != i.ToString(CultureInfo.InvariantCulture))
            throw new ArgumentException("Select an actual list member by a canonical nonnegative index.");
    }
    private static Context Resolve(string club, string activity, string people, string personPath, string offers, string offerPath, string channels)
    {
        var human = LiveTools.GetReference("human").GetPersistentIdentity();
        var actor = NegotiationActions.Channel(club, "human", "Club");
        if (actor.Identity != human) throw new ArgumentException("Use the active manager's club.");
        var clubId = LiveTools.GetReference(club).GetPersistentIdentity();
        NegotiationActions.Channel(activity, club, "TransferActivity");
        if (LiveTools.GetReference(activity).GetIl2CppType().FullName != "FM.UI.TransferActivityReference") throw new ArgumentException("Use the club's actual transfer activity.");
        var list = LiveTools.GetSnapshot(people);
        if (!list.Ready || list.Source != activity || !string.IsNullOrEmpty(list.SourcePath)) throw new ArgumentException("Use the actual club activity collection.");
        var trade = list.Property == InternalCommands.PropertyId("TradeOffers");
        Index(offerPath);
        if (trade)
        {
            if (offers != people || !string.IsNullOrEmpty(personPath)) throw new ArgumentException("Trade offers must come directly from the current activity.TradeOffers list.");
        }
        else
        {
            if (!new[] { "TransferActivityPlayerListAll", "TransferActivityPlayerListIn", "TransferActivityPlayerListOut", "TransferActivityStaffListAll", "TransferActivityStaffListIn", "TransferActivityStaffListOut" }
                .Any(name => list.Property == InternalCommands.PropertyId(name))) throw new ArgumentException("Use an actual player/staff activity list.");
            Index(personPath);
            if (LiveTools.GetReference(people, personPath).GetIl2CppType().FullName != "FM.UI.TransferActivityPersonReference") throw new ArgumentException("Choose an actual activity person.");
            var source = NegotiationActions.Channel(offers, people, "TransferOffers", personPath);
            if (source.Identity != LiveTools.GetReference(people, personPath).GetPersistentIdentity()) throw new InvalidOperationException("Activity list reordered; refresh.");
        }
        var offer = LiveTools.GetReference(offers, offerPath);
        var expectedType = trade ? "FM.UI.TransferActivityTradeOfferReference" : "FM.UI.TransferActivityTransferOfferReference";
        if (offer.GetIl2CppType().FullName != expectedType) throw new ArgumentException("Offer reference does not match its actual collection.");
        var names = trade ? TradeNames : Names;
        var handles = JsonSerializer.Deserialize<Dictionary<string, string>>(channels) ?? throw new ArgumentException("Supply original offer state channels.");
        if (handles.Count != names.Length || names.Any(n => !handles.ContainsKey(n))) throw new ArgumentException("All current offer state channels are required.");
        var values = new Dictionary<string, LiveTools.Snapshot>();
        foreach (var name in names)
        {
            var snapshot = NegotiationActions.Channel(handles[name], offers, name, offerPath);
            if (snapshot.Identity != offer.GetPersistentIdentity()) throw new InvalidOperationException("Offer list reordered; refresh.");
            values.Add(name, snapshot);
        }
        var buyer = LiveTools.GetReference(handles["BuyingClub"]).GetPersistentIdentity();
        var seller = LiveTools.GetReference(handles["SellingClub"]).GetPersistentIdentity();
        if (buyer != clubId && seller != clubId) throw new InvalidOperationException("The active club is not a party to this offer.");
        return new(offer, values, clubId, human, trade);
    }
    private static bool Flag(Context c, string name) => c.Trade && name == "CanStallOffer" ? false : bool.TryParse(c.Values[name].Value?.AsString(), out var enabled) ? enabled
        : throw new InvalidOperationException("Native offer permission is not ready: " + name);
    // Trade offers have their own InteropEventIDs: 113 AcceptTradeOffer, 114 RejectTradeOffer
    // (111 TradeOfferResponse / 112 TradeOfferSetNegotiable exist but are not wired here).
    // Transfer offers keep the recovered TransferCentre events. The trade mapping is inferred from
    // InteropEventIDs and the current build's TradeOfferTool asset (event 114); it is not live-verified.
    private static (uint Event, string Permission) Recipe(string action, bool trade = false) => action switch {
        "accept" => trade ? (113u, "CanAcceptOffer") : (1832014419u, "CanAcceptOffer"),
        "stall" => trade ? (0u, "CanStallOffer") : (810905175u, "CanStallOffer"),
        "cancel-reject-withdraw" => trade ? (114u, "CanRejectCancelWithdrawOffer") : (929649002u, "CanRejectCancelWithdrawOffer"),
        _ => throw new ArgumentException("Use accept, stall or the game's cancel/reject/withdraw operation.")
    };
    private static string Token(Context c, string action) => DispatchJournal.Fingerprint(LiveTools.JsonText(new {
        sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch, human = c.Human, club = c.Club,
        target = c.Offer.GetPersistentIdentity(), action,
        fields = c.Values.ToDictionary(p => p.Key, p => NativeValueFingerprint.Compute(p.Value.Value)) }));
    public static object Read(string club, string activity, string people, string personPath, string offers, string offerPath, string channels, string action, string operationId)
    {
        var c = Resolve(club, activity, people, personPath, offers, offerPath, channels);
        var choices = new[] { "accept", "stall", "cancel-reject-withdraw" }.Select(a => new { action = a, enabled = Flag(c, Recipe(a, c.Trade).Permission) }).ToArray();
        object preview = null;
        if (!string.IsNullOrEmpty(action))
        {
            var recipe = Recipe(action, c.Trade);
            preview = new { action, choiceToken = Token(c, action), enabled = Flag(c, recipe.Permission), nativeEvent = recipe.Event,
                tradeProtocol = c.Trade ? "trade_offer_response_113_114_inferred" : "transfer_centre_response_recovered" };
        }
        object observation = null;
        if (!string.IsNullOrEmpty(operationId))
        {
            var receipt = ActionCommands.Status(operationId) as DispatchJournal.Receipt ?? throw new ArgumentException("Unknown offer response operation.");
            if (!receipt.command.StartsWith("transfer_activity_", StringComparison.Ordinal) || receipt.targetIdentity != c.Offer.GetPersistentIdentity())
                throw new ArgumentException("Operation belongs to a different offer or workflow.");
            var sameContext = receipt.sessionId == LiveTools.SessionId && receipt.epoch == LiveTools.CurrentEpoch;
            var changed = new List<string>();
            if (sameContext && !string.IsNullOrEmpty(receipt.observationBaseline))
            {
                using var previous = JsonDocument.Parse(receipt.observationBaseline);
                foreach (var pair in c.Values)
                    if (previous.RootElement.GetProperty("fingerprints").GetProperty(pair.Key).GetString() != NativeValueFingerprint.Compute(pair.Value.Value)) changed.Add(pair.Key);
            }
            observation = new { operation = receipt, sameContext, changedFields = changed,
                offerStatusChanged = changed.Contains("TransferOfferStatus"), exclusiveCausalityVerified = false, responseAcceptedVerified = false };
        }
        return new { ok = true, offerIdentity = c.Offer.GetPersistentIdentity(), kind = c.Trade ? "trades" : "transfers", observation,
            fields = c.Values.ToDictionary(p => p.Key, p => LiveTools.DescribeValue(p.Value.Value)), choices, preview,
            scope = "actual_transfer_activity_offer_business_dispatch", transferCompleted = false, liveVerified = false };
    }
    public static object Execute(string id, string club, string activity, string people, string personPath, string offers, string offerPath,
        string channels, string action, string token)
    {
        var c = Resolve(club, activity, people, personPath, offers, offerPath, channels); var recipe = Recipe(action, c.Trade);
        // DispatchOnce checks recorded IDs/fingerprints before this preflight. An uncertain
        // original response cannot be repeated merely by choosing a new request ID.
        return ActionCommands.DispatchOnce(id, "transfer_activity_" + action, c.Offer.GetPersistentIdentity(), token,
            "transfer_activity_response_dispatch", () => new ContinueRequestGuard.Preflight(Token(c, action), false,
                Flag(c, recipe.Permission), "Game does not currently permit this offer response.", LiveTools.JsonText(new {
                    human = c.Human, club = c.Club, offer = c.Offer.GetPersistentIdentity(),
                    fingerprints = c.Values.ToDictionary(p => p.Key, p => NativeValueFingerprint.Compute(p.Value.Value)),
                    state = c.Values.ToDictionary(p => p.Key, p => LiveTools.DescribeValue(p.Value.Value)) })),
            () => SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(recipe.Event, c.Offer, null));
    }
}
