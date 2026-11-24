import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExtendedTools } from "../../mcp/extended-tools.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_DIR = path.join(ROOT, "skills", "fm27-assistant");

const CORE_BUILTIN_TOOLS = [
  "plugin_health", "fm_discover", "fm_call", "fm_continue_game",
  "get_inbox", "get_formation_options", "set_formation", "get_tactic_roles", "set_player_role", "operation_status"
];

test("Skills 全部文档的相对链接目标文件均存在", () => {
  const mdFiles = [
    path.join(SKILL_DIR, "SKILL.md"),
    ...fs.readdirSync(path.join(SKILL_DIR, "references")).filter(f => f.endsWith(".md")).map(f => path.join(SKILL_DIR, "references", f))
  ];
  for (const file of mdFiles) {
    const dir = path.dirname(file);
    const content = fs.readFileSync(file, "utf8");
    for (const m of content.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
      const rel = m[1];
      if (/^https?:\/\//i.test(rel)) continue;
      const target = path.resolve(dir, rel);
      assert.ok(fs.existsSync(target), `${path.basename(file)} 引用了不存在的文档链接: ${rel}`);
    }
  }
});

test("Skills 全部文档引用的工具名 100% 存在于注册表中（0 无效引用）", () => {
  const ext = createExtendedTools(async () => ({}));
  const validTools = new Set([...Object.keys(ext.handlers), ...CORE_BUILTIN_TOOLS]);

  const mdFiles = [
    path.join(SKILL_DIR, "SKILL.md"),
    ...fs.readdirSync(path.join(SKILL_DIR, "references")).filter(f => f.endsWith(".md")).map(f => path.join(SKILL_DIR, "references", f))
  ];
  const invalid = [];
  for (const file of mdFiles) {
    const content = fs.readFileSync(file, "utf8");
    const matches = content.match(/`([a-z][a-z0-9_]{3,})`/g) || [];
    for (const m of matches) {
      const name = m.slice(1, -1);
      if (/^(get_|set_|create_|change_|manage_|list_|search_|select_|submit_|reply_|open_|execute_|stage_|start_|answer_|continue_|request_|preview_|assign_|discard_|copy_|paste_|mark_|edit_|compare_|live_|fm_|plugin_|optimize_|audit_)/.test(name)) {
        if (!validTools.has(name)) invalid.push(`${path.basename(file)}:${name}`);
      }
    }
  }
  assert.deepEqual(invalid, [], `发现无效工具引用: ${invalid.join(", ")}`);
});
