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
  assert.match(block, /ForEach\(visibleSources\)[\s\S]*Text\(source\.label\)/);
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
  // 说明收进 ⓘ 而不是常驻铺在页面上。ⓘ 本身由 PanelView 的 InfoDot 统一实现，
  // 这里只验证额度开关确实走了 info 形态（而不是又变回常驻文本）。
  assert.match(quota, /info:\s*"Codex 通过官方 CLI 自动读取/,
    '额度读取说明应收进原生信息提示，不常驻占用设置页空间');
  assert.match(panelSource, /struct InfoDot[\s\S]*Image\(systemName: "info\.circle"\)/,
    'ⓘ 的实现应当只有一份');
  assert.match(panelSource, /struct InfoDot[\s\S]*\.help\(info\)/);
  assert.match(panelSource, /struct InfoDot[\s\S]*Button \{ showing\.toggle\(\) \}/,
    '信息提示还应支持键盘聚焦和点击展开');
  assert.doesNotMatch(quota, /Text\("Claude Code 状态行只在交互式界面刷新/,
    '刷新盲区说明不应再直接铺在开关下方');
});

test('Claude 自定义状态行不会让已开启的 Codex 额度被误报为未开启', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /if !store\.quota\.enabled/);
  assert.match(block, /case \.foreign:[\s\S]*Codex/);
});

test('WorkBuddy 真实积分与现有额度来源共用进度条并显示精确积分', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /ForEach\(visibleSources\)/);
  assert.doesNotMatch(block, /暂不支持读取积分/);
  const row = panelSource.slice(
    panelSource.indexOf('private struct QuotaRow'),
    panelSource.indexOf('// MARK: - 小图形'),
  );
  assert.match(row, /window\.remaining/);
  assert.match(row, /window\.limit/);
  assert.match(row, /Fmt\.credits/);
});

test('WorkBuddy 尚未登录或私有接口失效时给出可行动降级状态', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /workBuddyStatus/);
  assert.match(block, /请先登录 WorkBuddy/);
  assert.match(block, /登录状态已失效/);
  assert.match(block, /正在读取 WorkBuddy 积分/);
  assert.match(block, /lastErrorCode != nil/,
    '即使还有旧积分，登录或网络错误也必须同时显示');
});

test('WorkBuddy 订阅与额外额度对齐显示，额外积分包可展开查看', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /WorkBuddyQuotaPresentation/);
  assert.doesNotMatch(block, /DisclosureGroup/);
  assert.match(block, /Button[\s\S]*workBuddyBonusExpanded\.toggle\(\)/);
  assert.match(block, /chevron\.(up|down)/);
  assert.match(block, /contentShape\(Rectangle\(\)\)/);
  assert.match(block, /bonusDetails/);
  assert.match(block, /个额外积分包/);
  assert.match(block, /deadlineAction: \.expire/);
  assert.match(block, /Text\(window\.label\)/, '展开后必须保留 WorkBuddy 返回的真实包名');
  assert.match(block, /数据暂不完整/, '无法汇总时不能静默隐藏额度');
});

test('WorkBuddy 额外积分包在有限的独立滚动区展开，不撑乱整个概览页', () => {
  const block = panelSource.slice(
    panelSource.indexOf('if workBuddyBonusExpanded'),
    panelSource.indexOf('private var workBuddyStatus'),
  );
  assert.match(block, /ScrollView\(\.vertical,\s*showsIndicators:\s*false\)/,
    '额外包明细必须使用自己的纵向滚动区，不能全部塞进概览外层滚动区');
  assert.match(block, /\.frame\(height:\s*min\(/,
    '明细视口高度必须有上限，积分包数量不能无限拉长概览页');
  assert.match(block, /Text\(window\.label\)[\s\S]*\.lineLimit\(1\)[\s\S]*\.help\(window\.label\)/,
    '固定行高要求包名不换行，同时必须通过悬停保留完整名称');
});

test('额度窗口没有返回截止时间时不再静默留白', () => {
  const row = panelSource.slice(
    panelSource.indexOf('private struct QuotaRow'),
    panelSource.indexOf('// MARK: - 小图形'),
  );
  assert.match(row, /Fmt\.until\(window\.resetAt, action: deadlineAction\)/);
  assert.match(row, /deadlineAction\.label\)时间暂未提供/,
    'Grok 等未返回 resetAt 的来源也必须显示时间说明');
});

test('订阅额度标题右侧可多选这张卡显示的工具', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /@AppStorage\("overviewQuotaHiddenSources"\)/);
  assert.match(block, /Toggle\(source\.label, isOn: sourceVisibility\(source\.id\)\)/);
  assert.match(block, /Button\("全选"\)/);
  assert.ok(block.includes('return "已选 \\(visibleSources.count) 个"'));
  assert.match(block, /未选择要显示的工具/);
  assert.match(block, /accessory: store\.quota\.sources\.count > 1/);
  assert.match(block, /ForEach\(visibleSources\)/);
  assert.doesNotMatch(block, /setSetting|\/api\/settings/,
    '卡片筛选不应改变额度采集设置');
});

test('显示工具弹窗可持久化调整订阅额度来源顺序', () => {
  const block = panelSource.slice(
    panelSource.indexOf('private struct QuotaBlock'),
    panelSource.indexOf('private struct QuotaRow'),
  );
  assert.match(block, /@AppStorage\("overviewQuotaSourceOrder"\)/);
  assert.match(block, /QuotaSourceOrder\.resolve\(store\.quota\.sources, stored: sourceOrder\)/);
  assert.match(block, /ForEach\(Array\(orderedSources\.enumerated\(\)\), id: \\.element\.id\)/);
  assert.match(block, /sourceOrder = QuotaSourceOrder\.move\([\s\S]*id, by: offset, sources: store\.quota\.sources, stored: sourceOrder/);
  assert.match(block, /Image\(systemName: "chevron\.up"\)/);
  assert.match(block, /Image\(systemName: "chevron\.down"\)/);
  assert.ok(block.includes('.accessibilityLabel("上移 \\(source.label)")'));
  assert.ok(block.includes('.accessibilityLabel("下移 \\(source.label)")'));
});
