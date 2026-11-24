/**
 * mcp/core/auth.mjs — 本地随机 Bearer Token 加载与热刷新。
 * 插件每次启动都会把新生成的 256-bit 会话密钥写入 %LOCALAPPDATA%\FMAssistant\session.token。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveDefaultTokenPath() {
  if (process.env.FM_ASSISTANT_TOKEN_FILE) {
    return process.env.FM_ASSISTANT_TOKEN_FILE;
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "FMAssistant", "session.token");
}

export function createAuthTokenProvider({ tokenFilePath = resolveDefaultTokenPath(), envToken = process.env.FM_ASSISTANT_TOKEN } = {}) {
  let cachedToken = null;
  let cachedMtimeMs = -1;

  function readTokenFromDisk(force = false) {
    if (envToken && String(envToken).trim()) {
      return String(envToken).trim();
    }
    try {
      const stat = fs.statSync(tokenFilePath);
      if (!force && cachedToken && stat.mtimeMs === cachedMtimeMs) {
        return cachedToken;
      }
      const raw = fs.readFileSync(tokenFilePath, "utf8").trim();
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        cachedToken = typeof parsed?.token === "string" ? parsed.token.trim() : null;
      } catch {
        // 兼容纯文本 token 文件
        cachedToken = raw;
      }
      cachedMtimeMs = stat.mtimeMs;
      return cachedToken;
    } catch {
      return null;
    }
  }

  return {
    tokenFilePath,
    getToken(forceReload = false) {
      return readTokenFromDisk(forceReload);
    },
    getAuthHeaders(forceReload = false) {
      const token = readTokenFromDisk(forceReload);
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    },
    invalidate() {
      cachedToken = null;
      cachedMtimeMs = -1;
    }
  };
}
