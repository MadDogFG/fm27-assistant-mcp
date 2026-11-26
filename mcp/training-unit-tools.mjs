import { createLiveClient } from "./live-client.mjs";

export function createTrainingUnitTools(call) {
  const client = createLiveClient(call);
  return {
    get: () => client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      const channels = {};
      for (const property of ["AttackingUnit", "DefensiveUnit", "MidfieldUnit", "GoalkeepingUnit"])
        channels[property] = (await scope.subscribe(training.handle, property, contexts)).handle;
      return scope.api("/api/v1/training-management/units", { team: team.handle, training: training.handle, channels });
    }),
    // Review #25: FM27 已调整旧版训练 Units 系统；当前构建缺失手动调组的合法原生 offered action，
    // 禁止空参默认写入或向 EventFmxConfirmTrainingFocusChanges 派发自组载荷，仅保留 get_training_unit_summaries 只读
    manageMembership: async ({ squadIndex, unit, action, operationId } = {}) => {
      const validUnits = ["attacking", "defensive", "midfield", "goalkeeping"];
      if (!unit || !validUnits.includes(unit)) {
        throw new Error(`必须明确指定训练单元 unit（支持 ${validUnits.join("/")}）。`);
      }
      if (!action || !["add", "remove"].includes(action)) {
        throw new Error("必须明确指定分组动作 action（支持 add/remove）。");
      }
      if (!Number.isInteger(squadIndex) || squadIndex < 0) {
        throw new Error("必须提供有效的非负整数 squadIndex。");
      }
      return {
        ok: false,
        blocked: true,
        unsupportedInFm27: true,
        operationId: operationId || null,
        squadIndex,
        unit,
        action,
        reason: "FM27 已调整旧版训练 Units 手动分组机制，当前插件未验证可核对成员变更的合法原生调组事务（已拦截无依据的自组载荷派发）。只读查看请调用 get_training_unit_summaries。",
        zeroDispatches: true
      };
    }
  };
}
