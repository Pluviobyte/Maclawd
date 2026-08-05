import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelView.swift', import.meta.url), 'utf8',
);
const runtimeSource = readFileSync(
  new URL('../mac/Sources/Maclawd/RuntimeClient.swift', import.meta.url), 'utf8',
);
const menuSource = readFileSync(
  new URL('../mac/Sources/Maclawd/MenuBarController.swift', import.meta.url), 'utf8',
);
const settingsSource = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelSettings.swift', import.meta.url), 'utf8',
);
const alertSource = readFileSync(
  new URL('../mac/Sources/Maclawd/QuotaAlertHUD.swift', import.meta.url), 'utf8',
);

test('订阅额度即使只有一个服务商也始终显示来源名称', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /ForEach\(store\.quota\.sources\)[\s\S]*Text\(source\.label\)/);
  assert.doesNotMatch(block, /if store\.quota\.sources\.count > 1/,
    '单一来源时也不能隐藏 Claude Code / Codex 标签');
});

test('面板、菜单栏与额度提醒统一展示剩余百分比', () => {
  const row = panelSource.slice(
    panelSource.indexOf('private struct QuotaRow'),
    panelSource.indexOf('// MARK: - 小图形'),
  );
  assert.match(runtimeSource, /struct QuotaBrief[\s\S]*sourceLabel: String\?/);
  assert.match(runtimeSource, /brief\.sourceLabel = tightest\?\.0\.label/);
  assert.match(row, /remainingPercent/);
  assert.match(row, /剩余/);
  assert.doesNotMatch(row, /显示\*\*已用\*\*|Text\([^\n]*已用/);
  assert.match(menuSource, /remainingPercent/);
  assert.match(menuSource, /sourceLabel[\s\S]*windowLabel[\s\S]*剩余/);
  assert.match(alertSource, /剩余/);
  assert.match(alertSource, /remainingPercent/);
});

test('额度主开关同时说明 Codex 与 Claude Code，不再冒充为 Claude 专用开关', () => {
  const quota = settingsSource.slice(
    settingsSource.indexOf('// MARK: 订阅额度'),
    settingsSource.indexOf('// MARK: 提醒'),
  );
  assert.match(quota, /isOn: store\.bool\("quotaTracking"\)/);
  assert.match(quota, /Codex/);
  assert.match(quota, /Claude Code/);
});

test('Claude 自定义状态行不会让已开启的 Codex 额度被误报为未开启', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /if !store\.quota\.enabled/);
  assert.match(block, /case \.foreign:[\s\S]*Codex/);
});

test('已安装 WorkBuddy 时与现有额度来源并列，但不伪造进度条', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /store\.quota\.workBuddy\.installed/);
  assert.match(block, /Text\("WorkBuddy"\)/);
  assert.match(block, /暂不支持读取积分/);
  assert.match(block, /官方读取接口/);
});
