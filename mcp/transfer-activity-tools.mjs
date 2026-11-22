import { createLiveClient, scalar } from "./live-client.mjs";

export function createTransferActivityTools(call) {
  const client = createLiveClient(call);
  async function incomingForPlayer(args) {
    if (!args.source) throw new Error("需要原球员实时引用 source。");
    return client.scope(async scope => {
      const subject = await scope.api("/api/v1/live/properties", { source: args.source, path: args.path || "", filter: "Name" });
      const player = subject.reference;
      if (player?.type !== "FM.UI.PersonReference" || !player.identity) throw new Error("需要真实球员引用。");
      const club = await scope.subscribe("human", "Club");
      const human = { source: "human" }, clubRef = { source: club.handle };
      const contexts = { human, Human: human, club: clubRef, Club: clubRef };
      const clubIdentity = club.read.value?.identity;
      const activity = await scope.subscribe(club.handle, "TransferActivity", contexts);
      const people = await scope.subscribeOptional(activity.handle, "TransferActivityPlayerListIn", contexts);
      if (!people.handle) return { ok: true, source: "TransferActivityPlayerListIn", playerIdentity: player.identity, clubIdentity: club.read.value?.identity, offers: [], unavailable: people.unavailable };
      const { epoch, sessionId, value } = people.read;
      if (!clubIdentity || !sessionId || !Number.isSafeInteger(epoch) || subject.epoch !== epoch || club.read.epoch !== epoch ||
          club.read.sessionId !== sessionId || value?.kind !== "list" || !Number.isSafeInteger(value.count))
        throw new Error("当前俱乐部的原生买入报价列表尚未就绪。");
      const offers = [];
      async function requireStable(list) {
        const fresh = await scope.ready(list.handle);
        if (fresh.revision !== list.read.revision || fresh.epoch !== epoch || fresh.sessionId !== sessionId)
          throw new Error("读取期间转会列表或游戏会话已变化。");
      }
      for (let index = 0; index < value.count; index++) {
        const personRow = { source: people.handle, path: String(index) };
        await client.scope(async rowScope => {
          const person = await rowScope.subscribe(personRow, "Person", contexts);
          if (person.read.value?.type !== "FM.UI.PersonReference" || !person.read.value.identity)
            throw new Error("转会中心人员的原生球员引用尚未就绪。");
          if (person.read.value?.identity !== player.identity) return;
          const list = await rowScope.subscribe(personRow, "TransferOffers", contexts);
          const rows = list.read.value;
          if (rows?.kind !== "list" || !Number.isSafeInteger(rows.count)) throw new Error("球员报价列表尚未就绪。");
          for (let offerIndex = 0; offerIndex < rows.count; offerIndex++) {
            const offer = { source: list.handle, path: String(offerIndex) };
            await client.scope(async offerScope => {
              const buyer = await offerScope.subscribe(offer, "BuyingClub", contexts);
              if (!buyer.read.value?.identity) throw new Error("报价的原生买方尚未就绪。");
              if (buyer.read.value?.identity !== clubIdentity) return;
              const seller = await offerScope.subscribe(offer, "SellingClub", contexts);
              const id = await offerScope.subscribe(offer, "UniqueId", contexts);
              const status = await offerScope.subscribe(offer, "TransferOfferStatus", contexts);
              const type = await offerScope.subscribe(offer, "TransferOfferType", contexts);
              const channels = [buyer, seller, id, status, type];
              const offerIdentity = id.reference?.identity, uniqueId = scalar(id.read.value);
              if (!offerIdentity || id.reference.type !== "FM.UI.TransferActivityTransferOfferReference" || !/^\d+$/.test(uniqueId ?? "") ||
                  channels.some(channel => channel.reference?.identity !== offerIdentity || channel.read.sessionId !== sessionId || channel.read.epoch !== epoch))
                throw new Error("报价标识或字段来源已变化。");
              offers.push({ offerIdentity, uniqueId, sellingClubIdentity: seller.read.value?.identity,
                status: status.read.value, offerType: type.read.value, personPath: personRow.path, offerPath: offer.path });
            });
          }
          await requireStable(list);
        });
      }
      await requireStable(people);
      if (new Set(offers.map(row => row.uniqueId)).size !== offers.length) throw new Error("游戏返回了重复报价 ID。");
      return { ok: true, source: "TransferActivityPlayerListIn", playerIdentity: player.identity, clubIdentity, sessionId, epoch, offers };
    });
  }
  async function context(args, perform) {
    const kind = args.kind || "players", direction = args.direction || "all";
    if (!["players", "staff", "trades"].includes(kind) || !["all", "in", "out"].includes(direction)) throw new Error("选择players/staff/trades及all/in/out。");
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const human = { source: "human" }, clubRef = { source: club.handle };
      const contexts = { human, Human: human, club: clubRef, Club: clubRef };
      const activity = await scope.subscribeOptional(club.handle, "TransferActivity", contexts);
      if (!activity.handle) return { ok: true, available: false, unavailable: activity.unavailable, kind, direction };
      const property = kind === "trades" ? "TradeOffers" : `TransferActivity${kind === "players" ? "Player" : "Staff"}List${direction[0].toUpperCase() + direction.slice(1)}`;
      const people = await scope.subscribeOptional(activity.handle, property, contexts);
      if (!people.handle) return { ok: true, kind, direction, people: null, unavailable: people.unavailable, liveVerified: false };
      const query = { club: club.handle, activity: activity.handle, people: people.handle, personPath: args.personPath, offerPath: args.offerPath, action: args.action };
      if (kind !== "trades" && args.personPath === undefined) return perform(scope, query, { kind, direction, people: people.read.value }, false);
      const person = { source: people.handle, path: args.personPath };
      const offers = kind === "trades" ? people : await scope.subscribeOptional(person, "TransferOffers", contexts);
      if (!offers.handle) return { ok: true, kind, direction, personPath: args.personPath, offers: null, unavailable: offers.unavailable, liveVerified: false };
      if (kind === "trades") { query.personPath = ""; if (direction !== "all") throw new Error("交易使用实际TradeOffers列表，direction仅支持all。"); }
      query.offers = offers.handle;
      if (args.offerPath === undefined) return perform(scope, query, { offers: offers.read.value }, false);
      const offer = { source: offers.handle, path: args.offerPath }, channels = {};
      const names = kind === "trades" ? ["CanAcceptOffer", "CanRejectCancelWithdrawOffer", "OfferRequiresResponse", "TransferOfferStatus", "TransferOfferStatusString", "BuyingClub", "SellingClub", "RejectCancelWithdrawOfferActionString"]
        : ["UniqueId", "CanAcceptOffer", "CanStallOffer", "CanRejectCancelWithdrawOffer", "OfferRequiresResponse", "TransferOfferStatus", "TransferOfferStatusString", "BuyingClub", "SellingClub"];
      for (const name of names)
        channels[name] = (await scope.subscribe(offer, name, contexts)).handle;
      query.channels = channels;
      return perform(scope, query, {}, true);
    });
  }
  return {
    incomingForPlayer,
    get: args => context(args, async (scope, query, values, complete) => complete ? scope.api("/api/v1/transfers/activity/state", { ...query, operationId: args.operationId }) : { ok: true, ...values }),
    execute: args => {
      if (!args.operationId || !args.action || !args.expectedChoiceToken || (args.kind !== "trades" && args.personPath === undefined) || args.offerPath === undefined)
        throw new Error("提供原personPath/offerPath、action、token及固定operationId。");
      return context(args, async (scope, query, _values, complete) => {
        if (!complete) throw new Error("选择原生实际报价。");
        const state = await scope.api("/api/v1/transfers/activity/state", query);
        if (!state.preview?.enabled) throw new Error("游戏未允许此报价回应。");
        if (state.preview.choiceToken !== args.expectedChoiceToken) throw new Error("报价或状态改变，请重新读取预览。");
        return { ...await scope.api("/api/v1/transfers/activity/execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true), transferCompleted: false };
      });
    }
  };
}
