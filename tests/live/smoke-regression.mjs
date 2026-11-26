#!/usr/bin/env node
/**
 * tests/live/smoke-regression.mjs — 一键可复跑的 FM27 真机冒烟回归测试脚本。
 * 默认严格只读模式（零写入副作用，绝不修改玩家存档状态）：
 *   1. 本地 Bearer Token 鉴权（无 Token 必返回 401，带 Token 返回 200）；
 *   2. 生产模式防护（未授权开发诊断路由返回 403、非白名单内部事件被拦截）；
 *   3. 核心只读链路（capabilities / pre_match_briefing / squad_snapshot / league_table / set_piece_takers / tactical_style 只读）；
 *   4. 确定性足球决策算法（optimize_best_xi / audit_squad_and_contracts）；
 *   5. 全局小妖搜索（search_players）与空查询防护。
 *
 * 有写入副作用的可逆用例（收件箱已读翻转、战术风格切换往返）仅在显式提供
 * `--allow-writes --disposable-save`（或设置 FM_LIVE_ALLOW_WRITES=1 且 FM_LIVE_DISPOSABLE_SAVE=1）
 * 时才启用，并且均在 try/finally 中强制尝试恢复并报告恢复结果。
 *
 * 运行方式：
 *   node tests/live/smoke-regression.mjs                                   # 默认严格只读
 *   node tests/live/smoke-regression.mjs --allow-writes --disposable-save  # 仅限可丢弃测试档
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthTokenProvider } from "../../mcp/core/auth.mjs";
import { createExtendedTools } from "../../mcp/extended-tools.mjs";
import { createInboxTools } from "../../mcp/inbox-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.FM_ASSISTANT_URL || "http://127.0.0.1:27190").replace(/\/+$/, "");
const argv = new Set(process.argv.slice(2));
const ALLOW_WRITES = argv.has("--allow-writes") || process.env.FM_LIVE_ALLOW_WRITES === "1";
const DISPOSABLE_SAVE = argv.has("--disposable-save") || process.env.FM_LIVE_DISPOSABLE_SAVE === "1";

if (ALLOW_WRITES && !DISPOSABLE_SAVE) {
  console.error("拒绝执行写入冒烟测试：开启 --allow-writes 时必须同时显式声明 --disposable-save，确认当前载入的是可丢弃测试存档。");
  process.exit(2);
}

const auth = createAuthTokenProvider();

async function rawFetch(endpoint, { method = "GET", body = null, withAuth = true } = {}) {
  const headers = {
    ...(withAuth ? auth.getAuthHeaders() : {}),
    ...(body != null ? { "Content-Type": "application/json" } : {})
  };
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function call(endpoint, opts = {}) {
  const r = await rawFetch(endpoint, { ...opts, withAuth: true });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.text.slice(0, 240)}`);
  return r.json ?? r.text;
}

const checks = [];
async function runCheck(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, passed: true, durationMs: Date.now() - t0, detail });
    console.log(`[PASS] ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    checks.push({ name, passed: false, durationMs: Date.now() - t0, error: err?.message || String(err) });
    console.error(`[FAIL] ${name}: ${err?.message || err}`);
  }
}

const H = createExtendedTools(call).handlers;

await runCheck("01_health_public_accessible", async () => {
  const r = await rawFetch("/health", { withAuth: false });
  if (r.status !== 200 || !r.json?.ok) throw new Error(`health failed: ${r.status}`);
  return { version: r.json.version, authRequired: r.json.authRequired, devMode: r.json.devMode };
});

await runCheck("02_security_unauthenticated_401", async () => {
  const r = await rawFetch("/api/v1/capabilities", { withAuth: false });
  if (r.status !== 401) throw new Error(`预期无 Token 返回 401，实际返回 ${r.status}`);
  return { status: r.status };
});

await runCheck("03_security_authenticated_capabilities", async () => {
  const cap = await call("/api/v1/capabilities");
  if (!cap?.ok || !cap?.security?.authRequired) throw new Error("capabilities 未返回预期安全状态");
  return { schemaVersion: cap.schemaVersion, devMode: cap.security.devMode, liveVerified: cap.currentBuildLiveGameplayVerified };
});

await runCheck("04_security_production_blocks_diag_and_non_allowlist_event", async () => {
  const health = (await rawFetch("/health", { withAuth: false })).json;
  if (health?.devMode) return { skipped: "devMode=true" };
  const diag = await rawFetch("/types", { withAuth: true });
  if (diag.status !== 403) throw new Error(`生产模式下 /types 应返回 403，实际 ${diag.status}`);
  const badEv = await rawFetch(`/api/v1/internal/event?id=smoke_bad_${Date.now()}&event=EventLoadQuickStart&source=none&apply=true`, {
    method: "POST", body: null, withAuth: true
  });
  if (badEv.ok) throw new Error("非白名单事件不应在生产模式下成功");
  return { diagStatus: diag.status, blockedEventStatus: badEv.status };
});

await runCheck("05_readonly_briefing_and_table", async () => {
  const brief = await H.get_pre_match_briefing({});
  if (!brief?.ok) throw new Error("get_pre_match_briefing 失败");
  const table = await H.get_league_table_and_fixtures({ fixtureLimit: 3 });
  if (!table?.ok) throw new Error("get_league_table_and_fixtures 失败");
  return { briefingBytes: Buffer.byteLength(JSON.stringify(brief)), tableOk: true };
});

await runCheck("06_algorithm_optimize_best_xi", async () => {
  const xi = await H.optimize_best_xi({});
  if (!xi?.ok || xi.startingXI?.length !== 11) throw new Error(`排阵失败: ${xi?.error}`);
  return { formation: xi.formation, totalScore: xi.totalScore, benchCount: xi.bench?.length };
});

await runCheck("07_algorithm_audit_squad_and_contracts", async () => {
  const audit = await H.audit_squad_and_contracts({});
  if (!audit?.ok || !audit.squadSize) throw new Error("阵容审计失败");
  return { squadSize: audit.squadSize, shortages: audit.shortages.length, bloated: audit.bloated.length };
});

await runCheck("08_search_players_global_and_empty_guard", async () => {
  // 动态取当前存档本队第 1 名球员的真实姓名测试搜索，避免写死某联赛球员名导致不同语言/数据库存档误报
  const sq = await H.get_squad_snapshot({ offset: 0, limit: 1, includeContractAndStars: false, includeAvailability: false });
  const targetName = sq?.players?.[0]?.name || "Mbappé";
  const hit = await H.search_players({ name: targetName });
  if (!hit?.ok || hit.returnedCount < 1) throw new Error(`未搜到目标球员 ${targetName}（status=${hit?.status}, err=${hit?.error || "none"}, total=${hit?.totalInDatabase ?? 0}）`);
  const miss = await H.search_players({ name: "NoSuchPlayerXYZ999" });
  if (!miss?.ok || miss.returnedCount !== 0) throw new Error("不存在名字不应返回残留结果");
  return { searchedName: targetName, hitName: hit.players[0].name, missCount: miss.returnedCount };
});

await runCheck("09_tactical_style_readonly_or_disposable_roundtrip", async () => {
  const before = await H.set_tactical_style({});
  if (!before?.ok) throw new Error("读取预设战术风格失败");
  if (!before.current?.hasActiveTactic) {
    // 空战术（无活跃槽位）：只读安全守卫探针，不产生任何游戏写入
    const guarded = await H.set_tactical_style({ style: "7" });
    if (guarded?.ok !== false || guarded?.blockedReason !== "no_active_tactic") {
      throw new Error(`空战术写入未被 JS 守卫拦截: ${JSON.stringify(guarded)}`);
    }
    return { mode: "empty_tactic_readonly_guard", jsBlockedReason: guarded.blockedReason };
  }
  if (!ALLOW_WRITES) {
    return {
      mode: "readonly_only",
      currentStyleId: before.current.styleId,
      optionCount: before.options?.length || 0,
      note: "默认只读模式不执行预设风格切换（切换预设可能重设球队指令），需写入验证请对可丢弃测试档传 --allow-writes --disposable-save。"
    };
  }
  // 仅在显式 --allow-writes --disposable-save 下执行，并用 try/finally 保证尝试恢复原风格
  const origId = before.current.styleId || "0";
  const tempId = origId === "7" ? "1" : "7";
  let switched = false;
  let recovery = { attempted: false, verified: false, error: null };
  let primaryError = null;
  try {
    const step1 = await H.set_tactical_style({ style: tempId });
    switched = true;
    if (!step1?.verified) throw new Error("切换临时风格未验证生效");
  } catch (err) {
    primaryError = err;
  } finally {
    if (switched) {
      recovery.attempted = true;
      try {
        const step2 = await H.set_tactical_style({ style: origId });
        recovery.verified = Boolean(step2?.verified);
      } catch (recErr) {
        recovery.error = recErr?.message || String(recErr);
      }
    }
  }
  if (primaryError) {
    throw new Error(`${primaryError.message}（恢复状态：${JSON.stringify(recovery)}）`);
  }
  if (!recovery.verified) {
    throw new Error(`还原原战术风格未验证生效（恢复状态：${JSON.stringify(recovery)}）`);
  }
  return { mode: "disposable_tactic_roundtrip", origId, tempId, recovery };
});

await runCheck("10_set_piece_takers_default_attacking_read", async () => {
  const sp = await H.get_set_piece_takers({ setPieceType: 0, setPiecePitchSide: 0 });
  const side = sp.values?.find(v => v.property === "SetPieceTakerDataForSide")?.value?.fields?.["0x38435761"];
  if (!side || typeof side.count !== "number") throw new Error("无法读取进攻定位球主罚名单");
  return { takersCount: side.count };
});

await runCheck("11_news_read_state_readonly_or_disposable_roundtrip", async () => {
  const readInbox = createInboxTools(call);
  const box = await readInbox({ limit: 3, unreadOnly: false });
  const item0 = box.items?.[0];
  if (!item0?.targetIdentity) throw new Error("收件箱为空，无法校验已读状态");
  const st0 = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
  const origIsRead = Boolean(st0.isRead);
  if (!ALLOW_WRITES) {
    return {
      mode: "readonly_only",
      title: item0.title,
      origIsRead,
      note: "默认只读模式不翻转收件箱已读状态；需写入验证请对可丢弃测试档传 --allow-writes --disposable-save。"
    };
  }

  const flipped = !origIsRead;
  let mutated = false;
  let recovery = { attempted: false, verified: false, error: null };
  let primaryError = null;
  try {
    await H.set_news_read_state({
      index: 0,
      expectedNewsIdentity: item0.targetIdentity,
      expectedChoiceToken: flipped ? st0.choiceToken : st0.unreadChoiceToken,
      isRead: flipped,
      operationId: `smoke_news_flip_${Date.now()}`
    });
    mutated = true;
    const st1 = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
    if (Boolean(st1.isRead) !== flipped) {
      throw new Error(`期望翻转后 isRead=${flipped}，独立读回为 ${st1.isRead}`);
    }
  } catch (err) {
    primaryError = err;
  } finally {
    if (mutated) {
      recovery.attempted = true;
      try {
        const stCur = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
        if (Boolean(stCur.isRead) !== origIsRead) {
          await H.set_news_read_state({
            index: 0,
            expectedNewsIdentity: item0.targetIdentity,
            expectedChoiceToken: origIsRead ? stCur.choiceToken : stCur.unreadChoiceToken,
            isRead: origIsRead,
            operationId: `smoke_news_restore_${Date.now()}`
          });
        }
        const stAfter = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
        recovery.verified = Boolean(stAfter.isRead) === origIsRead;
      } catch (recErr) {
        recovery.error = recErr?.message || String(recErr);
      }
    }
  }
  if (primaryError) {
    throw new Error(`${primaryError.message}（恢复状态：${JSON.stringify(recovery)}）`);
  }
  if (!recovery.verified) {
    throw new Error(`还原收件箱已读状态未验证生效（恢复状态：${JSON.stringify(recovery)}）`);
  }
  return { mode: "disposable_news_roundtrip", title: item0.title, origIsRead, flipped, recovery };
});

const summary = {
  generatedAt: new Date().toISOString(),
  mode: ALLOW_WRITES ? "allow_writes_disposable_save" : "strict_readonly",
  total: checks.length,
  passed: checks.filter(c => c.passed).length,
  failed: checks.filter(c => !c.passed).length,
  checks
};

const reportPath = path.join(ROOT, "docs", "live-verification-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(`\nLIVE SMOKE SUMMARY (${summary.mode}): ${summary.passed}/${summary.total} passed -> ${reportPath}`);
if (summary.failed > 0) process.exit(1);
