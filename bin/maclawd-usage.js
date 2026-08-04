#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { scanAll } from '../src/runtime/scan.js';
import { parsers } from '../src/runtime/parsers/index.js';
import { dedupe } from '../src/runtime/dedupe.js';
import {
  buildRollup, summarize, baseline, RANGES, ROLLUP_VERSION,
} from '../src/runtime/rollup.js';
import { costOf, updatePrices, pricingMeta } from '../src/runtime/pricing.js';
import { summarizeSessions } from '../src/runtime/sessions.js';
import { createTailer, intensityFromRate } from '../src/runtime/tail.js';
import { loadActions, serve } from '../src/runtime/server.js';
import { clearEndpoint } from '../src/runtime/endpoint.js';
import { collectionFromScan, createCollector } from '../src/runtime/daemon.js';
import { installHooks, uninstallHooks, hookStatus } from '../src/runtime/hook-install.js';
import {
  installStatusline, uninstallStatusline, statuslineStatus,
} from '../src/runtime/statusline-install.js';
import { readQuota } from '../src/runtime/account-quota.js';
import { probe, diffProbe } from '../src/runtime/probe.js';
import { rangeBounds } from '../src/runtime/rollup.js';
import {
  billable, cacheWrite, hitRate, throughput,
} from '../src/runtime/usage-record.js';
import { readJson, writeJson } from '../src/runtime/store.js';
import { COVERAGE_FILE, ROLLUP_FILE, usageDir } from '../src/runtime/paths.js';
import { classify, GLIMPSE_MS } from '../src/runtime/coverage.js';

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

  if (result.disabled) {
    console.log('用量记录已关闭，未改写现有统计。');
    return;
  }

  const rollup = buildRollup(
    result.records,
    result.sessionsBySource,
    result.projectPaths,
    collectionFromScan(result),
  );
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
  if (rollup.v !== ROLLUP_VERSION) {
    console.log('统计结构已升级，需要重新扫描。运行 `maclawd-usage scan`。');
    return;
  }

  const collection = rollup.collection ?? {
    complete: false, deferredFiles: null, sources: {}, scannedAt: null,
  };
  const lowerBound = collection.complete ? '' : '≥ ';

  const summary = summarize(rollup, rangeArg, {
    source: sourceArg,
    priceBucket: withCost ? costOf : null,
  });

  console.log(bold(`${rangeArg}${sourceArg ? ` · ${sourceArg}` : ''}`));
  console.log();
  const costText = summary.cost !== null
    ? ` · 估算 ${lowerBound}$${summary.cost.toFixed(2)}`
    : '';
  console.log(`  ${bold(lowerBound + fmt(summary.billable))} 非缓存读取 tokens${costText}`);
  if (!collection.complete) {
    const deferred = collection.deferredFiles == null
      ? ''
      : `，待处理 ${collection.deferredFiles} 个文件`;
    console.log(dim(`  采集索引尚未完成${deferred}，以上 Token、估算费用与会话均为下限`));
  }
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
  if (collection.complete && base && rangeArg === 'today' && summary.throughput > 0) {
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

/**
 * 动作覆盖报告。
 *
 * 回答一个测试答不了的问题：**这个动作在真实使用中被看见过吗**。
 * 可达性测试只能证明「合成场景下能上屏」——一个动作可能完全可达，
 * 却因为触发条件在日常里不出现、或每次只闪几十毫秒，事实上从没被看见过。
 * 这个项目已经三次栽在这类问题上，三次都是靠人肉排查发现的。
 */
function runCoverage() {
  const snapshot = readJson(COVERAGE_FILE, null);
  if (!snapshot?.actions) {
    console.log(dim('还没有覆盖数据。桌宠跑起来之后会自动记录，用一天再回来看。'));
    return;
  }
  const known = loadActions().filter((a) => a.name).map((a) => a.id);
  const { never, glimpsed, normal } = classify(snapshot, known);
  const secs = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}分` : `${(ms / 1000).toFixed(1)}秒`);

  const since = snapshot.since ? new Date(snapshot.since).toLocaleString() : '未知';
  console.log(bold('动作覆盖') + dim(`  自 ${since} 起`));
  console.log(dim(`  共 ${known.length} 个动作：${normal.length} 正常 · ${glimpsed.length} 一闪而过 · ${never.length} 从没出现`));

  if (never.length) {
    console.log('\n' + bold('从没出现过') + dim('  ——可达性测试是绿的，但日常里这些条件从不发生'));
    for (const r of never) console.log(`  ${r.id}`);
  }
  if (glimpsed.length) {
    console.log('\n' + bold('出现过但每次都看不清') + dim(`  ——最长一次都不到 ${GLIMPSE_MS}ms`));
    for (const r of glimpsed) {
      console.log(`  ${r.id.padEnd(24)} ${r.count} 次 · 最长 ${r.maxMs}ms`);
    }
  }
  if (normal.length) {
    console.log('\n' + bold('正常'));
    for (const r of normal) {
      const flash = r.glimpses ? dim(`（其中 ${r.glimpses} 次一闪而过）`) : '';
      console.log(`  ${r.id.padEnd(24)} ${String(r.count).padStart(4)} 次 · 共 ${secs(r.totalMs).padStart(7)} · 最长 ${secs(r.maxMs)} ${flash}`);
    }
  }
}

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
  const wanted = Number.isFinite(portArg) && portArg > 0 ? portArg : 4173;

  let started;
  try {
    started = await serve({ port: wanted });
  } catch (err) {
    // 端口相关的失败必须说人话。此前这里是未捕获异常，外壳又把 stderr
    // 丢掉了，用户只看到桌宠不动——那是最难自查的一种失败。
    if (err?.code === 'EALREADYRUNNING') {
      console.error(`Maclawd 已经在 ${err.port} 端口运行，不再启动第二份。`);
      console.error(dim('  两个采集器同时跑会重复计数。要重启请先退出原来那个。'));
      process.exit(3);
    }
    if (err?.code === 'EPORTEXHAUSTED') {
      console.error(err.message);
      console.error(dim('  用 `maclawd-usage serve <端口>` 指定一个空闲端口。'));
      process.exit(4);
    }
    throw err;
  }

  const { host, port, identity } = started;
  // 退出时把端点文件清掉，免得下一次启动的 hook 去连一个已经死了的端口。
  const cleanup = () => { clearEndpoint({ instanceId: identity.instanceId }); };
  process.on('exit', cleanup);
  // 管理端点用于新版 App 接替旧 runtime。server.close() 只撤掉监听端口，
  // 正在进行的历史扫描仍可能持有异步文件句柄；不显式退出就会留下一个
  // 无端口、满 CPU 的孤儿进程，与新 runtime 同时扫同一批日志。
  started.server.once('close', () => process.exit(0));

  console.log(bold('Maclawd 本地面板'));
  console.log(`  宠物管理   http://${host}:${port}/`);
  console.log(`  用量统计   http://${host}:${port}/usage`);
  if (port !== wanted) {
    console.log();
    console.log(dim(`  ${wanted} 已被占用，改用 ${port}。hook 会自动跟上。`));
  }
  console.log();
  console.log(dim('  只监听回环地址。Ctrl+C 退出。'));
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

// ---------- statusline（订阅额度通道） ----------

/** 把重置时刻说成人话。距离越远给的精度越粗。 */
function untilText(resetAt) {
  if (!Number.isFinite(resetAt)) return '重置时间未知';
  const secs = Math.round((resetAt - Date.now()) / 1000);
  if (secs <= 0) return '即将重置';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小时后重置`;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m 后重置` : `${m} 分钟后重置`;
}

function printStatuslineStatus() {
  const s = statuslineStatus();
  console.log(bold('Claude Code 状态行通道'));
  console.log(dim(`  ${s.path}`));
  console.log();
  switch (s.state) {
    case 'none':
      console.log('  未安装。状态行槽位是空的，可以直接装。');
      console.log(dim('  `maclawd-usage statusline install`'));
      break;
    case 'ours':
      console.log(success('已安装'));
      break;
    case 'chained':
      console.log(success('已安装（接管模式）'));
      console.log(dim('  你原来的状态行仍然在渲染，Maclawd 只取额度：'));
      console.log(dim(`    ${(s.foreignCommand ?? '（sidecar 丢失）').slice(0, 120)}`));
      break;
    case 'foreign':
      console.log('  槽位被别的状态行占着，Maclawd 没有覆盖它：');
      console.log(dim(`    ${s.command.slice(0, 120)}`));
      console.log();
      console.log(dim('  想同时保留它并取额度：`maclawd-usage statusline chain`'));
      break;
    default:
      console.log(`  无法读取：${s.error}`);
  }
}

function runStatusline(args) {
  const action = args[0] ?? 'status';
  if (action === 'status') { printStatuslineStatus(); return; }

  if (action === 'install' || action === 'chain') {
    const r = installStatusline({ chainExisting: action === 'chain' });
    if (r.blocked) {
      console.log('检测到你已经配置了状态行，Maclawd **没有**覆盖它：');
      console.log(dim(`  ${r.foreignCommand.slice(0, 160)}`));
      console.log();
      console.log('要同时保留它并取额度，运行：');
      console.log(dim('  maclawd-usage statusline chain'));
      process.exitCode = 1;
      return;
    }
    console.log(success(r.chained ? '已接管状态行，原有的仍在渲染' : '已注册状态行'));
    console.log(dim(`  ${r.path}`));
    console.log(dim('  额度要等下一次交互式会话产生第一次 API 响应之后才会出现。'));
    return;
  }

  if (action === 'uninstall') {
    const r = uninstallStatusline();
    if (!r.removed) {
      console.log(r.foreign
        ? '状态行已经被改成别的了，未做改动。'
        : '本来就没装。');
      return;
    }
    console.log(success(r.restored ? '已移除并还原你原来的状态行' : '已移除'));
    return;
  }

  console.log('用法: maclawd-usage statusline [status|install|chain|uninstall]');
  process.exitCode = 1;
}

// ---------- quota ----------

function runQuota() {
  const snap = readQuota();
  const s = statuslineStatus();
  console.log(bold('订阅额度'));
  console.log();

  if (snap.empty) {
    console.log('  还没有额度数据。');
    console.log();
    if (s.state === 'none' || s.state === 'foreign') {
      console.log(dim('  通道没装。`maclawd-usage statusline status` 看怎么装。'));
    } else {
      console.log(dim('  通道已装。额度要等交互式会话的第一次 API 响应之后才出现——'));
      console.log(dim('  `claude -p` 与 CI 里的无界面运行不会触发状态行，因此不更新额度。'));
    }
    return;
  }

  for (const source of snap.sources) {
    console.log(`  ${bold(source.label)}`);
    for (const w of source.windows) {
      if (w.state === 'reset') {
        console.log(`    ${w.label.padEnd(8)} ${dim('已重置')}`);
        continue;
      }
      const filled = Math.round((w.usedPercent / 100) * 20);
      const bar = '█'.repeat(filled) + '·'.repeat(20 - filled);
      const stale = w.state === 'quiet'
        ? dim(`  ${Math.round(w.staleSeconds / 60)} 分钟前的数据`)
        : '';
      console.log(`    ${w.label.padEnd(8)} ${bar} 已用 ${String(w.usedPercent).padStart(3)}%  ${dim(untilText(w.resetAt))}${stale}`);
    }
    if (source.context) {
      const size = source.context.windowSize
        ? `${Math.round(source.context.windowSize / 1000)}K`
        : '未知';
      console.log(dim(`    上下文     已用 ${source.context.usedPercent}%（窗口 ${size}）`));
    }
    console.log();
  }
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
    case 'statusline': runStatusline(rest); break;
    case 'quota': runQuota(); break;
    case 'probe': await runProbe(rest); break;
    case 'coverage': runCoverage(); break;
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
  coverage            动作覆盖：哪些动作在真实使用中被看见过
    --save            保存快照，之后用 --diff 对比
    --diff            与上次快照对比，看新操作有没有被记到
    --issues          只显示有问题的
  hook status         查看 Claude Code 事件通道状态
  hook install        安装（只订阅状态事件，async 注册，不拦截权限）
  hook uninstall      卸载（只移除自己写入的条目）
  quota               订阅额度：5 小时 / 本周窗口用了多少、何时重置
  statusline status   查看订阅额度通道（Claude Code 状态行）
  statusline install  安装到空槽位（槽位被占则拒绝并提示）
  statusline chain    接管已有状态行，原有的继续渲染
  statusline uninstall 卸载并还原
  daemon [分钟]        后台采集循环（默认 30 分钟全量扫描一次）
  serve [端口]         启动本地面板（默认 4173，自带后台采集）
  update-prices       联网更新模型价格表（唯一的对外请求）`);
  }
} catch (err) {
  console.error(`失败: ${err.message}`);
  process.exitCode = 1;
}
