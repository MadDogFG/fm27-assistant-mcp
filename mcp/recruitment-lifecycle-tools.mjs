import { randomUUID } from "node:crypto";
import { createLiveClient } from "./live-client.mjs";

export function createRecruitmentLifecycleTools(call) {
  const client = createLiveClient(call);
  async function context(args, action) {
    if (!args.focusPath || !["restart", "complete", "delete"].includes(args.action))
      throw new Error("需要实际已有focusPath及restart/complete/delete操作。");
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const contexts = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
      const info = await scope.subscribe("human", "ScoutingInfo", contexts);
      const source = await scope.subscribe(info.handle, "RecruitmentFocusesList", contexts);
      const focus = { source: source.handle, path: args.focusPath };
      const uniqueId = await scope.subscribe(focus, "UniqueId", contexts);
      const complete = await scope.subscribe(focus, "IsFocusComplete", contexts);
      const name = await scope.subscribe(focus, "Name", contexts);
      const query = { action: args.action, info: info.handle, ...focus, uniqueId: uniqueId.handle, complete: complete.handle, name: name.handle };
      const preview = await scope.api("/api/v1/recruitment/lifecycle-preview", query);
      return action(scope, query, preview);
    });
  }
  return {
    get: args => context(args, async (_scope, _query, preview) => preview),
    execute: args => {
      if (!args.expectedChoiceToken) throw new Error("先预览已有招募重点的生命周期操作并提供原token。");
      return context(args, async (scope, query, preview) => {
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("重点身份或状态已变化，请重新预览。");
        // 删除重点不可逆，保留确认门槛；结束/重启可逆操作默认直接确认
        const isDelete = args.action === "delete";
        const confirmed = isDelete ? (args.acceptConfirmation === true) : (args.acceptConfirmation !== false);
        if (preview.requiresConfirmation && !confirmed) throw new Error(preview.confirmation);
        return { ...await scope.api("/api/v1/recruitment/lifecycle-execute", { ...query, id: args.operationId || randomUUID(),
          choiceToken: preview.choiceToken, acceptConfirmation: confirmed }, true), liveVerified: false };
      });
    },
    // REC-O06a / REC-O07b: 读取球队球探优先级列表并优先/取消球队考察任务
    teamScouting: async ({ action = "read", teamIndex = 0, operationId } = {}) => {
      if (!["read", "prioritise", "cancel"].includes(action)) {
        throw new Error(`未知球队球探动作: ${action}（支持 read/prioritise/cancel）`);
      }
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const info = await scope.subscribe("human", "ScoutingInfo", ctx);
        const listSub = await scope.subscribeOptional(info.handle, "ScoutTeamPriorities", ctx, 1200);
        const list = listSub.handle ? listSub.read?.value : null;
        if (action === "read") {
          return { ok: true, readOnly: true, count: list?.count ?? 0, teams: list };
        }
        if (!Number.isInteger(teamIndex) || teamIndex < 0) throw new Error("teamIndex 必须为非负整数。");
        const id = operationId || `team_scout_${action}_${Date.now()}`;
        const eventName = action === "prioritise" ? "EventFmxPrioritiseScoutingTeam" : "EventFmxCancelScoutingTeam";
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=${encodeURIComponent(eventName)}&source=${encodeURIComponent(info.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamIndex) }
        );
        return { ok: true, operationId: id, action, teamIndex, eventName, beforeCount: list?.count ?? 0, dispatch: send };
      });
    },
    // REC-O30a/b: 安排/修改比赛与对手考察分析任务（EventFmxHumanScoutFixture）
    scoutFixture: async ({ action = "read", fixtureIndex, useNextFixture = true, operationId } = {}) => {
      if (!["read", "scout"].includes(action)) {
        throw new Error(`未知赛程考察动作: ${action}（支持 read/scout）`);
      }
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const nextFix = await scope.subscribeOptional(team.handle, "NextFixture", ctx, 1200);
        const fixList = await scope.subscribeOptional(team.handle, "FixtureList", ctx, 1200);
        const listCount = fixList.read?.value?.count ?? 0;
        if (action === "read") {
          return {
            ok: true,
            readOnly: true,
            hasNextFixture: Boolean(nextFix.handle && nextFix.read?.value),
            nextFixture: nextFix.read?.value ?? null,
            fixtureCount: listCount,
            fixtures: fixList.read?.value ?? null
          };
        }
        const id = operationId || `scout_fixture_${Date.now()}`;
        let targetRef = null;
        if (Number.isInteger(fixtureIndex)) {
          if (fixtureIndex < 0 || fixtureIndex >= listCount) {
            throw new Error(`fixtureIndex 越界: ${fixtureIndex}（共 ${listCount} 场）`);
          }
          targetRef = { $reference: { source: fixList.handle, path: String(fixtureIndex) } };
        } else if (useNextFixture && nextFix.handle) {
          targetRef = { $reference: { source: nextFix.handle } };
        } else {
          throw new Error("未找到可用的赛程引用（NextFixture 或 FixtureList）。");
        }
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxHumanScoutFixture&source=human&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targetRef) }
        );
        return {
          ok: true,
          operationId: id,
          action,
          fixtureIndex: Number.isInteger(fixtureIndex) ? fixtureIndex : null,
          useNextFixture: !Number.isInteger(fixtureIndex),
          eventName: "EventFmxHumanScoutFixture",
          dispatch: send
        };
      });
    },
    // REC-O08c: 球探中心报告处理与请求更新（读取选项、确认已阅、继续考察/请求更新报告）
    scoutingCentreReport: async ({ action = "read", durationDays, operationId } = {}) => {
      if (!["read", "acknowledge", "request_update", "keep_scouting"].includes(action)) {
        throw new Error(`未知球探报告动作: ${action}（支持 read/acknowledge/request_update/keep_scouting）`);
      }
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const sca = await scope.subscribe("human", "ScoutingCentreActions", ctx);
        const [items, keepAct, scoutAct, counts] = await Promise.all([
          scope.subscribeOptional(sca.handle, "Items", ctx, 1000),
          scope.subscribeOptional(sca.handle, "KeepScoutingAction", ctx, 1000),
          scope.subscribeOptional(sca.handle, "ScoutPlayerAction", ctx, 1000),
          scope.subscribeOptional(sca.handle, "ScoutingCentreCounts", ctx, 1000)
        ]);
        if (action === "read") {
          return {
            ok: true,
            readOnly: true,
            items: items.read?.value ?? null,
            counts: counts.read?.value ?? null,
            keepScoutingDefault: keepAct.read?.value ?? null,
            scoutPlayerDefault: scoutAct.read?.value ?? null
          };
        }
        const id = operationId || `scouting_centre_${action}_${Date.now()}`;
        if (action === "acknowledge") {
          const send = await call(
            `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxScoutingCentreAcknowledge&source=${encodeURIComponent(sca.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
          );
          return { ok: true, operationId: id, action, eventName: "EventFmxScoutingCentreAcknowledge", dispatch: send };
        }
        // request_update 或 keep_scouting：可选更新 ScoutPlayerAction / KeepScoutingAction 后派发响应事件
        if (durationDays !== undefined) {
          const targetProp = action === "keep_scouting" ? keepAct : scoutAct;
          if (targetProp.handle) {
            await call(
              `/api/v1/internal/update?handle=${encodeURIComponent(targetProp.handle)}&apply=true`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(durationDays) }
            );
          }
        }
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxScoutingCentreResponse&source=${encodeURIComponent(sca.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(durationDays ?? 7) }
        );
        return { ok: true, operationId: id, action, durationDays: durationDays ?? 7, eventName: "EventFmxScoutingCentreResponse", dispatch: send };
      });
    },
    // REC-O06b/c / REC-O07a / REC-O31: 读取可考察赛事与地区树、调整球探覆盖范围与任务人员/频率
    scoutingAssignment: async ({ action = "read", rangeValue, intervalValue, operationId } = {}) => {
      if (!["read", "set_range", "confirm_staff", "set_interval"].includes(action)) {
        throw new Error(`未知球探任务动作: ${action}（支持 read/set_range/confirm_staff/set_interval）`);
      }
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const info = await scope.subscribe("human", "ScoutingInfo", ctx);
        const [areas, ranges, range, budget] = await Promise.all([
          scope.subscribeOptional(team.handle, "PossibleScoutingAreasDropdown", ctx, 1000),
          scope.subscribeOptional(info.handle, "ValidScoutingRanges", ctx, 1000),
          scope.subscribeOptional(info.handle, "ScoutingRange", ctx, 1000),
          scope.subscribeOptional(info.handle, "ScoutingBudget", ctx, 1000)
        ]);
        if (action === "read") {
          return {
            ok: true,
            readOnly: true,
            scoutingRange: range.read?.value ?? null,
            scoutingBudget: budget.read?.value ?? null,
            validRanges: ranges.read?.value ?? null,
            possibleAreas: areas.read?.value ?? null
          };
        }
        const id = operationId || `scouting_assign_${action}_${Date.now()}`;
        if (action === "set_range") {
          if (!Number.isInteger(rangeValue) || rangeValue < 0) throw new Error("rangeValue 必须为非负整数。");
          const send = await call(
            `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxScoutingRangeEditConfirm&source=${encodeURIComponent(info.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rangeValue) }
          );
          await new Promise(r => setTimeout(r, 200));
          const afterRange = await scope.subscribeOptional(info.handle, "ScoutingRange", ctx, 1000);
          return { ok: true, operationId: id, action, rangeValue, eventName: "EventFmxScoutingRangeEditConfirm", beforeRange: range.read?.value ?? null, afterRange: afterRange.read?.value ?? null, dispatch: send };
        }
        if (action === "confirm_staff") {
          const send = await call(
            `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxRecruitmentFocusScoutAnalystEditConfirm&source=human&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
          );
          return { ok: true, operationId: id, action, eventName: "EventFmxRecruitmentFocusScoutAnalystEditConfirm", dispatch: send };
        }
        // set_interval (REC-O31: 短名单球探持续更新周期)
        if (!Number.isInteger(intervalValue) || intervalValue < 0) throw new Error("intervalValue 必须为非负整数。");
        const ctx0 = { ...ctx, Type: 0, type: 0 };
        const ps0 = await scope.subscribeOptional("human", "HumanPersonSearch", ctx0, 1200);
        if (ps0.handle) {
          const beforeSel = await scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalSelected", ctx0, 800);
          const opts = await scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalOptionsList", ctx0, 800);
          const items = opts.read?.value?.items || [];
          let optIdx = items.findIndex(x => String(x?.fields?.["0x7074766c"]?.value) === String(intervalValue));
          if (optIdx < 0 && intervalValue < items.length) optIdx = intervalValue;
          if (optIdx < 0) optIdx = 0;
          const payload = opts.handle ? { $value: { source: opts.handle, path: String(optIdx) } } : intervalValue;
          const send = await call(
            `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSetShortlistScoutUpdateInterval&source=${encodeURIComponent(ps0.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
          );
          await new Promise(r => setTimeout(r, 250));
          const afterSel = await scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalSelected", ctx0, 800);
          return {
            ok: true,
            operationId: id,
            action,
            intervalValue,
            optionIndex: optIdx,
            beforeInterval: beforeSel.read?.value ?? null,
            afterInterval: afterSel.read?.value ?? null,
            eventName: "EventFmxSetShortlistScoutUpdateInterval",
            dispatch: send
          };
        }
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSetShortlistScoutUpdateInterval&source=human&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intervalValue) }
        );
        return { ok: true, operationId: id, action, intervalValue, eventName: "EventFmxSetShortlistScoutUpdateInterval", dispatch: send };
      });
    }
  };
}
