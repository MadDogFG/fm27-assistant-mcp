import { createLiveClient } from "./live-client.mjs";

// Team training intensity: resolves human.Team -> TeamTraining, then TrainingIntensities (candidates)
// and TrainingIntensitySettingsForConditionRanges (current). Dispatch uses the current build's SetTrainingIntensity event.
export function createTeamTrainingIntensityTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const conditionRange = args.conditionRange === undefined ? 0 : args.conditionRange;
      if (!Number.isInteger(conditionRange) || conditionRange < 0 || conditionRange > 4) throw new Error("conditionRange 必须为 0 到 4 的整数。");
      const contexts = { human, Human: human, team: { source: team.handle }, Team: { source: team.handle },
        ConditionRange: conditionRange };
      const training = await scope.subscribe(team.handle, "TeamTraining", contexts);
      const options = await scope.subscribe(training.handle, "TrainingIntensities", contexts);
      const selected = await scope.subscribe(training.handle, "TrainingIntensitySettingsForConditionRanges", contexts);
      const query = { training: training.handle, selected: selected.handle, options: options.handle, optionPath: args.optionPath,
        operationId: args.operationId };
      if (args.optionPath === undefined) return perform(scope, query, { candidates: options.read.value }, false);
      return perform(scope, query, {}, true);
    });
  }
  return {
    get: args => context(args, async (scope, query, values, complete) => complete
      ? { ...await scope.api("/api/v1/team-training/intensity-preview", query), draftOnly: true, liveVerified: false }
      : { ok: true, ...values, ...await scope.api("/api/v1/team-training/intensity-state", query), draftOnly: true, liveVerified: false }),
    set: args => {
      if (!args.optionPath || !args.operationId || !args.expectedChoiceToken) throw new Error("提供 intensity 候选 optionPath、token 与固定 operationId。");
      return context(args, async (scope, query) => {
        const preview = await scope.api("/api/v1/team-training/intensity-preview", query);
        if (preview.choiceToken !== args.expectedChoiceToken) throw new Error("训练强度候选或当前值变化，请重新预览。");
        return { ...await scope.api("/api/v1/team-training/intensity-execute", { ...query, id: args.operationId, choiceToken: args.expectedChoiceToken }, true),
          intensityApplied: false };
      });
    }
  };
}
