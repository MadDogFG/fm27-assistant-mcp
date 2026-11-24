import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createExtendedTools } from "../../mcp/extended-tools.mjs";
import { classifyToolDomain, resolveToolMetadata, discoverTools } from "../../mcp/tool-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function collectFiles(dir, extRegex) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!["bin", "obj", "node_modules", ".git"].includes(ent.name)) {
        out.push(...collectFiles(full, extRegex));
      }
    } else if (extRegex.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

test("全仓 .mjs 文件均通过 Node 语法检查", () => {
  const files = [
    ...collectFiles(path.join(ROOT, "mcp"), /\.mjs$/),
    ...collectFiles(path.join(ROOT, "scripts"), /\.mjs$/),
    ...collectFiles(path.join(ROOT, "tests"), /\.mjs$/)
  ];
  assert.ok(files.length > 50, `预期至少 50 个 .mjs 文件，实际仅找到 ${files.length}`);
  for (const file of files) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
});

test("扩展工具注册表无重名、无缺失 handler、Schema required 合法", () => {
  const ext = createExtendedTools(async () => ({}));
  assert.ok(ext.tools.length >= 300, `工具数异常: ${ext.tools.length}`);
  const seen = new Set();
  for (const tool of ext.tools) {
    assert.ok(!seen.has(tool.name), `发现重复注册工具: ${tool.name}`);
    seen.add(tool.name);
    assert.equal(typeof ext.handlers[tool.name], "function", `工具缺少 handler: ${tool.name}`);
    const props = tool.inputSchema?.properties || {};
    for (const req of tool.inputSchema?.required || []) {
      assert.ok(req in props, `工具 ${tool.name} 的 required 字段 ${req} 不在 properties 中`);
    }
  }
});

test("显式元数据正确标注读写属性、共享状态锁、领域与风险等级", () => {
  const searchMeta = resolveToolMetadata("search_players");
  assert.equal(searchMeta.domain, "recruitment");
  assert.equal(searchMeta.readOnly, true);
  assert.equal(searchMeta.exclusiveState, true, "search_players 会写全局搜索框，必须串行锁保护");

  const styleMeta = resolveToolMetadata("set_tactical_style");
  assert.equal(styleMeta.domain, "tactics");
  assert.equal(styleMeta.readOnly, false);

  const bestXiMeta = resolveToolMetadata("optimize_best_xi");
  assert.equal(bestXiMeta.domain, "squad");
  assert.equal(bestXiMeta.readOnly, true);
  assert.equal(bestXiMeta.exclusiveState, false);

  const auditMeta = resolveToolMetadata("audit_squad_and_contracts");
  assert.equal(auditMeta.domain, "squad");
  assert.equal(auditMeta.readOnly, true);

  const highRiskMeta = resolveToolMetadata("execute_person_management_action");
  assert.equal(highRiskMeta.riskLevel, "high");

  assert.equal(classifyToolDomain("get_match_team_stats_and_xg"), "match");
});

test("fm_discover 中英文同义词与显式元数据返回正常", () => {
  const ext = createExtendedTools(async () => ({}));
  const r1 = discoverTools(ext.tools, { domain: "recruitment", query: "小妖", limit: 5 });
  assert.equal(r1.ok, true);
  assert.equal(r1.tools[0].name, "search_players");
  assert.equal(r1.tools[0].readOnly, true);

  const r2 = discoverTools(ext.tools, { domain: "squad", query: "最佳阵容", limit: 5 });
  assert.ok(r2.tools.some(t => t.name === "optimize_best_xi"));

  const r3 = discoverTools(ext.tools, { domain: "tactics", query: "高位压迫", limit: 5 });
  assert.ok(r3.tools.some(t => t.name === "set_tactical_style"));
});

test("仓库源码不包含私人用户名或个人本地路径泄漏", () => {
  const files = [
    ...collectFiles(path.join(ROOT, "mcp"), /\.(mjs|js|json)$/),
    ...collectFiles(path.join(ROOT, "bepinex-plugin", "FMAssistant"), /\.cs$/),
    ...collectFiles(path.join(ROOT, "skills"), /\.md$/),
    ...collectFiles(path.join(ROOT, "scripts"), /\.(mjs|ps1)$/)
  ];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.ok(!/a1347|汤 飞机|深圳青年人/i.test(content), `检测到个人敏感路径或测试存档残留: ${file}`);
  }
});
