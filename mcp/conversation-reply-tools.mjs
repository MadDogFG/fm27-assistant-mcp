import { createLiveClient } from "./live-client.mjs";
import { randomUUID } from "node:crypto";

export function createConversationReplyTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    if (!args.source) throw new Error("提供真实球员/员工/董事会人物或球队引用source及可选path。");
    const bucket = args.bucket || "RequiredActions";
    if (!["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"].includes(bucket)) throw new Error("选择实际会谈动作bucket。");
    return client.scope(async scope => {
      const actor = { source: args.source, path: args.path || "" };
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef, Person: actor, person: actor };
      const session = await scope.subscribe(actor, "ConversationEditSession", contexts);
      const speakto = await scope.subscribe(session.handle, "SpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
      const groups = await scope.subscribe(primary.handle, "Actions", contexts);
      const options = await scope.subscribe(groups.handle, bucket, contexts);
      const flat = {};
      // Discover actual SDK metadata; never invent a Conversation.Responses list.
      for (const property of await scope.properties(actions.handle)) {
        const name = property.name.split(":")[0];
        if (!name.startsWith("ActionsForButtons") && !name.startsWith("ActionsForDropdown")) continue;
        if (Object.keys(flat).length >= 8) break;
        try { flat[name] = (await scope.subscribe(actions.handle, name, contexts)).handle; }
        catch { /* A view with unavailable extra native context is not a reply candidate. */ }
      }
      const query = { ...actor, session: session.handle, speakto: speakto.handle, actions: actions.handle,
        primary: primary.handle, groups: groups.handle, options: options.handle, bucket, flat };
      const described = await scope.api("/api/v1/conversations/replies", query);
      if (!execute) return described;
      if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !args.expectedChoiceToken)
        throw new Error("从原始会谈bucket选实际actionIndex和expectedChoiceToken。");
      const selected = described.offered?.actions?.find(row => row.index === args.actionIndex);
      if (!selected?.implemented || selected.choiceToken !== args.expectedChoiceToken) throw new Error(selected?.reason || "当前会谈回应已变化，请重新读取。");
      if (selected.requiresConfirmation && !args.acceptConfirmation) throw new Error("请先阅读游戏确认内容，按已授权意图提供acceptConfirmation。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/conversations/reply", { ...query, id, index: args.actionIndex,
        choiceToken: selected.choiceToken, acceptConfirmation: Boolean(args.acceptConfirmation) }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), reply: args => {
    if (!args.operationId || !args.expectedChoiceToken || !Number.isInteger(args.actionIndex)) throw new Error("提供原回应下标、token和固定operationId。");
    return context(args, true);
  } };
}
