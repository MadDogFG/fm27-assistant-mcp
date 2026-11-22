import { createLiveClient } from "./live-client.mjs";

export function createInboxManagementTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const unread = await scope.subscribe("human", "NumberUnreadMessages", { human, Human: human, team: teamRef, Team: teamRef });
      const query = { team: team.handle, unread: unread.handle };
      const preview = await scope.api("/api/v1/news/mark-all-read-preview", { ...query, operationId: execute ? undefined : args.operationId });
      if (!execute) return preview;
      if (!args.operationId || !args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken)
        throw new Error("需要原收件箱预览token和固定operationId，状态变化后请重新预览。");
      return scope.api("/api/v1/news/mark-all-read", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true);
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
