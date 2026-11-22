import { createLiveClient } from "./live-client.mjs";

// Generic read-only view for club-area panels (club info, finances, staff, fans, history).
// The caller supplies live property names; nothing about a save, club or league is baked in.
export function createClubStateTools(call) {
  const client = createLiveClient(call);
  async function context(args, perform) {
    return client.scope(async scope => {
      const root = args.root || "club";
      const human = { source: "human" };
      const team = await scope.subscribe("human", "Team");
      const teamRef = { source: team.handle };
      const contexts = { human, Human: human, team: teamRef, Team: teamRef };
      let source;
      if (root === "club") source = await scope.subscribe("human", "Club", contexts);
      else if (root === "team") source = team;
      else if (root === "tactic") source = (await scope.tactic()).tactic;
      else throw new Error("root 需要 club、team 或 tactic。");
      return perform(scope, source.handle, contexts);
    });
  }
  return {
    get: args => context(args, async (scope, handle, contexts) => {
      const names = Array.isArray(args.properties) ? args.properties : [];
      if (!names.length) throw new Error("提供要读取的实时属性名数组（例如 Stadium、FinanceStadium、FanHappiness、ClubReputation）。");
      const values = [];
      for (const name of names) {
        try {
          const opened = await scope.subscribe(handle, name, contexts);
          values.push({ property: name, value: opened.read.value });
        } catch (error) { values.push({ property: name, error: String(error.message || error) }); }
      }
      return { ok: true, root: args.root || "club", values, liveVerified: false };
    })
  };
}
