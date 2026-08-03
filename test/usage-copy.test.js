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
  assert.match(analyticsSwift, /lowerBound.*activeSeconds/s);
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
