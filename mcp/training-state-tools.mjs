import { createLiveClient } from "./live-client.mjs";

// Generic read-only view for training-area panels: the caller supplies live property names
// (e.g. TrainingIntensityOrRest, CoachAssignments, MatchPreparationSessions, TacticalIntensity)
// and this tool resolves them on the current team/training/tactic reference.
export function createTrainingStateTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const root = args.root || "training";
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      let source;
      if (root === "training") source = await scope.subscribe(team.handle, "TeamTraining", contexts);
      else if (root === "team") source = team;
      else if (root === "tactic") source = (await scope.tactic()).tactic;
      else throw new Error("root 需要 training、team 或 tactic。");
      return perform(scope, source.handle, contexts);
    });
  }
  return {
    get: args => context(args, async (scope, handle, contexts) => {
      const names = Array.isArray(args.properties) ? args.properties : [];
      if (!names.length) throw new Error("提供要读取的实时属性名数组（例如 CoachAssignments、MatchPreparationSessions、TrainingIntensityOrRest）。");
      const values = [];
      for (const name of names) {
        try {
          const opened = await scope.subscribe(handle, name, contexts);
          values.push({ property: name, value: opened.read.value });
        } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
      }
      return { ok: true, root: args.root || "training", values, liveVerified: false };
    })
  };
}
