/**
 * 密钥脱敏护栏。
 *
 * 本项目的第一原则是「不落盘任何 prompt、回复、文件内容」，所以正常路径上
 * 根本没有敏感文本经过。这一层是**护栏而不是主要防线**：
 * 一旦将来有人想在面板上显示会话标题、最近命令、错误信息，
 * 这个函数必须挡在展示之前，而不是等出事了再补。
 *
 * 设计取向：**宁可多脱一点**。误脱一个无害字符串只是显示成 ***，
 * 漏脱一个 API key 是事故。
 */

/** 一眼能认出的密钥前缀。命中即整段替换，不做部分保留。 */
const KNOWN_PREFIXES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,              // OpenAI / Anthropic 风格
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,          // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,                  // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,        // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/g,              // Google API key
  /\bglpat-[A-Za-z0-9_-]{16,}/g,            // GitLab
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,  // JWT
  /\bvbu_[A-Za-z0-9]{16,}/g,                // vibe-usage 自己的 key 格式
];

/** `KEY=value` / `KEY: value` / `--flag value` 形式的赋值，键名可疑就脱掉值。 */
const SENSITIVE_KEY = /(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|authorization|bearer|password|passwd|pwd|secret|private[_-]?key|client[_-]?secret|session[_-]?token|credential)/i;
const ASSIGNMENT = /([A-Za-z_][A-Za-z0-9_-]{0,40})\s*([:=])\s*("[^"]*"|'[^']*'|[^\n"']+)/g;
const FLAG_ASSIGNMENT = /(--?[A-Za-z][A-Za-z0-9-]{0,40})[= ]\s*("[^"]*"|'[^']*'|\S+)/g;

/** PEM 私钥整块。 */
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/**
 * 高熵长串。这条最容易误伤，所以门槛设得高（40 位以上、且同时含大小写与数字），
 * 普通的路径、句子、十六进制哈希都不会命中。
 */
const HIGH_ENTROPY = /\b(?=[A-Za-z0-9+/_-]{40,}\b)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g;

export const MASK = '***';

/** 是否含有疑似密钥。用于「宁可整条不显示」的场景。 */
export function looksSensitive(text) {
  if (typeof text !== 'string' || !text) return false;
  if (PEM_BLOCK.test(text)) { PEM_BLOCK.lastIndex = 0; return true; }
  for (const pattern of KNOWN_PREFIXES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return SENSITIVE_KEY.test(text);
}

/**
 * 把文本里的密钥替换成掩码。
 *
 * @param {string} text
 * @param {{maxLength?: number}} [options] 超长时截断——展示用文本没有必要很长，
 *   而越长越容易夹带没被规则覆盖的东西。
 */
export function redact(text, { maxLength = 240 } = {}) {
  if (typeof text !== 'string' || !text) return '';

  let out = text.replace(PEM_BLOCK, MASK);

  for (const pattern of KNOWN_PREFIXES) {
    out = out.replace(pattern, MASK);
  }

  // 键名可疑的赋值：只脱值，保留键名，这样「有个 api_key」这个信息还在，
  // 对排查有用，而值不会泄露。
  // 敏感键的值必须整段脱掉：`Authorization: Bearer eyJ…` 后面有**两个**词，
  // 只脱下一个词会把真正的令牌原样留下——这是实测撞到的缺陷。
  out = out.replace(ASSIGNMENT, (match, key, sep, value) => {
    if (!SENSITIVE_KEY.test(key)) return match;
    const quoted = value.startsWith('"') || value.startsWith("'");
    const quote = quoted ? value[0] : '';
    return `${key}${sep} ${quote}${MASK}${quote}`;
  });
  out = out.replace(FLAG_ASSIGNMENT, (match, flag, value) => (
    SENSITIVE_KEY.test(flag) ? `${flag} ${MASK}` : match
  ));

  out = out.replace(HIGH_ENTROPY, MASK);

  // 控制字符会破坏终端与 HTML 展示
  out = out.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();

  if (out.length > maxLength) out = `${out.slice(0, maxLength - 1)}…`;
  return out;
}

/**
 * 会话标题这类要展示在桌宠附近的短文本：命中任何可疑特征就整条不显示，
 * 而不是脱敏后显示半截。桌宠旁边露出 `***` 比不显示更糟——用户会想去看它。
 */
export function safeTitle(text, { maxLength = 60 } = {}) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (looksSensitive(trimmed)) return '';
  const cleaned = redact(trimmed, { maxLength });
  return cleaned.includes(MASK) ? '' : cleaned;
}
