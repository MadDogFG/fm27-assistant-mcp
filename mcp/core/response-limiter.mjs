/**
 * mcp/core/response-limiter.mjs — 真正的 UTF-8 硬字节响应限流器。
 * 既递归折叠超长数组、深层嵌套和超长字符串，也保证最终 UTF-8 序列化体积绝不突破 maxBytes 硬上限。
 */

export const DEFAULT_MAX_RESPONSE_BYTES = 120_000;

function trimNode(node, { maxItems, maxDepth, maxStringLen, maxKeys }, depth = 0) {
  if (typeof node === "string") {
    if (node.length <= maxStringLen) return node;
    return `${node.slice(0, maxStringLen)}... [已截断，原长 ${node.length} 字符]`;
  }
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (depth >= maxDepth) {
    if (Array.isArray(node)) return `[array length=${node.length}]`;
    if (node.identity) return { type: node.type, identity: node.identity };
    return `[object keys=${Object.keys(node).length}]`;
  }
  if (Array.isArray(node)) {
    const kept = node.slice(0, maxItems).map(item => trimNode(item, { maxItems, maxDepth, maxStringLen, maxKeys }, depth + 1));
    if (node.length > maxItems) {
      return {
        _truncated: true,
        _originalCount: node.length,
        _keptCount: maxItems,
        items: kept
      };
    }
    return kept;
  }
  const out = {};
  const entries = Object.entries(node);
  const sliced = entries.slice(0, maxKeys);
  for (const [k, v] of sliced) {
    out[k] = trimNode(v, { maxItems, maxDepth, maxStringLen, maxKeys }, depth + 1);
  }
  if (entries.length > maxKeys) {
    out._truncatedKeys = entries.length - maxKeys;
  }
  return out;
}

/**
 * 将响应对象控制在 maxBytes（UTF-8 字节）硬上限以内，返回 { data, text, bytes, truncated }。
 */
export function enforceHardByteLimit(payload, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const safeMax = Math.max(512, Number(maxBytes) || DEFAULT_MAX_RESPONSE_BYTES);
  const rawText = JSON.stringify(payload, null, 2);
  const rawBytes = Buffer.byteLength(rawText, "utf8");
  if (rawBytes <= safeMax) {
    return { data: payload, text: rawText, bytes: rawBytes, truncated: false };
  }

  // 两级结构化渐进裁剪：优先保持合法 JSON 结构
  const passes = [
    { maxItems: 40, maxDepth: 6, maxStringLen: 4000, maxKeys: 60 },
    { maxItems: 15, maxDepth: 4, maxStringLen: 1500, maxKeys: 30 },
    { maxItems: 6, maxDepth: 3, maxStringLen: 400, maxKeys: 15 }
  ];

  for (const opts of passes) {
    const candidate = trimNode(payload, opts);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      candidate._payloadGuarded = true;
      candidate._originalBytes = rawBytes;
    }
    const text = JSON.stringify(candidate, null, 2);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= safeMax) {
      return { data: candidate, text, bytes, truncated: true };
    }
  }

  // 兜底硬截断：无论单字段多大，严格保证输出字节数 <= safeMax
  const overhead = 260;
  const previewBudget = Math.max(64, Math.floor((safeMax - overhead) / 4));
  let preview = rawText.slice(0, previewBudget);
  const wrap = p => JSON.stringify({
    ok: payload?.ok !== false,
    _hardTruncated: true,
    _originalBytes: rawBytes,
    _maxBytes: safeMax,
    note: "响应超出硬字节上限，已强行截断；请传分页参数或使用更精细的查询字段。",
    preview: p
  });
  let finalText = wrap(preview);
  while (Buffer.byteLength(finalText, "utf8") > safeMax && preview.length > 16) {
    preview = preview.slice(0, Math.floor(preview.length * 0.7));
    finalText = wrap(preview);
  }
  return {
    data: JSON.parse(finalText),
    text: finalText,
    bytes: Buffer.byteLength(finalText, "utf8"),
    truncated: true
  };
}
