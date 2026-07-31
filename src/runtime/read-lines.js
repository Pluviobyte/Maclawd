import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/**
 * 有界行读取。所有读取都限制在发现阶段抓到的 size 内，避免读进正在追写的半截行。
 */

/** 尾部指纹窗口：用来验证文件确实是纯追加，而不是被重写或截断。 */
export const TAIL_WINDOW = 512;

export async function readLines(path, start, end, onLine) {
  if (end <= start) return;
  const stream = createReadStream(path, { encoding: 'utf8', start, end: end - 1 });
  let streamError = null;
  stream.on('error', (err) => { streamError = err; });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line) onLine(line);
    }
    if (streamError) throw streamError;
  } finally {
    lines.close();
    stream.destroy();
  }
}

/**
 * 读取 [offset-TAIL_WINDOW, offset) 的字节指纹。
 *
 * 增量尾读之前必须验证这个指纹与上次一致，否则文件可能被重写、截断或轮转，
 * 此时任何基于 offset 的续读都会产出错误数据，必须退回全量路径。
 */
export async function tailFingerprint(path, offset) {
  if (offset <= 0) return null;
  const start = Math.max(0, offset - TAIL_WINDOW);
  const length = offset - start;
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead !== length) return null;
    return createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * 找出 [0, size) 内最后一个换行符之后的位置，作为「已消费完整行」的边界。
 *
 * 只有落在换行边界上的 offset 才能安全续读；否则下次会从半行中间开始。
 */
export async function lastNewlineBoundary(path, size) {
  if (size <= 0) return 0;
  let handle;
  try {
    handle = await open(path, 'r');
    const window = Math.min(TAIL_WINDOW * 8, size);
    const buffer = Buffer.alloc(window);
    const { bytesRead } = await handle.read(buffer, 0, window, size - window);
    if (bytesRead <= 0) return 0;
    const index = buffer.lastIndexOf(0x0a, bytesRead - 1);
    if (index < 0) return 0;
    return size - window + index + 1;
  } catch {
    return 0;
  } finally {
    await handle?.close();
  }
}
