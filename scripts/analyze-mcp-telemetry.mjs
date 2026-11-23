#!/usr/bin/env node
/**
 * 分析 logs/mcp.log 中的遥测数据：按工具汇总调用次数、成功率、耗时、响应体积与估算 Token。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = process.argv[2] || path.resolve(__dirname, "..", "logs", "mcp.log");

if (!fs.existsSync(logPath)) {
  console.log("日志文件不存在:", logPath);
  process.exit(0);
}

const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
const stats = new Map();
const lineRe = /^\[([^\]]+)\] \[(INFO|WARN|ERROR)\] ([^\s]+) \((\d+)ms(?:, bytes=(\d+))?\)/;

for (const line of lines) {
  const m = line.match(lineRe);
  if (!m) continue;
  const [, , level, tool, msStr, bytesStr] = m;
  const ms = Number(msStr);
  const bytes = bytesStr ? Number(bytesStr) : 0;
  if (!stats.has(tool)) {
    stats.set(tool, { tool, calls: 0, errors: 0, totalMs: 0, maxMs: 0, totalBytes: 0, maxBytes: 0 });
  }
  const s = stats.get(tool);
  s.calls++;
  if (level === "ERROR" || level === "WARN") s.errors++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  s.totalBytes += bytes;
  if (bytes > s.maxBytes) s.maxBytes = bytes;
}

const rows = [...stats.values()].sort((a, b) => b.totalBytes - a.totalBytes || b.calls - a.calls);
console.log(`共解析 ${lines.length} 行日志，涉及 ${rows.length} 个工具：\n`);
console.log("工具名 | 调用数 | 异常数 | 均耗时ms | 最大耗时ms | 均体积B | 最大体积B | 估算总Token");
console.log("---|---:|---:|---:|---:|---:|---:|---:");
for (const r of rows.slice(0, 40)) {
  const avgMs = Math.round(r.totalMs / r.calls);
  const avgB = Math.round(r.totalBytes / r.calls);
  const estTok = Math.round(r.totalBytes / 3.2);
  console.log(`${r.tool} | ${r.calls} | ${r.errors} | ${avgMs} | ${r.maxMs} | ${avgB} | ${r.maxBytes} | ${estTok}`);
}
