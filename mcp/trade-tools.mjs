import { createLiveClient } from "./live-client.mjs";

// Trade offer draft editing: resolves the actual TradeOffers list from the human club's
// TransferActivity, then the offer's TradeOfferEditSession and its offered/available asset lists.
// All ids/events come from the plugin's trade command protocol; this bridge only wires handles.
export function createTradeOfferTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const human = { source: "human" }, clubRef = { source: club.handle };
      const contexts = { human, Human: human, club: clubRef, Club: clubRef };
      const activity = await scope.subscribe(club.handle, "TransferActivity", contexts);
      const offers = await scope.subscribe(activity.handle, "TradeOffers", contexts);
      const query = { club: club.handle };
      if (args.offerIndex === undefined) return perform(scope, query, { offers: offers.read.value }, false);
      if (!Number.isInteger(args.offerIndex) || args.offerIndex < 0) throw new Error("offerIndex 必须是当前 TradeOffers 的非负下标。");
      const offer = { source: offers.handle, path: String(args.offerIndex) };
      const session = await scope.subscribe(offer, "TradeOfferEditSession", contexts);
      const flag = {};
      for (const name of ["EditSessionTradeType", "HumanIsBuying", "TradeOtherClub", "Negotiable", "NegotiableOptionListEnabled", "NegotiableOptionListVisible"])
        flag[name] = (await scope.subscribe(session.handle, name, contexts)).handle;
      const lists = {};
      for (const name of ["ContextHumanTeamAssetsList", "OtherTeamAssetsList", "ContextHumanTeamAvailableAssetsList", "OtherTeamAvailableAssetsList"])
        lists[name] = (await scope.subscribe(session.handle, name, contexts)).handle;
      Object.assign(query, { session: session.handle, tradeType: flag.EditSessionTradeType, humanIsBuying: flag.HumanIsBuying,
        otherClub: flag.TradeOtherClub, negotiable: flag.Negotiable, negotiableEnabled: flag.NegotiableOptionListEnabled,
        negotiableVisible: flag.NegotiableOptionListVisible, humanAssets: lists.ContextHumanTeamAssetsList,
        otherAssets: lists.OtherTeamAssetsList, humanAvailable: lists.ContextHumanTeamAvailableAssetsList,
        otherAvailable: lists.OtherTeamAvailableAssetsList });
      if (!args.action) return perform(scope, query, {}, false);
      const action = args.action;
      query.action = action;
      if (action === "add-human") { query.options = lists.ContextHumanTeamAvailableAssetsList; query.optionPath = args.optionPath; }
      else if (action === "add-other") { query.options = lists.OtherTeamAvailableAssetsList; query.optionPath = args.optionPath; }
      else if (action === "remove-human") { query.collection = lists.ContextHumanTeamAssetsList; query.assetPath = args.assetPath; }
      else if (action === "remove-other") { query.collection = lists.OtherTeamAssetsList; query.assetPath = args.assetPath; }
      else if (action === "set-negotiable") {
        query.options = (await scope.subscribe(session.handle, "NegotiableOptionListValuesList", contexts)).handle;
        query.optionPath = args.optionPath;
      } else if (action === "change-asset") {
        if (!Number.isInteger(args.assetIndex) || args.assetIndex < 0) throw new Error("change-asset 需要 assetSide 与 assetIndex。");
        const collection = args.assetSide === "other" ? lists.OtherTeamAssetsList : lists.ContextHumanTeamAssetsList;
        const asset = { source: collection, path: String(args.assetIndex) };
        query.asset = (await scope.subscribe(asset, "IsEnabled", contexts)).handle;
        query.options = (await scope.subscribe(asset, "TradeOfferAssetDropdownValueSelectionList", contexts)).handle;
        query.optionPath = args.optionPath;
        query.action = "change-asset";
      } else if (action === "request-dof-valuation") {
        query.action = "request-dof-valuation";
      } else if (action === "input-cash") {
        const kinds = {
          minimum: { selector: "MinimumAmountToAcceptForAssetsOfferedCashIdentifier", intervals: "MinimumAmountToAcceptForAssetsOfferedCashIntervalsProps" },
          dof: { selector: "DoFRecommendedBidCashIdentifier", intervals: "DoFRecommendedBidCashIntervalsProps" }
        };
        const kind = kinds[args.cashKind];
        if (!kind) throw new Error("cashKind 必须是 minimum 或 dof。");
        query.action = "input-cash"; query.kind = args.cashKind;
        query.selector = (await scope.subscribe(session.handle, kind.selector, contexts)).handle;
        query.intervals = (await scope.subscribe(session.handle, kind.intervals, contexts)).handle;
        query.amount = String(args.cash);
      } else throw new Error("action 必须是 add-human/add-other/remove-human/remove-other/set-negotiable/change-asset/request-dof-valuation/input-cash。");
      return perform(scope, query, {}, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, values, complete) => complete && query.action === "change-asset"
      ? { ...await scope.api("/api/v1/trades/asset-preview", query), action: args.action, draftOnly: true, liveVerified: false }
      : complete && query.action === "request-dof-valuation"
      ? { ...await scope.api("/api/v1/trades/valuation-preview", query), action: args.action, draftOnly: true, liveVerified: false }
      : complete && query.action === "input-cash"
      ? { ...await scope.api("/api/v1/trades/cash-preview", query), action: args.action, draftOnly: true, liveVerified: false }
      : complete
      ? { ...await scope.api("/api/v1/trades/preview", query), action: args.action, draftOnly: true, liveVerified: false }
      : { ok: true, ...values, draftOnly: true, liveVerified: false, note: "先读取 TradeOffers，再用 offerIndex 选择实际 trade 报价草稿。" }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken || args.offerIndex === undefined)
        throw new Error("提供实际 offerIndex、action、token 及固定 operationId。");
      return context(args, async (scope, query) => {
        const route = query.action === "change-asset" ? "asset" : query.action === "request-dof-valuation" ? "valuation" : query.action === "input-cash" ? "cash" : "";
        const preview = await scope.api(`/api/v1/trades/${route ? route + "-" : ""}preview`, query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("trade 草稿或合法选项变化，请重新预览。");
        return { ...await scope.api(`/api/v1/trades/${route ? route + "-" : ""}execute`, { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          tradeCompleted: false, contractSigned: false };
      });
    }
  };
}
