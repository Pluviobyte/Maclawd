import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('用量面板明确区分非缓存读取 Token、价格覆盖与采集完整度', () => {
  const html = readFileSync(new URL('../web/usage.html', import.meta.url), 'utf8');
  assert.match(html, /非缓存读取 Token/);
  assert.match(html, /计价覆盖率/);
  assert.match(html, /采集完整度/);
  assert.match(html, /collection\.complete/);
  assert.doesNotMatch(html, />计费 Token</);
});

test('手机镜像把费用标为估算，并把未完成采集显示成下限', () => {
  const html = readFileSync(new URL('../web/mobile.html', import.meta.url), 'utf8');
  assert.match(html, /估算成本/);
  assert.match(html, /summary\.collection/);
  assert.match(html, /collection\.complete/);
  assert.match(html, /采集索引尚未完成/);
  assert.doesNotMatch(html, />成本</);
});

test('部分空态不伪装成暂无数据，且不完整时隐藏比较并标记会话下限', () => {
  const usage = readFileSync(new URL('../web/usage.html', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../web/mobile.html', import.meta.url), 'utf8');
  const analyticsSwift = readFileSync(
    new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
  );
  const panelSwift = readFileSync(
    new URL('../mac/Sources/Maclawd/PanelView.swift', import.meta.url), 'utf8',
  );
  for (const source of [usage, mobile, analyticsSwift, panelSwift]) {
    assert.match(source, /正在建立用量索引/);
  }
  assert.match(usage, /collection\.complete && a\.comparison/);
  assert.match(mobile, /collection\.complete && summary\.baseline/);
  assert.match(analyticsSwift, /collection\.complete, let delta/);
  assert.match(panelSwift, /collectionComplete, let delta/);
  assert.match(usage, /lowerBound.*activeSeconds/s);
  assert.doesNotMatch(analyticsSwift, /lowerBound.*activeSeconds/s);
});

test('原生区间总览显示已统计的准确值和索引百分比，不使用大于等于号', () => {
  const source = readFileSync(
    new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
  );
  const headline = source.slice(
    source.indexOf('private var headline'),
    source.indexOf('private var trendCard'),
  );
  assert.match(headline, /当前已统计/);
  assert.match(headline, /历史索引进度/);
  assert.match(headline, /ProgressView\(value:/);
  assert.match(headline, /准确值/);
  assert.doesNotMatch(headline, /≥|lowerBound/);
});

test('原生概览用普通语言解释首次索引，不用数学符号要求用户猜', () => {
  const panelSwift = readFileSync(
    new URL('../mac/Sources/Maclawd/PanelView.swift', import.meta.url), 'utf8',
  );
  assert.match(panelSwift, /正在整理历史用量/);
  assert.match(panelSwift, /已完成/);
  assert.match(panelSwift, /最终数字可能更高/);
  assert.match(panelSwift, /nextCollectionScanLabel/);
  assert.doesNotMatch(panelSwift, /collectionComplete \? "" : "≥ "/);
});

test('概览统一显示总 Token，不让用户选择技术口径', () => {
  const panelSwift = readFileSync(
    new URL('../mac/Sources/Maclawd/PanelView.swift', import.meta.url), 'utf8',
  );
  const menuSwift = readFileSync(
    new URL('../mac/Sources/Maclawd/MenuBarController.swift', import.meta.url), 'utf8',
  );
  const pet = readFileSync(new URL('../web/pet.html', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../web/mobile.html', import.meta.url), 'utf8');
  assert.match(panelSwift, /总 Token/);
  assert.doesNotMatch(panelSwift, /非缓存读取 tokens|吞吐 tokens/);
  assert.match(menuSwift, /client\.usage\.throughput/);
  assert.doesNotMatch(pet, /面板主口径/);
  assert.match(mobile, /fmt\(s\.throughput\)/);
  assert.match(mobile, /总 Token/);
});

test('原生每日趋势在图表内显示悬浮读数，不叠加系统提示', () => {
  const source = readFileSync(
    new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
  );
  const chart = source.slice(
    source.indexOf('struct AnalyticsTrendChart'),
    source.indexOf('struct AnalyticsHeatmap'),
  );
  assert.match(chart, /悬浮柱状图查看具体数值/);
  assert.match(chart, /shown\.first\(where:/);
  assert.doesNotMatch(chart, /\.help\(/);
  assert.doesNotMatch(chart, /\.overlay\(/);
});

test('分布维度和数值选择器之间有明确的视觉分隔', () => {
  const source = readFileSync(
    new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
  );
  const card = source.slice(
    source.indexOf('private var distributionCard'),
    source.indexOf('private var detailCard'),
  );
  assert.match(card, /Rectangle\(\)[\s\S]*frame\(width: 1, height: 18\)/);
  assert.match(card, /accessibilityHidden\(true\)/);
});

test('额度设置把 Claude HUD 兼容作为自动行为，不暴露接管和槽位术语', () => {
  const source = readFileSync(
    new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
  );
  const quota = source.slice(
    source.indexOf('// MARK: 订阅额度'),
    source.indexOf('// MARK: 提醒'),
  );
  assert.match(quota, /自动兼容 Claude HUD/);
  assert.match(quota, /保持它原有的显示/);
  assert.match(quota, /保留原显示并读取额度/);
  assert.doesNotMatch(quota, /接管并保留原有|状态行槽位|foreignBanner/);
});

test('网页从非空筛选切到空结果时清除上一轮统计', () => {
  const html = readFileSync(new URL('../web/usage.html', import.meta.url), 'utf8');
  const match = html.match(/function clearUsageData\(\)\{([\s\S]*?)\n\}/);
  assert.ok(match, 'usage page should define one empty-state reset function');

  const nodes = new Map();
  const el = (id) => {
    if (!nodes.has(id)) {
      let value = '上一轮数据';
      nodes.set(id, {
        get textContent() { return value; },
        set textContent(next) { value = String(next); },
        get innerHTML() { return value; },
        set innerHTML(next) { value = String(next); },
        hidden: false,
        title: '上一轮明细',
      });
    }
    return nodes.get(id);
  };
  Function('el', `return function(){${match[1]}\n}`)(el)();

  for (const id of ['costNum', 'coverage', 'hit', 'active', 'compare', 'fields',
    'hours', 'dailyMeta', 'daily', 'heat', 'recordMeta', 'wrapped']) {
    assert.doesNotMatch(String(nodes.get(id)?.textContent ?? nodes.get(id)?.innerHTML), /上一轮数据/, id);
  }
  for (const id of ['tBySource', 'tByModel', 'tByProject', 'tRecords']) {
    assert.doesNotMatch(nodes.get(id).innerHTML, /上一轮数据/, id);
  }
  assert.equal(nodes.get('moreRecords').hidden, true);
  assert.equal(nodes.get('coverageNote').hidden, true);
  assert.equal(nodes.get('projectNote').hidden, true);
});
