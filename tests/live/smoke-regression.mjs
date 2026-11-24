#!/usr/bin/env node
/**
 * tests/live/smoke-regression.mjs — 一键可复跑的 FM27 真机冒烟回归测试脚本。
 * 严格使用只读与完全可逆的小步写入验证：
 * 1. 本地 Bearer Token 鉴权（无 Token 必返回 401，带 Token 返回 200）；
 * 2. 生产模式防护（未授权开发诊断路由返回 403、非白名单内部事件被拦截）；
 * 3. 核心只读链路（capabilities / pre_match_briefing / squad_snapshot / league_table / set_piece_takers）；
 * 4. 确定性足球决策算法（optimize_best_xi / audit_squad_and_contracts）；
 * 5. 全局小妖搜索（search_players）与预设战术风格可逆往返切换（set_tactical_style）。
 *
 * 运行方式：node tests/live/smoke-regression.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthTokenProvider } from "../../mcp/core/auth.mjs";
import { createExtendedTools } from "../../mcp/extended-tools.mjs";
import { createInboxTools } from "../../mcp/inbox-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = (process.env.FM_ASSISTANT_URL || "http://127.0.0.1:27190").replace(/\/+$/, "");
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
  const hit = await H.search_players({ name: "Rui Araki" });
  if (!hit?.ok || hit.returnedCount < 1) throw new Error("未搜到 Rui Araki");
  const miss = await H.search_players({ name: "NoSuchPlayerXYZ999" });
  if (!miss?.ok || miss.returnedCount !== 0) throw new Error("不存在名字不应返回残留结果");
  return { hitName: hit.players[0].name, missCount: miss.returnedCount };
});

await runCheck("09_tactical_style_guard_or_roundtrip", async () => {
  const before = await H.set_tactical_style({});
  if (!before?.ok) throw new Error("读取预设战术风格失败");
  if (before.current?.hasActiveTactic) {
    // 已有活跃战术槽位：执行完整预设风格切换 + 还原可逆往返
    const origId = before.current.styleId || "0";
    const tempId = origId === "7" ? "1" : "7";
    const step1 = await H.set_tactical_style({ style: tempId });
    if (!step1?.verified) throw new Error("切换临时风格未验证生效");
    const step2 = await H.set_tactical_style({ style: origId });
    if (!step2?.verified) throw new Error("还原原战术风格未验证生效");
    return { mode: "active_tactic_roundtrip", origId, tempId, roundtripVerified: true };
  }
  // 当前存档尚未创建任何活跃战术（TacticalStyle=-1 / TacticalStyleDropdown=null）：
  // 1) 验证 JS 防死锁守卫拒绝写入并返回明确指引
  const guarded = await H.set_tactical_style({ style: "7" });
  if (guarded?.ok !== false || guarded?.blockedReason !== "no_active_tactic") {
    throw new Error(`空战术写入未被 JS 守卫拦截: ${JSON.stringify(guarded)}`);
  }
  // 2) 直接探测 C# 底层防死锁守卫（确保绕过 JS 时底层依然 400 拒绝且绝不卡死引擎）
  const openTeam = await call("/api/v1/live/properties?source=human&filter=Team");
  const teamProp = openTeam.properties.find(p => p.name.split(":")[0] === "Team");
  const tOpen = await call(`/api/v1/live/open?source=human&property=${teamProp.id}&contexts=${encodeURIComponent("{}")}`, { method: "POST" });
  let tacticHandle = null, ddHandle = null;
  try {
    await new Promise(r => setTimeout(r, 150));
    const tacProps = await call(`/api/v1/live/properties?source=${encodeURIComponent(tOpen.handle)}&filter=Tactic`);
    const tacProp = tacProps.properties.find(p => p.name.split(":")[0] === "Tactic");
    const tacOpen = await call(`/api/v1/live/open?source=${encodeURIComponent(tOpen.handle)}&property=${tacProp.id}&contexts=${encodeURIComponent(JSON.stringify({ Boolean: true }))}`, { method: "POST" });
    tacticHandle = tacOpen.handle;
    await new Promise(r => setTimeout(r, 150));
    const ddProps = await call(`/api/v1/live/properties?source=${encodeURIComponent(tacticHandle)}&filter=TacticalStyleDropdown`);
    const ddProp = ddProps.properties.find(p => p.name.split(":")[0] === "TacticalStyleDropdown");
    const ddOpen = await call(`/api/v1/live/open?source=${encodeURIComponent(tacticHandle)}&property=${ddProp.id}&contexts=${encodeURIComponent("{}")}`, { method: "POST" });
    ddHandle = ddOpen.handle;
    await new Promise(r => setTimeout(r, 150));
    const directRes = await rawFetch(`/api/v1/internal/update?handle=${encodeURIComponent(ddHandle)}&apply=true`, {
      method: "POST",
      body: JSON.stringify(7),
      withAuth: true
    });
    if (directRes.ok || directRes.status !== 400 || !String(directRes.json?.error || "").includes("no active tactic")) {
      throw new Error(`C# 底层空战术守卫应返回 400(no active tactic)，实际 ${directRes.status}: ${directRes.json?.error}`);
    }
    return {
      mode: "empty_tactic_deadlock_guard",
      jsBlockedReason: guarded.blockedReason,
      csharpGuardStatus: directRes.status,
      csharpGuardError: directRes.json?.error
    };
  } finally {
    if (ddHandle) await rawFetch(`/api/v1/live/close?handle=${encodeURIComponent(ddHandle)}`, { method: "POST", withAuth: true }).catch(() => {});
    if (tacticHandle) await rawFetch(`/api/v1/live/close?handle=${encodeURIComponent(tacticHandle)}`, { method: "POST", withAuth: true }).catch(() => {});
    await rawFetch(`/api/v1/live/close?handle=${encodeURIComponent(tOpen.handle)}`, { method: "POST", withAuth: true }).catch(() => {});
  }
});

await runCheck("10_set_piece_takers_default_attacking_read", async () => {
  const sp = await H.get_set_piece_takers({ setPieceType: 0, setPiecePitchSide: 0 });
  const side = sp.values?.find(v => v.property === "SetPieceTakerDataForSide")?.value?.fields?.["0x38435761"];
  if (!side || typeof side.count !== "number") throw new Error("无法读取进攻定位球主罚名单");
  return { takersCount: side.count };
});

await runCheck("11_news_read_state_reversible_roundtrip", async () => {
  // 真实走一等 C# 领域事件通道（Event 75 / Event 138 + choiceToken + operationId + 独立读回验证）
  const readInbox = createInboxTools(call);
  const box = await readInbox({ limit: 3, unreadOnly: false });
  const item0 = box.items?.[0];
  if (!item0?.targetIdentity) throw new Error("收件箱为空，无法测试已读状态往返");

  const st0 = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
  const origIsRead = Boolean(st0.isRead);
  const flipped = !origIsRead;

  await H.set_news_read_state({
    index: 0,
    expectedNewsIdentity: item0.targetIdentity,
    expectedChoiceToken: flipped ? st0.choiceToken : st0.unreadChoiceToken,
    isRead: flipped,
    operationId: `smoke_news_flip_${Date.now()}`
  });
  const st1 = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
  if (Boolean(st1.isRead) !== flipped) {
    throw new Error(`期望翻转后 isRead=${flipped}，独立读回为 ${st1.isRead}`);
  }

  await H.set_news_read_state({
    index: 0,
    expectedNewsIdentity: item0.targetIdentity,
    expectedChoiceToken: origIsRead ? st1.choiceToken : st1.unreadChoiceToken,
    isRead: origIsRead,
    operationId: `smoke_news_restore_${Date.now()}`
  });
  const st2 = await H.get_news_read_state({ index: 0, expectedNewsIdentity: item0.targetIdentity });
  if (Boolean(st2.isRead) !== origIsRead) {
    throw new Error(`期望还原后 isRead=${origIsRead}，独立读回为 ${st2.isRead}`);
  }

  return { title: item0.title, origIsRead, flipped, verifiedRoundtrip: true };
});

const summary = {
  generatedAt: new Date().toISOString(),
  total: checks.length,
  passed: checks.filter(c => c.passed).length,
  failed: checks.filter(c => !c.passed).length,
  checks
};

const reportPath = path.join(ROOT, "docs", "live-verification-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(`\nLIVE SMOKE SUMMARY: ${summary.passed}/${summary.total} passed -> ${reportPath}`);
if (summary.failed > 0) process.exit(1);
