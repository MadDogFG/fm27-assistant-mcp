import { randomUUID } from "node:crypto";
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
      if (args.expectedChoiceToken && preview.choiceToken !== args.expectedChoiceToken)
        throw new Error("收件箱状态已变化，请重新预览。");
      const token = args.expectedChoiceToken || preview.choiceToken;
      const opId = args.operationId || randomUUID();
      return scope.api("/api/v1/news/mark-all-read", { ...query, id: opId, choiceToken: token }, true);
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
