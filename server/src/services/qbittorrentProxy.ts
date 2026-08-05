// Node reimplementation of src/api/qbittorrent.ts's request logic -
// qBittorrent's WebUI authenticates via a session cookie from a
// username/password login (or an optional static Bearer API-key for
// reverse-proxy setups). RN's networking layer maintains that cookie jar
// implicitly, the same way a browser would; Node's built-in `fetch` has no
// implicit cookie jar at all, so this keeps one explicitly, in memory, keyed
// by `${userId}:${profileId}` (a profile id is only unique within one
// user's own list, not globally across users) - re-logging in and retrying
// exactly once on a 401/403, mirroring the client's own retry-once
// behavior precisely.
import { ProxyRequestBody, ServiceConfig } from '../types';

interface CookieEntry {
  cookie: string;
}

const cookieJar = new Map<string, CookieEntry>();

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// Extracts just the `SID=...` cookie pair (dropping Path/HttpOnly/etc.
// attributes) from a Set-Cookie response header - `getSetCookie()` returns
// every Set-Cookie header the response sent (there's normally only one
// here), each still carrying its trailing attributes after the first `;`.
function extractSidCookie(res: Response): string | undefined {
  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  for (const header of setCookieHeaders) {
    const pair = header.split(';')[0]?.trim();
    if (pair?.startsWith('SID=')) return pair;
  }
  return undefined;
}

async function login(cacheKey: string, config: ServiceConfig): Promise<void> {
  const base = trimBase(config.baseUrl);
  const body = new URLSearchParams();
  body.set('username', config.username ?? '');
  body.set('password', config.password ?? '');

  const res = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok || text.trim() !== 'Ok.') {
    throw new Error("qBittorrent login failed - check the username and password.");
  }
  const cookie = extractSidCookie(res);
  if (cookie) cookieJar.set(cacheKey, { cookie });
}

export async function qbittorrentProxyRequest<T>(
  cacheKey: string,
  config: ServiceConfig,
  req: ProxyRequestBody
): Promise<T> {
  const base = trimBase(config.baseUrl);
  const url = new URL(base + req.path);
  Object.entries(req.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));

  const apiKey = config.apiKey?.trim();

  const doFetch = () => {
    const headers: Record<string, string> = { Referer: base };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const stored = cookieJar.get(cacheKey);
    if (stored) headers.Cookie = stored.cookie;
    if (req.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(url.toString(), {
      method: req.method ?? 'GET',
      headers,
      body: req.form ? new URLSearchParams(req.form).toString() : undefined,
    });
  };

  let res = await doFetch();
  if ((res.status === 403 || res.status === 401) && !apiKey && (config.username || config.password)) {
    await login(cacheKey, config);
    res = await doFetch();
  }

  if (!res.ok) {
    throw new Error(`qBittorrent request failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
