/**
 * 解析器接口。见 design/token-tracking.md。
 *
 * 每个解析器导出：
 *   id / label / lineFilter
 *   dataDirs()             用于检测该工具是否安装
 *   discover({listJsonl})  → 候选文件列表
 *   createFileParser(prev) → { onObject(obj), finish() -> {records, state} }
 *
 * 为什么是 createFileParser 而不是纯函数 parseObject(obj)：
 * Codex 的用量是**累计值**，判重与增量计算都依赖「上一条的累计总量」这个跨行状态。
 * 更关键的是增量尾读——只读文件新增部分时，解析器必须能从上次的续读状态接着算，
 * 所以状态要能随解析缓存一起持久化（vibe-usage 称之为 parser continuation state）。
 *
 * 无状态解析器用 statelessParser() 包一层即可，不必关心这些。
 */

export function statelessParser(parseObject) {
  return function createFileParser() {
    const records = [];
    return {
      onObject(obj) {
        const record = parseObject(obj);
        if (record) records.push(record);
      },
      finish() {
        return { records, state: null };
      },
    };
  };
}
