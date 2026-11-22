import { createLiveClient } from "./live-client.mjs";

// Generic read-only panel reader for 招募/经理中心/阵容 style screens. The caller supplies
// the live reference root and the game property names; no club, league, save or player is
// ever baked in. Missing properties are reported per property instead of failing the call.
export function createPanelStateTools(call) {
  const client = createLiveClient(call);
  const roots = {
    human: async scope => ({ handle: "human", contexts: { human: { source: "human" } } }),
    club: async scope => {
      const human = { source: "human" };
      return { handle: (await scope.subscribe("human", "Club", { human })).handle, contexts: { human, Human: human } };
    },
    team: async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const teamRef = { source: team.handle };
      return { handle: team.handle, contexts: { human, Human: human, team: teamRef, Team: teamRef } };
    },
    training: async scope => {
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const teamRef = { source: team.handle };
      return { handle: (await scope.subscribe(team.handle, "TeamTraining", { human, Human: human, team: teamRef, Team: teamRef })).handle, contexts: { human, Human: human, team: teamRef, Team: teamRef } };
    },
    tactic: async scope => {
      const { tactic } = await scope.tactic();
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const teamRef = { source: team.handle };
      return { handle: tactic.handle, contexts: { human, Human: human, team: teamRef, Team: teamRef } };
    }
  };
  return {
    get: args => client.scope(async scope => {
      const root = args.root || "human";
      if (!Object.hasOwn(roots, root)) throw new Error("root 需要 human、club、team、training 或 tactic（也可直接传 handle）。");
      const names = Array.isArray(args.properties) ? args.properties : [];
      if (!names.length) throw new Error("提供要读取的实时属性名数组（例如 HumanShortlists、HumanJobCentreCurrentAdverts、SquadPlanner、TransferRoomOfferedPlayers）。");
      const target = args.handle ? { handle: args.handle, contexts: {} } : await roots[root](scope);
      const contexts = { ...target.contexts, ...(args.contexts || {}) };
      const values = [];
      for (const name of names) {
        try {
          const opened = await scope.subscribe(target.handle, name, contexts);
          values.push({ property: name, value: opened.read.value });
        } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
      }
      return { ok: true, root, values, liveVerified: false };
    })
  };
}
