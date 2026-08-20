import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'maclawd-grok-quota-'));
process.env.MACLAWD_DATA_DIR = data;

const {
  readGrokToken, readGrokBilling, parseGrpcBillingResponse, createGrokQuotaCollector,
} = await import('../src/runtime/grok-quota.js');
const { clearQuota, readQuota, recordQuota } = await import('../src/runtime/account-quota.js');

const NOW = 1_785_800_000_000;

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7F) {
    bytes.push((remaining & 0x7F) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining & 0x7F);
  return Buffer.from(bytes);
}

function protoVarint(field, value) {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function protoMessage(field, payload) {
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(payload.length),
    payload,
  ]);
}

function grpcFrame(payload, flags = 0) {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flags;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

test.after(() => rmSync(data, { recursive: true, force: true }));
test.beforeEach(() => clearQuota());

// ---- auth.json 解析 ----

test('OIDC scope 优先于 legacy scope 读取 Grok Token', () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-auth-'));
  const authPath = join(authDir, 'auth.json');
  try {
    writeFileSync(authPath, JSON.stringify({
      'https://accounts.x.ai/sign-in': { key: 'legacy-token-abc' },
      'https://auth.x.ai::openid': { key: 'oidc-token-xyz' },
    }));
    assert.equal(readGrokToken({ authPath }), 'oidc-token-xyz');
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('仅有 legacy scope 时回退读取', () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-auth-'));
  const authPath = join(authDir, 'auth.json');
  try {
    writeFileSync(authPath, JSON.stringify({
      'https://accounts.x.ai/sign-in': { key: 'legacy-only-token' },
    }));
    assert.equal(readGrokToken({ authPath }), 'legacy-only-token');
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('认证文件不存在时抛出 ENOAUTH', () => {
  assert.throws(
    () => readGrokToken({ authPath: '/nonexistent/auth.json' }),
    (error) => error.code === 'ENOAUTH',
  );
});

test('认证文件中无有效 key 时抛出 ENOAUTH', () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-auth-'));
  const authPath = join(authDir, 'auth.json');
  try {
    writeFileSync(authPath, JSON.stringify({
      'https://auth.x.ai::openid': { key: '' },
      'https://accounts.x.ai/sign-in': {},
    }));
    assert.throws(
      () => readGrokToken({ authPath }),
      (error) => error.code === 'ENOAUTH',
    );
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

// ---- gRPC-web protobuf 解析 ----

test('从 gRPC-web protobuf 响应中正确扫描 usedPercent 和 resetsAt', () => {
  // 构造一个带有 float32 和 varint 字段的最小 protobuf
  const proto = Buffer.alloc(32);
  let offset = 0;

  // field 1, wire type 5 (fixed32) → usedPercent = 42.5
  proto[offset++] = (1 << 3) | 5;
  proto.writeFloatLE(42.5, offset);
  offset += 4;

  // field 2, wire type 0 (varint) → resetsAt = 1786000000
  proto[offset++] = (2 << 3) | 0;
  let value = 1_786_000_000;
  while (value > 0x7F) {
    proto[offset++] = (value & 0x7F) | 0x80;
    value >>>= 7;
  }
  proto[offset++] = value & 0x7F;

  const payload = proto.subarray(0, offset);

  // 5-byte gRPC-web frame header
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x00; // flags
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);

  const result = parseGrpcBillingResponse(frame);
  assert.ok(Math.abs(result.usedPercent - 42.5) < 0.01);
  assert.equal(result.resetsAt, 1_786_000_000);
});

test('protobuf 中没有合法 float32 时 usedPercent 为 null', () => {
  // 只有一个 varint 字段
  const proto = Buffer.alloc(16);
  let offset = 0;
  proto[offset++] = (1 << 3) | 0; // field 1, varint
  let value = 1_786_000_000;
  while (value > 0x7F) {
    proto[offset++] = (value & 0x7F) | 0x80;
    value >>>= 7;
  }
  proto[offset++] = value & 0x7F;

  const payload = proto.subarray(0, offset);
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0x00;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);

  const result = parseGrpcBillingResponse(frame);
  assert.equal(result.usedPercent, null);
  assert.equal(result.resetsAt, 1_786_000_000);
});

test('gRPC billing 同时包含周期开始和结束时选择结束时间', () => {
  const periodStart = 1_785_000_000;
  const periodEnd = 1_786_000_000;
  const overallUsage = Buffer.alloc(5);
  overallUsage[0] = (1 << 3) | 5;
  overallUsage.writeFloatLE(58, 1);
  const config = Buffer.concat([
    overallUsage,
    protoMessage(4, protoVarint(1, periodStart)),
    protoMessage(5, protoVarint(1, periodEnd)),
  ]);

  const result = parseGrpcBillingResponse(grpcFrame(protoMessage(1, config)));

  assert.equal(result.usedPercent, 58);
  assert.equal(result.resetsAt, periodEnd);
});

test('gRPC billing 支持 typed period 结束时间且总使用率字段省略时视为 0', () => {
  const periodEnd = 1_786_100_000;
  const productUsage = Buffer.alloc(5);
  productUsage[0] = (1 << 3) | 5;
  productUsage.writeFloatLE(73, 1);
  const typedPeriod = Buffer.concat([
    protoVarint(1, 2),
    protoMessage(3, protoVarint(1, periodEnd)),
  ]);
  const config = Buffer.concat([
    protoMessage(7, productUsage),
    protoMessage(8, typedPeriod),
  ]);

  const result = parseGrpcBillingResponse(grpcFrame(protoMessage(1, config)));

  assert.equal(result.usedPercent, 0);
  assert.equal(result.resetsAt, periodEnd);
});

test('gRPC-web 解析后续数据帧并校验成功 trailer', () => {
  const periodEnd = 1_786_200_000;
  const overallUsage = Buffer.alloc(5);
  overallUsage[0] = (1 << 3) | 5;
  overallUsage.writeFloatLE(44, 1);
  const config = Buffer.concat([
    overallUsage,
    protoMessage(5, protoVarint(1, periodEnd)),
  ]);
  const response = Buffer.concat([
    grpcFrame(protoVarint(2, 7)),
    grpcFrame(protoMessage(1, config)),
    grpcFrame(Buffer.from('grpc-status: 0\r\n'), 0x80),
  ]);

  const result = parseGrpcBillingResponse(response);

  assert.equal(result.usedPercent, 44);
  assert.equal(result.resetsAt, periodEnd);
});

test('gRPC-web 非零 trailer status 不当成成功响应', () => {
  const response = Buffer.concat([
    grpcFrame(Buffer.from([0x0d, 0, 0, 0, 0])),
    grpcFrame(Buffer.from('grpc-status: 16\r\n'), 0x80),
  ]);

  assert.throws(
    () => parseGrpcBillingResponse(response),
    (error) => error.code === 'EGRPC',
  );
});

test('gRPC 响应过短时抛出 EPROTO', () => {
  assert.throws(
    () => parseGrpcBillingResponse(Buffer.from([0x00, 0x00])),
    (error) => error.code === 'EPROTO',
  );
});

// ---- readGrokBilling HTTP 流程 ----

test('readGrokBilling 优先读取官方 JSON billing 的周期结束时间', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-json-billing-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': {
      key: 'json-bearer-token',
      user_id: 'user-123',
    },
  }));
  const resetAt = new Date(Date.now() + 86_400_000).toISOString();
  const calls = [];

  try {
    const report = await readGrokBilling({
      authPath,
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            config: {
              creditUsagePercent: 58,
              currentPeriod: {
                type: 'USAGE_PERIOD_TYPE_WEEKLY',
                start: new Date(Date.now() - 6 * 86_400_000).toISOString(),
                end: resetAt,
              },
            },
          }),
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://cli-chat-proxy.grok.com/v1/billing?format=credits');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers.Authorization, 'Bearer json-bearer-token');
    assert.equal(calls[0].headers['X-XAI-Token-Auth'], 'xai-grok-cli');
    assert.equal(calls[0].headers['x-userid'], 'user-123');
    assert.equal(report.windows.billing_cycle.usedPercent, 58);
    assert.equal(report.windows.billing_cycle.resetAt, Date.parse(resetAt));
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('readGrokBilling 兼容 JSON billingPeriodEnd 旧字段', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-json-legacy-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': { key: 'legacy-json-token', user_id: 'user-legacy' },
  }));
  const resetAt = new Date(Date.now() + 172_800_000).toISOString();

  try {
    const report = await readGrokBilling({
      authPath,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          config: { creditUsagePercent: 12.5, billingPeriodEnd: resetAt },
        }),
      }),
    });

    assert.equal(report.windows.billing_cycle.usedPercent, 12.5);
    assert.equal(report.windows.billing_cycle.resetAt, Date.parse(resetAt));
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('JSON billing 失败后回退 gRPC 并仍返回周期结束时间', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-json-fallback-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': { key: 'fallback-token', user_id: 'user-456' },
  }));
  const periodStart = Math.floor(Date.now() / 1000) - 6 * 86_400;
  const periodEnd = Math.floor(Date.now() / 1000) + 86_400;
  const overallUsage = Buffer.alloc(5);
  overallUsage[0] = (1 << 3) | 5;
  overallUsage.writeFloatLE(37, 1);
  const config = Buffer.concat([
    overallUsage,
    protoMessage(4, protoVarint(1, periodStart)),
    protoMessage(5, protoVarint(1, periodEnd)),
  ]);
  const responseBuffer = grpcFrame(protoMessage(1, config));
  const calls = [];

  try {
    const report = await readGrokBilling({
      authPath,
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.includes('cli-chat-proxy')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              config: {
                creditUsagePercent: 37,
                currentPeriod: { end: new Date(Date.now() - 86_400_000).toISOString() },
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => responseBuffer.buffer.slice(
            responseBuffer.byteOffset,
            responseBuffer.byteOffset + responseBuffer.byteLength,
          ),
        };
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(report.windows.billing_cycle.usedPercent, 37);
    assert.equal(report.windows.billing_cycle.resetAt, periodEnd * 1000);
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('readGrokBilling 发送正确的 gRPC-web 请求并返回额度报告', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-billing-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': { key: 'test-bearer-token' },
  }));

  // 构造 gRPC-web 响应
  const proto = Buffer.alloc(32);
  let offset = 0;
  proto[offset++] = (1 << 3) | 5;
  proto.writeFloatLE(65.0, offset);
  offset += 4;
  proto[offset++] = (2 << 3) | 0;
  const futureEpoch = Math.floor(Date.now() / 1000) + 86400;
  let value = futureEpoch;
  while (value > 0x7F) {
    proto[offset++] = (value & 0x7F) | 0x80;
    value >>>= 7;
  }
  proto[offset++] = value & 0x7F;
  const payload = proto.subarray(0, offset);
  const responseBuffer = Buffer.alloc(5 + payload.length);
  responseBuffer[0] = 0x00;
  responseBuffer.writeUInt32BE(payload.length, 1);
  payload.copy(responseBuffer, 5);

  const calls = [];
  try {
    const report = await readGrokBilling({
      authPath,
      fetchImpl: async (url, options) => {
        calls.push({ url, headers: options.headers, method: options.method });
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => responseBuffer.buffer.slice(
            responseBuffer.byteOffset,
            responseBuffer.byteOffset + responseBuffer.byteLength,
          ),
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Content-Type'], 'application/grpc-web+proto');
    assert.equal(calls[0].headers['x-grpc-web'], '1');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-bearer-token');

    assert.equal(report.source, 'grok');
    assert.equal(report.sourceLabel, 'Grok Build');
    assert.equal(report.completeSnapshot, true);
    assert.ok(Math.abs(report.windows.billing_cycle.usedPercent - 65.0) < 0.01);
    assert.equal(report.windows.billing_cycle.label, '计费周期');
    assert.equal(report.windows.billing_cycle.resetAt, futureEpoch * 1000);
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('Grok 鉴权失败返回 EAUTH 错误', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-auth-fail-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': { key: 'expired-token' },
  }));
  try {
    await assert.rejects(
      readGrokBilling({
        authPath,
        fetchImpl: async () => ({ ok: false, status: 401 }),
      }),
      (error) => error.code === 'EAUTH',
    );
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

test('过去的 resetsAt 被丢弃', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'maclawd-grok-past-reset-'));
  const authPath = join(authDir, 'auth.json');
  writeFileSync(authPath, JSON.stringify({
    'https://auth.x.ai::openid': { key: 'token' },
  }));

  const proto = Buffer.alloc(32);
  let offset = 0;
  proto[offset++] = (1 << 3) | 5;
  proto.writeFloatLE(10.0, offset);
  offset += 4;
  // 过去的时间戳
  proto[offset++] = (2 << 3) | 0;
  let value = 1_700_000_001;
  while (value > 0x7F) {
    proto[offset++] = (value & 0x7F) | 0x80;
    value >>>= 7;
  }
  proto[offset++] = value & 0x7F;
  const payload = proto.subarray(0, offset);
  const responseBuffer = Buffer.alloc(5 + payload.length);
  responseBuffer[0] = 0x00;
  responseBuffer.writeUInt32BE(payload.length, 1);
  payload.copy(responseBuffer, 5);

  try {
    const report = await readGrokBilling({
      authPath,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => responseBuffer.buffer.slice(
          responseBuffer.byteOffset,
          responseBuffer.byteOffset + responseBuffer.byteLength,
        ),
      }),
    });
    assert.equal(report.windows.billing_cycle.resetAt, null);
    assert.ok(Math.abs(report.windows.billing_cycle.usedPercent - 10.0) < 0.01);
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
});

// ---- recordQuota 集成 ----

test('Grok 额度报告写入后 readQuota 能正确读取 billing_cycle 窗口', () => {
  recordQuota({
    source: 'grok',
    sourceLabel: 'Grok Build',
    completeSnapshot: true,
    windows: {
      billing_cycle: {
        usedPercent: 55.5,
        resetAt: NOW + 3_600_000,
        label: '计费周期',
      },
    },
  }, { now: NOW });

  const snapshot = readQuota({ now: NOW });
  const grokSource = snapshot.sources.find((s) => s.id === 'grok');
  assert.ok(grokSource);
  assert.equal(grokSource.label, 'Grok Build');
  assert.equal(grokSource.windows.length, 1);
  assert.equal(grokSource.windows[0].id, 'billing_cycle');
  assert.equal(grokSource.windows[0].label, '计费周期');
  assert.equal(grokSource.windows[0].usedPercent, 55.5);
});

// ---- 采集器生命周期 ----

test('Grok 采集器合并刷新、缓存结果并在开关关闭后停止读取', async () => {
  let enabled = true;
  let reads = 0;
  const recorded = [];
  const report = {
    source: 'grok', sourceLabel: 'Grok Build', completeSnapshot: true,
    windows: { billing_cycle: { label: '计费周期', usedPercent: 20, resetAt: NOW + 3_600_000 } },
  };
  const collector = createGrokQuotaCollector({
    intervalMs: 600_000,
    enabled: () => enabled,
    read: async () => { reads++; return report; },
    record: (value) => recorded.push(value),
  });

  const [first, joined] = await Promise.all([
    collector.refresh({ force: true }),
    collector.refresh({ force: true }),
  ]);
  assert.equal(first.reports, 1);
  assert.equal(joined.reports, 1);
  assert.equal(reads, 1);
  assert.deepEqual(recorded, [report]);
  assert.equal((await collector.refresh()).cached, true);

  enabled = false;
  assert.equal((await collector.refresh({ force: true })).disabled, true);
  assert.equal(reads, 1);
});

test('关闭 Grok 采集器会丢弃仍在进行中的读取结果', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let isEnabled = true;
  const recorded = [];
  const collector = createGrokQuotaCollector({
    enabled: () => isEnabled,
    read: async () => {
      await gate;
      return {
        source: 'grok', sourceLabel: 'Grok Build', completeSnapshot: true,
        windows: { billing_cycle: { usedPercent: 30, resetAt: NOW + 3_600_000, label: '计费周期' } },
      };
    },
    record: (value) => recorded.push(value),
  });

  collector.start();
  isEnabled = false;
  collector.stop();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(recorded, []);
  assert.equal(collector.status().lastSuccessAt, 0);
});

test('Grok 采集器读取失败保留 lastError 且不阻塞后续刷新', async () => {
  let reads = 0;
  let shouldFail = true;
  const collector = createGrokQuotaCollector({
    intervalMs: 600_000,
    enabled: () => true,
    read: async () => {
      reads++;
      if (shouldFail) throw Object.assign(new Error('网络超时'), { code: 'ETIMEDOUT' });
      return {
        source: 'grok', sourceLabel: 'Grok Build', completeSnapshot: true,
        windows: { billing_cycle: { usedPercent: 10, resetAt: NOW + 3_600_000, label: '计费周期' } },
      };
    },
    record: () => {},
  });

  const failed = await collector.refresh({ force: true });
  assert.equal(failed.error.code, 'ETIMEDOUT');
  assert.equal(collector.status().lastError.code, 'ETIMEDOUT');

  shouldFail = false;
  const success = await collector.refresh({ force: true });
  assert.equal(success.reports, 1);
  assert.equal(collector.status().lastError, null);
  assert.equal(reads, 2);
});
