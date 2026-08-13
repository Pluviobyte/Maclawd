import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 统计页的工具筛选。
 *
 * 这几条都是很容易在后续重构中被无意抹掉、而编译器和单元测试都不会报警的产品判断：
 * 控件的位置、筛选态是否自述、以及同一个状态有没有第二个入口。
 */

const analytics = readFileSync(
  new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
);
const model = readFileSync(
  new URL('../mac/Sources/Maclawd/PanelModel.swift', import.meta.url), 'utf8',
);

test('工具筛选就在日期区间选择的右侧', () => {
  const bar = analytics.slice(
    analytics.indexOf('private var rangeAndFilterBar'),
    analytics.indexOf('private var toolMenu'),
  );
  assert.ok(bar.length > 0, '找不到区间条');
  // 顺序即位置：区间胶囊 → 更多区间菜单 → 工具筛选 → 漏斗。
  assert.ok(bar.indexOf('Self.primaryRanges') < bar.indexOf('toolMenu'));
  assert.ok(bar.indexOf('customPresented = true') < bar.indexOf('toolMenu'));
  assert.ok(bar.indexOf('toolMenu') < bar.indexOf('filtersPresented = true'));
});

test('筛选态在条上自述，而不是只有一个角标', () => {
  const menu = analytics.slice(
    analytics.indexOf('private var toolMenu'),
    analytics.indexOf('private var emptyState'),
  );
  // 条上显示短名，菜单项和 VoiceOver 用全称。
  assert.match(menu, /shortLabel\(forSource:/);
  assert.match(menu, /label\(forSource: id\)/);
  assert.match(menu, /accessibilityValue\(toolFullName/);
  // 宽度是硬约束，截断兜底不能被删掉。
  assert.match(menu, /truncationMode\(\.tail\)/);
  assert.match(menu, /lineLimit\(1\)/);
});

test('工具菜单的样式和尺寸约束不能被改回去', () => {
  const menu = analytics.slice(
    analytics.indexOf('private var toolMenu'),
    analytics.indexOf('private var emptyState'),
  );
  // .borderlessButton 会把自定义标签的胶囊底和内边距整个丢掉，只渲染文字，
  // 还自己在左边画一个箭头——实测过，不是猜的。
  assert.match(menu, /\.menuStyle\(\.button\)/);
  assert.match(menu, /\.buttonStyle\(\.plain\)/);
  assert.doesNotMatch(menu, /\.menuStyle\(\.borderlessButton\)/);
  // fixedSize 会让文本拿到无约束的建议宽度，截断因此永远不触发，条被撑爆。
  assert.doesNotMatch(menu, /fixedSize/);

  // 胶囊内边距是算出来的容量，不是随手填的数字：7 放不下工具筛选。
  assert.match(analytics, /private static let chipPadding: CGFloat = 5/);
  const bar = analytics.slice(
    analytics.indexOf('private var rangeAndFilterBar'),
    analytics.indexOf('private var emptyState'),
  );
  assert.doesNotMatch(bar, /padding\(\.horizontal, \d/,
    '区间条上的胶囊必须共用 chipPadding，不能各写各的字面量');
});

test('筛选下的空区间说清是筛选造成的，并能一键清除', () => {
  const empty = analytics.slice(
    analytics.indexOf('private var emptyState'),
    analytics.indexOf('private var isPrimaryRange'),
  );
  assert.match(empty, /当前筛选下这个区间没有数据/);
  assert.match(empty, /清除工具筛选/);
  assert.match(empty, /store\.selectTool\(nil\)/);
});

test('工具只有一个入口：筛选 sheet 里不再有它', () => {
  const sheet = analytics.slice(
    analytics.indexOf('struct AnalyticsFilterSheet'),
    analytics.indexOf('struct AnalyticsCustomRangeSheet'),
  );
  assert.doesNotMatch(sheet, /dimensions\.sources/);
  assert.doesNotMatch(sheet, /selectedSource/);
  assert.doesNotMatch(sheet, /selector\("工具"/);
  // 漏斗的角标也不能再把工具算进去，否则它会替一个自己不管的状态报数。
  const count = analytics.slice(
    analytics.indexOf('private var filterCount'),
    analytics.indexOf('private var toolBinding'),
  );
  assert.doesNotMatch(count, /selectedSource/);
});

test('采集完整度按选中的工具收窄', () => {
  assert.match(analytics, /private var scopedComplete/);
  assert.match(analytics, /collection\.sources\[source\]\?\.complete/);
  // 只筛 Codex 时，别的工具没索引完不该把 Codex 的数字标成「已统计」。
  assert.doesNotMatch(
    analytics.slice(analytics.indexOf('private var headline')),
    /store\.analytics\.collection\.complete/,
  );
  assert.match(model, /var progress: Double\? \{[\s\S]*?discoveredFiles > 0/);
});
