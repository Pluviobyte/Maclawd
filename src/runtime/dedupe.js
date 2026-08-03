import { throughput } from './usage-record.js';

/**
 * 两级去重。见 design/token-tracking.md「去重合同」。
 *
 *   Claude Code：uuid（不同 uuid 即使 message/request 相同也是合法分片）
 *   其余来源主键：(message.id, requestId)
 *   其余来源次键：uuid              仅当 message.id 缺失
 *   特例：同 message.id、不同 requestId，且任一方 isSidechain → 视为重复合并
 *
 * 主键防的是 API 流式重试——同一次响应会写出多行不同 uuid、相同 message.id 的记录。
 * 只按 uuid 去重（vibe-usage 的做法）防不住这种重复。
 */

/** 冲突时是否用 candidate 替换 existing。 */
export function prefer(candidate, existing) {
  // 1. 非 sidechain 优先于 sidechain
  if (candidate.sidechain !== existing.sidechain) return existing.sidechain;
  // 2. throughput 大者优先（Claude 有时把同一条记录以零用量复制到别处）
  const a = throughput(candidate);
  const b = throughput(existing);
  if (a !== b) return a > b;
  // 3. 先出现者优先，保证结果确定
  return false;
}

export function dedupe(records) {
  const selected = [];
  const exact = new Map();
  const byMessage = new Map();

  for (const record of records) {
    const messageId = record.messageId;
    let index = null;
    let exactKey = null;
    // 键里带 source，避免两个工具的 id 空间偶然碰撞时互相吃掉记录。
    const scope = record.source ?? '';

    // Claude Code 的一个 API 响应会把多个独立 usage 片段写成相同的
    // message.id/requestId，但每个片段有自己的 UUID。Vibe Usage 的真实数据
    // 证明按 message/request 合并会吃掉一半以上 Token，所以 Claude 必须以 UUID
    // 为逻辑记录身份；没有 UUID 的匿名行宁可保留，也不能猜成重复。
    if (record.source === 'claude-code') {
      if (record.uuid) {
        exactKey = `u ${scope} ${record.uuid}`;
        const hit = exact.get(exactKey);
        if (hit !== undefined) index = hit;
      }
    } else if (messageId) {
      exactKey = `m ${scope} ${messageId} ${record.requestId ?? ''}`;
      const hit = exact.get(exactKey);
      if (hit !== undefined) {
        index = hit;
      } else {
        // 同 message.id 但 requestId 不同：只有牵涉 sidechain 时才合并。
        // 无条件合并会把同一条消息的多个合法分片当成重复丢掉。
        for (const candidateIndex of byMessage.get(`${scope} ${messageId}`) ?? []) {
          if (record.sidechain || selected[candidateIndex].sidechain) {
            index = candidateIndex;
            break;
          }
        }
      }
    } else if (record.uuid) {
      exactKey = `u ${scope} ${record.uuid}`;
      const hit = exact.get(exactKey);
      if (hit !== undefined) index = hit;
    }

    if (index !== null) {
      if (prefer(record, selected[index])) selected[index] = record;
      // 无论替换与否都登记主键，让后续同键记录直接命中而不必再扫一遍。
      if (exactKey !== null) exact.set(exactKey, index);
      continue;
    }

    index = selected.length;
    selected.push(record);
    if (exactKey !== null) exact.set(exactKey, index);
    if (messageId && record.source !== 'claude-code') {
      const groupKey = `${scope} ${messageId}`;
      const list = byMessage.get(groupKey);
      if (list) list.push(index);
      else byMessage.set(groupKey, [index]);
    }
  }

  return selected;
}
