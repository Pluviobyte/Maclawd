import { randomUUID } from 'node:crypto';
import { safeTitle } from './redact.js';

/**
 * 权限决策通道（「在桌宠上批准」）。
 *
 * 与状态通道的本质区别：状态是**单向通知**，权限是**双向请求**——
 * Claude Code 用 `type: "http"` hook 发来一个请求并**等待返回**，
 * 我们必须在超时前给出决策，否则它继续走自己的流程。
 *
 * 三条安全底线：
 *
 * 1. **超时一律「不决策」，绝不自动允许也绝不自动拒绝。**
 *    桌宠没人看、Maclawd 正在重启、用户走开了——这些情况下正确的行为是
 *    把决策权原样交回 Claude Code 自己的确认流程，而不是替用户做主。
 *
 * 2. **默认整个通道关闭。** 拦截别人的权限流程是很重的行为，
 *    必须用户显式开启（`permissionBubble` 设置项），且安装是独立一步。
 *
 * 3. **展示前脱敏。** 工具入参可能带密钥，要显示在桌宠旁边就必须先过 redact。
 */

/** 超时后交回 Claude Code 自己的流程。留足人看一眼再点的时间，但不能无限等。 */
const DEFAULT_TIMEOUT_MS = 25_000;

export function createPermissionBroker({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  /** id → { request, resolve, timer } */
  const pending = new Map();
  const listeners = new Set();

  function notify() {
    const snapshot = list();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // 监听方出错不影响决策流程
      }
    }
  }

  /** 提取可以安全展示的摘要。原始载荷不保留。 */
  function summarize(payload) {
    const tool = typeof payload?.tool_name === 'string' ? payload.tool_name : 'unknown';
    const input = payload?.tool_input;
    let detail = '';
    if (input && typeof input === 'object') {
      // 只取几个已知字段，且一律过脱敏——绝不整个 tool_input 往外发。
      const candidate = input.command ?? input.file_path ?? input.path ?? input.url ?? '';
      detail = safeTitle(String(candidate), { maxLength: 80 });
    }
    return { tool, detail };
  }

  /**
   * Claude Code 的 http hook 打进来。返回一个 Promise，
   * 决策产生或超时后 resolve。
   */
  function request(payload) {
    const id = randomUUID();
    const { tool, detail } = summarize(payload);
    const entry = {
      id,
      tool,
      detail,
      sessionId: typeof payload?.session_id === 'string' ? payload.session_id : 'default',
      at: Date.now(),
    };

    return new Promise((resolvePromise) => {
      const finish = (decision) => {
        const held = pending.get(id);
        if (!held) return;
        clearTimeout(held.timer);
        pending.delete(id);
        notify();
        resolvePromise(decision);
      };

      const timer = setTimeout(() => {
        // 超时 = 不决策。把控制权原样交回去。
        finish(null);
      }, timeoutMs);
      timer.unref?.();

      pending.set(id, { request: entry, finish, timer });
      notify();
    });
  }

  /** 用户在面板或桌宠上做出决策。 */
  function decide(id, decision) {
    const held = pending.get(id);
    if (!held) return false;
    if (decision !== 'allow' && decision !== 'deny') return false;
    held.finish(decision);
    return true;
  }

  function list() {
    return [...pending.values()].map((h) => ({ ...h.request }));
  }

  /** 主开关关闭或应用退出时，把所有等待中的请求交回 Claude Code。 */
  function releaseAll() {
    for (const held of [...pending.values()]) held.finish(null);
  }

  return {
    request,
    decide,
    list,
    releaseAll,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    get size() { return pending.size; },
  };
}

/**
 * 把决策翻译成 Claude Code hook 期待的返回体。
 *
 * null → 空对象，表示「不表态」，Claude Code 继续走它自己的确认流程。
 * 这是最重要的一条：**沉默必须等于不干预**。
 */
export function decisionResponse(decision) {
  if (decision === 'allow') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', permissionDecision: 'allow' } };
  }
  if (decision === 'deny') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', permissionDecision: 'deny' } };
  }
  return {};
}
