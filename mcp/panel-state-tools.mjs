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
    },
    player: async (scope, args) => {
      const idx = Number.isInteger(args.squadIndex) ? args.squadIndex : 0;
      const human = { source: "human" };
      const club = await scope.subscribe("human", "Club", { human });
      const team = await scope.subscribe("human", "Team", { human });
      const clubRef = { source: club.handle };
      const teamRef = { source: team.handle };
      const players = await scope.subscribe(team.handle, "Players", { human, Human: human, team: teamRef, Team: teamRef });
      const count = players.read?.value?.count ?? (players.read?.value?.items?.length || 0);
      if (idx < 0 || idx >= count) throw new Error(`squadIndex 越界: ${idx} (共 ${count} 人)`);
      const pRef = { source: players.handle, path: String(idx) };
      return { handle: pRef, contexts: { human, Human: human, club: clubRef, Club: clubRef, team: teamRef, Team: teamRef, Person: pRef, InPossession: true } };
    }
  };
  return {
    get: args => client.scope(async scope => {
      const root = args.root || "human";
      if (!Object.hasOwn(roots, root)) throw new Error("root 需要 human、club、team、training、tactic 或 player（也可直接传 handle）。");
      const names = Array.isArray(args.properties) ? args.properties : [];
      if (!names.length) throw new Error("提供要读取的实时属性名数组（例如 HumanShortlists、HumanJobCentreCurrentAdverts、SquadPlanner、TransferRoomOfferedPlayers）。");
      const target = args.handle ? { handle: args.handle, contexts: {} } : await roots[root](scope, args);
      const contexts = { ...target.contexts, ...(args.contexts || {}) };
      const values = [];
      for (const name of names) {
        try {
          const opened = await scope.subscribe(target.handle, name, contexts);
          values.push({ property: name, value: opened.read.value });
          await scope.release(opened.handle);
        } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
      }
      return { ok: true, root, ...(root === "player" ? { squadIndex: args.squadIndex ?? 0 } : {}), values, liveVerified: false };
    })
  };
}
