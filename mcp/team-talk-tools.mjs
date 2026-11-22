import { randomUUID } from "node:crypto";
import { createLiveClient, scalar, clean } from "./live-client.mjs";

// Own native subscriptions only; no panel is opened to obtain the talk or its actions.
export function createTeamTalkTools(call) {
  const client = createLiveClient(call);
  const properties = ["TeamTalkGroupType", "SelectedPlayers", "Players", "TalkingTo", "IsCompleted", "IsTeamTalkFinished",
    "IsSubsTalk", "IsPreMatchTalk", "IsPostMatchTalk"];
  async function context(args, action, withActions = false) {
    return client.scope(async scope => {
      const match = await scope.api("/api/v1/match/state");
      if (!match.inMatch || match.pastMatch || match.replay || match.spectating || typeof match.isHomeTeam !== "boolean")
        throw new Error("需要当前经理执教中的实际比赛，不能使用历史、回放或观战引用。");
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Boolean: true, human, Human: human, team: teamRef, Team: teamRef,
        isHomeTeam: match.isHomeTeam, IsHomeTeam: match.isHomeTeam };
      const tactic = await scope.subscribe("match", "Tactic", contexts);
      const talk = await scope.subscribe(tactic.handle, "TeamTalk", contexts);
      const channels = {};
      const nativeProperties = await scope.properties(talk.handle);
      for (const name of properties) {
        if (name === "TalkingTo" && !nativeProperties.some(value => value.name.split(":")[0] === name)) continue;
        channels[name] = (await scope.subscribe(talk.handle, name, contexts)).handle;
      }
      const query = { tactic: tactic.handle, talk: talk.handle, channels };
      query.config = (await scope.subscribe("singleton:ConfigReference", "AllowGroupedTeamTalks")).handle;
      if (withActions) {
        const speakto = await scope.subscribe(talk.handle, "SpeakTo", contexts);
        const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
        const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
        const groups = await scope.subscribe(primary.handle, "Actions", contexts);
        const bucket = args.bucket || "RequiredActions";
        if (!["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"].includes(bucket)) throw new Error("未知原生谈话动作列表。");
        const options = await scope.subscribe(groups.handle, bucket, contexts);
        Object.assign(query, { speakto: speakto.handle, actions: actions.handle, primary: primary.handle, groups: groups.handle, options: options.handle, bucket });
      }
      return action({ scope, query });
    });
  }
  async function selection(args, execute) {
    if (!["group", "players"].includes(args.kind)) throw new Error("kind 需要 group 或 players。");
    if (args.kind === "group" && (!Number.isInteger(args.optionIndex) || args.optionIndex < 0)) throw new Error("从原生组别候选中提供 optionIndex。");
    if (args.kind === "players" && (!Array.isArray(args.playerPaths) || args.playerPaths.some(path => typeof path !== "string" || !/^(0|[1-9]\d*)$/.test(path)) ||
      new Set(args.playerPaths).size !== args.playerPaths.length)) throw new Error("playerPaths 必须为不重复的原生球员行下标字符串。");
    if (execute && !args.expectedChoiceToken) throw new Error("先预览当前谈话对象，再提供 expectedChoiceToken。");
    const receipt = await context(args, async ({ scope, query }) => {
      const selected = { ...query, kind: args.kind, option: args.optionIndex, playerPaths: args.playerPaths };
      const preview = await scope.api("/api/v1/match/team-talk/selection-preview", selected);
      if (!execute) return preview;
      if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("谈话对象、状态或候选已改变，请重新预览。");
      return scope.api("/api/v1/match/team-talk/select", { ...selected, choiceToken: preview.choiceToken, id: args.operationId || randomUUID() }, true);
    });
    if (!execute || receipt.verified || !["dispatched_unverified", "dispatch_result_unknown"].includes(receipt.status)) return receipt;
    try {
      const observed = await context(args, ({ scope, query }) => scope.api("/api/v1/match/team-talk/state", { ...query, operationId: receipt.operationId }));
      if (!observed.operation) throw new Error("独立状态未返回原请求回执，保留原 operationId 查询。");
      return { ...observed.operation, observedTalk: observed, recipientSetVerified: observed.operation?.verified === true && observed.operation?.verificationScope === "team_talk_recipients" };
    }
    catch (error) { return { ...receipt, verificationError: String(error.message || error), retrySafe: false }; }
  }
  return {
    state: args => context(args, async ({ scope, query }) => {
      const result = await scope.api("/api/v1/match/team-talk/state", { ...query, operationId: args.operationId });
      for (const player of result.playerCandidates || []) {
        try {
          const name = await scope.subscribe({ source: query.channels.Players, path: `${player.path}/0x706c7972` }, "Name");
          player.name = clean(scalar(name.read.value));
        } catch (error) { player.nameUnavailable = String(error.message || error); }
      }
      return result;
    }),
    previewSelection: args => selection(args, false),
    select: args => selection(args, true),
    actions: args => context(args, ({ scope, query }) => scope.api("/api/v1/match/team-talk/actions", query), true),
    execute: async args => {
      if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !args.expectedChoiceToken) throw new Error("读取原生讲话动作后提供 actionIndex 和 expectedChoiceToken。");
      const receipt = await context(args, async ({ scope, query }) => {
        const offered = await scope.api("/api/v1/match/team-talk/actions", query);
        const choice = offered.actions.find(item => item.index === args.actionIndex);
        if (!choice?.silentExecutionImplemented) throw new Error(choice?.reason || "该谈话动作尚未恢复静默协议。");
        if (choice.choiceToken !== args.expectedChoiceToken) throw new Error("谈话动作或对象已改变，请重新读取。");
        if (choice.requiresConfirmation && args.acceptConfirmation !== true) throw new Error("请先读确认内容，再显式提供 acceptConfirmation:true。");
        return scope.api("/api/v1/match/team-talk/execute", { ...query, option: args.actionIndex, choiceToken: choice.choiceToken,
          acceptConfirmation: args.acceptConfirmation === true, id: args.operationId || randomUUID() }, true);
      }, true);
      // Independent current state is useful evidence, but it does not identify the spoken
      // comment or prove morale effects. Keep dispatch verification unchanged.
      try { return { ...receipt, observedTalk: await context(args, ({ scope, query }) => scope.api("/api/v1/match/team-talk/state", query)),
        note: "记录讲话派发及独立当前谈话状态；不把组别完成标志当作具体讲话或士气效果证明。" }; }
      catch (error) { return { ...receipt, verificationError: String(error.message || error), retrySafe: false }; }
    }
  };
}
