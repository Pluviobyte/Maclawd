import { throughput } from './usage-record.js';

/** Claude 的调用身份供历史扫描和实时窗口共用。 */
export function claudeUsageKey(record) {
  const message = typeof record.messageId === 'string' ? record.messageId.trim() : '';
  const request = typeof record.requestId === 'string' ? record.requestId.trim() : '';
  if (message || request) return JSON.stringify(['claude-code', 'call', message, request]);
  return record.uuid ? `u claude-code ${record.uuid}` : null;
}

/**
 * 两级去重。见 design/token-tracking.md「去重合同」。
 *
 *   Claude Code：(message.id, requestId)，均缺失时回落 uuid
 *   其余来源主键：(message.id, requestId)
 *   其余来源次键：uuid              仅当 message.id 缺失
 *   特例：同 message.id、不同 requestId，且任一方 isSidechain → 视为重复合并
 *
 * 主键防的是 API 流式重试——同一次响应会写出多行不同 uuid、相同 message.id 的记录。
 * 只按 uuid 去重防不住这种重复。
 */

/** 冲突时是否用 candidate 替换 existing。 */
export function prefer(candidate, existing) {
  // Codex fork 会改写外层时间但保留 payload。相同快照应归原消费时间，
  // 不能因扫描先读最新文件而把历史用量搬到 fork 当天。
  if (candidate.source === 'codex' && existing.source === 'codex'
      && candidate.ts !== existing.ts) return candidate.ts < existing.ts;
  // Claude 内容块会重复携带同次调用的 usage，流式最终值可能在 sidechain 中。
  // 核对 vibe-usage d4f9a1d / v0.10.21：完整度必须优先，不能累加部分响应。
  if (candidate.source === 'claude-code' && existing.source === 'claude-code') {
    return throughput(candidate) > throughput(existing);
  }
  // 1. 非 sidechain 优先于 sidechain
  if (candidate.sidechain !== existing.sidechain) return existing.sidechain;
  // 2. throughput 大者优先（Claude 有时把同一条记录以零用量复制到别处）
  const a = throughput(candidate);
  const b = throughput(existing);
  if (a !== b) return a > b;
  if (candidate.source === 'cola' && existing.source === 'cola') {
    return JSON.stringify(candidate.billing?.copyOwner ?? []) < JSON.stringify(existing.billing?.copyOwner ?? []);
  }
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

    // Claude 按调用而不是日志行计数；不同 requestId 仍是不同调用。
    if (record.source === 'claude-code') {
      exactKey = claudeUsageKey(record);
      if (exactKey !== null) {
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
