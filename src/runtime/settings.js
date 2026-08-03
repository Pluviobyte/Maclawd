import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, settingsPath } from './paths.js';

/**
 * 设置持久化。默认值见 design/token-tracking.md「开关与默认值」。
 *
 * 分层默认的核心：**读日志默认开（纯只读），写别人的配置文件默认关。**
 * hook 增强要改 ~/.claude/settings.json，那是在动用户另一个工具的运行时，
 * 不能默认替他决定。
 */

export const DEFAULTS = {
  // B 层：读本机日志。纯只读、不联网，所以可以默认开。
  recordUsage: true,
  // 第 3 层：累计用量影响桌宠 idle 变体权重与 away 阈值。
  petEnergy: true,
  // A 层：Claude Code hooks。要写 ~/.claude/settings.json，默认关。
  hookEnhancement: false,
  // A 层，但**必须与 hookEnhancement 分开**：hooks 是按事件分组的数组，
  // 往里加一条谁也不影响；statusLine 是**单槽位**，占了就把用户原来的挤掉。
  // 用户完全可能愿意加 hooks 却不愿意让出状态行，那是两个独立的信任决定。
  quotaStatusline: false,
  // 额度快用完时弹一次自绘浮窗。默认开——这是用户主动要的功能，
  // 而且有实际决策价值（决定现在敢不敢开大活），不是骚扰。
  quotaAlert: true,
  // 已用达到多少百分比时提醒。
  quotaAlertThreshold: 85,
  // 价格表有缺口时成本会偏低，默认不展示，见待决事项 2。
  showCost: false,
  // 与系统「减弱动效」独立的应用内开关。
  reducedMotion: false,
  // 开 Claude Code 时如果 Maclawd 没在跑，自动把它拉起来。
  // 默认开：**用户开了 agent 却没开桌宠是常态，不是异常**——不拉起的话
  // 那段时间的事件全丢，而这正是桌宠该出场的时候。只在 hook 装在 .app
  // 里时才有效果（源码目录里没有可拉起的东西），且永远后台启动不抢焦点。
  autoStart: true,
  // 面板默认口径：billable（非缓存读取量）或 throughput（上下文吞吐）。
  primaryMetric: 'billable',
  // 在桌宠上批准权限。拦截别人的权限流程是很重的行为，默认关闭；
  // 关闭时 /api/permission 一律「不表态」，决策原样留在 Claude Code 自己的流程里。
  permissionBubble: false,
  // 局域网只读镜像（手机上看一眼）。默认关闭，开启后必须配对令牌。
  lanMirror: false,
  // Cursor 本地不存用量，只能联网拉云端 CSV。与「纯本地」原则冲突，所以
  // 单独一个开关且默认关闭；关闭时它一个请求都不发。
  cursorCloud: false,
  // 项目名在面板上隐藏（本地隐私，不影响统计）。
  hiddenProjects: [],
  pinnedProjects: [],
};

export function loadSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  // 只保留已知键，避免前端误传把设置文件写脏。
  const cleaned = {};
  for (const key of Object.keys(DEFAULTS)) cleaned[key] = next[key];
  mkdirSync(dataDir(), { recursive: true });
  const target = settingsPath();
  const temp = join(dataDir(), `.settings.${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf-8');
  renameSync(temp, target);
  return cleaned;
}

/**
 * 主开关关闭时，桌宠必须走与「没有数据」完全相同的降级路径，不做两套逻辑。
 * 见 design/token-tracking.md 的降级链。
 */
export function usageEnabled(settings = loadSettings()) {
  return settings.recordUsage === true;
}
