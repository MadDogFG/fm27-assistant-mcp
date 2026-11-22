import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createBoardRequestTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const club = await scope.subscribe("human", "Club");
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, clubRef = { source: club.handle }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, club: clubRef, Club: clubRef, team: teamRef, Team: teamRef, ViewID: 0 };
      const speakto = await scope.subscribe(club.handle, "BoardRequestSpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const options = await scope.subscribe(actions.handle, "ActionsForDropdown", contexts);
      if (!args.optionPath && !execute) return { ok: true, choices: options.read.value, liveVerified: false };
      if (!args.optionPath) throw new Error("选择游戏真实董事会请求optionPath。");
      const query = { club: club.handle, speakto: speakto.handle, actions: actions.handle, options: options.handle, optionPath: args.optionPath };
      const preview = await scope.api("/api/v1/board/request-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("董事会请求或上下文已变化，请重新预览。");
      if (preview.requiresConfirmation && args.acceptConfirmation !== true) throw new Error("先阅读游戏原确认内容并显式acceptConfirmation。");
      return scope.api("/api/v1/board/request-execute", { ...query, id: args.operationId || randomUUID(),
        choiceToken: args.expectedChoiceToken, acceptConfirmation: args.acceptConfirmation === true }, true);
    });
  }
  return { get: args => context(args, false), execute: args => context(args, true) };
}
