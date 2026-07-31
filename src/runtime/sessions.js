/**
 * 会话时长指标。算法取自 vibe-usage 的 extractSessions。
 *
 *   一轮 = 用户提问后的第一条 AI 回复 → 下次提问前的最后一条 AI 回复
 *   activeSeconds = 各轮时长之和，**排除排队与首字等待**
 *   durationSeconds = 首末消息的墙钟差
 *
 * 为什么不能用墙钟：会话开着但人去吃饭了，墙钟照走，activeSeconds 不走。
 * 桌宠判断「该睡了」以及面板的「今天真正工作了多久」都必须用后者。
 *
 * 实现成增量累加器，是为了配合扫描器的增量尾读——只读文件新增部分时，
 * 轮次追踪状态要能从上次接着算，所以状态必须可序列化。
 */

export function createTurnTracker(prev = null) {
  let activeSeconds = prev?.activeSeconds ?? 0;
  let turnStart = prev?.turnStart ?? null;
  let turnEnd = prev?.turnEnd ?? null;
  let waiting = prev?.waiting ?? false;
  let firstTs = prev?.firstTs ?? null;
  let lastTs = prev?.lastTs ?? null;
  let messageCount = prev?.messageCount ?? 0;
  let userMessageCount = prev?.userMessageCount ?? 0;
  const hours = prev?.hours ? [...prev.hours] : new Array(24).fill(0);

  const closeTurn = () => {
    if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
      activeSeconds += Math.round((turnEnd - turnStart) / 1000);
    }
    turnStart = null;
    turnEnd = null;
  };

  return {
    onEvent(role, ts) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) return;
      messageCount++;
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;

      if (role === 'user') {
        closeTurn();
        waiting = true;
        userMessageCount++;
        hours[new Date(ts).getHours()]++;
        return;
      }
      if (waiting) {
        // 用户提问到这条首个回复之间的等待不计入活跃时长。
        turnStart = ts;
        turnEnd = ts;
        waiting = false;
      } else if (turnStart !== null) {
        turnEnd = ts;
      }
    },

    /** 只读快照，不改变累加器状态，可以反复调用。 */
    snapshot() {
      let total = activeSeconds;
      if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
        total += Math.round((turnEnd - turnStart) / 1000);
      }
      if (messageCount === 0) return null;
      return {
        firstTs,
        lastTs,
        durationSeconds: (firstTs !== null && lastTs !== null)
          ? Math.round((lastTs - firstTs) / 1000)
          : 0,
        activeSeconds: total,
        messageCount,
        userMessageCount,
        userPromptHours: hours,
      };
    },

    state() {
      return {
        activeSeconds, turnStart, turnEnd, waiting,
        firstTs, lastTs, messageCount, userMessageCount, hours,
      };
    },
  };
}

/** 把多个会话摘要合并成区间统计。 */
export function summarizeSessions(sessions, { from = null, to = null } = {}) {
  let activeSeconds = 0;
  let durationSeconds = 0;
  let messageCount = 0;
  let userMessageCount = 0;
  let count = 0;
  const hours = new Array(24).fill(0);

  for (const session of sessions) {
    if (!session) continue;
    if (from !== null && session.lastTs < from) continue;
    if (to !== null && session.firstTs > to) continue;
    count++;
    activeSeconds += session.activeSeconds ?? 0;
    durationSeconds += session.durationSeconds ?? 0;
    messageCount += session.messageCount ?? 0;
    userMessageCount += session.userMessageCount ?? 0;
    const promptHours = session.userPromptHours ?? [];
    for (let h = 0; h < 24; h++) hours[h] += promptHours[h] ?? 0;
  }

  return {
    sessions: count, activeSeconds, durationSeconds,
    messageCount, userMessageCount, userPromptHours: hours,
  };
}
