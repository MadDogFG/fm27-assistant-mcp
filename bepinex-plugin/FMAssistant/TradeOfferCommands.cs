using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FM.GamePlugin;
using SI.Core;
using SI.Interop;

namespace FMAssistant;

// Trade offer draft editing. Event ids and property names come from the current build's
// InteropEventIDs and TradeOffer* reference registries (evidence/v73-trade-draft-protocol.json):
// 1433429860 add context-human asset, 1198157344 add other-team asset,
// 844318548 remove context-human asset, 1431652458 remove other-team asset,
// 112 set negotiable. The asset/negotiable payload shapes are inferred from the
// TradeOfferAsset / MLSTradeOfferTermsBlock UI assets; nothing here is live-verified yet.
public static class TradeOfferCommands
{
    private static readonly string[] SessionProperties = { "EditSessionTradeType", "HumanIsBuying", "TradeOtherClub", "Negotiable",
        "NegotiableOptionListEnabled", "NegotiableOptionListVisible" };
    private static readonly string[] AssetProperties = { "IsEnabled", "IsLocked", "CanRemoveAsset", "IsAssetAssociatedWithCash",
        "IsAssetAssociatedWithDropdown", "TradeOfferAssetDropdownValue" };
    private static readonly Dictionary<string, (uint Event, string Subject)> AssetActions = new() {
        { "add-human", (1433429860u, "ContextHumanTeamAvailableAssetsList") },
        { "add-other", (1198157344u, "OtherTeamAvailableAssetsList") },
        { "remove-human", (844318548u, "ContextHumanTeamAssetsList") },
        { "remove-other", (1431652458u, "OtherTeamAssetsList") }
    };

    private static SI.Core.Record Record(TypedValue value)
    {
        var name = value?.DataType?.FullName ?? "";
        if (name == "SI.Core.DynamicNumber" || name == "FM.GamePlugin.GameDate" || name.StartsWith("System.")) return null;
        return value == null || value.IsNull ? null : value.Get()?.TryCast<SI.Core.Record>();
    }
    private static TypedValue Property(SI.Core.Record record, string name) => record != null && record.TryGetValue(InternalCommands.PropertyId(name), out var value)
        ? value : throw new ArgumentException("Native trade record is missing " + name);
    private static void Enabled(TypedValue value)
    {
        var row = Record(value);
        if (row != null && row.TryGetValue(InternalCommands.PropertyId("Disabled"), out var disabled) && disabled.AsString() != "False")
            throw new InvalidOperationException("Game disabled this asset or its parent group.");
    }
    private static LiveTools.Snapshot Channel(string handle, string session, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != session || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong trade session subscription: " + property);
        return snapshot;
    }
    private static LiveTools.Snapshot List(string handle, string session, string property)
    {
        var snapshot = LiveTools.GetSnapshot(handle);
        if (!snapshot.Ready || snapshot.Source != session || !string.IsNullOrEmpty(snapshot.SourcePath) ||
            snapshot.Property != InternalCommands.PropertyId(property)) throw new ArgumentException("Wrong trade asset list: " + property);
        return snapshot;
    }
    private static InteropReference Resolve(string session, string club)
    {
        var human = LiveTools.GetReference("human");
        var actor = NegotiationActions.Channel(club, "human", "Club");
        if (actor.Identity != human.GetPersistentIdentity()) throw new ArgumentException("Use the current manager's actual club.");
        var target = LiveTools.GetReference(session);
        var source = LiveTools.GetSnapshot(session);
        if (target.GetIl2CppType().FullName != "FM.UI.TradeOfferEditSessionReference" || !source.Ready ||
            source.Property != InternalCommands.PropertyId("TradeOfferEditSession") ||
            LiveTools.GetReference(source.Source, source.SourcePath).GetIl2CppType().FullName != "FM.UI.TransferActivityTradeOfferReference")
            throw new ArgumentException("Resolve TradeOfferEditSession from the actual trade offer reference.");
        return target;
    }
    private static string Flag(LiveTools.Snapshot value)
    {
        if (!bool.TryParse(value.Value?.AsString(), out var flag)) throw new ArgumentException("Native trade flag is not ready: " + value.Property);
        return flag ? "True" : "False";
    }
    public static object Read(string session, string club, string tradeType, string humanIsBuying, string otherClub, string negotiable,
        string negotiableEnabled, string negotiableVisible, string humanAssets, string otherAssets, string humanAvailable, string otherAvailable)
    {
        var target = Resolve(session, club);
        var flags = SessionProperties.ToDictionary(name => name, name => (object)null);
        var views = new Dictionary<string, object>();
        void View(string handle, string property)
        {
            var snapshot = Channel(handle, session, property);
            views[property] = new { enabled = property == "NegotiableOptionListEnabled" ? Flag(snapshot) : null,
                value = LiveTools.DescribeValue(snapshot.Value) };
        }
        View(tradeType, "EditSessionTradeType");
        View(humanIsBuying, "HumanIsBuying");
        View(otherClub, "TradeOtherClub");
        View(negotiable, "Negotiable");
        View(negotiableEnabled, "NegotiableOptionListEnabled");
        View(negotiableVisible, "NegotiableOptionListVisible");
        object Assets(string handle, string property)
        {
            var snapshot = List(handle, session, property);
            var list = snapshot.Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>();
            return new { count = list?.Count ?? 0, value = LiveTools.DescribeValue(snapshot.Value) };
        }
        return new { ok = true, tradeOfferIdentity = target.GetPersistentIdentity(), sessionProperties = views,
            humanOfferedAssets = Assets(humanAssets, "ContextHumanTeamAssetsList"),
            otherTeamOfferedAssets = Assets(otherAssets, "OtherTeamAssetsList"),
            humanAvailableAssets = Assets(humanAvailable, "ContextHumanTeamAvailableAssetsList"),
            otherTeamAvailableAssets = Assets(otherAvailable, "OtherTeamAvailableAssetsList"),
            assetActions = AssetActions.Keys.ToArray(), draftOnly = true, liveVerified = false };
    }
    private static TypedValue Option(string handle, string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Select a concrete available asset path.");
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i <= parts.Length; i++) Enabled(LiveTools.GetValue(handle, string.Join('/', parts.Take(i))));
        var option = LiveTools.GetValue(handle, path);
        var row = Record(option) ?? throw new ArgumentException("Selected asset is not a native record.");
        if (row.TryGetValue(InternalCommands.PropertyId("RowData"), out var nested)) { option = nested; Enabled(option); }
        return option;
    }
    private static (InteropReference Target, TypedValue Payload, uint Event, string Token, string Scope) Prepare(
        string action, string session, string club, string options, string optionPath, string collection, string assetPath, string negotiableEnabled)
    {
        var target = Resolve(session, club);
        var identity = target.GetPersistentIdentity();
        if (action == "set-negotiable")
        {
            var permission = LiveTools.GetSnapshot(negotiableEnabled);
            if (!permission.Ready || permission.Source != session || !string.IsNullOrEmpty(permission.SourcePath) ||
                permission.Property != InternalCommands.PropertyId("NegotiableOptionListEnabled")) throw new ArgumentException("Use the session's actual negotiable option flag.");
            if (Flag(permission) != "True") throw new InvalidOperationException("Game disabled the trade negotiable option.");
            Channel(options, session, "NegotiableOptionListValuesList");
            var option = Option(options, optionPath);
            var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
                action, identity, payload = NativeValueFingerprint.Compute(option), revision = NegotiationActions.Revision(identity) }));
            return (target, option, 112u, token, "trade_offer_negotiable_draft");
        }
        if (!AssetActions.TryGetValue(action, out var recipe)) throw new ArgumentException("Use add-human/add-other/remove-human/remove-other/set-negotiable.");
        var isAdd = action.StartsWith("add-", StringComparison.Ordinal);
        if (isAdd)
        {
            List(options, session, recipe.Subject);
            return Publish(target, action, Option(options, optionPath), recipe.Event, identity,
                "trade_offer_assets_draft");
        }
        var assets = List(collection, session, recipe.Subject);
        var count = assets.Value?.Get()?.TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()?.Count;
        if (!int.TryParse(assetPath, NumberStyles.None, CultureInfo.InvariantCulture, out var index) || count == null || index >= count)
            throw new ArgumentException("Select an existing trade asset by its list index.");
        var asset = assets.Value.Get().TryCast<Il2CppSystem.Collections.Generic.List<TypedValue>>()[index];
        var row = Record(asset) ?? throw new ArgumentException("Trade asset is not a native record.");
        if (row.TryGetValue(InternalCommands.PropertyId("CanRemoveAsset"), out var removable) && removable.AsString() != "True")
            throw new InvalidOperationException("Game does not allow removing this trade asset.");
        return Publish(target, action, TypedValue.CreateCopyFrom(asset), recipe.Event, identity, "trade_offer_assets_draft");
    }
    private static (InteropReference, TypedValue, uint, string, string) Publish(InteropReference target, string action, TypedValue payload, uint eventId,
        string identity, string scope)
    {
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action, identity, payload = NativeValueFingerprint.Compute(payload), revision = NegotiationActions.Revision(identity) }));
        return (target, payload, eventId, token, scope);
    }
    public static object Preview(string action, string session, string club, string options, string optionPath, string collection,
        string assetPath, string negotiableEnabled)
    {
        var p = Prepare(action, session, club, options, optionPath, collection, assetPath, negotiableEnabled);
        return new { ok = true, action, nativeEvent = p.Event, choiceToken = p.Token, scope = p.Scope,
            payload = LiveTools.DescribeValue(p.Payload), liveVerified = false,
            note = "trade 资产/可协商载荷由当前资产的 UI 事件与属性集合推断，尚未真机验证。" };
    }
    public static object Execute(string id, string action, string session, string club, string options, string optionPath, string collection,
        string assetPath, string negotiableEnabled, string token)
    {
        var p = Prepare(action, session, club, options, optionPath, collection, assetPath, negotiableEnabled);
        if (token != p.Token) throw new InvalidOperationException("Trade draft or legal option changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "trade_offer_" + action, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(p.Event, p.Target, p.Payload);
        }, null, null, p.Scope);
    }

    private static InteropReference AssetRef(string handle)
    {
        var asset = LiveTools.GetReference(handle);
        if (asset.GetIl2CppType().FullName != "FM.UI.TradeOfferAssetReference") throw new ArgumentException("Resolve the actual TradeOfferAsset reference.");
        return asset;
    }
    private static TypedValue DropdownOption(string asset, string options, string optionPath)
    {
        var source = LiveTools.GetSnapshot(options);
        var assetRef = AssetRef(asset);
        if (!source.Ready || source.Source != asset || !string.IsNullOrEmpty(source.SourcePath) ||
            source.Property != InternalCommands.PropertyId("TradeOfferAssetDropdownValueSelectionList")) throw new ArgumentException("Use the asset's actual tradeOfferAssetDropdownValueSelectionList.");
        return Option(options, optionPath);
    }
    public static object ChangeAssetPreview(string asset, string options, string optionPath)
    {
        var target = AssetRef(asset);
        var payload = DropdownOption(asset, options, optionPath);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "change-asset", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        return new { ok = true, action = "change-asset", nativeEvent = 1949397323u, choiceToken = token,
            payload = LiveTools.DescribeValue(payload), draftOnly = true, liveVerified = false };
    }
    public static object ChangeAssetExecute(string id, string asset, string options, string optionPath, string token)
    {
        var target = AssetRef(asset);
        var payload = DropdownOption(asset, options, optionPath);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "change-asset", identity = target.GetPersistentIdentity(), payload = NativeValueFingerprint.Compute(payload) }));
        if (token != expected) throw new InvalidOperationException("Trade asset dropdown or option changed since preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "trade_offer_change-asset", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1949397323u, target, payload);
        }, null, null, "trade_offer_asset_dropdown_draft");
    }
    public static object ValuationPreview(string session, string club)
    {
        var target = Resolve(session, club);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "request-dof-valuation", identity = target.GetPersistentIdentity() }));
        return new { ok = true, action = "request-dof-valuation", nativeEvent = 1097166443u, choiceToken = token,
            payload = (object)null, draftOnly = true, liveVerified = false,
            note = "DoF valuation request carries no payload; the response arrives through normal callbacks." };
    }
    public static object ValuationExecute(string id, string session, string club, string token)
    {
        var target = Resolve(session, club);
        var expected = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            action = "request-dof-valuation", identity = target.GetPersistentIdentity() }));
        if (token != expected) throw new InvalidOperationException("Trade draft changed since valuation preview.");
        LiveTools.RequireUnusedDraft(target);
        return ActionCommands.DispatchDomain(id, "trade_offer_request-dof-valuation", target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(1097166443u, target, null);
        }, null, null, "trade_offer_dof_valuation_request");
    }

    private static readonly Dictionary<string, (string Cash, string Selector, string Intervals)> CashKinds = new() {
        { "minimum", ("MinimumAmountToAcceptForAssetsOfferedCash", "MinimumAmountToAcceptForAssetsOfferedCashIdentifier", "MinimumAmountToAcceptForAssetsOfferedCashIntervalsProps") },
        { "dof", ("DoFRecommendedBidCash", "DoFRecommendedBidCashIdentifier", "DoFRecommendedBidCashIntervalsProps") }
    };
    private static (string Cash, string Selector, string Intervals) CashKind(string kind) =>
        CashKinds.TryGetValue(kind ?? "", out var recipe) ? recipe : throw new ArgumentException("Use cash kind minimum or dof.");
    private static SI.Core.Record CashRecord(string intervals, string session, string property)
    {
        var channel = Channel(intervals, session, property);
        return Record(channel.Value) ?? throw new ArgumentException("Native trade cash intervals are not a record.");
    }
    public static object CashRead(string session, string club, string kind, string selector, string intervals)
    {
        var target = Resolve(session, club);
        var recipe = CashKind(kind);
        var selectorValue = Channel(selector, session, recipe.Selector).Value;
        var info = CashRecord(intervals, session, recipe.Intervals);
        var foreign = info.TryGetValue(InternalCommands.PropertyId("ForeignValue"), out var value) ? value : null;
        if (foreign == null || !long.TryParse(foreign.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var current))
            throw new ArgumentException("Native trade cash intervals have no signed 64-bit ForeignValue.");
        return new { ok = true, kind, current = current.ToString(CultureInfo.InvariantCulture), unit = "native_cash_intervals_foreign_value",
            selector = LiveTools.DescribeValue(selectorValue), tradeOfferIdentity = target.GetPersistentIdentity(), liveVerified = false };
    }
    private static (InteropReference Target, SI.Core.Record Payload, string Before, string Requested, string Token) PrepareCash(
        string session, string club, string kind, string selector, string intervals, string amount)
    {
        var target = Resolve(session, club);
        var recipe = CashKind(kind);
        if (!long.TryParse(amount, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
            throw new ArgumentException("Use a decimal string in the native cash units.");
        var selectorValue = Channel(selector, session, recipe.Selector).Value;
        var info = CashRecord(intervals, session, recipe.Intervals);
        var foreign = info.TryGetValue(InternalCommands.PropertyId("ForeignValue"), out var value) ? value : null;
        if (foreign == null || !long.TryParse(foreign.AsString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var before))
            throw new ArgumentException("Native trade cash intervals have no signed 64-bit ForeignValue.");
        var payload = new SI.Core.Record();
        payload[0x6d444557] = TypedValue.CreateCopyFrom(selectorValue);
        payload[0x69797a6d] = TypedValue.Create(number);
        var requested = number.ToString(CultureInfo.InvariantCulture);
        var token = DispatchJournal.Fingerprint(LiveTools.JsonText(new { sessionId = LiveTools.SessionId, epoch = LiveTools.CurrentEpoch,
            kind, identity = target.GetPersistentIdentity(), before = before.ToString(CultureInfo.InvariantCulture), requested,
            selector = NativeValueFingerprint.Compute(selectorValue) }));
        return (target, payload, before.ToString(CultureInfo.InvariantCulture), requested, token);
    }
    public static object CashPreview(string session, string club, string kind, string selector, string intervals, string amount)
    {
        var p = PrepareCash(session, club, kind, selector, intervals, amount);
        return new { ok = true, kind, before = p.Before, requested = p.Requested, choiceToken = p.Token,
            unit = "native_cash_intervals_foreign_value", nativeEvent = 73, draftOnly = true, liveVerified = false,
            note = "Event 73 ValidateCashValue 会对金额做原生换算/边界/取整；结果需独立读回。" };
    }
    public static object CashExecute(string id, string session, string club, string kind, string selector, string intervals, string amount, string token)
    {
        var p = PrepareCash(session, club, kind, selector, intervals, amount);
        if (token != p.Token) throw new InvalidOperationException("Trade cash input or draft changed since preview.");
        LiveTools.RequireUnusedDraft(p.Target);
        return ActionCommands.DispatchDomain(id, "trade_offer_cash_" + kind, p.Target.GetPersistentIdentity(), token, () => {
            NegotiationActions.Touch(p.Target.GetPersistentIdentity());
            SI.Core.GameSubsystems.Get<GameInteropSubsystem>().SendEvent(73u, p.Target, GameTools.MakeObjectTypedValue(p.Payload));
        }, p.Before, p.Requested, "trade_offer_cash_draft");
    }
}
