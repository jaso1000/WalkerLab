// Node reimplementation of src/api/transmission.ts's request logic -
// Transmission's RPC requires a CSRF token (X-Transmission-Session-Id) the
// FIRST request always lacks, returned via a 409's own response header;
// every later request must resend it, and it can rotate/expire, producing
// another 409 down the line. Structurally identical to
// qbittorrentProxy.ts's cookieJar (same cacheKey shape, keyed by
// `${userId}:${profileId}` - a profile id is only unique within one user's
// own list, not globally across users), just keyed on this header instead
// of Set-Cookie. Basic auth (if configured) is independent of this CSRF
// dance entirely - sent on every request regardless of session-id state.
import { ProxyRequestBody, ServiceConfig } from '../types';

const sessionIdCache = new Map<string, string>();

export async function transmissionProxyRequest<T>(
  cacheKey: string,
  config: ServiceConfig,
  req: ProxyRequestBody
): Promise<T> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const url = `${base}/transmission/rpc`;

  const doFetch = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.username || config.password) {
      headers.Authorization = `Basic ${Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString('base64')}`;
    } else if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    const sid = sessionIdCache.get(cacheKey);
    if (sid) headers['X-Transmission-Session-Id'] = sid;
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(req.body) });
  };

  let res = await doFetch();
  if (res.status === 409) {
    const sid = res.headers.get('X-Transmission-Session-Id');
    if (sid) sessionIdCache.set(cacheKey, sid);
    res = await doFetch();
  }

  if (!res.ok) {
    throw new Error(`Transmission request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { result: string; arguments?: T };
  if (json.result !== 'success') {
    throw new Error(json.result || 'Transmission request failed');
  }
  return (json.arguments ?? {}) as T;
}
