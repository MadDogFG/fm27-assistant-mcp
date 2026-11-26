/**
 * mcp/core/property-registry.mjs — 可自动恢复的属性字典缓存工具
 * 仅在成功拉取到非空属性字典时写入缓存；首次失败或返回空列表时绝不缓存空 Map，
 * 避免桥进程在整个生命周期内丧失十六进制属性名解码能力（Review #46）。
 */
export function createPropertyRegistryCache(call) {
  let cachedIdMap = null;

  async function getPropertyMap() {
    if (cachedIdMap && cachedIdMap.size > 0) return cachedIdMap;
    try {
      const reg = await call("/api/v1/internal/registry?kind=properties");
      const items = Array.isArray(reg?.items) ? reg.items : [];
      if (items.length > 0) {
        cachedIdMap = new Map(items.map(x => [x.id, x.name]));
        return cachedIdMap;
      }
      // 空响应不写入持久缓存，允许下次调用自动重试
      return new Map();
    } catch {
      // 首次读取失败不污染缓存，下次调用自动恢复
      return new Map();
    }
  }

  function invalidate() {
    cachedIdMap = null;
  }

  return { getPropertyMap, invalidate };
}
