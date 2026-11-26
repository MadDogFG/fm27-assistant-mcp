import { randomUUID } from "node:crypto";
import { createLiveClient, scalar } from "./live-client.mjs";

// 训练教练分工管理（Review #26：枚举每个教练当前实际暴露的训练类别及 CanEdit，明确区分实测类别与已知候选常量）
export function createTrainingManagementTools(call) {
  const client = createLiveClient(call);
  async function context(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      const assignments = await scope.subscribe(training.handle, "CoachAssignments", contexts);
      const rows = await scope.subscribe(assignments.handle, "Assignments", contexts);
      if (args.operation === undefined) return { ok: true, assignments: rows.read.value,
        operations: ["assistant_assign", "clear"], liveVerified: false };
      if (!["assistant_assign", "clear"].includes(args.operation)) throw new Error("operation需要assistant_assign或clear。");
      const query = { operation: args.operation, team: team.handle, training: training.handle,
        assignments: assignments.handle, rows: rows.handle };
      const preview = await scope.api("/api/v1/training-management/coach-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("教练分工已变化，请重新预览。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/training-management/coach-execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", verified: false, retrySafe: false, error: String(error.message || error) }; }
    });
  }

  const KNOWN_CATEGORY_CANDIDATES = [
    "AttackingTacticalCategory", "AttackingTechnicalCategory", "DefendingTacticalCategory", "DefendingTechnicalCategory",
    "PossessionTacticalCategory", "PossessionTechnicalCategory", "GoalkeepingCategory", "FitnessCategory", "SetPiecesCategory"
  ];

  async function categoryContext(args, execute) {
    return client.scope(async scope => {
      const team = await scope.subscribe("human", "Team");
      const human = { source: "human" }, teamRef = { source: team.handle };
      const contexts = { Human: human, human, Team: teamRef, team: teamRef };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      const assignments = await scope.subscribe(training.handle, "CoachAssignments", contexts);
      const rows = await scope.subscribe(assignments.handle, "Assignments", contexts);

      if (args.coachPath === undefined) {
        const items = rows.read?.value?.items || [];
        // Review #26: 探测每个教练行实际暴露的类别属性及 CanEdit/IsAssigned（最多前 12 名教练防耗时过高）
        const coachCapabilities = [];
        for (let i = 0; i < Math.min(items.length, 12); i++) {
          const coachRef = { source: rows.handle, path: String(i) };
          const props = await scope.properties(coachRef, "Category").catch(() => []);
          const propNames = new Set(props.map(p => p.name.split(":")[0]));
          const exposed = KNOWN_CATEGORY_CANDIDATES.filter(c => propNames.has(c));
          const details = [];
          for (const cat of exposed) {
            const cSub = await scope.subscribeOptional(coachRef, cat, contexts, 400);
            if (!cSub.handle) {
              details.push({ category: cat, available: false });
              continue;
            }
            const [assR, editR] = await Promise.all([
              scope.readAndRelease(cSub.handle, "IsAssigned", contexts, 350),
              scope.readAndRelease(cSub.handle, "CanEdit", contexts, 350)
            ]);
            await scope.release(cSub.handle);
            details.push({
              category: cat,
              available: true,
              isAssigned: assR.scalar === "True" ? true : (assR.scalar === "False" ? false : null),
              canEdit: editR.scalar === "True" ? true : (editR.scalar === "False" ? false : null)
            });
          }
          coachCapabilities.push({
            coachPath: String(i),
            identity: items[i]?.identity || null,
            observedCategories: details
          });
        }
        return {
          ok: true,
          readOnly: true,
          coaches: rows.read.value,
          coachCapabilities,
          knownCategoryCandidates: KNOWN_CATEGORY_CANDIDATES,
          categories: KNOWN_CATEGORY_CANDIDATES,
          categoryNote: "knownCategoryCandidates 仅为 FM27 已知字段名候选，实际可分工类别与 CanEdit 权限请以 coachCapabilities[].observedCategories 为准。",
          liveVerified: false
        };
      }

      if (typeof args.coachPath !== "string" || !args.coachPath || !KNOWN_CATEGORY_CANDIDATES.includes(args.category))
        throw new Error("从原教练列表选择coachPath与合法category。");
      if (execute && typeof args.assigned !== "boolean") throw new Error("assigned必须是明确的分配/取消布尔意图。");
      const source = await scope.subscribe({ source: rows.handle, path: args.coachPath }, args.category, contexts);
      const current = await scope.subscribe(source.handle, "IsAssigned", contexts);
      const editable = await scope.subscribe(source.handle, "CanEdit", contexts);
      const eventData = await scope.subscribe(source.handle, "EventData", contexts);
      const query = { team: team.handle, training: training.handle, assignments: assignments.handle, rows: rows.handle,
        coachPath: args.coachPath, category: args.category, categorySource: source.handle, current: current.handle,
        editable: editable.handle, eventData: eventData.handle, assigned: args.assigned ?? true };
      const preview = await scope.api("/api/v1/training-management/category-preview", query);
      if (!execute) return preview;
      if (!args.expectedChoiceToken || preview.choiceToken !== args.expectedChoiceToken) throw new Error("教练分工或可编辑状态已改变，请重新预览。");
      const id = args.operationId || randomUUID();
      try { return await scope.api("/api/v1/training-management/category-execute", { ...query, id, choiceToken: preview.choiceToken }, true); }
      catch (error) { return { ok: false, operationId: id, status: "transport_result_unknown", verified: false, retrySafe: false, error: String(error.message || error) }; }
    });
  }
  return { get: args => context(args, false), change: args => context(args, true),
    getCategory: args => categoryContext(args, false), setCategory: args => categoryContext(args, true) };
}
