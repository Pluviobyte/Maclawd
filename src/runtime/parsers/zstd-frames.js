import zlib from 'node:zlib';

// Independent framing implementation of RFC8878 §3.1.1/3.1.2. Node's one-shot
// decoder stops after the first frame; DSH appends one frame per log write.
export function decodeZstdFrames(bytes, { maxOutput = 512 * 1024 * 1024 } = {}) {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('DSH 压缩日志需要 Node 22.15+ 或应用内置运行时');
  const chunks = []; let at = 0, decoded = 0;
  const partial = () => ({ chunks, incomplete: true });
  while (at < bytes.length) {
    const start = at;
    if (bytes.length - at < 4) {
      const prefix = bytes.subarray(at);
      const magics = [0xfd2fb528, ...Array.from({ length: 16 }, (_, i) => 0x184d2a50 + i)];
      if (!magics.some(value => { const magic = Buffer.alloc(4); magic.writeUInt32LE(value); return magic.subarray(0, prefix.length).equals(prefix); })) {
        throw new Error('DSH Zstandard 帧标记无效');
      }
      return partial();
    }
    const magic = bytes.readUInt32LE(at); at += 4;
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      if (at + 4 > bytes.length) return partial();
      const size = bytes.readUInt32LE(at); at += 4 + size;
      if (at > bytes.length) return partial();
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error('DSH Zstandard 帧标记无效');
    if (at >= bytes.length) return partial();
    const descriptor = bytes[at++], single = Boolean(descriptor & 32), sizeFlag = descriptor >>> 6;
    if (descriptor & 8) throw new Error('DSH Zstandard 保留位无效');
    const sizeBytes = sizeFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][sizeFlag];
    const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
    at += (single ? 0 : 1) + dictionaryBytes + sizeBytes;
    if (at > bytes.length) return partial();
    let last = false;
    while (!last) {
      if (at + 3 > bytes.length) return partial();
      const block = bytes.readUIntLE(at, 3); at += 3;
      last = Boolean(block & 1);
      const kind = (block >>> 1) & 3, size = block >>> 3;
      if (kind === 3 || size > 128 * 1024) throw new Error('DSH Zstandard 块无效');
      at += kind === 1 ? 1 : size;
      if (at > bytes.length) return partial();
    }
    if (descriptor & 4) at += 4;
    if (at > bytes.length) return partial();
    if (decoded >= maxOutput) throw new Error('DSH 解压内容超出大小限制');
    const chunk = zlib.zstdDecompressSync(bytes.subarray(start, at), { maxOutputLength: maxOutput - decoded });
    decoded += chunk.length; chunks.push(chunk);
  }
  return { chunks, incomplete: false };
}
