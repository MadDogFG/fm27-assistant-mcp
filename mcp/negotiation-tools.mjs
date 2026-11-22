import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";
import { createTransferActivityTools } from "./transfer-activity-tools.mjs";

export async function resolveNegotiationSession(scope, args) {
      const person = { source: args.source, path: args.path || "" }, human = { source: "human" };
      const club = await scope.subscribe("human", "Club");
      const activeClub = { source: club.handle };
      const buyingClub = args.domain === "transfer" && args.buyingClubSource ?
        { source: args.buyingClubSource, path: args.buyingClubPath || "" } : activeClub;
      const contexts = { person, Person: person, player: person, Player: person, human, Human: human,
        club: activeClub, Club: activeClub, buyingclub: buyingClub, BuyingClub: buyingClub };
      if (args.domain === "transfer") {
        const selling = await scope.subscribe(person, "Club", contexts);
        contexts.sellingclub = contexts.SellingClub = { source: selling.handle };
        contexts.targetclub = contexts.TargetClub = null;
      }
      const session = await scope.subscribe(person, args.domain === "contract" ? "ContractEditSession" : args.domain === "promises" ? "PreContractPromisesEditSession" : "TransferOfferEditSession", contexts);
      return { session, club, contexts };
}

export function createNegotiationTools(call) {
  const client = createLiveClient(call);
  const activity = createTransferActivityTools(call);
  async function context(args, action) {
    if (!["contract", "transfer", "promises"].includes(args.domain) || !args.source) throw new Error("请提供 contract/transfer/promises 及实时球员/员工引用 source。");
    return client.scope(async scope => {
      const { session, club, contexts } = await resolveNegotiationSession(scope, args);
      const speakto = await scope.subscribe(session.handle, "SpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
      const groups = await scope.subscribe(primary.handle, "Actions", contexts);
      const bucket = args.bucket || "RequiredActions";
      if (!["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"].includes(bucket)) throw new Error("未知游戏谈判动作列表。");
      const options = await scope.subscribe(groups.handle, bucket, contexts);
      const query = { domain: args.domain, session: session.handle, club: club.handle, speakto: speakto.handle,
        actions: actions.handle, primary: primary.handle, groups: groups.handle, options: options.handle, bucket };
      const offered = await scope.api("/api/v1/negotiations/describe", query);
      return action({ scope, query, offered });
    });
  }
  return {
    get: args => context(args, async ({ offered }) => offered),
    execute: args => {
      if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !args.expectedChoiceToken) throw new Error("先读取本次合法谈判动作，再提供 actionIndex 和 expectedChoiceToken。");
      if (args.trackIncomingOffers && (args.domain !== "transfer" || args.buyingClubSource || !args.operationId))
        throw new Error("跟踪买入报价需要当前俱乐部是买方、domain=transfer 及固定 operationId。");
      return context(args, async ({ scope, query, offered }) => {
        const selected = offered.actions.find(item => item.index === args.actionIndex);
        if (!selected?.silentExecutionImplemented) throw new Error(selected?.reason || "该动作的静默执行协议尚不可用。");
        if (selected.choiceToken !== args.expectedChoiceToken) throw new Error("谈判选项或草稿已变化，请重新读取。");
        if (selected.requiresConfirmation && args.acceptConfirmation !== true) throw new Error("游戏动作需要确认，请读取确认内容后显式传 acceptConfirmation:true。");
        const before = args.trackIncomingOffers ? await activity.incomingForPlayer(args) : null;
        if (before && (before.sessionId !== offered.sessionId || before.epoch !== offered.epoch ||
            before.playerIdentity !== offered.personIdentity || before.clubIdentity !== offered.clubIdentity))
          throw new Error("报价和谈判的球员、俱乐部或会话已变化，请刷新。");
        const route = args.domain === "transfer" ? "/api/v1/transfers/negotiation/execute" : "/api/v1/negotiations/execute";
        const result = await scope.api(route, { ...query, option: args.actionIndex,
          choiceToken: selected.choiceToken, acceptConfirmation: args.acceptConfirmation === true, id: args.operationId || randomUUID() }, true);
        const response = { ...result, verificationScope: "negotiation_action_dispatch", note: "提交、对方回应和最终成交需分别核对。" };
        if (!before) return response;
        const beforeIds = before.offers.map(offer => offer.uniqueId);
        response.activityObservation = { playerIdentity: before.playerIdentity, clubIdentity: before.clubIdentity,
          sessionId: before.sessionId, epoch: before.epoch, beforeIds, newOffers: [], exclusiveCausalityVerified: false };
        if (result.status !== "dispatched_unverified") return response;
        try {
          for (const delay of [0, 350, 1000]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            const after = await activity.incomingForPlayer(args);
            if (after.sessionId !== before.sessionId || after.epoch !== before.epoch || after.playerIdentity !== before.playerIdentity ||
                after.clubIdentity !== before.clubIdentity) throw new Error("报价读回属于另一球员、俱乐部或会话。");
            response.activityObservation.newOffers = after.offers.filter(offer => !beforeIds.includes(offer.uniqueId));
            if (response.activityObservation.newOffers.length) break;
          }
        } catch (error) { response.activityObservation.error = String(error.message || error); }
        return response;
      });
    }
  };
}
