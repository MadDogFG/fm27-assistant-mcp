import { createLiveClient } from "./live-client.mjs";

// 只读比赛状态聚合：播放/阶段/模拟/活动/战术草稿。高级统计与赛事报告请调用内置的 get_match_analytics / get_past_match_report。
export function createMatchReadTools(call, readMatchState) {
  const client = createLiveClient(call);
  const attempt = async (read, name) => {
    try { return { name, ok: true, value: await read() }; }
    catch (error) { return { name, ok: false, error: String(error.message || error).slice(0, 300) }; }
  };
  return {
    get: args => client.scope(async scope => {
      const parts = [];
      parts.push(await attempt(() => readMatchState({ includeScore: true, operationId: args.operationId }), "state"));
      parts.push(await attempt(() => scope.api("/api/v1/match/simulation-state"), "simulation"));
      parts.push(await attempt(() => scope.api("/api/v1/match/activity-state", { mutationCursor: Number.isInteger(args.mutationCursor) ? args.mutationCursor : -1 }), "activity"));
      if (args.tactic) {
        parts.push(await attempt(() => scope.api("/api/v1/match/draft-state", { tactic: args.tactic, pending: args.pending || "" }), "draft"));
        if (args.waiting) parts.push(await attempt(() => scope.api("/api/v1/match/stage-state", { waiting: args.waiting, tactic: args.tactic, pending: args.pending || "", managerSide: String(args.managerSide === true) }), "stage"));
      }
      return { ok: true, parts, dispatched: false, liveVerified: false,
        advanced: "xG、射门、传球与历史比赛事件详情请使用插件内置工具 get_match_analytics 或 get_past_match_report。" };
    })
  };
}
