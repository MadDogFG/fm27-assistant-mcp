/**
 * mcp/core/schema-validator.mjs — 零依赖轻量 JSON Schema 校验器。
 * 在 fm_call / tools/call 进入游戏主线程前拦截非法参数，给出清晰的中文错误提示。
 */

function describeType(val) {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  return typeof val;
}

function validateNode(schema, value, fieldPath, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${fieldPath} 必须是以下允许值之一：${schema.enum.map(v => JSON.stringify(v)).join(" / ")}（当前：${JSON.stringify(value)}）`);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some(t => {
      if (t === "integer") return typeof value === "number" && Number.isInteger(value);
      if (t === "number") return typeof value === "number" && Number.isFinite(value);
      if (t === "string") return typeof value === "string";
      if (t === "boolean") return typeof value === "boolean";
      if (t === "array") return Array.isArray(value);
      if (t === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
      if (t === "null") return value === null;
      return true;
    });
    if (!ok) {
      errors.push(`${fieldPath} 类型错误：期望 ${types.join("|")}，实际收到 ${describeType(value)}`);
      return;
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${fieldPath} 不能小于 ${schema.minimum}（当前：${value}）`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${fieldPath} 不能大于 ${schema.maximum}（当前：${value}）`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${fieldPath} 长度不能少于 ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${fieldPath} 长度不能超过 ${schema.maxLength}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${fieldPath} 至少需要 ${schema.minItems} 项（当前：${value.length}）`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${fieldPath} 最多允许 ${schema.maxItems} 项（当前：${value.length}）`);
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map(v => JSON.stringify(v)));
      if (seen.size !== value.length) {
        errors.push(`${fieldPath} 不能包含重复元素`);
      }
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(schema.items, value[i], `${fieldPath}[${i}]`, errors);
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (value[reqKey] === undefined || value[reqKey] === null) {
          errors.push(`缺少必填参数 ${fieldPath === "params" ? reqKey : `${fieldPath}.${reqKey}`}`);
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          errors.push(`不支持的未知参数 ${fieldPath === "params" ? key : `${fieldPath}.${key}`}`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (value[key] !== undefined) {
        validateNode(propSchema, value[key], fieldPath === "params" ? key : `${fieldPath}.${key}`, errors);
      }
    }
  }
}

/**
 * 校验参数是否满足目标工具的 inputSchema
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateToolArgs(schema, args) {
  if (!schema || typeof schema !== "object") return { ok: true, errors: [] };
  const normalized = args === undefined || args === null ? {} : args;
  const errors = [];
  validateNode(schema, normalized, "params", errors);
  return { ok: errors.length === 0, errors };
}
