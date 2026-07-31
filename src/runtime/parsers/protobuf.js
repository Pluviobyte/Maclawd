/**
 * 极简 protobuf wire-format 解码器。
 *
 * 只做「把字节流拆成 字段号 → 值列表」，不认识任何 schema。这一层是标准协议，
 * 可以独立验证正确性；schema（字段号的含义）由调用方提供。
 *
 * 这种分层很重要：字段号是逆向出来的，可能猜错；而只要解码器本身是对的，
 * 猜错 schema 的结果是「结构不匹配 → 返回 null」，而不是「产出错误数字」。
 */

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH = 2;
const WIRE_FIXED32 = 5;

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let position = offset;
  while (position < buf.length) {
    const byte = buf[position++];
    // 用乘法而不是位移：JS 的位运算是 32 位的，token 计数会超。
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, position];
    shift += 7;
    if (shift > 63) throw new Error('varint 过长');
  }
  throw new Error('varint 被截断');
}

/** 解码一层消息 → Map<字段号, Array<{wireType, value}>>。 */
export function decodeMessage(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const [tag, afterTag] = readVarint(buf, offset);
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (fieldNumber === 0) throw new Error('字段号为 0');
    offset = afterTag;

    let value;
    if (wireType === WIRE_VARINT) {
      [value, offset] = readVarint(buf, offset);
    } else if (wireType === WIRE_LENGTH) {
      let length;
      [length, offset] = readVarint(buf, offset);
      if (offset + length > buf.length) throw new Error('长度越界');
      value = buf.subarray(offset, offset + length);
      offset += length;
    } else if (wireType === WIRE_FIXED64) {
      if (offset + 8 > buf.length) throw new Error('fixed64 越界');
      value = buf.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === WIRE_FIXED32) {
      if (offset + 4 > buf.length) throw new Error('fixed32 越界');
      value = buf.subarray(offset, offset + 4);
      offset += 4;
    } else {
      throw new Error(`不支持的 wire type ${wireType}`);
    }

    const list = fields.get(fieldNumber);
    if (list) list.push({ wireType, value });
    else fields.set(fieldNumber, [{ wireType, value }]);
  }
  return fields;
}

export function firstVarint(fields, fieldNumber) {
  const entry = fields?.get?.(fieldNumber)?.[0];
  return entry && entry.wireType === WIRE_VARINT ? entry.value : undefined;
}

export function firstBytes(fields, fieldNumber) {
  const entry = fields?.get?.(fieldNumber)?.[0];
  return entry && entry.wireType === WIRE_LENGTH ? entry.value : undefined;
}

export function firstString(fields, fieldNumber) {
  const bytes = firstBytes(fields, fieldNumber);
  return bytes ? bytes.toString('utf8') : undefined;
}

/** 嵌套消息；子结构解不开时返回 undefined 而不是抛错。 */
export function firstMessage(fields, fieldNumber) {
  const bytes = firstBytes(fields, fieldNumber);
  if (!bytes) return undefined;
  try {
    return decodeMessage(bytes);
  } catch {
    return undefined;
  }
}
