import { createLiveClient } from "./live-client.mjs";

export function createCommunicationTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!args.source) throw new Error("需要游戏实时对象source及可选path，不能编造会谈或事件。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle }, owner = { source: args.source, path: args.path || "" };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef, person: owner, Person: owner, ...(args.contexts || {}) };
      // Actor/team contexts are always actual current references.
      Object.assign(contexts, { human, Human: human, team: teamRef, Team: teamRef });
      const speakto = await scope.subscribe(owner, "SpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
      const groups = await scope.subscribe(primary.handle, "Actions", contexts);
      const bucket = args.bucket || "RequiredActions";
      if (!["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"].includes(bucket)) throw new Error("未知动作列表。");
      const options = await scope.subscribe(groups.handle, bucket, contexts);
      const query = { source: args.source, path: args.path || "", speakto: speakto.handle, actions: actions.handle, primary: primary.handle,
        groups: groups.handle, options: options.handle, bucket };
      return action(scope, query, await scope.api("/api/v1/communication/actions", query));
    });
  }
  return {
    get: args => context(args, async (_, __, offered) => offered),
    execute: args => {
      if (!args.operationId || !args.expectedChoiceToken || !Number.isInteger(args.actionIndex) || args.actionIndex < 0)
        throw new Error("先读取实际选项，保留原token、actionIndex和固定operationId。");
      return context(args, async (scope, query, offered) => {
        const option = offered.actions.find(item => item.index === args.actionIndex);
        if (!option?.implemented || option.choiceToken !== args.expectedChoiceToken) throw new Error(option?.reason || "动作或会谈状态已变化。");
        return scope.api("/api/v1/communication/execute", { ...query, id: args.operationId, option: args.actionIndex,
          choiceToken: args.expectedChoiceToken, acceptConfirmation: args.acceptConfirmation === true }, true);
      });
    }
  };
}
