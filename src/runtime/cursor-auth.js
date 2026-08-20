const SESSION_COOKIE = 'WorkosCursorSessionToken';

export function cursorDashboardHeaders(accept = 'application/json') {
  return {
    Accept: accept,
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard?tab=usage',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };
}

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed.trim() : trimmed;
  } catch {
    return trimmed;
  }
}

/** Cursor access token 是 JWT；dashboard Cookie 需要其 sub 作为前缀。 */
export function decodeCursorJwtSub(value) {
  const token = normalizeToken(value);
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return typeof decoded.sub === 'string' && decoded.sub.trim() ? decoded.sub.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Cursor 的 dashboard 目前优先接受 `{sub}%3A%3A{jwt}` Cookie。
 * 保留 user id、裸 Cookie 和 Bearer 作兼容回退，便于服务端渐进迁移。
 */
export function cursorAuthAttempts(value) {
  const token = normalizeToken(value);
  if (!token) return [];
  const sub = decodeCursorJwtSub(token);
  const userId = sub?.includes('|') ? sub.split('|').at(-1) : null;
  const cookieValues = [
    sub ? `${sub}%3A%3A${token}` : null,
    userId && userId !== sub ? `${userId}%3A%3A${token}` : null,
    token,
  ].filter(Boolean);
  const uniqueCookies = [...new Set(cookieValues)];
  return [
    ...uniqueCookies.map((cookie) => ({ Cookie: `${SESSION_COOKIE}=${cookie}` })),
    { Authorization: `Bearer ${token}` },
  ];
}

/** 仅在 401/403 时切换认证形式；其他响应原样交给调用方分类。 */
export async function fetchCursorWithAuth(url, {
  token,
  fetchImpl = globalThis.fetch,
  headers = {},
  signal = null,
  method = 'GET',
} = {}) {
  const attempts = cursorAuthAttempts(token);
  if (attempts.length === 0) {
    const error = new Error('Cursor 数据库中未找到 access token');
    error.code = 'ENODATA';
    throw error;
  }

  const failures = [];
  for (const authHeaders of attempts) {
    const response = await fetchImpl(url, {
      method,
      headers: { ...headers, ...authHeaders },
      signal,
    });
    if (response?.ok) return response;
    if (response?.status !== 401 && response?.status !== 403) return response;
    failures.push(response.status);
  }

  const error = new Error(`Cursor 登录状态已失效（HTTP ${failures.join('/')}）`);
  error.code = 'EAUTH';
  throw error;
}
