/**
 * mcp/core/execution-queue.mjs — 读写分离并发调度器。
 * - 纯只读操作（readOnly=true 且 exclusiveState=false）可并发执行，绝不被耗时写操作阻塞（如 plugin_health / fm_discover）；
 * - 写操作与共享可变状态操作（如 search_players 修改全局搜索框）进入独立串行写队列，防止竞态覆盖与超时冲突。
 */

export function createExecutionQueue() {
  let writeTail = Promise.resolve();
  let activeReads = 0;
  let queuedWrites = 0;

  return {
    run(meta, fn) {
      const needsSerialization = !meta?.readOnly || Boolean(meta?.exclusiveState);
      if (!needsSerialization) {
        activeReads++;
        return Promise.resolve()
          .then(fn)
          .finally(() => { activeReads--; });
      }

      queuedWrites++;
      const runTask = () => Promise.resolve().then(fn);
      const next = writeTail.then(runTask, runTask);
      writeTail = next.catch(() => {}).finally(() => { queuedWrites--; });
      return next;
    },
    stats() {
      return { activeReads, queuedWrites };
    }
  };
}
