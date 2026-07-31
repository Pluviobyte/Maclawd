import { open, stat } from 'node:fs/promises';

/**
 * 判定一次 `Stop` 到底意味着什么。
 *
 * **问题**：我们此前在每个 `Stop` 上都插播 success（Self High-five，庆祝）。
 * 但 `Stop` 不总是「干完了」——用户按 ESC 打断、模型停在工具调用上、
 * 或者只是这一轮的自然收尾而后面还有动作。**在用户刚打断时对他欢呼是会烦人的。**
 *
 * **查证结论**（读了本机最近 60 个会话的日志）：
 * Claude Code **没有**暴露「用户取消了这一轮」的信号。
 *   - `stop_reason` 只有 tool_use / end_turn / stop_sequence，那是**模型**为什么
 *     停止生成，不是**用户**是否打断
 *   - `stop_details` 全部为 null
 *   - 唯一带 `interrupted` 的是工具执行结果里的字段，是那条命令有没有被中断，
 *     不是轮次级别的
 *
 * 参考项目里 clawd-on-desk 把 StopFailure / PostToolUseFailure / ApiError 标成
 * "interrupted"，但那是**失败**不是**取消**，同样没解决这件事。
 *
 * **所以采取保守策略**：只有确认是自然收尾才庆祝，其余一律安静回到 idle。
 * 宁可少一个动作，也不要在用户刚打断时欢呼。
 */

/** 只读日志尾部这么多字节——最后一条 assistant 消息一定在里面。 */
const TAIL_BYTES = 64 * 1024;

export const DISPOSITION = {
  /** 模型自然说完了 → 可以庆祝 */
  complete: 'complete',
  /** 停在工具调用上却触发了 Stop → 多半被打断 → 安静收场，不庆祝也不耸肩 */
  inconclusive: 'inconclusive',
  /** 读不到或读不懂 → 与 inconclusive 同样处理 */
  unknown: 'unknown',
};

/**
 * 读 transcript 尾部，取最后一条 assistant 消息的 stop_reason。
 *
 * 有界读取（只读尾部 64KB）是必须的：transcript 可能有几十上百 MB，
 * 而这是在 hook 触发的热路径上。
 */
export async function readStopDisposition(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return DISPOSITION.unknown;

  let handle;
  try {
    const info = await stat(transcriptPath);
    if (!info.isFile() || info.size === 0) return DISPOSITION.unknown;

    const length = Math.min(TAIL_BYTES, info.size);
    const start = info.size - length;
    handle = await open(transcriptPath, 'r');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead <= 0) return DISPOSITION.unknown;

    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    // 从后往前找最后一条带 stop_reason 的 assistant 记录。
    // 首行可能被截断，所以只在能成功解析时采信。
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"stop_reason"')) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj?.type !== 'assistant') continue;
      const reason = obj.message?.stop_reason;
      if (typeof reason !== 'string') continue;
      // end_turn = 模型把话说完了。其余（尤其 tool_use）说明它还想继续，
      // 却收到了 Stop——那更可能是被打断，不该庆祝。
      return reason === 'end_turn' ? DISPOSITION.complete : DISPOSITION.inconclusive;
    }
    return DISPOSITION.unknown;
  } catch {
    return DISPOSITION.unknown;
  } finally {
    await handle?.close();
  }
}

/** 只有明确的自然收尾才值得庆祝。 */
export function shouldCelebrate(disposition) {
  return disposition === DISPOSITION.complete;
}
