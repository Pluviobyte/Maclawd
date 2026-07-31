#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { scanAll } from '../src/runtime/scan.js';
import { parsers } from '../src/runtime/parsers/index.js';
import { dedupe } from '../src/runtime/dedupe.js';
import {
  buildRollup, summarize, baseline, RANGES,
} from '../src/runtime/rollup.js';
import { costOf, updatePrices, pricingMeta } from '../src/runtime/pricing.js';
import { summarizeSessions } from '../src/runtime/sessions.js';
import { createTailer, intensityFromRate } from '../src/runtime/tail.js';
import { serve } from '../src/runtime/server.js';
import { createCollector } from '../src/runtime/daemon.js';
import { installHooks, uninstallHooks, hookStatus } from '../src/runtime/hook-install.js';
import { probe, diffProbe } from '../src/runtime/probe.js';
import { rangeBounds } from '../src/runtime/rollup.js';
import {
  billable, cacheWrite, hitRate, throughput,
} from '../src/runtime/usage-record.js';
import { readJson, writeJson } from '../src/runtime/store.js';
import { ROLLUP_FILE, usageDir } from '../src/runtime/paths.js';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const success = (s) => `\x1b[32m✓\x1b[0m ${s}`;

function fmt(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function sparkline(values) {
  const blocks = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 1);
  return values.map((v) => (v === 0 ? ' ' : blocks[Math.min(7, Math.floor((v / max) * 7.999))])).join('');
}

// ---------- doctor ----------

function doctor() {
  console.log(bold('检测到的工具'));
  for (const parser of parsers) {
    const dirs = parser.dataDirs();
    const present = dirs.filter((d) => existsSync(d));
    const mark = present.length > 0 ? '✓' : '·';
    console.log(`  ${mark} ${parser.label.padEnd(14)} ${present.length > 0 ? '' : dim('未安装')}`);
    for (const dir of dirs) {
      console.log(dim(`      ${existsSync(dir) ? '' : '（缺失）'}${dir}`));
    }
  }
  console.log();
  console.log(bold('数据目录'));
  console.log(dim(`  ${usageDir()}`));
}

// ---------- verify（阶段 0）----------

async function verify() {
  console.log(bold('口径验证'));
  console.log(dim('两种总量口径的差额就是缓存读。用它和 tokei / ccusage 对账。'));
  console.log();

  const started = Date.now();
  const result = await scanAll();
  const elapsed = Date.now() - started;

  for (const parser of parsers) {
    const records = result.bySource[parser.id] ?? [];
    if (records.length === 0) continue;

    // 去重效果：重新聚合未去重的记录做对比。
    const total = records.reduce((acc, r) => {
      acc.input += r.input; acc.output += r.output; acc.cacheRead += r.cacheRead;
      acc.write5m += r.write5m; acc.write1h += r.write1h; acc.reasoning += r.reasoning;
      return acc;
    }, { input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, reasoning: 0 });

    console.log(bold(parser.label));
    console.log(`  记录数           ${records.length}`);
    console.log(`  输入（非缓存）    ${fmt(total.input)}`);
    console.log(`  输出             ${fmt(total.output)}${total.reasoning > 0 ? dim(`  含推理 ${fmt(total.reasoning)}`) : ''}`);
    console.log(`  缓存读           ${fmt(total.cacheRead)}`);
    console.log(`  缓存写           ${fmt(cacheWrite(total))}${total.write1h > 0 ? dim(`  (5m ${fmt(total.write5m)} / 1h ${fmt(total.write1h)})`) : ''}`);
    console.log(`  ${bold('billable')}         ${bold(fmt(billable(total)))}  ${dim('不含缓存读 · vibe-usage 口径')}`);
    console.log(`  ${bold('throughput')}       ${bold(fmt(throughput(total)))}  ${dim('四项全加 · tokei 口径')}`);
    const ratio = billable(total) > 0 ? throughput(total) / billable(total) : 0;
    console.log(`  两口径倍数        ${ratio.toFixed(2)}×`);
    console.log(`  缓存命中率        ${pct(hitRate(total))}`);
    console.log();
  }

  console.log(dim(`扫描 ${elapsed}ms · 全量 ${result.stats.full} · 增量 ${result.stats.appended} · 复用 ${result.stats.reused}`));
  for (const warning of result.warnings) console.log(dim(`  ! ${warning}`));
}

// ---------- scan ----------

async function scan() {
  const started = Date.now();
  const result = await scanAll();
  const elapsed = Date.now() - started;

  const rollup = buildRollup(result.records, result.sessionsBySource, result.projectPaths);
  writeJson(ROLLUP_FILE, rollup);

  const dayCount = Object.keys(rollup.days).length;
  console.log(`已扫描 ${result.records.length} 条记录 · ${dayCount} 天`);
  console.log(dim(`  ${elapsed}ms · 全量 ${result.stats.full} · 增量 ${result.stats.appended} · 复用 ${result.stats.reused}${result.stats.deferred ? ` · 待续 ${result.stats.deferred}` : ''}`));
  for (const [source, records] of Object.entries(result.bySource)) {
    if (records.length > 0) console.log(dim(`  ${source.padEnd(14)}${records.length} 条`));
  }
  for (const warning of result.warnings) console.log(dim(`  ! ${warning}`));
  console.log(dim(`  → ${usageDir()}/${ROLLUP_FILE}`));
}

// ---------- stats ----------

function stats(args) {
  const rangeArg = args.find((a) => RANGES.includes(a)) ?? 'today';
  const withCost = args.includes('--cost');
  const sourceArg = (() => {
    const i = args.indexOf('--source');
    return i >= 0 ? args[i + 1] : null;
  })();

  const rollup = readJson(ROLLUP_FILE, null);
  if (!rollup) {
    console.log('还没有用量记录。先运行 `maclawd-usage scan`。');
    return;
  }

  const summary = summarize(rollup, rangeArg, {
    source: sourceArg,
    priceBucket: withCost ? costOf : null,
  });

  console.log(bold(`${rangeArg}${sourceArg ? ` · ${sourceArg}` : ''}`));
  console.log();
  const costText = summary.cost !== null ? `  $${summary.cost.toFixed(2)}` : '';
  console.log(`  ${bold(fmt(summary.billable))} 计费 tokens${costText}`);
  console.log(dim(`  ${fmt(summary.throughput)} 吞吐 · 缓存命中 ${pct(summary.hitRate)}`));
  const meta = pricingMeta();
  if (summary.unpricedTokens > 0 && !meta.fetchedAt) {
    console.log(dim('  价格表未拉取 — 运行 `maclawd-usage update-prices` 可大幅提升覆盖率'));
  }
  if (summary.unpricedTokens > 0) {
    console.log(dim(`  ${fmt(summary.unpricedTokens)} tokens 未计价 — 价格表缺: ${summary.unpricedModels.slice(0, 5).join(', ')}`));
    console.log(dim('  （补 usage/pricing.overrides.json 即可计入）'));
  }

  const base = baseline(rollup);
  if (base && rangeArg === 'today' && summary.throughput > 0) {
    const delta = (summary.throughput - base) / base;
    const word = delta >= 0 ? '多' : '少';
    console.log(dim(`  比平时${word} ${pct(Math.abs(delta))}（14 天中位数 ${fmt(base)}）`));
  }

  const allSessions = Object.entries(rollup.sessions ?? {})
    .filter(([src]) => !sourceArg || src === sourceArg)
    .flatMap(([, list]) => list);
  if (allSessions.length > 0) {
    const b = rangeBounds();
    const from = rangeArg === 'all' ? null : new Date(`${b[rangeArg === 'yesterday' ? 'yesterday' : rangeArg === 'today' ? 'today' : rangeArg === 'week' ? 'weekStart' : rangeArg === 'last_week' ? 'lastWeekStart' : rangeArg === 'month' ? 'monthStart' : 'yearStart']}T00:00:00`).getTime();
    const s = summarizeSessions(allSessions, { from });
    if (s.sessions > 0) {
      const h = Math.floor(s.activeSeconds / 3600);
      const m = Math.round((s.activeSeconds % 3600) / 60);
      console.log(dim(`  活跃 ${h > 0 ? `${h}h ` : ''}${m}m · ${s.sessions} 会话 · ${s.messageCount} 消息`));
    }
  }

  if (summary.hours.some((h) => h > 0)) {
    console.log();
    console.log(`  ${sparkline(summary.hours)}`);
    console.log(dim('  0           12          23'));
  }

  const section = (title, map) => {
    const rows = Object.entries(map)
      .map(([key, bucket]) => [key, billable(bucket), throughput(bucket)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (rows.length === 0) return;
    console.log();
    console.log(`  ${bold(title)}`);
    for (const [key, bill] of rows) {
      console.log(`    ${key.slice(0, 28).padEnd(30)}${fmt(bill).padStart(8)}`);
    }
  };

  section('来源', summary.bySource);
  section('项目', summary.byProject);
  section('模型', summary.byModel);
}

// ---------- watch（实时速率）----------

async function watch(args) {
  const intervalArg = Number(args.find((a) => /^\d+$/.test(a)));
  const interval = Number.isFinite(intervalArg) && intervalArg >= 1 ? intervalArg * 1000 : 2000;
  const tailer = createTailer();

  console.log(bold('实时 token 速率'));
  console.log(dim('首次见到的文件从当前末尾开始跟读，不回溯历史。'));
  console.log();

  // 第一轮只是登记游标，不会有数据。
  await tailer.poll();

  const render = async () => {
    const result = await tailer.poll();
    const bar = '█'.repeat(Math.round(intensityFromRate(result.tokensPerMin) * 24)).padEnd(24, '·');
    const fresh = result.fresh.length > 0
      ? ` ${dim(`+${result.fresh.length} 条 ${[...new Set(result.fresh.map((r) => r.source))].join(',')}`)}`
      : '';
    process.stdout.write(
      `\r  ${bar} ${fmt(result.tokensPerMin).padStart(7)}/min  ${dim(`${result.trackedFiles} 文件`)}${fresh}\x1b[K`,
    );
  };

  await render();
  const timer = setInterval(() => { render().catch(() => {}); }, interval);
  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log();
    process.exit(0);
  });
}

// ---------- update-prices ----------

async function runUpdatePrices() {
  console.log(bold('更新价格表'));
  console.log(dim('  这是本项目唯一的对外请求：一个公开 GET，不携带任何用户数据。'));
  try {
    const r = await updatePrices();
    console.log(success(`已写入 ${r.count} 个模型的价格${r.skipped ? `（跳过 ${r.skipped} 个无价条目）` : ''}`));
    console.log(dim('  pricing.overrides.json 未被触碰，手工修正依然生效。'));
  } catch (err) {
    console.error(`失败: ${err.message}`);
    console.error(dim('  本地价格表未被覆盖。'));
    process.exitCode = 1;
  }
}

// ---------- probe（解析器体检）----------

const PROBE_SNAPSHOT = 'probe-snapshot.json';
const LEVEL_MARK = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m', info: dim('·') };

async function runProbe(args) {
  const save = args.includes('--save');
  const showDiff = args.includes('--diff');
  const onlyIssues = args.includes('--issues');
  const sources = args.filter((a) => !a.startsWith('--'));

  console.log(bold('解析器体检'));
  console.log(dim('  检查项全部来自本项目踩过的真实坑，不是凭空想的。'));
  console.log();

  const report = await probe({ sources: sources.length ? sources : null });
  const rows = showDiff
    ? diffProbe(readJson(PROBE_SNAPSHOT, null), report)
    : report.map((r) => ({ ...r, delta: null }));

  let issues = 0;
  for (const entry of rows) {
    const problems = entry.checks.filter((c) => c.level === 'fail' || c.level === 'warn');
    if (problems.length) issues += problems.length;
    if (onlyIssues && problems.length === 0) continue;
    if (!entry.installed && onlyIssues) continue;

    const badge = entry.verified ? dim('[已验证]') : dim('[待验证]');
    const mark = problems.some((p) => p.level === 'fail') ? LEVEL_MARK.fail
      : problems.length ? LEVEL_MARK.warn
        : entry.installed ? LEVEL_MARK.ok : LEVEL_MARK.info;
    console.log(`${mark} ${bold(entry.label.padEnd(20))}${badge}`);

    if (!entry.installed) {
      console.log(dim(`    未安装 · ${entry.dirs[0] ?? ''}`));
      console.log();
      continue;
    }

    console.log(dim(`    ${entry.files.count} 文件 · ${fmt(entry.records)} 记录`
      + ` · 计费 ${fmt(entry.derived.billable)} · 吞吐 ${fmt(entry.derived.throughput)}`
      + ` · 命中 ${(entry.derived.hitRate * 100).toFixed(0)}%`));
    if (entry.models.length) console.log(dim(`    模型 ${entry.models.slice(0, 4).join(', ')}`));
    if (entry.newest) console.log(dim(`    最近一条 ${new Date(entry.newest).toLocaleString()}`));

    if (entry.delta) {
      const d = entry.delta;
      if (!entry.hadBaseline) console.log(dim('    （无基线，先跑一次 --save）'));
      else if (d.records === 0) console.log(`    ${LEVEL_MARK.warn} 相比上次快照没有新增记录`);
      else console.log(`    ${LEVEL_MARK.ok} 新增 ${d.records} 条 · 计费 +${fmt(d.billable)}`);
    }

    for (const c of entry.checks) {
      if (c.level === 'ok' && problems.length === 0) console.log(`    ${LEVEL_MARK.ok} ${c.message}`);
      else if (c.level !== 'ok') console.log(`    ${LEVEL_MARK[c.level]} ${c.message}`);
    }
    console.log();
  }

  if (save) {
    writeJson(PROBE_SNAPSHOT, report);
    console.log(dim(`已保存快照，去用那个工具跑一轮，再运行 \`maclawd-usage probe --diff\``));
  }
  if (issues > 0) {
    console.log(dim(`共 ${issues} 项需要关注。把上面的输出贴回来即可定位。`));
  }
}

// ---------- hook（Claude Code 事件通道）----------

function runHook(args) {
  const sub = args[0] ?? 'status';
  if (sub === 'install') {
    const r = installHooks();
    console.log(bold('已安装 Claude Code hook'));
    console.log(dim(`  ${r.path}${r.backedUp ? '（已备份原文件）' : ''}`));
    if (r.installed.length) console.log(`  新增 ${r.installed.length} 个事件: ${r.installed.join(', ')}`);
    if (r.alreadyInstalled.length) console.log(dim(`  刷新 ${r.alreadyInstalled.length} 个已有事件`));
    console.log();
    console.log(dim('  以 async 注册：Claude Code 不会等待 hook 返回。'));
    console.log(dim('  只订阅状态事件，权限决策完全留在 Claude Code 自己的流程里。'));
    console.log(dim('  卸载: maclawd-usage hook uninstall'));
    return;
  }
  if (sub === 'uninstall') {
    const r = uninstallHooks();
    if (r.removed.length === 0) console.log('没有找到 Maclawd 安装的 hook。');
    else {
      console.log(success(`已移除 ${r.removed.length} 个事件的 hook`));
      console.log(dim(`  ${r.path} 里其他条目未被触碰`));
    }
    return;
  }
  const st = hookStatus();
  console.log(bold('Claude Code hook 状态'));
  console.log(dim(`  配置 ${st.path}`));
  console.log(dim(`  脚本 ${st.script}`));
  if (st.error) { console.log(failureLine(st.error)); return; }
  console.log(`  已安装 ${st.installed.length}/${st.installed.length + st.missing.length}`);
  if (st.installed.length) console.log(dim(`    ${st.installed.join(', ')}`));
  if (st.missing.length) console.log(dim(`  未安装 ${st.missing.join(', ')}`));
}

const failureLine = (s) => `  \x1b[31m${s}\x1b[0m`;

// ---------- daemon（后台采集）----------

async function runDaemon(args) {
  const scanMin = Number(args.find((a) => /^\d+$/.test(a))) || 30;
  const collector = createCollector({
    scanIntervalMs: scanMin * 60_000,
    onScan: (r) => {
      const stamp = r.at.slice(11, 19);
      if (r.disabled) console.log(dim(`  ${stamp} 用量记录已关闭，跳过`));
      else if (r.error) console.log(dim(`  ${stamp} 扫描失败: ${r.error}`));
      else console.log(dim(`  ${stamp} ${r.records} 条 · ${r.elapsedMs}ms · 全量 ${r.stats.full} 增量 ${r.stats.appended} 复用 ${r.stats.reused}`));
    },
  });
  console.log(bold('Maclawd 后台采集'));
  console.log(dim(`  实时跟读 1s · 全量扫描 ${scanMin}min · Ctrl+C 退出`));
  console.log();
  await collector.start();
  // 保持进程存活（定时器已 unref）。
  setInterval(() => {}, 1 << 30);
  process.on('SIGINT', () => { collector.stop(); console.log(); process.exit(0); });
}

// ---------- serve（本地前端）----------

async function runServe(args) {
  const portArg = Number(args.find((a) => /^\d+$/.test(a)));
  const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4173;
  const { host } = await serve({ port });
  console.log(bold('Maclawd 本地面板'));
  console.log(`  宠物管理   http://${host}:${port}/`);
  console.log(`  用量统计   http://${host}:${port}/usage`);
  console.log();
  console.log(dim('  只监听回环地址。Ctrl+C 退出。'));
}

// ---------- main ----------

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case 'doctor': doctor(); break;
    case 'verify': await verify(); break;
    case 'scan': await scan(); break;
    case 'stats': stats(rest); break;
    case 'watch': await watch(rest); break;
    case 'serve': await runServe(rest); break;
    case 'update-prices': await runUpdatePrices(); break;
    case 'daemon': await runDaemon(rest); break;
    case 'hook': runHook(rest); break;
    case 'probe': await runProbe(rest); break;
    default:
      console.log(`用法: maclawd-usage <命令>

  doctor              检测已安装的工具与数据目录
  verify              口径验证：两种总量、命中率、去重效果
  scan                全量扫描并写入 rollup.json
  stats [区间]         查看统计（${RANGES.join(' / ')}）
    --source <id>     只看某个工具
    --cost            估算成本
  watch               实时 token 速率（Ctrl+C 退出）
  probe [source…]     解析器体检（不变量检查）
    --save            保存快照，之后用 --diff 对比
    --diff            与上次快照对比，看新操作有没有被记到
    --issues          只显示有问题的
  hook status         查看 Claude Code 事件通道状态
  hook install        安装（只订阅状态事件，async 注册，不拦截权限）
  hook uninstall      卸载（只移除自己写入的条目）
  daemon [分钟]        后台采集循环（默认 30 分钟全量扫描一次）
  serve [端口]         启动本地面板（默认 4173，自带后台采集）
  update-prices       联网更新模型价格表（唯一的对外请求）`);
  }
} catch (err) {
  console.error(`失败: ${err.message}`);
  process.exitCode = 1;
}
