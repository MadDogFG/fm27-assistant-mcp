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
    // TRN-O25a/b: 手动将指定球员移入或移出训练分组单元（Attacking/Defensive/Midfield/Goalkeeping）
    manageMembership: async ({ squadIndex = 0, unit = "attacking", action = "add", operationId } = {}) => {
      const unitMap = {
        attacking: "AttackingUnit",
        defensive: "DefensiveUnit",
        midfield: "MidfieldUnit",
        goalkeeping: "GoalkeepingUnit"
      };
      const unitProp = unitMap[unit];
      if (!unitProp) throw new Error(`未知训练单元: ${unit}（支持 attacking/defensive/midfield/goalkeeping）`);
      if (!["add", "remove"].includes(action)) throw new Error(`未知分组动作: ${action}（支持 add/remove）`);
      if (!Number.isInteger(squadIndex) || squadIndex < 0) throw new Error("squadIndex 必须为非负整数。");
      const id = operationId || `unit_${action}_${unit}_${Date.now()}`;
      return client.scope(async scope => {
        const team = await scope.subscribe("human", "Team");
        const human = { source: "human" }, teamRef = { source: team.handle };
        const contexts = { Human: human, human, Team: teamRef, team: teamRef };
        const players = await scope.subscribe(team.handle, "Players", contexts);
        const count = players.read?.value?.count ?? 0;
        if (squadIndex >= count) throw new Error(`squadIndex 越界: ${squadIndex} >= ${count}`);
        const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
        const unitSub = await scope.subscribe(training.handle, unitProp, contexts);
        // 使用合法的 InteropReference（training.handle）派发训练焦点与分组变更事件
        const send = await call(
          `/api/v1/internal/event?id=${encodeURIComponent(id)}&event=EventFmxConfirmTrainingFocusChanges&source=${encodeURIComponent(training.handle)}&apply=true`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, unit, playerIndex: squadIndex }) }
        );
        return { ok: true, operationId: id, action, unit, unitProp, squadIndex, dispatch: send };
      });
    }
  };
}
