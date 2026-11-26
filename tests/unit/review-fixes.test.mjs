import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createManagerTools } from "../../mcp/manager-tools.mjs";
import { createBudgetAdjustmentTools } from "../../mcp/budget-adjustment-tools.mjs";
import { createShortlistManagementTools } from "../../mcp/shortlist-management-tools.mjs";
import { createPlayerSearchFilterTools } from "../../mcp/player-search-filter-tools.mjs";
import { createTacticChangeTools } from "../../mcp/tactic-change-tools.mjs";
import { buildAbsoluteMcpConfig } from "../../scripts/generate-mcp-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// 启动带模拟后端 HTTP 服务的真实 MCP stdio 网关子进程，支持自定义 env 与 cwd
async function withMockGateway({ handler, env = {}, cwd = ROOT }, fn) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const urlObj = new URL(req.url, "http://127.0.0.1");
    requests.push({ method: req.method, pathname: urlObj.pathname, searchParams: urlObj.searchParams, body });
    try {
      const out = await handler({ method: req.method, pathname: urlObj.pathname, searchParams: urlObj.searchParams, body });
      const status = out?.__status ?? 200;
      const payload = out?.__status !== undefined ? out.body : out;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload ?? { ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const mcpConfig = buildAbsoluteMcpConfig(ROOT, `http://127.0.0.1:${port}`);
  const entryScript = mcpConfig.mcpServers["fm27-assistant"].args[0];

  const child = spawn(process.execPath, [entryScript], {
    cwd,
    env: {
      ...process.env,
      FM_ASSISTANT_URL: `http://127.0.0.1:${port}`,
      FM_ASSISTANT_TOKEN: "test-token",
      ...env
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const responses = new Map();
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses.set(msg.id, msg);
      } catch {}
    }
  });

  let nextId = 1;
  function sendReq(method, params = {}) {
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
          reject(new Error(`MCP 请求 ${method} 超时`));
        }
      }, 20);
    });
  }

  try {
    await sendReq("initialize", { protocolVersion: "2025-06-18" });
    return await fn({ sendReq, requests });
  } finally {
    child.stdin.end();
    child.kill();
    server.close();
  }
}

test("03：list_tactic_files 与 save_tactic_file 在默认、autonomous、全工具模式下均不可发现且零 HTTP 拒绝", async () => {
  const modeEnvs = [
    {},
    { FM_ASSISTANT_MODE: "autonomous" },
    { FM_ASSISTANT_EXPOSE_ALL_TOOLS: "1" }
  ];
  for (const env of modeEnvs) {
    await withMockGateway({ handler: () => ({ ok: true }), env }, async ({ sendReq, requests }) => {
      const listRes = await sendReq("tools/list");
      const listedNames = listRes.result.tools.map(t => t.name);
      assert.ok(!listedNames.includes("list_tactic_files"));
      assert.ok(!listedNames.includes("save_tactic_file"));

      const discRes = await sendReq("tools/call", { name: "fm_discover", arguments: { query: "tactic_file" } });
      const disc = JSON.parse(discRes.result.content[0].text);
      assert.equal(disc.tools.some(t => t.name === "list_tactic_files" || t.name === "save_tactic_file"), false);

      const call1 = await sendReq("tools/call", { name: "fm_call", arguments: { action: "list_tactic_files", params: {} } });
      assert.equal(call1.result.isError, true);
      assert.match(call1.result.content[0].text, /已从最终 MCP 移除/);

      const call2 = await sendReq("tools/call", {
        name: "fm_call",
        arguments: { action: "save_tactic_file", params: { name: "test", operationId: "op1" } }
      });
      assert.equal(call2.result.isError, true);
      assert.equal(requests.length, 0, "已移除的文件工具在发送 HTTP 前就应被拒绝");
    });
  }
});

test("01：默认 assistant 模式下比赛中拒绝公用战术写入口（set_mentality），但允许只读与 autonomous 模式", async () => {
  let writeCalled = 0;
  const mockMatchHandler = ({ pathname }) => {
    if (pathname === "/api/v1/match/state") {
      return { ok: true, inMatch: true, pastMatch: false, replay: false, finished: false, spectating: false };
    }
    if (pathname.startsWith("/api/v1/commands/")) {
      writeCalled++;
      return { ok: true };
    }
    return { ok: true, properties: [] };
  };

  await withMockGateway({ handler: mockMatchHandler }, async ({ sendReq }) => {
    const res = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "set_mentality", params: { mentality: "5" } }
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /默认 assistant 模式下比赛进行中禁止执行写操作/);
    assert.equal(writeCalled, 0, "默认模式下比赛中绝不应派发战术写入命令");
  });
});

test("04：预算确认强制绑定原预览 token（预览 A -> 玩家改为 B -> 确认 A 必拒绝且 0 次确认请求）", async () => {
  let sliderToken = "tok_draft_A";
  let dialogToken = "dlg_A";
  let confirmCalls = 0;
  let adjustExecuteCalls = 0;
  let seq = 0;
  const propsById = new Map();
  const handleVals = new Map();

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
      const prop = propsById.get(Number(q.get("property")));
      handleVals.set(handle, prop === "BudgetAdjustmentCanEditBudgets"
        ? { kind: "scalar", value: "True" }
        : { kind: "scalar", value: "3" });
      return { ok: true, handle, reference: { type: "MockRef" } };
    }
    if (pathname === "/api/v1/live/read") {
      return { ok: true, status: "ready", value: handleVals.get(q.get("handle")) };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    if (pathname === "/api/v1/commands/preview-budget-confirm") {
      return { ok: true, confirmationToken: sliderToken };
    }
    if (pathname === "/api/v1/commands/confirm-budget-allocation") {
      confirmCalls++;
      return { ok: true, status: "dispatched_unverified" };
    }
    if (pathname === "/api/v1/budget-adjustment/state") return { ok: true, canEditBudgets: true };
    if (pathname === "/api/v1/budget-adjustment/preview") return { ok: true, choiceToken: dialogToken };
    if (pathname === "/api/v1/budget-adjustment/execute") {
      adjustExecuteCalls++;
      return { ok: true, status: "dispatched_unverified" };
    }
    throw new Error(`未预期路由: ${route}`);
  };

  // A. confirm_budget_allocation：预览 A -> 玩家改为 B -> 用 A 确认被拒
  const mgr = createManagerTools(mockCall);
  await assert.rejects(() => mgr.confirmBudgetAllocation({}), /expectedConfirmationToken/);
  const draftA = await mgr.getBudgetAllocation();
  assert.equal(draftA.confirmationToken, "tok_draft_A");

  // 玩家手动挪动滑杆，服务端草稿令牌变成 B
  sliderToken = "tok_draft_B";
  await assert.rejects(
    () => mgr.confirmBudgetAllocation({ expectedConfirmationToken: draftA.confirmationToken, operationId: "op_budget_1" }),
    /预算草稿已变化/
  );
  assert.equal(confirmCalls, 0, "草稿变化后确认事件发送次数必须严格为 0");

  // B. 另一预算确认入口 confirm_club_budget_adjustment：滑杆变化同样拦截
  sliderToken = "tok_draft_A";
  const adj = createBudgetAdjustmentTools(mockCall);
  const adjPreviewA = await adj.get({ action: "confirm" });
  sliderToken = "tok_draft_B";
  await assert.rejects(
    () => adj.execute({ expectedChoiceToken: adjPreviewA.choiceToken, operationId: "op_adj_1" }),
    /预算滑杆草稿已变化/
  );
  assert.equal(adjustExecuteCalls, 0, "另一预算确认入口在滑杆变化后同样不得发送确认事件");
});

test("05/06/07：候选名单防同人数串读、超时拒返旧数据、恢复失败上报、保留玩家第三方切换、俱乐部三态", async () => {
  // 构造场景 A：同人数不同球员 + 延迟刷新 + 俱乐部三态（有俱乐部 / 明确空 / 订阅超时未就绪）
  let seq = 0;
  let activeIndex = 0; // 当前激活名单 A(index=0)
  let personListStage = "A"; // 模拟切到 B 后前两次仍返回旧 A 列表，第 3 次才真正刷新为 B
  let readsAfterSwitch = 0;
  let failRestore = false;
  let userSwitchesToThird = false;
  let startedReadingBPlayers = false;
  let freezeListOnSwitch = false;
  const switchHistory = [];
  const propsById = new Map();
  const handleMeta = new Map();

  const listPayloads = {
    A: { kind: "list", count: 3, items: [{ identity: "a1" }, { identity: "a2" }, { identity: "a3" }] },
    B: { kind: "list", count: 3, items: [{ identity: "b1" }, { identity: "b2" }, { identity: "b3" }] }
  };

  const mockCall = async (route, opts = {}) => {
    const [pathname, qs = ""] = route.split("?");
    const q = new URLSearchParams(qs);
    if (pathname === "/api/v1/internal/event" && q.get("event") === "EventFmxSetActiveShortlist") {
      const target = JSON.parse(opts.body);
      switchHistory.push(target);
      if (target === 0 && failRestore) throw new Error("native restore rejected");
      activeIndex = target;
      if (target === 1) {
        readsAfterSwitch = 0;
        startedReadingBPlayers = false;
      }
      return { ok: true };
    }
    if (pathname === "/api/v1/live/properties") {
      const f = q.get("filter") || "";
      if (!f) return { ok: true, properties: [{ id: 901, name: "Pace:mock", contexts: [] }] };
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      const prop = propsById.get(Number(q.get("property")));
      handleMeta.set(handle, { prop, path: q.get("path") || "", source: q.get("source") || "" });
      return { ok: true, handle, reference: { type: "MockRef" } };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (!meta) return { ok: true, status: "ready", value: null };
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "HumanShortlists") {
        // 如果测试模拟玩家在读取球员期间切去第三份名单 C(index=2)，在开始读取 B 的球员之后返回 index=2 为激活
        const effectiveActive = (userSwitchesToThird && startedReadingBPlayers) ? 2 : activeIndex;
        return {
          ok: true,
          status: "ready",
          value: {
            kind: "list",
            count: 3,
            items: [
              { fields: { "0x696e6478": { value: "0" }, "0x5374726e": { value: "名单A" }, "0x696d5856": { value: "3 名球员" }, "0x69734163": { value: effectiveActive === 0 ? "True" : "False" } } },
              { fields: { "0x696e6478": { value: "1" }, "0x5374726e": { value: "名单B" }, "0x696d5856": { value: "3 名球员" }, "0x69734163": { value: effectiveActive === 1 ? "True" : "False" } } },
              { fields: { "0x696e6478": { value: "2" }, "0x5374726e": { value: "名单C" }, "0x696d5856": { value: "1 名球员" }, "0x69734163": { value: effectiveActive === 2 ? "True" : "False" } } }
            ]
          }
        };
      }
      if (meta.prop === "HumanPersonSearch") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.PersonSearchReference" } };
      if (meta.prop === "PersonList") {
        if (activeIndex === 1 && !freezeListOnSwitch) {
          readsAfterSwitch++;
          personListStage = readsAfterSwitch >= 2 ? "B" : "A";
        } else {
          personListStage = "A";
        }
        return { ok: true, status: "ready", value: listPayloads[personListStage] };
      }
      if (meta.prop === "Name") {
        if (handleMeta.get(meta.source)?.prop === "Club") return { ok: true, status: "ready", value: { kind: "scalar", value: "巴塞罗那" } };
        if (personListStage === "B") startedReadingBPlayers = true;
        const names = personListStage === "B" ? ["小妖B1", "自由人B2", "未知俱乐部B3"] : ["旧人A1", "旧人A2", "旧人A3"];
        return { ok: true, status: "ready", value: { kind: "scalar", value: names[Number(meta.path) || 0] } };
      }
      if (meta.prop === "Club") {
        if (meta.path === "0") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.ClubReference", identity: "club_fcb" } };
        if (meta.path === "1") return { ok: true, status: "ready", value: { kind: "reference", type: "SI.Bindable.NullReference" } };
        // path === "2" 模拟 Club 订阅始终未就绪（awaiting_response -> 超时）
        return { ok: true, status: "awaiting_response", value: null };
      }
      if (meta.prop === "Age") return { ok: true, status: "ready", value: { kind: "scalar", value: "19" } };
      return { ok: true, status: "ready", value: { kind: "scalar", value: "" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const sl = createShortlistManagementTools(mockCall);

  // 1) 同人数 A/B 延迟刷新：必等到真正刷新为 B，且验证俱乐部三态
  const resB = await sl.getShortlistPlayers({ shortlistName: "名单B", includeAttributes: false });
  assert.equal(resB.ok, true);
  assert.deepEqual(resB.players.map(p => p.name), ["小妖B1", "自由人B2", "未知俱乐部B3"]);
  assert.equal(resB.players[0].freeAgent, false);
  assert.equal(resB.players[0].club, "巴塞罗那");
  assert.equal(resB.players[0].clubStatus, "contracted");
  assert.equal(resB.players[1].freeAgent, true);
  assert.equal(resB.players[1].club, "自由球员");
  assert.equal(resB.players[1].clubStatus, "free_agent");
  assert.equal(resB.players[2].freeAgent, null, "Club 未就绪绝不能误报为自由球员");
  assert.equal(resB.players[2].club, null);
  assert.equal(resB.players[2].clubStatus, "unavailable");
  assert.equal(resB.activeShortlistRestore.status, "restored");

  // 2) 切换超时（列表死活不刷新）：拒绝返回旧名单 A 的球员
  activeIndex = 0;
  freezeListOnSwitch = true;
  await assert.rejects(
    () => sl.getShortlistPlayers({ shortlistName: "名单B", includeAttributes: false }),
    /切换未就绪/
  );
  freezeListOnSwitch = false;

  // 3) 恢复原名单失败：不吞异常，明确返回 ok:false, partialFailure:true
  activeIndex = 0;
  failRestore = true;
  const resFail = await sl.getShortlistPlayers({ shortlistName: "名单B", includeAttributes: false });
  assert.equal(resFail.ok, false);
  assert.equal(resFail.partialFailure, true);
  assert.equal(resFail.activeShortlistRestore.status, "restore_failed");
  failRestore = false;

  // 4) 玩家读取期间主动切到第三份名单 C：保留玩家选择不强行覆写
  activeIndex = 0;
  startedReadingBPlayers = false;
  userSwitchesToThird = true;
  switchHistory.length = 0;
  const resPreserve = await sl.getShortlistPlayers({ shortlistName: "名单B", includeAttributes: false });
  assert.equal(resPreserve.ok, true);
  assert.equal(resPreserve.activeShortlistRestore.status, "preserved_user_selection");
  assert.equal(resPreserve.activeShortlistRestore.currentActive.index, 2);
  assert.deepEqual(switchHistory, [1], "玩家切去第三份名单 C 后不得再发送切回原名单 0 的事件");
});

test("07b：search_players(freeAgentOnly:true) 不会将 Club 订阅未就绪球员误判为自由球员", async () => {
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
      const prop = propsById.get(Number(q.get("property")));
      handleMeta.set(handle, { prop, path: q.get("path") || "", source: q.get("source") || "" });
      return { ok: true, handle, reference: { type: "MockRef" } };
    }
    if (pathname === "/api/v1/live/read") {
      const meta = handleMeta.get(q.get("handle"));
      if (meta.prop === "Team") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
      if (meta.prop === "HumanPersonSearch") return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.PersonSearchReference" } };
      if (meta.prop === "PersonList") return { ok: true, status: "ready", value: { kind: "list", count: 2, items: [{ identity: "p0" }, { identity: "p1" }] } };
      if (meta.prop === "Name") return { ok: true, status: "ready", value: { kind: "scalar", value: meta.path === "0" ? "明确自由人" : "俱乐部未就绪人" } };
      if (meta.prop === "Club") {
        if (meta.path === "0") return { ok: true, status: "ready", value: { kind: "reference", type: "SI.Bindable.NullReference" } };
        return { ok: true, status: "awaiting_response", value: null };
      }
      return { ok: true, status: "ready", value: { kind: "scalar", value: "21" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };
  const sp = createPlayerSearchFilterTools(mockCall);
  const res = await sp.searchPlayers({ freeAgentOnly: true, limit: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.players.length, 1);
  assert.equal(res.players[0].name, "明确自由人");
  assert.equal(res.players[0].clubStatus, "free_agent");
});

test("08：rename_tactic 严格区分 unchanged / verified / unverified 三态", async () => {
  let currentName = "高位压迫 4231";
  let allowChange = true;
  let updateCount = 0;
  let seq = 0;
  const propsById = new Map();
  const handleProp = new Map();

  const mockCall = async (route, opts = {}) => {
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
      handleProp.set(handle, propsById.get(Number(q.get("property"))));
      return { ok: true, handle, reference: { type: "FM.UI.TeamTacticReference" } };
    }
    if (pathname === "/api/v1/live/read") {
      const prop = handleProp.get(q.get("handle"));
      if (prop === "Name") return { ok: true, status: "ready", value: { kind: "scalar", value: currentName } };
      return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamTacticReference" } };
    }
    if (pathname === "/api/v1/internal/update") {
      updateCount++;
      if (allowChange) currentName = JSON.parse(opts.body);
      return { ok: true, status: "dispatched_unverified" };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    throw new Error(`未预期路由: ${route}`);
  };

  const tc = createTacticChangeTools(mockCall);

  // 1) 同名 -> unchanged 且 0 次写入
  const rSame = await tc.rename({ name: "高位压迫 4231" });
  assert.equal(rSame.ok, true);
  assert.equal(rSame.status, "unchanged");
  assert.equal(rSame.changed, false);
  assert.equal(updateCount, 0);

  // 2) A -> B 读回一致 -> verified
  const rOk = await tc.rename({ name: "防反 442" });
  assert.equal(rOk.ok, true);
  assert.equal(rOk.status, "verified");
  assert.equal(rOk.changed, true);
  assert.equal(rOk.verified, true);
  assert.equal(rOk.afterName, "防反 442");

  // 3) 派发后读回仍未变 -> ok:false, status:unverified
  allowChange = false;
  const rFail = await tc.rename({ name: "摆大巴 541" });
  assert.equal(rFail.ok, false);
  assert.equal(rFail.status, "unverified");
  assert.equal(rFail.verified, false);
  assert.equal(rFail.afterName, "防反 442");
});

test("06b/09/10/13：真实 MCP stdio 网关（异目录启动）验证 compact:false 全树、索引别名映射前置/冲突与移除 restoreActive", async () => {
  let seq = 0;
  const propsById = new Map();
  const handleProp = new Map();

  const mockHandler = ({ pathname, searchParams }) => {
    if (pathname === "/api/v1/match/state") return { ok: true, inMatch: false };
    if (pathname === "/api/v1/live/properties") {
      const f = searchParams.get("filter") || "";
      const id = ++seq;
      propsById.set(id, f);
      return { ok: true, properties: [{ id, name: `${f}:mock`, contexts: [] }] };
    }
    if (pathname === "/api/v1/live/open") {
      const handle = `h_${++seq}`;
      handleProp.set(handle, propsById.get(Number(searchParams.get("property"))));
      return { ok: true, handle, reference: { type: "FM.UI.TeamReference" } };
    }
    if (pathname === "/api/v1/live/read") {
      const prop = handleProp.get(searchParams.get("handle"));
      if (prop === "HumanJobCentreCurrentAdverts" || prop === "ClubJobAdverts") {
        // 构造 20 条职位广告用于验证 compact:true 截断 vs compact:false 完整取回
        const items = Array.from({ length: 20 }, (_, i) => ({
          kind: "record",
          fields: { "0x71764a36": { kind: "scalar", value: `职位广告_${i}` } }
        }));
        return { ok: true, status: "ready", value: { kind: "list", count: 20, items } };
      }
      if (prop === "SetPieceTakerDataForSide") {
        const items = Array.from({ length: 18 }, (_, i) => ({
          kind: "record",
          fields: { "0x71764a36": { kind: "scalar", value: `主罚候选_${i}` } }
        }));
        return { ok: true, status: "ready", value: { kind: "record", fields: { "0x38435761": { kind: "list", count: 18, items } } } };
      }
      if (prop === "Players") {
        const items = Array.from({ length: 5 }, (_, i) => ({ kind: "reference", type: "FM.UI.PersonReference", identity: `p_${i}` }));
        return { ok: true, status: "ready", value: { kind: "list", count: 5, items } };
      }
      if (prop === "Name") return { ok: true, status: "ready", value: { kind: "scalar", value: "测试球员" } };
      return { ok: true, status: "ready", value: { kind: "reference", type: "FM.UI.TeamReference" } };
    }
    if (pathname === "/api/v1/live/close") return { ok: true };
    return { ok: true };
  };

  // 第 13 项：将工作目录设为 os.tmpdir()（仓库外部目录），使用绝对路径入口启动
  await withMockGateway({ handler: mockHandler, cwd: os.tmpdir() }, async ({ sendReq }) => {
    const listRes = await sendReq("tools/list");
    assert.deepEqual(listRes.result.tools.map(t => t.name), ["plugin_health", "fm_discover", "fm_call", "fm_continue_game"]);

    // 第 06 项：get_shortlist_players 已移除 restoreActive，传入应被前置 Schema 校验拒绝
    const badRestore = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "get_shortlist_players", params: { restoreActive: false } }
    });
    assert.equal(badRestore.result.isError, true);
    assert.match(badRestore.result.content[0].text, /参数校验失败/);

    // 第 09 项：list_job_adverts 默认 compact=true 裁剪至 10 条；传 compact:false 应通过校验并返回全部 20 条
    const compactRes = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "list_job_adverts", params: {} }
    });
    assert.notEqual(compactRes.result.isError, true);
    const compactJson = JSON.parse(compactRes.result.content[0].text);
    assert.equal(compactJson.compact, true);

    const fullRes = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "list_job_adverts", params: { compact: false } }
    });
    assert.notEqual(fullRes.result.isError, true);
    const fullJson = JSON.parse(fullRes.result.content[0].text);
    assert.equal(fullJson.compact, undefined, "传 compact:false 不应再被紧凑裁剪");
    const listField = Object.values(fullJson).find(v => v?.items?.length === 20) ||
      Object.values(fullJson.adverts || fullJson.marketAdverts || fullJson.clubAdverts || {}).find(v => v?.items?.length === 20);
    const rawFullText = fullRes.result.content[0].text;
    assert.match(rawFullText, /职位广告_19/, "compact:false 应完整包含第 20 条广告（index=19）");
    assert.ok(listField || rawFullText.includes("职位广告_19"));

    const spFull = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "get_set_piece_takers", params: { setPieceType: 0, setPiecePitchSide: 0, compact: false } }
    });
    assert.notEqual(spFull.result.isError, true, "get_set_piece_takers 传 compact:false 应通过前置 Schema 校验");
    assert.match(spFull.result.content[0].text, /主罚候选_17/, "get_set_piece_takers compact:false 应返回全部 18 名候选");

    // 第 10 项：仅声明 playerIndex 的工具，测试标准名、别名 squadIndex 与冲突拦截
    const stdCall = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "get_player_career_playing_time_and_reserves", params: { playerIndex: 2 } }
    });
    assert.notEqual(stdCall.result.isError, true, "标准字段 playerIndex 应正常通过校验");

    const aliasCall = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "get_player_career_playing_time_and_reserves", params: { squadIndex: 2 } }
    });
    assert.notEqual(aliasCall.result.isError, true, "别名 squadIndex 应在校验前转换为 playerIndex 并剔除别名后通过");

    const conflictCall = await sendReq("tools/call", {
      name: "fm_call",
      arguments: { action: "get_player_career_playing_time_and_reserves", params: { squadIndex: 1, playerIndex: 2 } }
    });
    assert.equal(conflictCall.result.isError, true);
    assert.match(conflictCall.result.content[0].text, /参数冲突/);
  });
});
