import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

/**
 * 端口发现与冲突回退。
 *
 * 这组测试守的是一个**实测过的崩溃**：serve() 的 listen 原本没有 error 处理，
 * 端口被占时抛出未捕获的 EADDRINUSE，整个运行时进程退出；而外壳把 stderr
 * 接到了 /dev/null，用户只看到「桌宠不动」，没有任何线索。
 * 4173 是 Vite preview 的默认端口——对我们这批用户来说撞车是常态。
 */

function withDataDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-endpoint-'));
  const before = process.env.MACLAWD_DATA_DIR;
  process.env.MACLAWD_DATA_DIR = dir;
  return (async () => {
    try {
      return await fn(dir);
    } finally {
      if (before === undefined) delete process.env.MACLAWD_DATA_DIR;
      else process.env.MACLAWD_DATA_DIR = before;
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

/** 占住一个端口，返回它。 */
function occupy() {
  return new Promise((resolve) => {
    const s = createServer(() => {});
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

test('端点文件写进去能读回来', () => withDataDir(async () => {
  const { writeEndpoint, readEndpoint, endpointPath } = await import(
    `../src/runtime/endpoint.js?case=roundtrip`);
  writeEndpoint({ port: 4321, pid: process.pid });
  const back = readEndpoint();
  assert.equal(back.port, 4321);
  // 必须是完整 JSON——hook 可能正好在读，写了一半会让它拿到默认端口。
  const raw = JSON.parse(readFileSync(endpointPath(), 'utf8'));
  assert.equal(raw.version, 1);
}));

test('端点文件损坏时退回默认端口，不抛异常', () => withDataDir(async (dir) => {
  const { discoverPort, endpointPath } = await import(`../src/runtime/endpoint.js?case=corrupt`);
  const before = process.env.MACLAWD_PORT;
  delete process.env.MACLAWD_PORT;
  try {
    writeFileSync(endpointPath(), '{ 这不是 JSON', 'utf8');
    assert.equal(discoverPort({ fallback: 4173 }), 4173, '损坏的端点文件应当被忽略');
  } finally {
    if (before !== undefined) process.env.MACLAWD_PORT = before;
    void dir;
  }
}));

test('进程已死的陈旧端点被忽略', () => withDataDir(async () => {
  const { writeEndpoint, readEndpoint } = await import(`../src/runtime/endpoint.js?case=stale`);
  // pid 1 一定活着，所以用一个几乎不可能存在的高位 pid
  writeEndpoint({ port: 4321, pid: 999_999, now: Date.now() - 10 * 60_000 });
  assert.equal(readEndpoint(), null, '陈旧且进程已死的端点应当作废');
}));

test('时间戳很旧但进程还活着的端点仍然有效', () => withDataDir(async () => {
  const { writeEndpoint, readEndpoint } = await import(`../src/runtime/endpoint.js?case=alive`);
  // 端点文件只在启动时写一次，跑了一整天的健康运行时不该被判成过期。
  writeEndpoint({ port: 4321, pid: process.pid, now: Date.now() - 24 * 3600_000 });
  assert.equal(readEndpoint()?.port, 4321);
}));

test('MACLAWD_PORT 优先于端点文件', () => withDataDir(async () => {
  const { writeEndpoint, discoverPort } = await import(`../src/runtime/endpoint.js?case=env`);
  writeEndpoint({ port: 4321 });
  assert.equal(discoverPort({ env: { MACLAWD_PORT: '5555' } }), 5555);
}));

test('首选端口被别人占用时顺次往后找，不再崩溃', () => withDataDir(async () => {
  const { serve } = await import(`../src/runtime/server.js?case=fallback`);
  const { readEndpoint } = await import(`../src/runtime/endpoint.js?case=fallback`);
  const blocker = await occupy();
  try {
    const started = await serve({ port: blocker.port });
    try {
      assert.notEqual(started.port, blocker.port, '应当换了一个端口');
      assert.ok(started.port > blocker.port, `应当往后找，实际 ${started.port}`);
      // 换了端口就必须让 hook 知道，否则事件会发到一个空地址上。
      assert.equal(readEndpoint()?.port, started.port, '端点文件没跟上实际端口');
    } finally {
      started.worker.stop?.();
      await new Promise((r) => started.server.close(r));
    }
  } finally {
    await new Promise((r) => blocker.server.close(r));
  }
}));

test('占位的是另一个 Maclawd 时拒绝启动第二份', () => withDataDir(async () => {
  const { serve } = await import(`../src/runtime/server.js?case=dup`);
  const first = await serve({ port: 0 });
  try {
    await assert.rejects(
      () => serve({ port: first.port }),
      (err) => {
        // 两个采集器同时跑会重复计数，这里必须是明确的拒绝而不是静默换端口。
        assert.equal(err.code, 'EALREADYRUNNING');
        assert.equal(err.port, first.port);
        return true;
      },
    );
  } finally {
    first.worker.stop?.();
    await new Promise((r) => first.server.close(r));
  }
}));
