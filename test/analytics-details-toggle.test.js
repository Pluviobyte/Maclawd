import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Token 与会话明细的展开和收起文案都是完整按钮', () => {
  const source = readFileSync(
    new URL('../mac/Sources/Maclawd/AnalyticsView.swift', import.meta.url), 'utf8',
  );
  const headline = source.slice(
    source.indexOf('private var headline'),
    source.indexOf('@ViewBuilder private var sessionSummary'),
  );

  assert.match(headline, /Button\s*\{[\s\S]*detailsExpanded\.toggle\(\)/);
  assert.match(headline, /detailsExpanded \? "收起明细" : "查看 Token 与会话明细"/);
  assert.match(headline, /\.contentShape\(Rectangle\(\)\)/);
  assert.match(headline, /accessibilityLabel\(detailsExpanded/);
  assert.doesNotMatch(headline, /DisclosureGroup/);
});
