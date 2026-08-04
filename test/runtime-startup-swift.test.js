import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SOURCE = resolve('mac/Sources/Maclawd/RuntimeStartupCoordinator.swift');

function runSwiftHarness(body) {
  const dir = mkdtempSync(join(tmpdir(), 'maclawd-swift-runtime-test-'));
  const harness = join(dir, 'main.swift');
  const binary = join(dir, 'test-runtime-startup');
  try {
    writeFileSync(harness, body, 'utf8');
    execFileSync('/usr/bin/swiftc', [SOURCE, harness, '-o', binary], { stdio: 'pipe' });
    return execFileSync(binary, { encoding: 'utf8' }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Swift 启动协调：身份与版本完全匹配时复用运行时', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(
  port: 4173, pid: 42, protocolVersion: 1, buildId: "build-a",
  instanceId: "instance-a", managementToken: "secret"
)
let ping = RuntimePing(
  pid: 42, port: 4173, protocolVersion: 1, buildId: "build-a", instanceId: "instance-a"
)
let decision = RuntimeStartupCoordinator.decide(
  endpoint: endpoint, ping: ping, expectedProtocolVersion: 1, expectedBuildId: "build-a"
)
print(decision == .reuse(port: 4173) ? "reuse" : "wrong")
`);
  assert.equal(output, 'reuse');
});

test('Swift 启动协调：仅当可执行路径和 argv 都匹配时替换 legacy 运行时', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(port: 4173, pid: 42)
let ping = RuntimePing(pid: 42, port: 4173)
let process = RuntimeProcessIdentity(
  pid: 42,
  executablePath: "/Applications/Maclawd.app/Contents/Resources/node/arm64/bin/node",
  arguments: [
    "/Applications/Maclawd.app/Contents/Resources/node/arm64/bin/node",
    "/Applications/Maclawd.app/Contents/Resources/runtime/bin/maclawd-usage.js",
    "serve", "4173"
  ]
)
let decision = RuntimeStartupCoordinator.decide(
  endpoint: endpoint,
  ping: ping,
  expectedProtocolVersion: 1,
  expectedBuildId: "build-new",
  legacyProcess: process,
  expectedNodePath: "/Applications/Maclawd.app/Contents/Resources/node/arm64/bin/node",
  expectedScriptPath: "/Applications/Maclawd.app/Contents/Resources/runtime/bin/maclawd-usage.js"
)
print(decision == .replaceLegacy(port: 4173, pid: 42) ? "replace" : "wrong")
`);
  assert.equal(output, 'replace');
});

test('Swift 启动协调：已验证但版本不同的运行时走令牌替换', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(
  port: 4173, pid: 42, protocolVersion: 1, buildId: "old",
  instanceId: "instance-a", managementToken: "secret"
)
let ping = RuntimePing(
  pid: 42, port: 4173, protocolVersion: 1, buildId: "old", instanceId: "instance-a"
)
let decision = RuntimeStartupCoordinator.decide(
  endpoint: endpoint, ping: ping, expectedProtocolVersion: 1, expectedBuildId: "new"
)
print(decision == .replaceManaged(
  port: 4173, pid: 42, instanceId: "instance-a", managementToken: "secret"
) ? "replace" : "wrong")
`);
  assert.equal(output, 'replace');
});

test('Swift 启动协调：身份不完整或参数不匹配时绝不终止', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(port: 4173, pid: 42)
let ping = RuntimePing(pid: 42, port: 4173)
let process = RuntimeProcessIdentity(
  pid: 42,
  executablePath: "/usr/local/bin/node",
  arguments: ["/usr/local/bin/node", "/tmp/not-maclawd.js", "serve"]
)
let decision = RuntimeStartupCoordinator.decide(
  endpoint: endpoint,
  ping: ping,
  expectedProtocolVersion: 1,
  expectedBuildId: "new",
  legacyProcess: process,
  expectedNodePath: "/Applications/Maclawd.app/Contents/Resources/node/arm64/bin/node",
  expectedScriptPath: "/Applications/Maclawd.app/Contents/Resources/runtime/bin/maclawd-usage.js"
)
if case .untrusted = decision { print("refuse") } else { print("wrong") }
`);
  assert.equal(output, 'refuse');
});

test('Swift 启动协调：legacy argv 必须是受支持的精确形状', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(port: 4173, pid: 42)
let ping = RuntimePing(pid: 42, port: 4173)
let expectedNode = "/Applications/Maclawd.app/Contents/Resources/node/arm64/bin/node"
let expectedScript = "/Applications/Maclawd.app/Contents/Resources/runtime/bin/maclawd-usage.js"
let cases = [
  RuntimeProcessIdentity(
    pid: 42, executablePath: expectedNode,
    arguments: ["/tmp/not-node", expectedScript, "serve", "4173"]
  ),
  RuntimeProcessIdentity(
    pid: 42, executablePath: expectedNode,
    arguments: [expectedNode, expectedScript, "serve", "4999"]
  ),
  RuntimeProcessIdentity(
    pid: 42, executablePath: expectedNode,
    arguments: [expectedNode, expectedScript, "serve", "4173", "unexpected"]
  )
]
let allRefused = cases.allSatisfy { process in
  let decision = RuntimeStartupCoordinator.decide(
    endpoint: endpoint,
    ping: ping,
    expectedProtocolVersion: 1,
    expectedBuildId: "new",
    legacyProcess: process,
    expectedNodePath: expectedNode,
    expectedScriptPath: expectedScript
  )
  if case .untrusted = decision { return true }
  return false
}
print(allRefused ? "refuse" : "wrong")
`);
  assert.equal(output, 'refuse');
});

test('Swift 启动协调：端点进程仍存活但探针无响应时拒绝启动第二份', () => {
  const output = runSwiftHarness(`
import Foundation

let endpoint = RuntimeEndpoint(port: 4173, pid: 42)
let blocked = RuntimeStartupCoordinator.decide(
  endpoint: endpoint,
  ping: nil,
  expectedProtocolVersion: 1,
  expectedBuildId: "new",
  endpointProcessAlive: true
)
let gone = RuntimeStartupCoordinator.decide(
  endpoint: endpoint,
  ping: nil,
  expectedProtocolVersion: 1,
  expectedBuildId: "new",
  endpointProcessAlive: false
)
if case .untrusted = blocked, gone == .launch { print("safe") } else { print("wrong") }
`);
  assert.equal(output, 'safe');
});
