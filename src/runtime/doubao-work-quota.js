import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDoubaoWorkAuth } from './desktop-quota-auth.js';
import { finiteNumber, quotaError, quotaJson } from './quota-client.js';
import { createProviderQuotaCollector } from './provider-quota-collector.js';

const URL = 'https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/';
const TYPES = { 1: ['5 小时', 300], 2: ['7 天', 10080], 3: ['创作额度包', null], 4: ['月度', null] };

function milliseconds(value) {
  const time = finiteNumber(value);
  return time !== null && time > 0 ? time : null;
}

/** Independently verified against DoubaoWork 2.28.12's UI and a real read-only HTTP response. */
export function doubaoWorkQuotaReport(payload) {
  if (payload?.code !== undefined && finiteNumber(payload.code) !== 0) return null;
  const data = payload?.data;
  if (!data || typeof data !== 'object') return null;
  const windows = {};
  const hasPersonal = data.member_info?.hasActiveSubscription === true;
  const hasEnterprise = data.member_info?.hasEnterpriseSubscription === true;
  for (const [scope, section] of [
    ['personal', hasPersonal ? data.window_limit_section : null],
    ['enterprise', hasEnterprise ? data.enterprise_window_limit_section : null],
    ['package', data.quota_package_section],
  ]) {
    for (const group of Array.isArray(section?.window_limit_groups) ? section.window_limit_groups : []) {
      const limits = Array.isArray(group?.window_limits) ? group.window_limits : [];
      for (const item of limits) {
        const type = finiteNumber(item?.window_type);
        if (!TYPES[type]) continue;
        const percent = finiteNumber(item.used_percent);
        const unlimited = type === 1 && item.exemption?.active === true;
        if (!unlimited && (percent === null || percent < 0 || percent > 100)) continue;
        const identity = `${scope}:${group.feature_group ?? ''}:${type}:${item.item_type ?? 0}`;
        const key = `${scope}_${type}_${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
        // Without distinct identities it is unsafe to merge or arbitrarily select entitlements.
        if (windows[key]) return null;
        const [baseLabel, durationMinutes] = TYPES[type];
        const groupLabel = typeof group.feature_group_name === 'string' ? group.feature_group_name.trim().slice(0, 24) : '';
        const label = scope === 'enterprise' ? `企业 ${groupLabel || baseLabel}`
          : hasPersonal && hasEnterprise && scope === 'personal' ? `个人 ${baseLabel}` : baseLabel;
        windows[key] = {
          label, usedPercent: unlimited ? null : percent, unlimited,
          lessThanOnePercent: !unlimited && percent < 1 && item.less_than_one_percent === true,
          notStarted: !unlimited && type === 1 && percent === 0 && finiteNumber(item.start_time) === 0 && finiteNumber(item.end_time) === 0,
          resetAt: milliseconds(unlimited ? item.exemption.end_time : item.end_time),
          durationMinutes,
        };
      }
    }
  }
  if (!Object.keys(windows).length) return null;
  return {
    source: 'doubao-work', sourceLabel: '豆包工作', completeSnapshot: true,
    planType: hasEnterprise ? (hasPersonal ? 'personal+enterprise' : 'enterprise') : 'personal', windows,
  };
}

export async function readDoubaoWorkQuota({ auth = readDoubaoWorkAuth, ...options } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { session, csrf } = await auth(options);
    let payload;
    try {
      payload = await quotaJson(URL, {
        ...options, body: { product_line: 'membership' },
        headers: {
          Cookie: `sessionid=${session}`, Origin: 'https://www.doubao.com',
          Referer: 'https://www.doubao.com/member/quota-management',
          ...(csrf ? { 'x-secsdk-csrf-token': csrf } : {}),
        },
      });
    } catch (error) {
      if (error.code === 'EAUTH' && attempt === 0) continue;
      throw error;
    }
    if (payload?.code !== undefined && finiteNumber(payload.code) !== 0) {
      throw quotaError('EREMOTE', '豆包工作拒绝额度查询，请检查官方应用登录状态');
    }
    const report = doubaoWorkQuotaReport(payload);
    if (!report) throw quotaError('ENODATA', '豆包工作暂未返回可用额度');
    return report;
  }
}

export function createDoubaoWorkQuotaCollector(options = {}) {
  return createProviderQuotaCollector({ read: readDoubaoWorkQuota,
    installed: () => existsSync(process.env.MACLAWD_DOUBAO_WORK_DIR || join(homedir(), 'Library/Application Support/DoubaoWork')),
    ...options });
}
