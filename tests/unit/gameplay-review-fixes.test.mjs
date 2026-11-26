/**
 * tests/unit/gameplay-review-fixes.test.mjs — 第二轮玩法/逻辑 Review（15–54 项）全覆盖离线回归测试。
 * 纯模拟后端与真实 MCP stdio 网关验收，零外部依赖、不启动 FM27。
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createInboxTools } from "../../mcp/inbox-tools.mjs";
import { createInboxFlagsAndPromisesTools } from "../../mcp/inbox-flags-and-promises-tools.mjs";
import { createManagerCareerTools } from "../../mcp/manager-career-tools.mjs";
import { createManagerHolidayTools } from "../../mcp/manager-holiday-tools.mjs";
import { createTacticSlotTools } from "../../mcp/tactic-slot-tools.mjs";
import { createTrainingUnitTools } from "../../mcp/training-unit-tools.mjs";
import { createYouthAndMedicalTools } from "../../mcp/youth-and-medical-tools.mjs";
import { createSquadPlannerTools } from "../../mcp/squad-planner-tools.mjs";
import { createRecruitmentLifecycleTools } from "../../mcp/recruitment-lifecycle-tools.mjs";
import { createWorkPermitAndTrialTools } from "../../mcp/work-permit-and-trial-tools.mjs";
import { createDatahubAndTransferRoomTools } from "../../mcp/datahub-and-transfer-room-tools.mjs";
import { createClubAffiliateTools } from "../../mcp/club-affiliate-tools.mjs";
import { createMlsAndNegotiationAdviceTools } from "../../mcp/mls-and-negotiation-advice-tools.mjs";
import { createSquadSnapshotTools } from "../../mcp/squad-snapshot-tools.mjs";
import { createBestXiTools, solveBestXi, parsePositionTags, parseWageDetails } from "../../mcp/algorithms/best-xi.mjs";
import { createSquadAuditTools, analyzeSquadAndContracts } from "../../mcp/algorithms/squad-audit.mjs";
import { createPlayerSearchFilterTools } from "../../mcp/player-search-filter-tools.mjs";
import { createMatchAnalyticsTools } from "../../mcp/match-analytics-tools.mjs";
import { createPastMatchReportTools } from "../../mcp/past-match-report-tools.mjs";
import { createLiveQueryTools } from "../../mcp/live-query-tools.mjs";
import { createPlayerAttributesTools } from "../../mcp/player-attributes-tools.mjs";
import { createPlayerComparisonTools } from "../../mcp/player-comparison-tools.mjs";
import { createClubOverviewTools } from "../../mcp/club-overview-tools.mjs";
import { createShortlistManagementTools } from "../../mcp/shortlist-management-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MCP_ENTRY = path.join(ROOT, "mcp", "fm-assistant-mcp.mjs");

// 辅助函数：启动真实 MCP stdio 进程并发送 JSON-RPC 请求
function startMcpClient(env = {}, cwd = ROOT) {
  const child = spawn(process.execPath, [MCP_ENTRY], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      FM_ASSISTANT_LOG_FILE: path.join(os.tmpdir(), `fm-r2-test-${Date.now()}-${Math.random().toString(16).slice(2)}.log`),
      ...env
    }
  });
  const responses = new Map();
  let buf = "";
  child.stdout.on("data", chunk => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    }
  });
  let nextId = 1;
  function send(method, params = {}) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const timer = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(timer);
          resolve(responses.get(id));
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`MCP 超时: ${method}`));
        }
      }, 20);
    });
  }
  function close() {
    child.stdin.end();
    child.kill();
  }
  return { send, close };
}

test("15：get_inbox 完整支持第 21 封重要待办、主题筛选、nextScanFrom 续页与新邮件游标失效提示", async () => {
  // 构造 25 封信：0..19 为纯通知，index=20（第 21 封）是唯一重要且待办的报价提醒
  const mails = Array.from({ length: 25 }, (_, i) => ({
    identity: `news_${i}`,
    title: i === 20 ? "紧急转会报价待确认" : `日常新闻通知 #${i}`,
    body: `正文 ${i}`,
    isRead: false,
    important: i === 20,
    canRespond: i === 20,
    hasResponded: false
  }));
  let injectNewHeadAfterFirstScan = false;
  let headReads = 0;
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const mockCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))), path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      const subPath = q.get("path");
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "NumberUnreadMessages") return { ok: true, status: "ready", value: { kind: "scalar", value: String(mails.length) } };
      if (meta.prop === "HumanPortalUnreadMessages" || meta.prop === "HumanPortalFilteredMessages") {
        if (subPath === "0") {
          headReads++;
          const id = (injectNewHeadAfterFirstScan && headReads >= 1) ? "news_brand_new" : mails[0].identity;
          return { ok: true, status: "ready", epoch: 1, value: { kind: "reference", type: "FM.UI.NewsItemReference", identity: id } };
        }
        if (subPath !== null && subPath !== "") {
          const m = mails[Number(subPath)];
          return { ok: true, status: "ready", epoch: 1, value: { kind: "reference", type: "FM.UI.NewsItemReference", identity: m.identity } };
        }
        return {
          ok: true, status: "ready", epoch: 1,
          value: { kind: "list", count: mails.length, items: mails.map(m => ({ kind: "reference", type: "FM.UI.NewsItemReference", identity: m.identity })) }
        };
      }
      const m = mails[Number(meta.path) || 0];
      const map = {
        NewsTitleString: { kind: "scalar", type: "System.String", value: m.title },
        NewsBodyString: { kind: "scalar", type: "System.String", value: m.body },
        NewsItemHasBeenRead: { kind: "scalar", type: "System.Boolean", value: m.isRead ? "True" : "False" },
        NewsItemIsImportant: { kind: "scalar", type: "System.Boolean", value: m.important ? "True" : "False" },
        CanRespond: { kind: "scalar", type: "System.Boolean", value: m.canRespond ? "True" : "False" },
        NewsHasResponded: { kind: "scalar", type: "System.Boolean", value: m.hasResponded ? "True" : "False" }
      };
      return { ok: true, status: "ready", value: map[meta.prop] ?? null };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const getInbox = createInboxTools(mockCall);

  // 1) 按 pendingOnly + importantOnly + subject 均能跨过前 20 封通知精准命中第 21 封（index=20）
  const byPending = await getInbox({ unreadOnly: false, pendingOnly: true, limit: 10 });
  assert.equal(byPending.items.length, 1);
  assert.equal(byPending.items[0].targetIdentity, "news_20");
  assert.equal(byPending.items[0].index, 20);

  const byImportant = await getInbox({ unreadOnly: false, importantOnly: true, limit: 10 });
  assert.equal(byImportant.items[0].targetIdentity, "news_20");

  const bySubject = await getInbox({ unreadOnly: false, subject: "转会报价", limit: 10 });
  assert.equal(bySubject.items[0].targetIdentity, "news_20");

  // 2) 普通翻页利用 nextScanFrom 从第 1 页 -> 第 2 页 -> 第 3 页命中 news_20
  const p1 = await getInbox({ unreadOnly: false, limit: 10 });
  assert.equal(p1.items.length, 10);
  assert.equal(p1.nextScanFrom, 10);
  const p2 = await getInbox({ unreadOnly: false, limit: 10, scanFrom: p1.nextScanFrom });
  assert.equal(p2.nextScanFrom, 20);
  const p3 = await getInbox({ unreadOnly: false, limit: 10, scanFrom: p2.nextScanFrom });
  assert.equal(p3.items[0].targetIdentity, "news_20");
  assert.equal(p3.nextScanFrom, null);

  // 3) 扫描期间有新邮件插入队首 -> 明确报告 cursorInvalidated=true
  injectNewHeadAfterFirstScan = true;
  headReads = 0;
  const drifted = await getInbox({ unreadOnly: false, limit: 5 });
  assert.equal(drifted.cursorInvalidated, true);
  assert.equal(drifted.nextScanFrom, null);
  assert.match(drifted.note, /游标已失效/);
});

test("17/18/19/21：收件箱标旗按身份定位不误标已读信；无区分事件分支全部安全门控零派发", async () => {
  // 完整列表为 [已读 A (index=0), 未读 B (index=1)]；模拟调用方从未读列表拿到 index=0 但带了 B 的身份
  let fullList = [
    { identity: "news_A_read", important: false },
    { identity: "news_B_unread", important: false }
  ];
  let updatedTargetPath = null;
  let internalEvents = 0;
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const mockCall = async (route, opts = {}) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/event") {
      internalEvents++;
      return { ok: true };
    }
    if (pathname === "/api/v1/internal/update") {
      const meta = handleMeta.get(q.get("handle"));
      updatedTargetPath = meta?.path;
      const item = fullList[Number(meta?.path)];
      if (item) item.important = JSON.parse(opts.body);
      return { ok: true };
    }
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))), path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      const subPath = q.get("path");
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "HumanPortalFilteredMessages") {
        if (subPath !== null && subPath !== "") {
          const m = fullList[Number(subPath)];
          return { ok: true, status: "ready", value: m ? { kind: "reference", type: "FM.UI.NewsItemReference", identity: m.identity } : null };
        }
        return {
          ok: true, status: "ready",
          value: { kind: "list", count: fullList.length, items: fullList.map(m => ({ kind: "reference", type: "FM.UI.NewsItemReference", identity: m.identity })) }
        };
      }
      if (meta.prop === "NewsItemIsImportant") {
        const m = fullList[Number(meta.path)];
        return { ok: true, status: "ready", value: { kind: "scalar", value: m?.important ? "True" : "False" } };
      }
      if (meta.prop === "CanRespond") return { ok: true, status: "ready", value: { kind: "scalar", value: "True" } };
      if (meta.prop === "NewsHasResponded") return { ok: true, status: "ready", value: { kind: "scalar", value: "False" } };
      return { ok: true, status: "ready", value: null };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const tools = createInboxFlagsAndPromisesTools(mockCall);
  const career = createManagerCareerTools(mockCall);

  // 17: 传入未读下标 index=0 + expectedNewsIdentity="news_B_unread" -> 仅标记索引 1 的 B，绝不误标索引 0 的 A
  const resB = await tools.manageInboxMessageFlags({ index: 0, expectedNewsIdentity: "news_B_unread", flag: "important", value: true });
  assert.equal(resB.ok, true);
  assert.equal(resB.resolvedIndex, 1);
  assert.equal(updatedTargetPath, "1");
  assert.equal(fullList[0].important, false, "已读 A 不得被误标");
  assert.equal(fullList[1].important, true, "未读 B 必须正确被标重要");

  // 17b: 玩家插入新信后目标消息不在列表 -> 零派发阻断
  fullList = [{ identity: "news_C_new", important: false }];
  const missingRes = await tools.manageInboxMessageFlags({ index: 0, expectedNewsIdentity: "news_B_unread", flag: "important", value: false });
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.zeroDispatches, true);

  // 18: reminder(1/7天)、keep、archive 全部门控且 0 次原生事件派发
  const r1 = await tools.manageInboxMessageFlags({ expectedNewsIdentity: "news_C_new", flag: "reminder", reminderDays: 7 });
  const r2 = await tools.manageInboxMessageFlags({ expectedNewsIdentity: "news_C_new", flag: "keep", value: true });
  const r3 = await tools.manageInboxMessageFlags({ expectedNewsIdentity: "news_C_new", flag: "archive" });
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
  assert.equal(r3.ok, false);

  // 19 & 21: typed input、promise resolve、news follow 全部安全门控且 0 次原生事件派发
  const ti = await tools.submitMessageTypedInput({ expectedNewsIdentity: "news_C_new", inputKind: "numeric", numericValue: 100 });
  const pr = await tools.managePromiseOrHappiness({ action: "resolve", promiseIndex: 0 });
  const nf = await career.manageNewsFollow({ targetType: "club", targetIndex: 0, follow: false });
  assert.equal(ti.ok, false);
  assert.equal(pr.ok, false);
  assert.equal(nf.ok, false);
  assert.equal(internalEvents, 0, "所有无区分事件分支均不得向游戏发送任何事件");
});

test("20：manage_holiday 任何必填休假条件不可写或读回不符均零派发；返岗状态未知不误报已返岗", async () => {
  let goDispatched = 0;
  let holidayPropMode = "unwritable"; // unwritable -> mismatch -> unknown_return
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const mockCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/event") {
      if (q.get("event") === "EventFmxGoOnHoliday") goDispatched++;
      return { ok: true };
    }
    if (pathname === "/api/v1/internal/update") return { ok: true };
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (holidayPropMode === "unwritable" && f === "ReturnNumberDays") return { ok: true, properties: [] };
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))) });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "IsOnHoliday") {
        if (holidayPropMode === "unknown_return") return { ok: true, status: "awaiting_response", value: null };
        return { ok: true, status: "ready", value: { kind: "scalar", value: "False" } };
      }
      if (meta.prop === "GoOnHoliday") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.HolidayRef" } };
      if (meta.prop === "CanGoOnHoliday") return { ok: true, status: "ready", value: { kind: "scalar", value: "0" } };
      if (meta.prop === "CanConfirm") return { ok: true, status: "ready", value: { kind: "scalar", value: "True" } };
      if (meta.prop === "UseCurrentTactics") return { ok: true, status: "ready", value: { kind: "scalar", value: "False" } }; // 始终读回 False（与请求 true 不符）
      return { ok: true, status: "ready", value: { kind: "scalar", value: "" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const holiday = createManagerHolidayTools(mockCall);

  // 1) ReturnNumberDays 不可写 -> 中止且 0 次 EventFmxGoOnHoliday
  const r1 = await holiday.manageHoliday({ action: "go", returnNumberDays: 2 });
  assert.equal(r1.ok, false);
  assert.equal(r1.status, "conditions_not_confirmed");
  assert.equal(goDispatched, 0);

  // 2) UseCurrentTactics 读回值与请求不符 -> 中止且 0 次 EventFmxGoOnHoliday
  holidayPropMode = "mismatch";
  const r2 = await holiday.manageHoliday({ action: "go", useCurrentTactics: true });
  assert.equal(r2.ok, false);
  assert.equal(r2.failedConditions[0].reason, "readback_mismatch");
  assert.equal(goDispatched, 0);

  // 3) 返岗时 IsOnHoliday 未就绪 -> 保留 null 未知，绝不误判已返岗
  holidayPropMode = "unknown_return";
  const r3 = await holiday.manageHoliday({ action: "return" });
  assert.equal(r3.ok, false);
  assert.equal(r3.verified, false);
  assert.equal(r3.before.isOnHoliday, null);
});

test("23：set_tactical_style 模糊匹配（如“防反”）返回多候选零写入，预览后切槽拒绝旧 slotToken", async () => {
  let updateCalls = 0;
  let currentSlot = "0";
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const mockCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/update") {
      updateCalls++;
      return { ok: true };
    }
    if (pathname === "/api/v1/match/state") return { ok: true, inMatch: false };
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))) });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "Tactic") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TacticReference", identity: "tac_1" } };
      if (meta.prop === "TacticalStyle") return { ok: true, status: "ready", value: { kind: "scalar", value: "1" } };
      if (meta.prop === "CurrentTacticSlot") return { ok: true, status: "ready", value: { kind: "scalar", value: currentSlot } };
      if (meta.prop === "TacticalStyleDropdown") {
        return { ok: true, status: "ready", value: { kind: "record", fields: { "0x7074766c": { value: "1" }, "0x71764a36": { value: "高位压迫" } } } };
      }
      if (meta.prop === "TacticalStyleDropdownOptions") {
        return {
          ok: true, status: "ready",
          value: {
            kind: "list",
            items: [
              { fields: { "0x7074766c": { value: "1" }, "0x71764a36": { value: "高位压迫" } } },
              { fields: { "0x7074766c": { value: "6" }, "0x71764a36": { value: "灵活防反" } } },
              { fields: { "0x7074766c": { value: "7" }, "0x71764a36": { value: "快速防反" } } }
            ]
          }
        };
      }
      return { ok: true, status: "ready", value: { kind: "list", items: [] } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const ts = createTacticSlotTools(mockCall);
  const preview = await ts.setStyle({ previewOnly: true });
  assert.equal(preview.ok, true);
  assert.ok(preview.slotToken);

  // 模糊词“防反”命中 2 项 -> 必须返回候选且零写入
  const amb = await ts.setStyle({ style: "防反" });
  assert.equal(amb.ok, false);
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.candidates.length, 2);
  assert.equal(updateCalls, 0);

  // 玩家切到槽位 1 后携带旧 slotToken 执行精确 ID -> 拒绝且零写入
  currentSlot = "1";
  const stale = await ts.setStyle({ style: "7", expectedSlotToken: preview.slotToken });
  assert.equal(stale.ok, false);
  assert.equal(stale.blockedReason, "tactic_slot_changed");
  assert.equal(updateCalls, 0);
});

test("25/31/32/35/36/38/39/41/43：训练分组/伤病脑震荡/规划器/球探周期/外部工作许可/TR空草稿/附属换序/MLS门禁均零误派发", async () => {
  let writeDispatches = 0;
  let affiliates = [
    { identity: "aff_club_A", name: "卫星队A" },
    { identity: "aff_club_B", name: "卫星队B" }
  ];
  let plannerVersion = "plan_v1";
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const mockCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/event" || pathname === "/api/v1/internal/update") {
      writeDispatches++;
      return { ok: true };
    }
    if (pathname === "/api/v1/internal/registry") return { ok: true, items: [] };
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))), path: q.get("path") || "", source: q.get("source") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference", identity: "team_1" } };
      if (meta.prop === "Club") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.ClubReference", identity: "club_parent" } };
      if (meta.prop === "Players") return { ok: true, status: "ready", value: { kind: "list", count: 2, items: [{ identity: "p0" }, { identity: "p1" }] } };
      if (meta.prop === "CurrentInjury") return { ok: true, status: "ready", value: { kind: "reference", identity: "inj_concussion" } };
      if (meta.prop === "IsActive") return { ok: true, status: "ready", value: { kind: "scalar", value: "True" } };
      if (meta.prop === "Description" || meta.prop === "Name") {
        if (handleMeta.get(meta.source)?.prop === "AffiliatedClubsList") {
          const idx = Number(meta.path);
          return { ok: true, status: "ready", value: { kind: "scalar", value: affiliates[idx]?.name || "" } };
        }
        if (meta.source === "ext_person_handle") return { ok: true, status: "ready", value: { kind: "scalar", value: "外部免签右后卫" } };
        return { ok: true, status: "ready", value: { kind: "scalar", value: meta.prop === "Description" ? "轻微脑震荡" : "张三" } };
      }
      if (meta.prop === "SquadPlanner") return { ok: true, status: "ready", value: { kind: "reference", identity: "sp_1" } };
      if (meta.prop === "CurrentPlan") return { ok: true, status: "ready", value: { kind: "scalar", value: plannerVersion } };
      if (meta.prop === "ScoutingInfo") return { ok: true, status: "ready", value: { kind: "reference", identity: "sc_1" } };
      if (meta.prop === "ScoutingCentreActions") return { ok: true, status: "ready", value: { kind: "reference", identity: "sca_1" } };
      if (meta.prop === "Items") return { ok: true, status: "ready", value: { kind: "list", count: 2, items: [{ identity: "rep_1" }, { identity: "rep_2" }] } };
      if (meta.prop === "HumanPersonSearch") return { ok: true, status: "ready", value: { kind: "reference", identity: "ps_0" } };
      if (meta.prop === "ShortlistScoutingIntervalOptionsList") {
        return {
          ok: true, status: "ready",
          value: { kind: "list", items: [{ fields: { "0x7074766c": { value: "10" }, "0x71764a36": { value: "每周" } } }, { fields: { "0x7074766c": { value: "30" }, "0x71764a36": { value: "每月" } } }] }
        };
      }
      if (meta.prop === "TransferRoom") return { ok: true, status: "ready", value: { kind: "reference", identity: "tr_1" } };
      if (meta.prop === "HumanAdvertsList") return { ok: true, status: "ready", value: { kind: "list", count: 1, items: [{ identity: "adv_1" }] } };
      if (meta.prop === "AffiliatedClubsList") {
        return { ok: true, status: "ready", value: { kind: "list", count: affiliates.length, items: affiliates.map(a => ({ kind: "reference", type: "FM.UI.ClubReference", identity: a.identity })) } };
      }
      if (meta.prop === "HasSalaryCap" || meta.prop === "IsFantasyDraftGame") return { ok: true, status: "ready", value: { kind: "scalar", value: "False" } };
      if (meta.prop === "RequiresPlayingWorkPermit") return { ok: true, status: "ready", value: { kind: "scalar", value: "True" } };
      return { ok: true, status: "ready", value: { kind: "scalar", value: "OK" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  // 25: 训练分组调组在 FM27 门控零派发
  const units = createTrainingUnitTools(mockCall);
  const uRes = await units.manageMembership({ squadIndex: 0, unit: "attacking", action: "add" });
  assert.equal(uRes.ok, false);
  assert.equal(uRes.unsupportedInFm27, true);

  // 31: 伤病治疗检测脑震荡复出独立状态，拒绝硬编码写入
  const med = createYouthAndMedicalTools(mockCall);
  const medRead = await med.manageInjuryTreatment({ squadIndex: 0, action: "read" });
  assert.equal(medRead.ok, true);
  assert.equal(medRead.isConcussionProtocol, true);
  assert.equal(medRead.matchClearanceStatus.status, "requires_medical_concussion_clearance");
  const medWrite = await med.manageInjuryTreatment({ squadIndex: 0, action: "resume_training" });
  assert.equal(medWrite.ok, false);
  assert.equal(medWrite.zeroWrites, true);

  // 32: 阵容规划器空参报错，方案变化后旧 planToken 拒绝
  const sp = createSquadPlannerTools(mockCall);
  await assert.rejects(() => sp.editPlannerPlayer({}), /必须明确指定规划器动作/);
  const plan1 = await sp.readSquadPlanner({});
  plannerVersion = "plan_v2_switched_by_player";
  const spEdit = await sp.editPlannerPlayer({ action: "remove", playerIndex: 0, expectedPlanToken: plan1.planToken });
  assert.equal(spEdit.ok, false);
  assert.equal(spEdit.zeroDispatches, true);

  // 35 & 36: 球探中心多报告缺身份/缺天数被拒；球探更新周期非法值 99 绝不回退第 0 项
  const rl = createRecruitmentLifecycleTools(mockCall);
  const repRes = await rl.scoutingCentreReport({ action: "keep_scouting" });
  assert.equal(repRes.ok, false);
  assert.equal(repRes.zeroDispatches, true);
  const intRes = await rl.scoutingAssignment({ action: "set_interval", intervalValue: 99 });
  assert.equal(intRes.ok, false);
  assert.equal(intRes.zeroDispatches, true);

  // 38: 工作许可支持外部未加盟目标 { source, path }；写分支安全门控
  const wp = createWorkPermitAndTrialTools(mockCall);
  const extWp = await wp.getWorkPermitStatus({ source: "ext_person_handle" });
  assert.equal(extWp.ok, true);
  assert.equal(extWp.targetMode, "external_reference");
  assert.equal(extWp.workPermit.Name, "外部免签右后卫");
  const medPre = await wp.handleWorkPermitOrMedical({ source: "ext_person_handle", action: "medical" });
  assert.equal(medPre.ok, false);
  assert.equal(medPre.zeroDispatches, true);

  // 39: TransferRoom 空草稿 {} 必拒
  const tr = createDatahubAndTransferRoomTools(mockCall);
  await assert.rejects(() => tr.manageTransferRoomAdvert({ action: "confirm", draft: {} }), /空对象/);

  // 41: 附属俱乐部换序后拒绝过期确认
  const aff = createClubAffiliateTools(mockCall);
  const affPrev = await aff.cancelLink({ action: "preview" });
  assert.equal(affPrev.affiliates[0].affiliateIdentity, "aff_club_A");
  affiliates = [affiliates[1], affiliates[0]]; // 调换顺序！
  const affConf = await aff.cancelLink({
    action: "confirm",
    affiliateIndex: 0,
    expectedAffiliateIdentity: "aff_club_A",
    expectedChoiceToken: affPrev.affiliates[0].choiceToken
  });
  assert.equal(affConf.ok, false);
  assert.equal(affConf.zeroDispatches, true);

  // 43: MLS/选秀默认只读，普通联赛写操作被阻断
  const mls = createMlsAndNegotiationAdviceTools(mockCall);
  const mlsRead = await mls.manageMlsAndDraft({});
  assert.equal(mlsRead.readOnly, true);
  const mlsWrite = await mls.manageMlsAndDraft({ action: "set_budget_adjustment", value: 100 });
  assert.equal(mlsWrite.ok, false);
  assert.equal(mlsWrite.zeroDispatches, true);

  assert.equal(writeDispatches, 0, "上述所有拦截场景合计写派发次数必须严格为 0");
});

test("27/28/29/30/52/54：31人全量分页与快照共享缓存、中文中场解析、薪资周期、伤停外租三态、门将硬可行性、非标阵型拒回退、合同到期队列", async () => {
  // 30: 中文位置与薪资周期精确解析
  const mlTags = parsePositionTags("中场 (左)");
  assert.equal(mlTags.has("ML"), true);
  assert.equal(mlTags.has("MC"), false, "中场 (左) 绝不能误标 MC");
  const mrTags = parsePositionTags("中场 (右)");
  assert.equal(mrTags.has("MR"), true);
  assert.equal(mrTags.has("MC"), false, "中场 (右) 绝不能误标 MC");
  assert.equal(parseWageDetails("€12,5k/周").weeklyEquivalent, 12500);
  assert.equal(Math.round(parseWageDetails("€43,333/月").weeklyEquivalent), 10000);
  assert.equal(parseWageDetails("€5000").period, "unknown");
  assert.equal(parseWageDetails("€5000").weeklyEquivalent, null);

  // 28 & 29: 无健康门将时硬判不可行；外租/停赛/严格轮休排除；可配置替补席 9 人；未识别阵型不回退 4-2-3-1
  const noGkSquad = Array.from({ length: 15 }, (_, i) => ({
    index: i, name: `外场${i}`, age: "23", position: i < 5 ? "后卫 (中)" : (i < 10 ? "中场 (中)" : "前锋 (中)"),
    condition: "95%", sharpness: "90%", wage: "€5万/周", injured: false, suspended: false
  }));
  const noGkRes = solveBestXi(noGkSquad, { formation: "4-2-3-1" });
  assert.equal(noGkRes.ok, false);
  assert.equal(noGkRes.infeasible, true);
  assert.ok(noGkRes.missingPositions.some(m => m.includes("GK")));

  const badFormRes = solveBestXi(noGkSquad, { formation: "4-2-2-2-Asymmetric" });
  assert.equal(badFormRes.ok, false);
  assert.equal(badFormRes.unrecognizedFormation, "4-2-2-2-Asymmetric");

  // 27 & 52 & 54: 构造 31 人大名单，第 31 人（index=30，位于第 2 页！）是唯一健康门将且合同 90 天内到期（低薪年轻主力）
  const mockPlayers31 = Array.from({ length: 31 }, (_, i) => {
    if (i === 0) return { name: "伤病门将", pos: "门将", age: "29", cond: "90%", sharp: "80%", wage: "€20万/周", injured: "True", suspended: "False", exp: "2029-06-30", pt: "重要主力" };
    if (i === 1) return { name: "外租前锋", pos: "前锋 (中)", age: "20", cond: "95%", sharp: "90%", wage: "€2万/周", injured: "False", suspended: "False", loanClub: "租借去处FC", exp: "2028-06-30", pt: "轮换" };
    if (i === 2) return { name: "疲劳老将", pos: "后卫 (中)", age: "33", cond: "65%", sharp: "85%", wage: "€30万/周", injured: "False", suspended: "False", exp: "2030-06-30", pt: "常规主力" };
    if (i === 30) return { name: "末页神门", pos: "门将", age: "21", cond: "97%", sharp: "92%", wage: "€1.5万/周", injured: "False", suspended: "False", exp: "2027-01-31", pt: "明星球员" };
    const posPool = ["后卫 (右)", "后卫 (中)", "后卫 (左)", "后腰", "前腰 (右)", "前腰 (中)", "前腰 (左)", "前锋 (中)"];
    return { name: `球员${i}`, pos: posPool[i % posPool.length], age: String(21 + (i % 7)), cond: "92%", sharp: "88%", wage: "€6万/周", injured: "False", suspended: "False", exp: "2029-06-30", pt: "常规主力" };
  });

  let nameOpenCount = 0;
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();
  const mockCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/match/state") return { ok: true, inMatch: false };
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      const prop = propsById.get(Number(q.get("property")));
      if (prop === "Name") nameOpenCount++;
      handleMeta.set(handle, { prop, path: q.get("path") || "", source: q.get("source") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference", identity: "team_31" } };
      if (meta.prop === "CurrentGameDate") return { ok: true, status: "ready", value: { kind: "scalar", value: "2026-11-01" } };
      if (meta.prop === "Players") {
        return { ok: true, status: "ready", value: { kind: "list", count: 31, items: mockPlayers31.map((_, idx) => ({ identity: `p_${idx}` })) } };
      }
      if (meta.prop === "Tactic") return { ok: true, status: "ready", value: { kind: "reference", identity: "tac_31" } };
      if (meta.prop === "FormationName") return { ok: true, status: "ready", value: { kind: "scalar", value: "4-2-3-1" } };
      if (meta.prop === "NumberOfSubstitutes") return { ok: true, status: "ready", value: { kind: "scalar", value: "9" } };
      const idx = Number(meta.path);
      const p = mockPlayers31[idx];
      if (meta.prop === "Name") {
        if (handleMeta.get(meta.source)?.prop === "Team") return { ok: true, status: "ready", value: { kind: "scalar", value: "本队FC" } };
        if (handleMeta.get(meta.source)?.prop === "LoanClub") return { ok: true, status: "ready", value: { kind: "scalar", value: "租借去处FC" } };
        return { ok: true, status: "ready", value: { kind: "scalar", value: p?.name || "" } };
      }
      if (meta.prop === "LoanClub") return { ok: true, status: "ready", value: p?.loanClub ? { kind: "reference", identity: "loan_1" } : null };
      if (meta.prop === "FullContract") return { ok: true, status: "ready", value: { kind: "reference", identity: `fc_${idx}` } };
      if (meta.prop === "EndDateDescription") {
        const fcIdx = Number(handleMeta.get(meta.source)?.path);
        return { ok: true, status: "ready", value: { kind: "scalar", value: mockPlayers31[fcIdx]?.exp || "" } };
      }
      if (meta.prop === "AgreedPlayingTimeDescription") {
        const fcIdx = Number(handleMeta.get(meta.source)?.path);
        return { ok: true, status: "ready", value: { kind: "scalar", value: mockPlayers31[fcIdx]?.pt || "" } };
      }
      if (meta.prop === "Wage") {
        const fcIdx = Number(handleMeta.get(meta.source)?.path ?? meta.path);
        return { ok: true, status: "ready", value: { kind: "scalar", value: mockPlayers31[fcIdx]?.wage || "" } };
      }
      const fieldMap = {
        Age: p?.age, BestPositionShortString: p?.pos, Condition: p?.cond, Sharpness: p?.sharp,
        Morale: "16", IsInjured: p?.injured, IsSuspended: p?.suspended, SquadNumber: String(idx + 1)
      };
      return { ok: true, status: "ready", value: fieldMap[meta.prop] !== undefined ? { kind: "scalar", value: fieldMap[meta.prop] } : null };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const sharedSnap = createSquadSnapshotTools(mockCall);
  const auditTools = createSquadAuditTools(mockCall, sharedSnap);
  const xiTools = createBestXiTools(mockCall, sharedSnap);

  const audit = await auditTools.auditSquadAndContracts({});
  assert.equal(audit.squadSize, 31, "体检必须翻页覆盖全部 31 名球员");
  assert.equal(audit.expiringContractsQueue.expiringCount, 1);
  assert.equal(audit.expiringContractsQueue.expiringSoon[0].name, "末页神门", "低薪年轻主力到期必须排在合同到期队列首位");
  assert.ok(!audit.expiringContractsQueue.expiringSoon.some(x => x.name === "疲劳老将"), "长约老将不得混入到期队列");
  const opensAfterAudit = nameOpenCount;

  // 紧接调用排阵：必须复用同日全量快照（零重复逐人订阅），选中末页第 31 人门将，排除外租与严格轮休低体能老将，替补席 9 人
  const xi = await xiTools.optimizeBestXi({ minCondition: 75, strictMinCondition: true });
  assert.equal(xi.ok, true);
  assert.equal(xi.snapshotCoverage.reusedSnapshotCache, true, "同日连续体检+排阵应共享只读快照");
  assert.equal(nameOpenCount, opensAfterAudit, "复用快照期间不应再次逐人订阅 Name");
  assert.equal(xi.startingXI.find(s => s.slot === "GK")?.squadIndex, 30, "必须选到第 2 页的唯一健康门将");
  assert.ok(!xi.startingXI.some(s => s.squadIndex === 1), "外租球员必须被排除");
  assert.ok(!xi.startingXI.some(s => s.squadIndex === 2), "严格轮休模式体能 65% 老将必须被排除");
  assert.equal(xi.bench.length, 9, "应遵循比赛规则返回 9 人替补席");
});

test("37/44/45/46/47/48/53：搜人还原防旧命中、比赛实时无静态回退+采样跨度+字典自恢复、历史赛程严格类型、live_query 80行隐藏筛选+禁读发布会、简报全量无假默认", async () => {
  // 44 + 46 + 53: 首次字典失败，第二次自动恢复；客队 Stats 未就绪绝不读静态 AwayShots；采样跨 44->46 分钟标 spannedBoundary=true
  let regCalls = 0;
  let matchStateCalls = 0;
  let staticAwayRequested = false;
  let seq = 0;
  const propsById = new Map();
  const handleMeta = new Map();

  const matchCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/registry") {
      regCalls++;
      if (regCalls === 1) throw new Error("transient boot failure");
      return { ok: true, items: [{ id: 0x00001001, name: "TotalShots" }, { id: 0x00001002, name: "ExpectedGoals" }] };
    }
    if (pathname === "/api/v1/match/state") {
      matchStateCalls++;
      return { ok: true, inMatch: true, matchIdentity: "match_99", minute: matchStateCalls === 1 ? 44 : 46, continueState: "Playing", isHomeTeam: true };
    }
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (f === "AwayShots" || f === "AwayPossession") staticAwayRequested = true;
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [{ name: "isHomeTeam:bool" }] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      const ctx = JSON.parse(q.get("contexts") || "{}");
      handleMeta.set(handle, { prop: propsById.get(Number(q.get("property"))), isHomeTeam: ctx.isHomeTeam });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "Stats") {
        if (meta.isHomeTeam === false) return { ok: true, status: "awaiting_response", value: null };
        return { ok: true, status: "ready", value: { kind: "record", fields: { "0x00001001": { kind: "scalar", value: 0 }, "0x00001002": { kind: "scalar", value: 0.42 } } } };
      }
      if (meta.prop === "XgValue" || meta.prop === "PlayerMatchStats") return { ok: true, status: "awaiting_response", value: null };
      return { ok: true, status: "ready", value: { kind: "scalar", value: "0-0" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const ma = createMatchAnalyticsTools(matchCall);
  const firstRun = await ma.teamStatsAndXg({ compact: true });
  assert.equal(staticAwayRequested, false, "客队实时 Stats 未就绪时绝不可回退读取静态 AwayShots");
  assert.equal(firstRun.sideAvailability.home.available, true);
  assert.equal(firstRun.sideAvailability.away.available, false);
  assert.ok(firstRun.stats.XgValue.unavailable, "XgValue 未就绪时紧凑模式必须保留 unavailable 诊断");
  assert.equal(firstRun.samplingWindow.spannedBoundary, true);
  assert.equal(firstRun.matchIdentity, "match_99");

  // 第二次调用字典自动恢复（regCalls === 2），具名字段 TotalShots=0 与 ExpectedGoals=0.42 正常解码
  const secondRun = await ma.teamStatsAndXg({ compact: true });
  assert.equal(regCalls, 2, "首次字典失败不得缓存空 Map，第二次必须自动重试恢复");
  assert.equal(secondRun.homeTeamLiveStats.shots, 0, "真实零射门必须保留为 0");
  assert.equal(secondRun.homeTeamLiveStats.xg, 0.42);

  // PlayerMatchStats 未就绪 -> 返回 available: false, count: null（而非 count: 0）
  const pStats = await ma.playerLiveStats({ side: "home" });
  assert.equal(pStats.sides.home.available, false);
  assert.equal(pStats.sides.home.count, null);

  // 45: 历史战报行内 TeamReference 排在 FixtureReference 前面 -> 仅接受 FixtureReference；越界直接报 found:false
  let pastSeq = 0;
  const pastProps = new Map();
  const pastHandles = new Map();
  const pastCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/registry") return { ok: true, items: [] };
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++pastSeq;
      pastProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `ph_${++pastSeq}`;
      pastHandles.set(handle, { prop: pastProps.get(Number(q.get("property"))), path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = pastHandles.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "DataHubLastMatchFixtureDropdown") {
        return {
          ok: true, status: "ready",
          value: {
            kind: "list", count: 1,
            items: [{
              fields: {
                "0x00000001": { kind: "reference", type: "FM.UI.TeamReference", identity: "wrong_team_ref" },
                "0x00000002": { kind: "reference", type: "FM.UI.FixtureReference", identity: "real_fixture_77" }
              }
            }]
          }
        };
      }
      return { ok: true, status: "ready", value: { kind: "scalar", value: "2026-11-20" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const pm = createPastMatchReportTools(pastCall);
  const okPast = await pm.getPastMatchReport({ fixtureIndex: 0 });
  assert.equal(okPast.ok, true);
  assert.equal(okPast.fixtureIdentity, "real_fixture_77", "必须忽略排在前面的 TeamReference，只绑定 FM.UI.FixtureReference");
  const missPast = await pm.getPastMatchReport({ fixtureIndex: 5 });
  assert.equal(missPast.ok, false);
  assert.equal(missPast.found, false);
  assert.equal(missPast.teamReports, undefined, "查无此场不得混入球队最近一场分析");

  // 47 + 对话权限边界: 80 行仅内联 64 行，第 70 行（index=69）满足 Age<=18，select 仅含 Name
  let lqSeq = 0;
  const lqProps = new Map();
  const lqHandles = new Map();
  const lqCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (!f) return { ok: true, properties: [{ id: 1, name: "Name:str", contexts: [] }, { id: 2, name: "Age:int", contexts: [] }] };
      const id = ++lqSeq;
      lqProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `lq_${++lqSeq}`;
      lqHandles.set(handle, { prop: lqProps.get(Number(q.get("property"))), path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = lqHandles.get(q.get("handle"));
      if (meta.prop === "Team" || meta.prop === "Club") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "Players") {
        return { ok: true, status: "ready", value: { kind: "list", count: 80, truncated: true, items: Array.from({ length: 64 }, (_, i) => ({ type: "FM.UI.PersonReference", identity: `p_${i}` })) } };
      }
      const idx = Number(meta.path);
      if (meta.prop === "Name") return { ok: true, status: "ready", value: { kind: "scalar", value: idx === 69 ? "第70行天才小妖" : `球员${idx}` } };
      if (meta.prop === "Age") return { ok: true, status: "ready", value: { kind: "scalar", value: idx === 69 ? "17" : "28" } };
      return { ok: true, status: "ready", value: null };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const lq = createLiveQueryTools(lqCall);
  const qRes = await lq.query({ node: "team.Players", select: ["Name"], where: [{ field: "Age", op: "lte", value: 18 }], scanLimit: 100 });
  assert.equal(qRes.nativeTotal, 80);
  assert.equal(qRes.inlinedCount, 64);
  assert.equal(qRes.rows.length, 1);
  assert.equal(qRes.rows[0].index, 69);
  assert.equal(qRes.rows[0].Name, "第70行天才小妖");
  assert.equal(Object.hasOwn(qRes.rows[0], "Age"), false, "隐藏筛选字段不应强迫输出到 select 结果中");
  await assert.rejects(() => lq.query({ node: "human.PressConferenceEditSession", select: ["CurrentQuestion"] }), /范围边界/);

  // 48: 赛前简报覆盖第 26 人疲劳、单人缺失士气不假定 15、未读缺失不假定 "0"
  let brSeq = 0;
  const brProps = new Map();
  const brHandles = new Map();
  const brCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++brSeq;
      brProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `br_${++brSeq}`;
      brHandles.set(handle, { prop: brProps.get(Number(q.get("property"))), path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = brHandles.get(q.get("handle"));
      if (meta.prop === "Team" || meta.prop === "Club") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "Players") return { ok: true, status: "ready", value: { kind: "list", count: 27, items: Array.from({ length: 27 }, (_, i) => ({ identity: `p_${i}` })) } };
      if (meta.prop === "NumberUnreadMessages") return { ok: true, status: "awaiting_response", value: null };
      const idx = Number(meta.path);
      if (meta.prop === "Condition") return { ok: true, status: "ready", value: { kind: "scalar", value: idx === 25 ? "62" : "94" } };
      if (meta.prop === "Sharpness") return { ok: true, status: "ready", value: { kind: "scalar", value: "85" } };
      if (meta.prop === "Morale") return idx === 1 ? { ok: true, status: "awaiting_response", value: null } : { ok: true, status: "ready", value: { kind: "scalar", value: "16" } };
      if (meta.prop === "Name") return { ok: true, status: "ready", value: { kind: "scalar", value: idx === 25 ? "第26位疲劳主力" : `球员${idx}` } };
      return { ok: true, status: "ready", value: { kind: "scalar", value: "ST" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const pa = createPlayerAttributesTools(brCall);
  const brief = await pa.getPreMatchBriefing();
  assert.equal(brief.squadScanSummary.checkedPlayers, 27);
  assert.equal(brief.squadScanSummary.unknownMoraleCount, 1);
  assert.equal(brief.unreadMessages, null, "未读数缺失必须保留 null 而非 '0'");
  assert.ok(brief.squadAlerts.some(a => a.squadIndex === 25 && a.name === "第26位疲劳主力"));

  // 37: 按名字搜索后还原玩家原有关键词，且在结果不刷新时拒绝返回旧列表
  let searchBox = "玩家原搜词";
  let freezeSearch = false;
  let spSeq = 0;
  const spProps = new Map();
  const spHandles = new Map();
  const spCall = async (route, opts = {}) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/update") {
      searchBox = JSON.parse(opts.body);
      return { ok: true };
    }
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      const id = ++spSeq;
      spProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `sp_${++spSeq}`;
      spHandles.set(handle, { prop: spProps.get(Number(q.get("property"))), path: q.get("path") || "", source: q.get("source") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = spHandles.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "Search") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.SearchReference" } };
      if (meta.prop === "Name") {
        if (spHandles.get(meta.source)?.prop === "Search") return { ok: true, status: "ready", value: { kind: "scalar", value: searchBox } };
        return { ok: true, status: "ready", value: { kind: "scalar", value: "新目标球员" } };
      }
      if (meta.prop === "SearchIsFinished") return { ok: true, status: "ready", value: { kind: "scalar", value: "True" } };
      if (meta.prop === "PersonList") {
        const id = (!freezeSearch && searchBox === "哈兰德") ? "id_haaland" : "id_old_player";
        return { ok: true, status: "ready", value: { kind: "list", count: 1, items: [{ identity: id }] } };
      }
      if (meta.prop === "RowData") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.PersonReference", identity: "id_haaland" } };
      if (meta.prop === "Club") return { ok: true, status: "ready", value: { kind: "reference", type: "SI.Bindable.NullReference" } };
      return { ok: true, status: "ready", value: { kind: "scalar", value: "22" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const spTools = createPlayerSearchFilterTools(spCall);
  const found = await spTools.searchPlayers({ name: "哈兰德" });
  assert.equal(found.ok, true);
  assert.equal(found.scanned, 1);
  assert.equal(found.searchBoxRestore.status, "restored");
  assert.equal(searchBox, "玩家原搜词", "搜索完毕必须还原玩家原有搜索词");

  freezeSearch = true;
  const staleSearch = await spTools.searchPlayers({ name: "不存在的新词" });
  assert.equal(staleSearch.ok, false);
  assert.equal(staleSearch.status, "search_not_ready");
  assert.equal(searchBox, "玩家原搜词");
});

test("40/42/49/51：内外球员混合比较无年龄leader、财政全缺 liveVerified:false、失业短名单可读、真实MCP网关504回执与自定义端口错误", async () => {
  // 40: 本队 + 外部目标混合比较，保留球探区间，年龄/身高不标 leader
  let cSeq = 0;
  const cProps = new Map();
  const cHandles = new Map();
  const compCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (!f) return { ok: true, properties: [{ id: 1, name: "Pace:int", contexts: [] }] };
      const id = ++cSeq;
      cProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `c_${++cSeq}`;
      cHandles.set(handle, { prop: cProps.get(Number(q.get("property"))), source: q.get("source") || "", path: q.get("path") || "" });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = cHandles.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "Players") return { ok: true, status: "ready", value: { kind: "list", count: 1, items: [{ identity: "own_0" }] } };
      const isExt = meta.source === "ext_rb";
      if (meta.prop === "Club") return { ok: true, status: "ready", value: { kind: "reference", type: isExt ? "SI.Bindable.NullReference" : "FM.UI.ClubReference", identity: "c1" } };
      const vals = {
        Name: isExt ? "外部免签右卫" : "队内老右卫",
        Age: isExt ? "22" : "31",
        Condition: isExt ? "96" : "82",
        Pace: isExt ? "14-16" : "12",
        BestRoleForPosition: "边后卫(策应)",
        BestOOPRoleForPosition: "边后卫(防守)",
        ScoutingKnowledgeLevel: isExt ? "65%" : "100%"
      };
      return { ok: true, status: "ready", value: { kind: "scalar", value: vals[meta.prop] ?? "" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const cmp = createPlayerComparisonTools(compCall);
  const cmpRes = await cmp.comparePlayers({ targets: [{ squadIndex: 0 }, { source: "ext_rb" }] });
  assert.equal(cmpRes.ok, true);
  assert.equal(cmpRes.profiles[1].coreAttributes.Pace, "14-16", "必须保留外部球员球探属性区间");
  assert.equal(cmpRes.comparison.Age.metricKind, "objective_profile_delta");
  assert.equal(cmpRes.comparison.Age.leader, undefined, "年龄不应标最大者为 leader");
  assert.equal(cmpRes.comparison.Age.delta, 9);
  assert.equal(cmpRes.comparison.Condition.leader.name, "外部免签右卫");

  // 42: 财政字段全缺失时必须返回 degraded:true, liveVerified:false
  let fSeq = 0;
  const fProps = new Map();
  const fHandles = new Map();
  const emptyFinCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (f === "Club" || f === "Team") {
        const id = ++fSeq;
        fProps.set(id, f);
        return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
      }
      return { ok: true, properties: [] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `f_${++fSeq}`;
      fHandles.set(handle, { prop: fProps.get(Number(q.get("property"))) });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") return { ok: true, status: "ready", value: { kind: "reference", identity: "club_empty" } };
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const co = createClubOverviewTools(emptyFinCall);
  const finRes = await co.finances();
  assert.equal(finRes.degraded, true);
  assert.equal(finRes.liveVerified, false);
  assert.equal(finRes.readCoverage.availableFields, 0);

  // 49: 失业经理（human.Team 返回 NullReference）依然可读取短名单列表
  let uSeq = 0;
  const uProps = new Map();
  const uHandles = new Map();
  const unemployedCall = async (route) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (f === "Team") return { ok: true, properties: [] };
      const id = ++uSeq;
      uProps.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `u_${++uSeq}`;
      uHandles.set(handle, { prop: uProps.get(Number(q.get("property"))) });
      return { ok: true, handle };
    }
    if (pathname === "/api/v1/live/read") {
      return { ok: true, status: "ready", value: { kind: "list", count: 1, items: [{ fields: { "0x696e6478": { value: "0" }, "0x5374726e": { value: "失业自建名单" }, "0x696d5856": { value: "0 名球员" }, "0x69734163": { value: "True" } } }] } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const sl = createShortlistManagementTools(unemployedCall);
  const uList = await sl.listShortlists();
  assert.equal(uList.ok, true);
  assert.equal(uList.shortlists[0].name, "失业自建名单");

  // 49 & 51: 真实 MCP stdio 网关验收 HTTP 504 结构化 timeoutReceipt、plugin_health 四层诊断与自定义端口错误提示
  const mockServer = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: "1.1.0", authRequired: true }));
      return;
    }
    if (u.pathname === "/api/v1/live/properties") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, code: "no_active_save", error: "Expected one active human reference; found 0." }));
      return;
    }
    if (u.pathname === "/api/v1/commands/status") {
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, status: "execution_result_unknown", operationId: "op_timeout_504", retrySafe: false, error: "Main thread timed out" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => mockServer.listen(0, "127.0.0.1", resolve));
  const { port } = mockServer.address();

  const mcp1 = startMcpClient({ FM_ASSISTANT_URL: `http://127.0.0.1:${port}`, FM_ASSISTANT_TOKEN: "secret-tok" });
  try {
    const healthResp = await mcp1.send("tools/call", { name: "plugin_health", arguments: {} });
    const hData = JSON.parse(healthResp.result.content[0].text);
    assert.equal(hData.diagnostics.serviceOnline, true);
    assert.equal(hData.diagnostics.authStatus, "authorized");
    assert.equal(hData.diagnostics.saveLoaded, false, "未载入存档时 plugin_health 必须明确区分服务在线但 saveLoaded=false");

    const timeoutResp = await mcp1.send("tools/call", {
      name: "fm_call",
      arguments: { action: "operation_status", params: { operationId: "op_timeout_504" } }
    });
    assert.equal(timeoutResp.result.isError, true);
    const tData = JSON.parse(timeoutResp.result.content[0].text);
    assert.equal(tData.code, "execution_timeout_receipt");
    assert.equal(tData.operationId, "op_timeout_504");
    assert.equal(tData.retrySafe, false);
    assert.equal(tData.timeoutReceipt.status, "execution_result_unknown");
  } finally {
    mcp1.close();
    await new Promise(resolve => mockServer.close(resolve));
  }

  // 自定义端口连接失败时必须提示实际配置地址（而非写死 127.0.0.1:27190）
  const mcp2 = startMcpClient({ FM_ASSISTANT_URL: "http://127.0.0.1:39876", FM_ASSISTANT_TOKEN: "secret-tok" });
  try {
    const connErr = await mcp2.send("tools/call", { name: "plugin_health", arguments: {} });
    assert.equal(connErr.result.isError, true);
    assert.match(connErr.result.content[0].text, /127\.0\.0\.1:39876/);
  } finally {
    mcp2.close();
  }
});
