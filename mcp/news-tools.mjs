import { randomUUID } from "node:crypto";
import { createLiveClient, clean, scalar } from "./live-client.mjs";

const buckets = ["RequiredActions", "OptionalActions", "AdviceActions", "ExitActions"];
const newsEntityTypes = new Set(["FM.UI.PersonReference", "FM.UI.TeamReference", "FM.UI.ClubReference", "FM.UI.CompReference"]);
export function createNewsTools(call) {
  const client = createLiveClient(call);
  async function readContext(args, action) {
    if (!Number.isInteger(args.index) || args.index < 0 || !args.expectedNewsIdentity)
      throw new Error("先读取完整收件箱，提供消息 index 和 expectedNewsIdentity。");
    if (args.unreadOnly === true) throw new Error("标读状态必须使用完整收件箱的 index，不能使用未读列表下标。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle },
        Team: { source: team.handle }, StringType: "", PortalMessagesTab: 0 };
      const inbox = await scope.subscribe("human", "HumanPortalFilteredMessages", contexts);
      const row = inbox.read?.value?.items?.[args.index] ?? (await scope.ready(inbox.handle, String(args.index))).value;
      if (row?.kind !== "reference" || row.identity !== args.expectedNewsIdentity)
        throw new Error("完整收件箱已变化，当前下标不是预期消息；尚未执行操作。");
      const news = { source: inbox.handle, path: String(args.index) };
      const readFlag = await scope.subscribe(news, "NewsItemHasBeenRead", contexts);
      const query = { inbox: inbox.handle, path: news.path, team: team.handle, readFlag: readFlag.handle,
        expectedNewsIdentity: args.expectedNewsIdentity, operationId: args.operationId };
      const state = await scope.api("/api/v1/news/read-state", query);
      if (state.targetIdentity !== args.expectedNewsIdentity)
        throw new Error("消息身份在读取期间变化，不能观察替代消息。");
      return action({ scope, query, state });
    });
  }
  async function context(args, needChoices, action) {
    if (!Number.isInteger(args.index) || args.index < 0) throw new Error("提供收件箱中消息的非负 index。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle },
        Team: { source: team.handle }, StringType: "", PortalMessagesTab: 0 };
      const inbox = await scope.subscribe("human", args.unreadOnly === true ? "HumanPortalUnreadMessages" : "HumanPortalFilteredMessages", contexts);
      const news = { source: inbox.handle, path: String(args.index) };
      const canRespond = await scope.subscribe(news, "CanRespond", contexts);
      const hasResponded = await scope.subscribe(news, "NewsHasResponded", contexts);
      const query = { inbox: inbox.handle, path: news.path, canRespond: canRespond.handle, hasResponded: hasResponded.handle };
      if (!needChoices) {
        const { latestResponse: _discarded, ...state } = await scope.api("/api/v1/news/state", query);
        if (args.expectedNewsIdentity && state.targetIdentity !== args.expectedNewsIdentity) throw new Error("消息列表已变化，当前下标不是原消息。");
        return action({ scope, query, state, contexts });
      }
      if (needChoices === true) query.title = (await scope.subscribe(news, "NewsTitleString", contexts)).handle;
      const speakto = await scope.subscribe(news, "SpeakTo", contexts);
      const actions = await scope.subscribe(speakto.handle, "Actions", contexts);
      const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
      const groups = await scope.subscribe(primary.handle, "Actions", contexts);
      const bucket = args.bucket || "RequiredActions";
      if (!buckets.includes(bucket)) throw new Error("未知新闻回应动作列表。");
      const options = await scope.subscribe(groups.handle, bucket, contexts);
      Object.assign(query, { speakto: speakto.handle, actions: actions.handle, primary: primary.handle, groups: groups.handle, options: options.handle, bucket });
      if (needChoices === "navigation") return action({ scope, query });
      if (needChoices === "conference") {
        const offered = await scope.api("/api/v1/news/state", query);
        if (args.expectedNewsIdentity !== offered.targetIdentity)
          throw new Error("消息列表已变化，当前下标不是原消息。");
        return action({ scope, query, contexts, options, offered });
      }
      const offered = await scope.api("/api/v1/news/describe", query);
      if (args.expectedNewsIdentity && offered.targetIdentity !== args.expectedNewsIdentity) throw new Error("消息列表已变化，当前下标不是原消息。");
      return action({ scope, query, contexts, options, offered: { ...offered, title: clean(offered.title), index: args.index, unreadOnly: args.unreadOnly === true } });
    });
  }
  return {
    relatedNews: args => readContext(args, async ({ scope, query, state }) => {
      const limit = args.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw new Error("Provide a related-items limit from 1 to 64.");
      const source = { source: query.inbox, path: query.path };
      const attachment = await scope.subscribeOptional(source, "AttachmentsNewsItem");
      const related = await scope.subscribe(source, "NewsRelatedNewsItems", { human: { source: "human" }, Number: limit });
      const navigation = await scope.subscribeOptional(source, "NewsItemActionDataReferences", { human: { source: "human" } });
      const value = related.read.value;
      if (value?.kind !== "list") throw new Error("FM has not returned the related-message list.");
      const messages = (value.items ?? []).map(item => {
        if (item?.type !== "FM.UI.NewsItemReference" || !item.identity)
          throw new Error("FM returned an unidentifiable related message.");
        return { identity: item.identity };
      });
      const owner = attachment.read.value;
      const nativeReferences = navigation.read.value;
      const navigationReferences = [];
      for (const [index, item] of (nativeReferences?.items ?? []).entries()) {
        if (item?.type !== "SI.Bindable.DynamicReference") continue;
        const nativeType = scalar(item.fields?.["0x6b456435"]);
        if (!/^\d+$/.test(nativeType ?? "")) continue;
        const target = item.fields?.["0x304a4a34"];
        const nativeId = scalar(target);
        if (/^\d+$/.test(nativeId ?? "")) {
          navigationReferences.push({ index, nativeType, nativeId });
        } else if (target?.kind === "reference" && newsEntityTypes.has(target.type) && target.identity) {
          navigationReferences.push({ index, nativeType, entityType: target.type, entityIdentity: target.identity });
        } else if (target?.kind === "list") {
          const entities = (target.items ?? []).flatMap(entry =>
            entry?.kind === "reference" && newsEntityTypes.has(entry.type) && entry.identity ?
              [{ entityType: entry.type, entityIdentity: entry.identity }] : []);
          navigationReferences.push({ index, nativeType, itemCount: target.count, entities });
        }
      }
      const current = await scope.api("/api/v1/news/read-state", query);
      if (current.targetIdentity !== state.targetIdentity || current.epoch !== state.epoch || current.sessionId !== state.sessionId)
        throw new Error("The source message changed during the related-message read.");
      return { ok: true, newsIdentity: state.targetIdentity, relatedMessages: messages, returnedCount: messages.length,
        mayHaveMore: value.truncated === true || value.count > messages.length || messages.length >= limit,
        attachmentOwnerIdentity: owner?.type === "FM.UI.NewsItemReference" ? owner.identity ?? null : null,
        navigationReferences, nativeNavigationReferenceCount: nativeReferences?.kind === "list" ? nativeReferences.count : null };
    }),
    happinessIssues: ({ offset = 0, limit = 10 } = {}) => client.scope(async scope => {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
        throw new Error("Provide a non-negative offset and a limit from 1 to 20.");
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" } };
      const list = await scope.subscribe(team.handle, "HappinessIssuesList", contexts);
      const players = await scope.subscribe(team.handle, "HappinessIssuesPlayerCount", contexts);
      const total = list.read.value?.count;
      const playerCount = scalar(players.read.value);
      if (list.read.value?.kind !== "list" || !Number.isSafeInteger(total) || playerCount == null)
        throw new Error("FM has not supplied the squad happiness issues.");
      const rows = [];
      const end = Math.min(total, offset + limit);
      for (let index = offset; index < end; index++) {
        const path = String(index);
        const original = (await scope.ready(list.handle, path)).value;
        if (original?.type !== "FM.UI.HappinessIssuesRowReference" || !original.identity) continue;
        const source = { source: list.handle, path };
        const hasPromises = await scope.subscribeOptional(source, "IssueHasPromises", contexts);
        const linked = await scope.subscribeOptional(source, "IssueLinkedPromises", contexts);
        if ((await scope.ready(list.handle, path)).value?.identity !== original.identity)
          throw new Error("The native happiness issues list changed during the read.");
        rows.push({ index, identity: original.identity, hasPromises: scalar(hasPromises.read.value) ?? null,
          linkedPromiseCount: linked.read.value?.kind === "list" ? linked.read.value.count : null });
      }
      return { ok: true, status: "ok", degraded: false, teamIdentity: team.read.value?.identity, playerCount: Number(playerCount), total,
        offset, nextOffset: end < total ? end : null, rows,
        ...(total === 0 ? { note: "当前全队无任何不满事项（已成功读回原生列表）。" } : {}) };
    }),
    promises: ({ completed = false, offset = 0, limit = 10 } = {}) => client.scope(async scope => {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
        throw new Error("Provide a non-negative offset and a limit from 1 to 20.");
      const name = completed ? "HumanCompletedPromisesMadeList" : "HumanActivePromisesMadeList";
      const list = await scope.subscribe("human", name);
      const value = list.read.value;
      if (value?.kind !== "list" || !Number.isSafeInteger(value.count))
        throw new Error("FM has not returned the native promise list.");
      const fields = {
        title: "InteractionPromiseTitle", status: "InteractionPromiseStatusText",
        ongoing: "InteractionPromiseOngoing", daysRemaining: "InteractionPromiseDaysRemaining",
        daysElapsed: "InteractionPromiseDaysElapsed", progress: "InteractionPromiseRequiredTargetProgressShortString"
      };
      const rows = [];
      const end = Math.min(value.count, offset + limit);
      for (let index = offset; index < end; index++) {
        const original = (await scope.ready(list.handle, String(index))).value;
        if (original?.type !== "FM.UI.PromiseReference" || !original.identity)
          throw new Error("FM did not return an identifiable promise row.");
        const row = { index, identity: original.identity };
        for (const [field, property] of Object.entries(fields)) {
          const channel = await scope.subscribeOptional({ source: list.handle, path: String(index) }, property);
          row[field] = scalar(channel.read.value) ?? null;
        }
        if ((await scope.ready(list.handle, String(index))).value?.identity !== row.identity)
          throw new Error("The native promise list changed during the read.");
        rows.push(row);
      }
      return { ok: true, completed, offset, total: value.count, nextOffset: end < value.count ? end : null, rows };
    }),
    readState: args => readContext(args, async ({ state }) => ({ ...state, index: args.index, unreadOnly: false })),
    setRead: async args => {
      if (args.isRead !== true && args.isRead !== false) throw new Error("isRead 需为 true（标为已读）或 false（标为未读）。");
      if (!args.expectedChoiceToken) throw new Error("先调用 get_news_read_state，再提供 expectedChoiceToken。");
      const operationId = args.operationId || randomUUID();
      const markingUnread = args.isRead === false;
      const dispatched = await readContext({ ...args, operationId: undefined }, async ({ scope, query, state }) => {
        if (markingUnread) {
          if (state.unreadChoiceToken !== args.expectedChoiceToken) throw new Error("消息、收件箱或已读状态已变化，请重新预览。");
          if (!state.canMarkUnread) throw new Error("该消息已经是未读，尚未发送事件。");
          const receipt = await scope.api("/api/v1/news/set-unread-state", { ...query, operationId: undefined,
            choiceToken: state.unreadChoiceToken, id: operationId }, true);
          return { receipt, state };
        }
        if (state.choiceToken !== args.expectedChoiceToken) throw new Error("消息、收件箱或已读状态已变化，请重新预览。");
        if (!state.canMarkRead) throw new Error("该消息已经已读，尚未发送事件。");
        const receipt = await scope.api("/api/v1/news/set-read-state", { ...query, operationId: undefined,
          choiceToken: state.choiceToken, isRead: true, id: operationId }, true);
        return { receipt, state };
      });
      let observation;
      if (dispatched.receipt.status === "dispatched_unverified") {
        try {
          observation = await readContext({ ...args, operationId }, async ({ state }) => state);
          if (observation.sessionId !== dispatched.state.sessionId || observation.epoch !== dispatched.state.epoch)
            throw new Error("游戏会话已变化，不能用新会话证明本次标读。");
        } catch (error) { observation = { error: String(error.message || error), verified: false }; }
      }
      return { ...dispatched.receipt, newsIdentity: args.expectedNewsIdentity, ...(observation ? { observation } : {}),
        note: markingUnread ? "只发送游戏单条标未读业务；不打开消息、不改变最后打开消息。" : "只发送游戏单条标读业务；不打开消息、不改变最后打开消息、不完成新闻待办。独立读回不证明命令因果。" };
    },
    get: args => context(args, true, async ({ offered }) => ({
      ...offered,
      actions: offered.actions.flatMap(action => {
        if (action.silentExecutionImplemented === true) {
          const { index, label, choiceToken, requiresConfirmation } = action;
          return [{ index, label, choiceToken, requiresConfirmation, silentExecutionImplemented: true }];
        }
        return action.handoffTool === "open_press_conference_for_player" ?
          [{ index: action.index, label: "出席新闻发布会", handoffTool: action.handoffTool, silentExecutionImplemented: false }] : [];
      })
    })),
    openPressConference: args => {
      if (!args.expectedNewsIdentity || !args.operationId)
        throw new Error("Provide the original invitation identity and an operation ID.");
      return context({ ...args, bucket: "RequiredActions" }, "navigation", ({ scope, query }) =>
        scope.api("/api/v1/news/open-press-conference", { ...query,
          expectedNewsIdentity: args.expectedNewsIdentity, id: args.operationId }, true));
    },
    pressConference: args => {
      if (args.actionIndex !== undefined || args.expectedQuestion !== undefined)
        throw new Error("Press conference answers are handled by the player in FM.");
      const handoffEvents = new Map([[863384693, "start"], [1330852694, "delegate"]]);
      const knownSessionLookup = !args.operationId && args.conferenceId !== undefined;
      if (knownSessionLookup && (!args.expectedNewsIdentity || !args.expectedConferenceIdentity ||
          !/^\d{1,10}$/.test(args.conferenceId) || Number(args.conferenceId) > 4294967295))
        throw new Error("提供原消息身份、发布会 ID 和已知会话身份。");
      return context({ ...args, bucket: "RequiredActions" }, knownSessionLookup ? false : "conference",
        async ({ scope, contexts, options, offered, state: newsState }) => {
        const newsIdentity = (offered ?? newsState).targetIdentity;
        const unique = (rows, predicate, error) => {
          const matches = (rows ?? []).map((row, index) => ({ fields: row?.fields, index })).filter(({ fields }) => predicate(fields));
          if (matches.length !== 1) throw new Error(error);
          return matches[0];
        };
        const rows = options?.read.value?.items ?? [];
        let conferenceId, conferenceContext;
        if (knownSessionLookup) {
          conferenceId = args.conferenceId;
          if (!newsIdentity.split(",").includes(`1970170212:${conferenceId}`))
            throw new Error("原消息与发布会 ID 不匹配。");
          conferenceContext = { $u32: conferenceId };
        } else {
          const attend = unique(rows, f => scalar(f?.["0x37755247"]) === "15" &&
            scalar(f?.["0x6b746a77"]) === "3", "该消息没有唯一的发布会邀请；结束后请提供先前读取的会话身份及 ID。");
          const parameters = attend.fields["0x53554171"];
          if (parameters?.kind !== "list" || parameters.truncated) throw new Error("发布会参数不可用。");
          const id = unique(parameters.items, f => scalar(f?.["0x6b456435"]) === "0" &&
            /^\d+$/.test(scalar(f?.["0x304a4a34"]) ?? ""), "游戏未提供唯一的发布会 ID。");
          conferenceId = scalar(id.fields["0x304a4a34"]);
          conferenceContext = { valueSource: options.handle, path: `${attend.index}/0x53554171/${id.index}/0x304a4a34` };
        }
        const session = await scope.subscribe("human", "PressConferenceEditSession", { ...contexts,
          PressConferenceId: conferenceContext });
        const conferenceIdentity = session.read.value?.identity;
        if (args.expectedConferenceIdentity && conferenceIdentity !== args.expectedConferenceIdentity)
          throw new Error("发布会会话身份不符。");
        const state = {};
        for (const key of ["HasPressConferenceStarted", "HasPressConferenceFinished", "TotalNumberOfQuestions", "NumberOfQuestionsAsked", "NumberOfJournalistsAttending"]) {
          const value = await scope.subscribeOptional(session.handle, key, contexts);
          state[key] = scalar(value.read.value);
        }
        // The game can retain Started after the last answer, or clear it when it
        // closes the original invite. Finished is authoritative in both cases.
        const phase = state.HasPressConferenceFinished === "True" ? "finished" :
          state.HasPressConferenceStarted === "True" && state.HasPressConferenceFinished === "False" ? "started" :
          state.HasPressConferenceStarted === "False" && state.HasPressConferenceFinished === "False" ? "not_started" : "unknown";
        const result = { ok: true, newsIdentity, conferenceId, conferenceIdentity, phase, state, nativeActions: [] };
        if (knownSessionLookup || state.HasPressConferenceStarted !== "False" || state.HasPressConferenceFinished !== "False") {
          if (args.operationId) throw new Error("The press conference cannot be started in its current state.");
          return result;
        }
        const speakTo = await scope.subscribe(session.handle, "SpeakTo", contexts);
        const actions = await scope.subscribe(speakTo.handle, "Actions", contexts);
        const primary = await scope.subscribe(actions.handle, "PrimaryNpcWithActions", contexts);
        const groups = await scope.subscribe(primary.handle, "Actions", contexts);
        const bucket = "OptionalActions";
        const list = await scope.subscribe(groups.handle, bucket, contexts);
        const query = { source: session.handle, speakto: speakTo.handle, actions: actions.handle, primary: primary.handle,
          groups: groups.handle, options: list.handle, bucket };
        const entries = list.read.value?.items ?? [];
        const offeredHandoff = entries.some(row => handoffEvents.has(Number(scalar(row?.fields?.["0x6576656e"]))));
        const choices = offeredHandoff ? (await scope.api("/api/v1/communication/actions", query)).actions : [];
        const handoffs = choices.filter(item => item.implemented && item.choiceToken && handoffEvents.has(item.eventId) &&
          Number(scalar(entries[item.index]?.fields?.["0x6576656e"])) === item.eventId);
        if (args.operationId) {
          const requested = args.handoff || "start";
          const choice = handoffs.find(item => handoffEvents.get(item.eventId) === requested && item.choiceToken === args.expectedChoiceToken);
          if (!choice) throw new Error("Refresh the press conference handoff preview. FM must offer this action.");
          return scope.api("/api/v1/communication/execute", { ...query, option: choice.index,
            choiceToken: choice.choiceToken, id: args.operationId, acceptConfirmation: args.acceptConfirmation === true }, true);
        }
        result.nativeActions = handoffs.map(choice => ({ bucket, index: choice.index,
          label: handoffEvents.get(choice.eventId) === "delegate" ? "派助教出席" : "启动发布会",
          handoff: handoffEvents.get(choice.eventId), nativeEvent: String(choice.eventId),
          choiceToken: choice.choiceToken, requiresConfirmation: choice.requiresConfirmation }));
        return result;
      });
    },
    state: args => context(args, false, async ({ state }) => state),
    reply: async args => {
      if (!Number.isInteger(args.actionIndex) || args.actionIndex < 0 || !args.expectedChoiceToken) throw new Error("先读取新闻合法回应，再提供 actionIndex 和 expectedChoiceToken。");
      const dispatched = await context(args, true, async ({ scope, query, offered }) => {
        const choice = offered.actions.find(row => row.index === args.actionIndex);
        if (!choice?.silentExecutionImplemented) throw new Error(choice?.reason || "该新闻动作尚未恢复静默协议。");
        if (choice.choiceToken !== args.expectedChoiceToken) throw new Error("消息或回应选项已变化，请重新读取。");
        if (choice.requiresConfirmation && args.acceptConfirmation !== true) throw new Error("读取游戏确认内容后，显式选择 acceptConfirmation:true。");
        const receipt = await scope.api("/api/v1/news/execute", { ...query, option: args.actionIndex, choiceToken: choice.choiceToken,
          acceptConfirmation: args.acceptConfirmation === true, id: args.operationId || randomUUID() }, true);
        return { receipt, offered };
      });
      const { receipt, offered } = dispatched;
      let observation;
      if (receipt.status === "dispatched_unverified") {
        try {
          observation = await context({ ...args, expectedNewsIdentity: offered.targetIdentity }, false, async ({ state }) => state);
          if (observation.sessionId !== offered.sessionId || observation.epoch !== offered.epoch) throw new Error("游戏会话已变化，不能将新会话状态用于本次回应。");
        } catch (error) { observation = { error: String(error.message || error) }; }
      }
      return { ...receipt, title: offered.title, newsIdentity: offered.targetIdentity, ...(observation ? { observation } : {}),
        note: "回执只证明原生回应派发。另一次订阅读到的回应状态不证明本命令的因果结果；其它新闻/卡片/谈话流程仍需专门接口。" };
    }
  };
}
