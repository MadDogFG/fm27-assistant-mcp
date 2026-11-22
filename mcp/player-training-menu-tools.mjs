import { createLiveClient, scalar, clean } from "./live-client.mjs";
import { randomUUID } from "node:crypto";
import { createTrainingTools } from "./training-tools.mjs";

export function createPlayerTrainingMenuTools(call) {
  const client = createLiveClient(call);
  const training = createTrainingTools(call);
  // Game API action names in preference order; the actual ID is always read from the
  // live offered-action list, so builds that rename or add a menu family stay supported.
  const actionNames = {
    training_report: ["PersonRequestTrainingReport", "PersonTrainingReport"],
    rest: ["PersonTrainingIntensityRest", "PersonRestTrainingSchedule"],
    cancel_rest: ["PersonCancelRestTrainingSchedule"],
    weaker_foot: ["PlayerFootednessTraitTraining"],
    leadership_course: ["PersonLeadershipCourse"],
    language_course: ["PersonSendOnIntensiveLanguageCourse"],
    preferred_move: ["PersonTrainingNewPreferredMove"]
  };
  async function context(args, execute, availabilityOnly = false) {
    if (Boolean(args.source) === Number.isInteger(args.squadIndex) || args.squadIndex < 0 || !Object.hasOwn(actionNames, args.action))
      throw new Error("提供球员 source 或 squadIndex，以及有效的训练菜单 action。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const squad = args.source ? null : await scope.subscribe(team.handle, "Players", { human: { source: "human" } });
      const subject = args.source ? { source: args.source, path: args.path || "" } : { source: squad.handle, path: String(args.squadIndex) };
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle }, Records: [{ $reference: subject }] };
      const offered = await scope.subscribe("game", "Actions", contexts);
      const offeredList = await scope.api("/api/v1/actions/offered", { offered: offered.handle });
      const available = (offeredList.actions || []).map(action => ({ id: String(action.id), name: action.name }));
      const chosen = actionNames[args.action].map(name => available.find(action => action.name === name)).find(Boolean);
      if (availabilityOnly) return Boolean(chosen);
      if (!chosen) {
        const related = available.filter(action => /Training|Rest/i.test(action.name)).map(action => action.name);
        throw new Error(`游戏当前没有为这名球员提供 ${args.action} 菜单（相关候选：${related.join(", ") || "无"}）。`);
      }
      const reference = await scope.subscribe("game", "Action", { ...contexts, ID: { $u32: chosen.id } });
      const items = await scope.subscribe(reference.handle, "Items", contexts);
      const query = { offered: offered.handle, action: reference.handle, items: items.handle };
      if (!args.entry) {
        if (execute) throw new Error("先从原生训练菜单选具体entry并预览。");
        const keys = Object.fromEntries(await Promise.all(["Text", "Event", "Disabled", "RowData", "ChildList", "ActionData"].map(async name => [name, await scope.propertyId(name)])));
        const entries = [];
        async function visit(list, nativePath = [], path = [], disabled = false) {
          if (list?.kind !== "list") return;
          for (const [index, outer] of (list.items || []).entries()) {
            const outerPath = [...nativePath, index];
            const rowPath = [...outerPath, keys.RowData];
            let row = outer?.fields?.[keys.RowData];
            if (row?.truncated && !row.fields?.[keys.Event]) row = (await scope.ready(items.handle, rowPath.join("/"))).value;
            const fields = (row || outer)?.fields || {};
            const blocked = disabled || scalar(outer?.fields?.[keys.Disabled]) === "True" || scalar(fields[keys.Disabled]) === "True";
            const entry = [...path, index];
            const nativeEvent = scalar(fields[keys.Event]);
            const restDuration = chosen.name === "PersonTrainingIntensityRest" && nativeEvent === "1702130291";
            const weakerFootToggle = args.action === "weaker_foot" && nativeEvent === "2003194700";
            const weakerFootRequest = weakerFootToggle ? scalar(fields[keys.ActionData]?.fields?.["0x70737766"]) : null;
            const traitMode = args.action === "preferred_move" && nativeEvent === "44" ?
              scalar(fields[keys.ActionData]?.fields?.["0x6d6f6465"]) : null;
            entries.push({ entry, label: clean(scalar(fields[keys.Text]) ?? scalar(outer?.fields?.[keys.Text])), disabled: blocked,
              nativeEvent: nativeEvent ?? scalar(outer?.fields?.[keys.Event]) ?? null,
              ...(weakerFootRequest === "True" || weakerFootRequest === "False" ? { requestedTraining: weakerFootRequest === "True" } : {}),
              ...(traitMode === "0" || traitMode === "2" ? { requestedTraining: traitMode === "0" } : {}),
              executableLeaf: (args.action === "weaker_foot" ? weakerFootRequest === "True" || weakerFootRequest === "False" :
                nativeEvent === "44" || restDuration) && Boolean(fields[keys.ActionData]) });
            const outerChildren = outer?.fields?.[keys.ChildList];
            const childPath = [...(outerChildren ? outerPath : row ? rowPath : outerPath), keys.ChildList];
            let children = outerChildren || fields[keys.ChildList];
            if (children?.truncated && !children.items) children = (await scope.ready(items.handle, childPath.join("/"))).value;
            await visit(children, childPath, entry, blocked);
          }
        }
        await visit(items.read.value);
        return { ok: true, action: args.action, nativeAction: chosen.name, entries, liveVerified: false };
      }
      query.entry = args.entry;
      const preview = await scope.api("/api/v1/player-training-menu/preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("训练菜单/球员状态已变化，提供原预览token。");
      if (preview.disabled || !preview.silentExecutionImplemented) throw new Error("游戏禁用此选择，或该确认流程尚未接入。");
      if (preview.requiresConfirmationProtocol && args.acceptConfirmation !== true) throw new Error("请先查阅游戏确认内容，再显式传入 acceptConfirmation=true。");
      const id = args.operationId || randomUUID();
      const playerArgs = args.source ? { source: args.source, path: args.path } : { squadIndex: args.squadIndex };
      const readRest = async () => (await training.get({ ...playerArgs, kind: "intensity" })).restDaysRemaining;
      const courseFlag = args.action === "language_course" ? "169" : args.action === "leadership_course" ? "171" : null;
      const readCourse = () => client.scope(async observation => {
        const flags = await observation.subscribe(subject, "PlayerStatusFlagsForTeam", contexts);
        const list = flags.read.value;
        if (list?.kind !== "list" || list.truncated) return null;
        return (list.items ?? []).some(row => String(scalar(row.fields?.["0x32347667"])) === courseFlag);
      });
      let courseBefore;
      if (courseFlag) { try { courseBefore = await readCourse(); } catch {} }
      const weakerFootRequest = async () => (await context({ ...playerArgs, action: "weaker_foot" }, false)).entries
        .find(row => row.nativeEvent === "2003194700" && row.executableLeaf &&
          row.entry.length === args.entry.length && row.entry.every((index, offset) => index === args.entry[offset]))?.requestedTraining;
      let requestedTraining;
      const readTraitMenu = async () => (await context({ ...playerArgs, action: "preferred_move" }, false)).entries;
      let traitRequest;
      let before;
      if (args.action === "cancel_rest") {
        try { before = await readRest(); } catch {}
      } else if (args.action === "weaker_foot") {
        try { requestedTraining = await weakerFootRequest(); } catch {}
      } else if (args.action === "preferred_move") {
        try {
          const rows = await readTraitMenu();
          traitRequest = rows.find(row => row.executableLeaf && row.entry.length === args.entry.length &&
            row.entry.every((index, offset) => index === args.entry[offset]))?.requestedTraining;
          if (typeof traitRequest === "boolean" && !rows.some(row => row.executableLeaf && row.requestedTraining === !traitRequest)) {
            before = !traitRequest;
          }
        } catch {}
      }
      let receipt;
      try { receipt = await scope.api("/api/v1/player-training-menu/execute", { ...query, id, choiceToken: preview.choiceToken, acceptConfirmation: args.acceptConfirmation }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", retrySafe: false, verified: false, error: String(error.message || error) }; }
      if (!receipt.verified && receipt.status === "dispatched_unverified" && Number(before) > 0) {
        try {
          if (String(await readRest()) === "0") return { ...receipt, status: "verified", verified: true,
            verificationScope: "player_training_rest_days", before, requested: "0", after: "0" };
        } catch {}
      }
      if (!receipt.verified && receipt.status === "dispatched_unverified" && typeof requestedTraining === "boolean") {
        try {
          if (await weakerFootRequest() === !requestedTraining) return { ...receipt, status: "verified", verified: true,
            verificationScope: "player_training_weaker_foot_native_menu_toggle", before: !requestedTraining,
            requested: requestedTraining, after: requestedTraining };
        } catch {}
      }
      if (receipt.status === "dispatched_unverified" && courseFlag) {
        let courseAfter;
        try {
          courseAfter = await readCourse();
          if (courseBefore === false && courseAfter === true) return { ...receipt, status: "verified", verified: true,
            verificationScope: "player_training_course_status_flag", before: false, requested: true, after: true };
        } catch {}
        try {
          const offeredAfter = await context({ ...playerArgs, action: args.action }, false, true);
          return { ...receipt, enrollmentObservation: { offeredBefore: true, offeredAfter, enrollmentConfirmed: false,
            statusFlag: courseFlag, statusFlagBefore: courseBefore ?? null, statusFlagAfter: courseAfter ?? null } };
        } catch {}
      }
      if (receipt.status === "dispatched_unverified" && args.action === "preferred_move" && typeof before === "boolean") {
        try {
          const rows = await readTraitMenu();
          if (rows.some(row => row.executableLeaf && row.requestedTraining === !traitRequest) &&
              !rows.some(row => row.executableLeaf && row.requestedTraining === traitRequest))
            return { ...receipt, status: "verified", verified: true, verificationScope: "player_training_trait_native_menu",
              before, requested: traitRequest, after: traitRequest };
        } catch {}
      }
      return receipt;
    });
  }
  async function weakerFootState(args) {
    const { isTrainingWeakerFoot: channelState, ...state } = await training.get(args);
    let toggle;
    try {
      const menu = await context({ ...args, action: "weaker_foot" }, false);
      const rows = menu.entries.filter(row => typeof row.requestedTraining === "boolean");
      if (rows.length === 1) toggle = rows[0];
    } catch {}
    if (toggle) return { ...state, isTrainingWeakerFoot: !toggle.requestedTraining,
      stateSource: "native_menu", channelState, channelDisagrees: channelState !== !toggle.requestedTraining };
    return { ...state, isTrainingWeakerFoot: channelState ? true : null, stateSource: "training_channel_only", channelState };
  }
  return { get: args => context(args, false), execute: args => context(args, true), weakerFootState };
}
