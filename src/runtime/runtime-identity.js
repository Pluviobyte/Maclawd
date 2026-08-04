import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** App 与 Node runtime 之间的兼容性合同。修改不兼容的 API 时才递增。 */
export const RUNTIME_PROTOCOL_VERSION = 1;

const RUNTIME_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 打包时 package.sh 会把运行时内容指纹写到 runtime-build.json。
 * 源码开发没有该文件时回落到 package 版本；分发包不走回落。
 */
export function runtimeBuildId({ env = process.env, root = RUNTIME_ROOT } = {}) {
  const explicit = env?.MACLAWD_RUNTIME_BUILD_ID?.trim();
  if (explicit) return explicit;
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'runtime-build.json'), 'utf8'));
    if (typeof manifest?.buildId === 'string' && manifest.buildId.trim()) {
      return manifest.buildId.trim();
    }
  } catch {
    // 源码开发模式没有 manifest。
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return `dev-${pkg.version ?? 'unknown'}`;
  } catch {
    return 'dev-unknown';
  }
}

export function createRuntimeIdentity({ env = process.env, now = Date.now() } = {}) {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    buildId: runtimeBuildId({ env }),
    instanceId: randomBytes(16).toString('hex'),
    managementToken: randomBytes(32).toString('base64url'),
    startedAt: now,
  };
}

export function publicRuntimeIdentity(identity) {
  const {
    protocolVersion, buildId, instanceId, startedAt,
  } = identity;
  return { protocolVersion, buildId, instanceId, startedAt };
}

export function managementTokenMatches(identity, candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const expected = Buffer.from(identity.managementToken);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
