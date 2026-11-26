#!/usr/bin/env node
/**
 * scripts/generate-mcp-config.mjs — 生成包含当前仓库实际绝对路径的 MCP 客户端配置。
 * 解决宿主从非仓库工作目录启动时，相对路径 "mcp/fm-assistant-mcp.mjs" 无法定位入口的问题。
 *
 * 用法：
 *   node scripts/generate-mcp-config.mjs          # 仅向标准输出打印 JSON 配置
 *   node scripts/generate-mcp-config.mjs --write  # 同时写入仓库根目录 mcp_config.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(ROOT, "mcp", "fm-assistant-mcp.mjs");
const url = process.env.FM_ASSISTANT_URL || "http://127.0.0.1:27190";

export function buildAbsoluteMcpConfig(rootDir = ROOT, assistantUrl = url) {
  const absoluteEntry = path.resolve(rootDir, "mcp", "fm-assistant-mcp.mjs");
  return {
    mcpServers: {
      "fm27-assistant": {
        command: "node",
        args: [absoluteEntry],
        env: {
          FM_ASSISTANT_URL: assistantUrl
        }
      }
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = buildAbsoluteMcpConfig(ROOT, url);
  const formatted = JSON.stringify(config, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    const target = path.join(ROOT, "mcp_config.json");
    fs.writeFileSync(target, formatted, "utf8");
    process.stderr.write(`已写入绝对路径配置到 ${target}（入口：${entryPath}）\n`);
  }
  process.stdout.write(formatted);
}
