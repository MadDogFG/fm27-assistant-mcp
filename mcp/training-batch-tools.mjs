import { createTrainingTools } from "./training-tools.mjs";
import { createLiveClient } from "./live-client.mjs";

// A batch is a sequence of normal player-training commands, not an atomic game edit.
export function createTrainingBatchTools(call) {
  const single = createTrainingTools(call), client = createLiveClient(call);
  function validate(args, writing) {
    if (!Array.isArray(args.players) || args.players.length < 1 || args.players.length > 50)
      throw new Error("players需要1..50个实际球员引用与训练选择。");
    const ids = new Set();
    for (const player of args.players) {
      if ((!player.source && !Number.isInteger(player.squadIndex)) || !["intensity", "focus", "position-role", "oop-role"].includes(player.kind))
        throw new Error("每名球员需要实际source（或squadIndex）与训练kind。");
      if (writing) {
        if (!player.expectedChoiceToken || !player.expectedCurrent || !Number.isInteger(player.optionIndex) || player.optionIndex < 0 ||
            typeof player.operationId !== "string" || !player.operationId.trim() || player.operationId.length > 100 || ids.has(player.operationId))
          throw new Error("批量操作的每项必须有原预览token/current、optionIndex与不重复的固定operationId。");
        ids.add(player.operationId);
      }
    }
  }
  async function get(args) {
    validate(args, false);
    const results = [];
    for (let index = 0; index < args.players.length; index++) {
      try { results.push({ index, ...await single.get(args.players[index]) }); }
      catch (error) { results.push({ index, ok: false, error: String(error.message || error) }); }
    }
    return { ok: true, results, liveVerified: false };
  }
  async function set(args) {
    validate(args, true);
    const results = [];
    for (let index = 0; index < args.players.length; index++) {
      const player = args.players[index];
      try {
        const lookup = await client.api("/api/v1/game/continue-receipt", { id: player.operationId });
        if (typeof lookup.found !== "boolean") throw new Error("请求历史查询不明确。");
        if (lookup.found) {
          return { ok: false, status: "stopped_existing_request", stoppedAt: index, results,
            previousReceipt: lookup.receipt, operationId: player.operationId, retrySafe: false,
            note: "该项已有历史；本批没有重发。请只读查询原请求，未执行后续球员。" };
        }
        const receipt = await single.set(player);
        results.push({ index, receipt });
        if (!receipt.verified) return { ok: false, status: "stopped_unverified_item", stoppedAt: index, results,
          retrySafe: false, note: "保留各项请求号查询；后续球员尚未执行，不重发本批。" };
      } catch (error) {
        return { ok: false, status: "stopped_item_error", stoppedAt: index, operationId: player.operationId, results,
          error: String(error.message || error), retrySafe: false };
      }
    }
    return { ok: true, status: "all_item_configurations_observed", results, atomic: false, liveVerified: false };
  }
  return { get, set };
}
