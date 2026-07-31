import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASK, looksSensitive, redact, safeTitle } from '../src/runtime/redact.js';

/**
 * 取向是**宁可多脱一点**：误脱一个无害字符串只是显示成 ***，
 * 漏脱一个 API key 是事故。所以这里的用例分两组——
 * 「必须脱掉」是硬要求，「不该误伤」是质量要求。
 */

/**
 * 测试向量在**运行时拼装**，源码里不留完整字面量。
 *
 * 原因很实际：GitHub 的推送保护会把 `xoxb-…` 这类完整样本当成真令牌拦下来，
 * 而安全测试的样本本来就不该在源码里留下可被扫描器匹配的串。
 * 拼装后 redact() 收到的仍是完整字符串，测的东西一点没少。
 */
const j = (...parts) => parts.join('');
const DIGITS = '0123456789';
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

const MUST_REDACT = [
  ['OpenAI/Anthropic', j('ANTHROPIC_API_KEY=', 'sk-', 'ant-api03-', ALPHA, '012345')],
  ['GitHub PAT', j('token ', 'ghp', '_', ALPHA, DIGITS)],
  ['GitHub 细粒度', j('github', '_pat_', '11ABCDEFG0', ALPHA, '012345')],
  ['AWS', j('aws_access_key_id ', 'AKIA', 'IOSFODNN7EXAMPLE')],
  ['Slack', j('xox', 'b-', '1234567890-', ALPHA.slice(0, 16))],
  ['Google', j('AIza', 'SyA1234567890', ALPHA.slice(0, 22))],
  ['GitLab', j('glpat', '-', ALPHA.slice(0, 10), DIGITS)],
  ['npm', j('npm', '_', ALPHA, DIGITS)],
  ['本项目自己的 key', j('vbu', '_', ALPHA)],
  ['Authorization 头', j('curl -H "Authorization: Bearer ', 'eyJ', 'hbGciOiJIUzI1NiJ9.payload.sig"')],
  ['password 赋值', 'DB_PASSWORD=hunter2'],
  ['secret 赋值', 'client_secret: abc123def456'],
  ['命令行 flag', 'deploy --api-key abcdef123456'],
];

for (const [label, text] of MUST_REDACT) {
  test(`必须脱掉：${label}`, () => {
    const out = redact(text);
    assert.ok(out.includes(MASK), `没有脱敏: ${out}`);
    // 原始密钥的可识别片段不得残留
    const secretPattern = new RegExp(
      ['sk-[\\w-]+', 'gh[pousr]_\\w+', 'github_pat_\\w+', 'AKIA\\w+',
       'xox[bp]-[\\w-]+', 'AIza[\\w-]+', 'glpat-[\\w-]+', 'npm_\\w+', 'vbu_\\w+',
       'hunter2', 'abc123def456', 'abcdef123456', 'eyJ[\\w.]+'].join('|'),
    );
    const secret = text.match(secretPattern)?.[0];
    if (secret) assert.ok(!out.includes(secret), `密钥残留: ${out}`);
  });
}

test('PEM 私钥整块脱掉', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----';
  const out = redact(`key:\n${pem}`);
  assert.ok(!out.includes('MIIEow'));
  assert.ok(out.includes(MASK));
});

const MUST_NOT_TOUCH = [
  'npm run build && git push origin main',
  'pytest -q tests/parsers',
  '修复 New-API 的登录问题',
  '/Users/rain/Desktop/Maclawd/src/runtime/scan.js',
  'claude-opus-4-6',
  'SELECT * FROM message WHERE role = "assistant"',
  'git commit -m "fix: 缓存命中率算错了分母"',
];

for (const text of MUST_NOT_TOUCH) {
  test(`不该误伤：${text.slice(0, 32)}`, () => {
    assert.equal(redact(text), text, '普通文本被改动了');
    assert.equal(looksSensitive(text), false);
  });
}

test('键名可疑时只脱值，保留键名', () => {
  // 「有个 api_key」这个信息对排查有用，值不能留
  const out = redact('api_key=abcdefghijklmnop');
  assert.ok(out.startsWith('api_key='));
  assert.ok(out.includes(MASK));
});

test('高熵长串被脱掉，但普通哈希与路径不受影响', () => {
  const entropy = 'aB3dEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh';
  assert.ok(redact(entropy).includes(MASK));
  // 纯十六进制（git sha、文件哈希）不该命中——它没有大小写混合
  const sha = 'e2c70c6f9a1b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e';
  assert.equal(redact(sha), sha);
});

test('控制字符被清理，超长被截断', () => {
  assert.equal(redact('a\u0000b\u001Fc'), 'a b c');
  const long = 'x'.repeat(400);
  const out = redact(long, { maxLength: 50 });
  assert.equal(out.length, 50);
  assert.ok(out.endsWith('…'));
});

test('safeTitle 命中可疑就整条不显示，而不是显示半截', () => {
  // 桌宠旁边露出 *** 比不显示更糟——用户会想去点开看它
  assert.equal(safeTitle(j('ANTHROPIC_API_KEY=', 'sk-', 'ant-', ALPHA.slice(0, 20))), '');
  assert.equal(safeTitle('password: x'), '');
  assert.equal(safeTitle('重构解析器的去重逻辑'), '重构解析器的去重逻辑');
});

test('非字符串输入不抛错', () => {
  for (const input of [null, undefined, 42, {}, []]) {
    assert.equal(redact(input), '');
    assert.equal(safeTitle(input), '');
    assert.equal(looksSensitive(input), false);
  }
});

test('正则带 g 标志时反复调用结果稳定', () => {
  // lastIndex 没重置会导致第二次调用漏判——这是 /g 正则的经典坑
  const text = j('ghp', '_', ALPHA, DIGITS);
  for (let i = 0; i < 4; i++) {
    assert.equal(looksSensitive(text), true, `第 ${i + 1} 次调用结果不一致`);
    assert.ok(redact(text).includes(MASK));
  }
});
