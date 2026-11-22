import { createLiveClient } from "./live-client.mjs";

// Only the actual induction's offered ExitActions can be executed.
export function createInductionTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!Number.isInteger(args.index) || args.index < 0 || !args.expectedNewsIdentity)
      throw new Error("需要完整收件箱消息 index 和 expectedNewsIdentity。 ");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle },
        Team: { source: team.handle }, StringType: "", PortalMessagesTab: 0 };
      const inbox = await scope.subscribe("human", "HumanPortalFilteredMessages", contexts);
      const row = inbox.read?.value?.items?.[args.index] ?? (await scope.ready(inbox.handle, String(args.index))).value;
      if (row?.kind !== "reference" || row.identity !== args.expectedNewsIdentity) throw new Error("消息身份或收件箱顺序已变化。 ");
      const news = { source: inbox.handle, path: String(args.index) };
      const induction = await scope.subscribe(news, "Induction", contexts);
      const speakto = await scope.subscribe(induction.handle, "SpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
      const groups = await scope.subscribe(primary.handle, "Actions", contexts);
      const options = await scope.subscribe(groups.handle, "ExitActions", contexts);
      const complete = await scope.subscribe(speakto.handle, "InteractionIsComplete", contexts);
      const step = await scope.subscribe(speakto.handle, "CurrentInductionStepIndex", contexts);
      const maxStep = await scope.subscribe(speakto.handle, "MaxInductionStepIndex", contexts);
      const query = { inbox: inbox.handle, path: news.path, induction: induction.handle, speakto: speakto.handle,
        actions: actions.handle, primary: primary.handle, groups: groups.handle, options: options.handle,
        complete: complete.handle, step: step.handle, maxStep: maxStep.handle };
      const offered = await scope.api("/api/v1/induction/read", query);
      if (offered.newsIdentity !== args.expectedNewsIdentity) throw new Error("消息身份在读取期间发生变化。 ");
      return action(scope, query, offered);
    });
  }
  return {
    get: args => context(args, async (_, __, offered) => offered),
    execute: async args => {
      if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !args.expectedChoiceToken || !args.operationId)
        throw new Error("提供原始候选 actionIndex、expectedChoiceToken 和 operationId。 ");
      const dispatched = await context(args, async (scope, query, offered) => {
        const choice = offered.actions.find(item => item.index === args.actionIndex);
        if (!choice?.implemented || choice.choiceToken !== args.expectedChoiceToken) throw new Error(choice?.reason || "选项或引导状态已变化。 ");
        const receipt = await scope.api("/api/v1/induction/execute", { ...query, id: args.operationId, option: args.actionIndex,
          choiceToken: args.expectedChoiceToken, acceptConfirmation: args.acceptConfirmation === true }, true);
        return { receipt, sessionId: offered.sessionId, epoch: offered.epoch };
      });
      let observation;
      if (dispatched.receipt.status === "dispatched_unverified") {
        try {
          observation = await context(args, async (_, __, offered) => offered);
          if (observation.sessionId !== dispatched.sessionId || observation.epoch !== dispatched.epoch)
            throw new Error("游戏会话已变化，无法将读回关联到此次操作。 ");
        } catch (error) { observation = { error: String(error.message || error), verified: false }; }
      }
      return { ...dispatched.receipt, ...(observation ? { observation } : {}),
        note: "读回是独立观察，不单独证明命令因果；新闻回应和继续状态需分别核验。" };
    }
  };
}
