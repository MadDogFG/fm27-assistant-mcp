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
    // REC-O08c (Review #35): 球探中心报告读取与严格按报告身份及独立动作通道处理
    scoutingCentreReport: async ({ action = "read", reportIndex, expectedReportIdentity, durationDays, operationId } = {}) => {
      if (!["read", "acknowledge", "request_update", "keep_scouting"].includes(action)) {
        throw new Error(`未知球探报告动作: ${action}（支持 read/acknowledge/request_update/keep_scouting）`);
      }
      if (reportIndex !== undefined && (!Number.isInteger(reportIndex) || reportIndex < 0)) {
        throw new Error("reportIndex 必须为非负整数。");
      }
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const ctx = { human: { source: "human" }, Human: { source: "human" }, team: { source: team.handle }, Team: { source: team.handle } };
        const sca = await scope.subscribe("human", "ScoutingCentreActions", ctx);
        const [itemsSub, keepAct, scoutAct, counts] = await Promise.all([
          scope.subscribeOptional(sca.handle, "Items", ctx, 1000),
          scope.subscribeOptional(sca.handle, "KeepScoutingAction", ctx, 1000),
          scope.subscribeOptional(sca.handle, "ScoutPlayerAction", ctx, 1000),
          scope.subscribeOptional(sca.handle, "ScoutingCentreCounts", ctx, 1000)
        ]);
        const rawItems = itemsSub.read?.value?.items || [];
        const reportSummaries = rawItems.map((it, idx) => ({
          index: idx,
          identity: it?.identity || it?.fields?.["0x69642020"]?.value || null,
          type: it?.type || null
        }));
        if (action === "read") {
          return {
            ok: true,
            readOnly: true,
            reportCount: itemsSub.read?.value?.count ?? rawItems.length,
            reports: reportSummaries,
            items: itemsSub.read?.value ?? null,
            counts: counts.read?.value ?? null,
            keepScoutingDefault: keepAct.read?.value ?? null,
            scoutPlayerDefault: scoutAct.read?.value ?? null
          };
        }

        // 写操作必须唯一绑定具体报告（多份报告时不可省略 reportIndex / expectedReportIdentity）
        const totalReports = itemsSub.read?.value?.count ?? rawItems.length;
        if (totalReports === 0) {
          return { ok: false, blocked: true, reason: "球探中心当前没有待处理报告，已拒绝派发。", zeroDispatches: true };
        }
        let targetIdx = reportIndex;
        if (expectedReportIdentity) {
          const byId = reportSummaries.findIndex(r => r.identity === expectedReportIdentity);
          if (byId < 0) {
            return {
              ok: false,
              blocked: true,
              reason: `球探中心报告列表已变化，未找到身份为 "${expectedReportIdentity}" 的报告，已拒绝派发。`,
              expectedReportIdentity,
              reports: reportSummaries,
              zeroDispatches: true
            };
          }
          if (targetIdx !== undefined && targetIdx !== byId) {
            return {
              ok: false,
              blocked: true,
              reason: `reportIndex=${targetIdx} 与 expectedReportIdentity 实际所在位置(${byId})不匹配，已拒绝派发。`,
              zeroDispatches: true
            };
          }
          targetIdx = byId;
        } else if (totalReports > 1 && targetIdx === undefined) {
          return {
            ok: false,
            blocked: true,
            reason: `当前球探中心存在 ${totalReports} 份报告，必须指定 reportIndex 或 expectedReportIdentity 才能操作，已拒绝盲写。`,
            reports: reportSummaries,
            zeroDispatches: true
          };
        } else if (targetIdx === undefined) {
          targetIdx = 0;
        }
        if (targetIdx < 0 || targetIdx >= totalReports) {
          throw new Error(`reportIndex 越界: ${targetIdx} >= ${totalReports}`);
        }
        const matchedReport = reportSummaries[targetIdx] || { index: targetIdx, identity: null };
        const id = operationId || `scouting_centre_${action}_${Date.now()}`;

        if (action === "acknowledge") {
          if (totalReports > 1 && !expectedReportIdentity) {
            return {
              ok: false,
              blocked: true,
              reason: "多份球探报告并存时，原生 EventFmxScoutingCentreAcknowledge(null) 无法保证仅确认单份报告，请提供 expectedReportIdentity 或使用单人菜单。",
              reports: reportSummaries,
              zeroDispatches: true
            };
          }
          const send = await call(
            `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxScoutingCentreAcknowledge&source=${encodeURIComponent(sca.handle)}&apply=true`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(null) }
          );
          return { ok: true, status: "dispatched_unverified", operationId: id, action, targetReport: matchedReport, eventName: "EventFmxScoutingCentreAcknowledge", dispatch: send };
        }

        // request_update vs keep_scouting 必须走各自独立通道并显式提供 durationDays，严禁两者在省略参数时发出完全相同的 (sca, 7)
        const targetProp = action === "keep_scouting" ? keepAct : scoutAct;
        const propName = action === "keep_scouting" ? "KeepScoutingAction" : "ScoutPlayerAction";
        if (!Number.isInteger(durationDays) || durationDays < 1) {
          return {
            ok: false,
            blocked: true,
            reason: `执行 ${action} 必须明确指定正整数 durationDays，禁止省略参数回退为无区分默认值。`,
            targetReport: matchedReport,
            zeroDispatches: true
          };
        }
        if (!targetProp.handle) {
          return {
            ok: false,
            blocked: true,
            reason: `球探中心当前未暴露 ${propName} 动作通道，无法将 "${action}" 与另一动作区分送入游戏，已拒绝派发；请改用 get_player_actions + execute_player_action 对具体球员发起球探指令。`,
            targetReport: matchedReport,
            zeroDispatches: true
          };
        }
        if (totalReports > 1 && !matchedReport.identity) {
          return {
            ok: false,
            blocked: true,
            reason: "多份报告存在且无法确认目标报告稳定身份，已拒绝向球探中心广播响应事件；请对目标球员使用 get_player_actions + execute_player_action。",
            reports: reportSummaries,
            zeroDispatches: true
          };
        }
        const upd = await call(
          `/api/v1/internal/update?handle=${encodeURIComponent(targetProp.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(durationDays) }
        );
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxScoutingCentreResponse&source=${encodeURIComponent(sca.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ $value: { source: targetProp.handle } }) }
        );
        return {
          ok: true,
          status: "dispatched_unverified",
          operationId: id,
          action,
          actionChannel: propName,
          targetReport: matchedReport,
          durationDays,
          eventName: "EventFmxScoutingCentreResponse",
          update: upd,
          dispatch: send
        };
      });
    },
    // REC-O06b/c / REC-O07a / REC-O31 (Review #36): 读取可考察赛事与地区树、球探覆盖范围与短名单更新周期；
    // set_interval 仅接受原生合法选项列表中唯一匹配的选项值，非法/缺失/重复/通道未就绪一律零写入
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
          const ctx0 = { ...ctx, Type: 0, type: 0 };
          const ps0 = await scope.subscribeOptional("human", "HumanPersonSearch", ctx0, 1000);
          let shortlistScoutingInterval = null;
          if (ps0.handle) {
            const [curSel, opts] = await Promise.all([
              scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalSelected", ctx0, 800),
              scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalOptionsList", ctx0, 800)
            ]);
            const parsedOpts = (opts.read?.value?.items || []).map((x, idx) => ({
              optionIndex: idx,
              value: x?.fields?.["0x7074766c"]?.value ?? null,
              label: x?.fields?.["0x71764a36"]?.value ?? x?.fields?.["0x5374726e"]?.value ?? null
            }));
            shortlistScoutingInterval = {
              available: Boolean(opts.handle),
              current: curSel.read?.value ?? null,
              options: parsedOpts
            };
          }
          return {
            ok: true,
            readOnly: true,
            scoutingRange: range.read?.value ?? null,
            scoutingBudget: budget.read?.value ?? null,
            validRanges: ranges.read?.value ?? null,
            possibleAreas: areas.read?.value ?? null,
            shortlistScoutingInterval
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
        // set_interval (REC-O31, Review #36): 严禁非法值回退第 0 项，严禁选项通道缺失时退回发送裸整数
        if (!Number.isInteger(intervalValue) || intervalValue < 0) throw new Error("intervalValue 必须为非负整数（取自 action='read' 返回的合法选项 value）。");
        const ctx0 = { ...ctx, Type: 0, type: 0 };
        const ps0 = await scope.subscribeOptional("human", "HumanPersonSearch", ctx0, 1200);
        if (!ps0.handle) {
          return {
            ok: false,
            blocked: true,
            reason: "HumanPersonSearch(Type=0) 通道未就绪，无法读取短名单球探更新周期合法选项，已拒绝发送裸整数。",
            zeroDispatches: true
          };
        }
        const [beforeSel, opts] = await Promise.all([
          scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalSelected", ctx0, 800),
          scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalOptionsList", ctx0, 800)
        ]);
        if (!opts.handle || !Array.isArray(opts.read?.value?.items) || opts.read.value.items.length === 0) {
          return {
            ok: false,
            blocked: true,
            reason: "ShortlistScoutingIntervalOptionsList 不可用或为空，已拒绝盲写更新周期。",
            zeroDispatches: true
          };
        }
        const parsedOpts = opts.read.value.items.map((x, idx) => ({
          optionIndex: idx,
          value: x?.fields?.["0x7074766c"]?.value ?? null,
          label: x?.fields?.["0x71764a36"]?.value ?? x?.fields?.["0x5374726e"]?.value ?? null
        }));
        const exactMatches = parsedOpts.filter(o => o.value !== null && String(o.value) === String(intervalValue));
        if (exactMatches.length !== 1) {
          return {
            ok: false,
            blocked: true,
            reason: exactMatches.length === 0
              ? `intervalValue=${intervalValue} 不是当前游戏合法的短名单球探更新周期选项，已拒绝写入（合法选项：${parsedOpts.map(o => `${o.value}:${o.label}`).join(" / ")}）。`
              : `intervalValue=${intervalValue} 匹配到多个重复选项，已拒绝写入。`,
            availableOptions: parsedOpts,
            zeroDispatches: true
          };
        }
        const matchedOpt = exactMatches[0];
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxSetShortlistScoutUpdateInterval&source=${encodeURIComponent(ps0.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ $value: { source: opts.handle, path: String(matchedOpt.optionIndex) } }) }
        );
        await new Promise(r => setTimeout(r, 250));
        const afterSel = await scope.subscribeOptional(ps0.handle, "ShortlistScoutingIntervalSelected", ctx0, 800);
        const afterVal = afterSel.read?.value ?? null;
        const afterNativeVal = afterVal?.fields?.["0x7074766c"]?.value ?? afterVal?.value ?? null;
        return {
          ok: true,
          operationId: id,
          action,
          requestedIntervalValue: intervalValue,
          selectedOption: matchedOpt,
          beforeInterval: beforeSel.read?.value ?? null,
          afterInterval: afterVal,
          verified: afterNativeVal !== null && String(afterNativeVal) === String(matchedOpt.value),
          eventName: "EventFmxSetShortlistScoutUpdateInterval",
          dispatch: send
        };
      });
    }
  };
}
