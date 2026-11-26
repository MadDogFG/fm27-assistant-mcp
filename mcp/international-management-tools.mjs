import { createLiveClient, scalar } from "./live-client.mjs";

// 国家队人事（SQU-O17a/b/c：征召/撤回/资格变更，Review #34）与国家队集训（TRN-O28a/b）
export function createInternationalManagementTools(call) {
  const client = createLiveClient(call);

  // 只读检查当前经理是否执教国家队及集训/国家队阵容状态
  async function getInternationalManagementState() {
    return client.scope(async scope => {
      const [allowIntl, isIntlCtx, inCamp, instr] = await Promise.all([
        scope.subscribeOptional("human", "AllowInternationalManagement"),
        scope.subscribeOptional("human", "IsInternationalContext"),
        scope.subscribeOptional("human", "IsInInternationalCamp"),
        scope.subscribeOptional("human", "InternationalInstructions")
      ]);
      const parseTri = v => (v === "True" ? true : v === "False" ? false : null);
      return {
        ok: true,
        readOnly: true,
        allowInternationalManagement: scalar(allowIntl.read?.value),
        isInternationalContext: parseTri(scalar(isIntlCtx.read?.value)),
        isInInternationalCamp: parseTri(scalar(inCamp.read?.value)),
        hasInstructions: Boolean(instr.handle && instr.read?.value)
      };
    });
  }

  // SQU-O17a/b/c (Review #34): 支持传入外部合资格候选人引用（{ source, path }）或国家队现役名单下标（playerIndex）；
  // 严禁向 EventFmxSpeakToQuickActionComplete 派发自组对象 { action, playerIndex }，而是先查目标实时菜单或明确门控
  async function manageInternationalCallup({ action = "read", source, path, playerIndex, operationId } = {}) {
    if (!["read", "call_up", "withdraw", "eligibility"].includes(action)) {
      throw new Error(`未知国家队征召动作: ${action}（支持 read/call_up/withdraw/eligibility）`);
    }
    if (!source && playerIndex !== undefined && (!Number.isInteger(playerIndex) || playerIndex < 0)) {
      throw new Error("playerIndex 必须为非负整数。");
    }
    return client.scope(async scope => {
      const isIntlCtx = await scope.subscribeOptional("human", "IsInternationalContext");
      const intlRaw = scalar(isIntlCtx.read?.value);
      if (intlRaw !== "True") {
        return {
          ok: false,
          blocked: true,
          status: intlRaw === null ? "context_unavailable" : "not_international_manager",
          reason: intlRaw === null
            ? "无法读取 IsInternationalContext 状态（未就绪），已阻断且零派发。"
            : "当前经理未处于国家队执教上下文（IsInternationalContext=False）。",
          action,
          zeroDispatches: true
        };
      }
      const team = await scope.subscribe("human", "Team");
      const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      let targetRef;
      let targetMeta;
      if (source) {
        targetRef = { source, path: path || "" };
        targetMeta = { targetMode: "external_candidate", source, path: path || "" };
      } else {
        const players = await scope.subscribe(team.handle, "Players", { human: { source: "human" } });
        const count = players.read?.value?.count ?? 0;
        if (action === "read" && playerIndex === undefined) {
          return {
            ok: true,
            readOnly: true,
            currentSquadCount: count,
            note: "征召国家队外合资格新人请先用 search_players 按国籍检索并传入 { source, path }，再用 get_player_actions 查看国家队征召菜单。"
          };
        }
        const idx = playerIndex ?? 0;
        if (idx >= count) throw new Error(`playerIndex 越界: ${idx} >= ${count}`);
        targetRef = { source: players.handle, path: String(idx) };
        targetMeta = { targetMode: "current_squad", playerIndex: idx, personIdentity: players.read?.value?.items?.[idx]?.identity || null };
      }
      const [nameR, natR] = await Promise.all([
        scope.readAndRelease(targetRef, "Name", ctx, 600),
        scope.readAndRelease(targetRef, "NationalityText", ctx, 600)
      ]);
      if (action === "read") {
        return { ok: true, readOnly: true, ...targetMeta, playerName: nameR.scalar || null, nationality: natR.scalar || null };
      }
      // 国家队征召/撤回/劝说资格转换需通过目标球员的原生 Actions 菜单叶节点执行，不发送自组 { action, playerIndex }
      return {
        ok: false,
        blocked: true,
        unsupportedBranch: true,
        operationId: operationId || null,
        action,
        ...targetMeta,
        playerName: nameR.scalar || null,
        nationality: natR.scalar || null,
        reason: "国家队征召/撤回/资格劝说需经由该球员的原生动作菜单（get_player_actions / execute_player_action）执行，已阻断无区分自组载荷派发。",
        zeroDispatches: true
      };
    });
  }

  // TRN-O28a/b: 安排国家队集训指定日或应用集训计划（要求显式 action 与非负索引）
  async function manageInternationalTrainingCamp({ action, dayIndex, scheduleIndex, operationId } = {}) {
    if (!["schedule_day", "apply_camp_plan"].includes(action)) {
      throw new Error(`必须明确指定国家队集训动作 action（支持 schedule_day/apply_camp_plan）。当前: ${action}`);
    }
    if (action === "schedule_day" && (!Number.isInteger(dayIndex) || dayIndex < 0)) {
      throw new Error("schedule_day 必须提供有效的非负整数 dayIndex。");
    }
    if (action === "apply_camp_plan" && (!Number.isInteger(scheduleIndex) || scheduleIndex < 0)) {
      throw new Error("apply_camp_plan 必须提供有效的非负整数 scheduleIndex。");
    }
    const id = operationId || `intl_camp_${action}_${Date.now()}`;
    return client.scope(async scope => {
      const inCamp = await scope.subscribeOptional("human", "IsInInternationalCamp");
      const isIntlCtx = await scope.subscribeOptional("human", "IsInternationalContext");
      if (scalar(isIntlCtx.read?.value) !== "True" && scalar(inCamp.read?.value) !== "True") {
        return { ok: false, blocked: true, reason: "当前未执教国家队且未处于国家队集训期。", action, zeroDispatches: true };
      }
      const eventName = action === "schedule_day" ? "EventFmxConfirmTrainingSession" : "EventFmxConfirmTrainingSchedule";
      const dispatch = await call(
        `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=human&apply=true`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "schedule_day" ? dayIndex : scheduleIndex) }
      );
      return { ok: true, operationId: id, action, eventName, dispatch };
    });
  }

  return { getInternationalManagementState, manageInternationalCallup, manageInternationalTrainingCamp };
}
