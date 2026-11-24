import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAuthTokenProvider } from "../../mcp/core/auth.mjs";
import { validateToolArgs } from "../../mcp/core/schema-validator.mjs";
import { enforceHardByteLimit } from "../../mcp/core/response-limiter.mjs";
import { createExecutionQueue } from "../../mcp/core/execution-queue.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("AuthTokenProvider 支持读取 JSON token、热刷新与环境变量覆盖", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-auth-test-"));
  const tokenFile = path.join(tmpDir, "session.token");
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "secret-abc-123", pid: 100 }), "utf8");

  const provider = createAuthTokenProvider({ tokenFilePath: tokenFile, envToken: "" });
  assert.equal(provider.getToken(), "secret-abc-123");
  assert.deepEqual(provider.getAuthHeaders(), { Authorization: "Bearer secret-abc-123" });

  // 模拟游戏重启覆盖新 token 后强制重载
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "rotated-xyz-999", pid: 101 }), "utf8");
  provider.invalidate();
  assert.equal(provider.getToken(true), "rotated-xyz-999");

  // 环境变量显式优先
  const envProvider = createAuthTokenProvider({ tokenFilePath: tokenFile, envToken: "env-override" });
  assert.equal(envProvider.getToken(), "env-override");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("SchemaValidator 严格拦截缺失必填、错误类型、枚举越界与未知字段", () => {
  const schema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["save", "load"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      indices: { type: "array", items: { type: "integer", minimum: 0 }, uniqueItems: true }
    },
    required: ["action"],
    additionalProperties: false
  };

  assert.equal(validateToolArgs(schema, { action: "save", limit: 10, indices: [0, 1] }).ok, true);

  const missingReq = validateToolArgs(schema, { limit: 10 });
  assert.equal(missingReq.ok, false);
  assert.match(missingReq.errors[0], /action/);

  const badEnum = validateToolArgs(schema, { action: "drop" });
  assert.equal(badEnum.ok, false);

  const badRange = validateToolArgs(schema, { action: "save", limit: 999 });
  assert.equal(badRange.ok, false);

  const dupArray = validateToolArgs(schema, { action: "save", indices: [2, 2] });
  assert.equal(dupArray.ok, false);

  const extraProp = validateToolArgs(schema, { action: "save", hackerParam: true });
  assert.equal(extraProp.ok, false);
});

test("ResponseLimiter 强制保证超大数组与巨型单字符串都不突破 UTF-8 硬字节上限", () => {
  const hugeStringPayload = { ok: true, blob: "汉".repeat(120_000) };
  const res = enforceHardByteLimit(hugeStringPayload, 4096);
  assert.equal(res.truncated, true);
  assert.ok(Buffer.byteLength(res.text, "utf8") <= 4096, `实际字节 ${res.bytes} 超过硬上限 4096`);
  assert.doesNotThrow(() => JSON.parse(res.text), "截断后必须保持合法 JSON");

  const smallPayload = { ok: true, value: 42 };
  const resSmall = enforceHardByteLimit(smallPayload, 4096);
  assert.equal(resSmall.truncated, false);
  assert.deepEqual(resSmall.data, smallPayload);
});

test("ExecutionQueue 实现只读并发执行 + 写/独占状态严格串行保序", async () => {
  const queue = createExecutionQueue();
  const order = [];

  // 启动一个慢只读和一个快只读：快只读必须先结束（证明只读并发不互相阻塞）
  const rSlow = queue.run({ readOnly: true, exclusiveState: false }, async () => {
    await new Promise(r => setTimeout(r, 60));
    order.push("read-slow");
  });
  const rFast = queue.run({ readOnly: true, exclusiveState: false }, async () => {
    await new Promise(r => setTimeout(r, 10));
    order.push("read-fast");
  });
  await Promise.all([rSlow, rFast]);
  assert.deepEqual(order, ["read-fast", "read-slow"]);

  // 启动两个写任务：哪怕第一个慢第二个快，也必须严格先 1 后 2
  const wOrder = [];
  const w1 = queue.run({ readOnly: false, exclusiveState: true }, async () => {
    await new Promise(r => setTimeout(r, 50));
    wOrder.push("write-1");
  });
  const w2 = queue.run({ readOnly: true, exclusiveState: true }, async () => {
    await new Promise(r => setTimeout(r, 5));
    wOrder.push("write-2-exclusive");
  });
  await Promise.all([w1, w2]);
  assert.deepEqual(wOrder, ["write-1", "write-2-exclusive"]);
});

test("MCP stdio 进程端到端协议测试：版本协商、4元工具暴露、前置参数校验与单载荷输出", async () => {
  const child = spawn(process.execPath, [path.join(ROOT, "mcp", "fm-assistant-mcp.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FM_ASSISTANT_LOG_FILE: path.join(os.tmpdir(), `fm-mcp-test-${Date.now()}.log`) }
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

  function sendReq(id, method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const timer = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(timer);
          resolve(responses.get(id));
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`MCP response timeout for id=${id}`));
        }
      }, 20);
    });
  }

  try {
    // 1. 不支持的未来协议版本应回退到服务端最高支持版本，而非盲目回显
    const init = await sendReq(1, "initialize", { protocolVersion: "2099-01-01" });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.version, "1.1.0");

    // 2. tools/list 默认仅暴露 4 个元工具
    const list = await sendReq(2, "tools/list");
    assert.deepEqual(list.result.tools.map(t => t.name), ["plugin_health", "fm_discover", "fm_call", "fm_continue_game"]);

    // 3. fm_discover 离线可用且默认不输出重复 structuredContent
    const disc = await sendReq(3, "tools/call", { name: "fm_discover", arguments: { domain: "squad", query: "最佳阵容" } });
    assert.equal(disc.result.structuredContent, undefined, "默认不应吐出重复 structuredContent 浪费上下文");
    const discData = JSON.parse(disc.result.content[0].text);
    assert.equal(discData.ok, true);
    assert.ok(discData.tools.some(t => t.name === "optimize_best_xi"));

    // 4. fm_call 前置 Schema 校验应直接拦截坏参数（无需连接游戏即可立即报错）
    const badCall = await sendReq(4, "tools/call", {
      name: "fm_call",
      arguments: { action: "set_player_role", params: { selectionIndex: 99, role: "GK" } }
    });
    assert.equal(badCall.result.isError, true);
    assert.match(badCall.result.content[0].text, /参数校验失败/);
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test("set_tactical_style：空战术（TacticalStyleDropdown=null）时必须本地拦截且绝不派发写入", async () => {
  const { createTacticSlotTools } = await import("../../mcp/tactic-slot-tools.mjs");
  let updateDispatched = 0;
  let seq = 0;
  const mockValues = new Map();
  const mockCall = async (route, opts = {}) => {
    if (route.startsWith("/api/v1/internal/update")) {
      updateDispatched++;
      throw new Error("空战术严禁到达 /api/v1/internal/update");
    }
    if (route.startsWith("/api/v1/match/state")) return { ok: true, inMatch: false };
    if (route.startsWith("/api/v1/live/properties")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      const filter = q.get("filter") || "";
      const id = ++seq;
      return { ok: true, properties: [{ id, name: `${filter}:mock`, contexts: [] }] };
    }
    if (route.startsWith("/api/v1/live/open")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      const handle = `h_${++seq}`;
      const propId = Number(q.get("property"));
      // 顺序：1=Team, 2=Tactic, 3=TacticalStyle, 4=TacticalStyleDropdown, 5=Options, 6=Rec, 7=Mentality
      if (propId === 3) mockValues.set(handle, { kind: "scalar", value: "-1" });
      else if (propId === 4) mockValues.set(handle, null);
      else if (propId === 5) mockValues.set(handle, { kind: "list", items: [{ fields: { "0x7074766c": { value: "7" }, "0x71764a36": { value: "快速防反" } } }] });
      else if (propId === 6) mockValues.set(handle, { kind: "list", items: [] });
      else if (propId === 7) mockValues.set(handle, { kind: "scalar", value: "0" });
      else mockValues.set(handle, { kind: "reference", type: "FM.UI.TeamReference" });
      return { ok: true, handle, reference: { type: "FM.UI.TeamReference" } };
    }
    if (route.startsWith("/api/v1/live/read")) {
      const q = new URLSearchParams(route.split("?")[1] || "");
      return { ok: true, status: "ready", value: mockValues.get(q.get("handle")) ?? null };
    }
    if (route.startsWith("/api/v1/live/close")) return { ok: true };
    throw new Error(`未预期的路由: ${route}`);
  };

  const tools = createTacticSlotTools(mockCall);
  const res = await tools.setStyle({ style: "7" });
  assert.equal(res.ok, false);
  assert.equal(res.blockedReason, "no_active_tactic");
  assert.equal(updateDispatched, 0, "空战术绝不应发出 /api/v1/internal/update");
});
