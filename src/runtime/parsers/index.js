import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';
import * as workbuddy from './workbuddy.js';
import * as kimiCode from './kimi-code.js';
import * as qwenCode from './qwen-code.js';
import * as grok from './grok.js';
import * as geminiCli from './gemini-cli.js';
import * as copilotCli from './copilot-cli.js';
import * as piCodingAgent from './pi-coding-agent.js';
import * as openclaw from './openclaw.js';
import * as amp from './amp.js';
import * as droid from './droid.js';
import * as cline from './cline.js';
import * as rooCode from './roo-code.js';
import * as traeCli from './trae-cli.js';
import * as opencode from './opencode.js';
import * as zcode from './zcode.js';
import * as hermes from './hermes.js';
import * as kiro from './kiro.js';
import * as antigravity from './antigravity.js';
import * as mimocode from './mimocode.js';
import * as alma from './alma.js';
import * as dimagent from './dimagent.js';
import * as omp from './omp.js';
import * as craftAgent from './craft-agent.js';
import * as cursor from './cursor.js';

/**
 * 解析器注册表。新增工具只需实现同一组导出并在这里登记：
 *
 *   id           稳定的 source 标识，进 rollup
 *   label        面板显示名
 *   readMode     'lines'（默认，JSONL）/ 'whole'（整份 JSON）/ 'none'（自取，如 SQLite）
 *   lineFilter   解析前的裸子串或谓词过滤；null 表示不过滤
 *   dataDirs()   用于检测该工具是否安装
 *   discover({listJsonl})  → 候选文件列表
 *   createFileParser(prev) → { onObject, finish }（口径归一在这里完成）
 *
 * 两条不变量必须在解析器边缘满足，见 usage-record.js：
 *   input 不含缓存 · output 含 reasoning
 *
 * 排序即面板默认顺序：先已验证的，再移植待验证的。
 */
export const parsers = [
  // 已在真机数据上验证过口径
  claudeCode,
  codex,
  workbuddy,
  kimiCode,
  qwenCode,
  grok,
  // 口径依据 vibe-usage 移植，尚缺真实样本验证
  geminiCli,
  copilotCli,
  piCodingAgent,
  openclaw,
  amp,
  droid,
  cline,
  rooCode,
  traeCli,
  opencode,
  zcode,
  hermes,
  kiro,
  antigravity,
  mimocode,
  alma,
  dimagent,
  omp,
  craftAgent,
  // 唯一需要联网的解析器，由 cursorCloud 设置显式开启，默认关闭
  cursor,
];

/**
 * 已用真实数据核对过口径的 source。其余是照 vibe-usage 移植但没有样本可验的，
 * 面板据此显示「待验证」标记——把「已支持」和「已验证」分开说是诚实的底线。
 */
export const VERIFIED_SOURCES = new Set([
  'claude-code', 'codex', 'workbuddy', 'kimi-code', 'qwen-code', 'grok',
  // 用开发机上的真实记录核对过：1 条 message 用量、项目名取自旁挂的
  // .trajectory.jsonl，且已确认 model.completed 与 message 的双计陷阱。
  'openclaw',
]);

export function parserById(id) {
  return parsers.find((p) => p.id === id) ?? null;
}

export const SOURCE_LABELS = Object.fromEntries(
  parsers.map((p) => [p.id, p.label]),
);
