// Node reimplementation of src/api/arrFetch.ts's request logic - header
// (X-Api-Key) API-key auth, JSON in/out, tolerant of an empty response body.
// Used for sonarr/radarr/overseerr, and Portainer's non-pinned-certificate
// path (see portainerTls.ts for the pinned path).
import { ProxyRequestBody, ServiceConfig } from '../types';

export async function arrProxyRequest<T>(config: ServiceConfig, req: ProxyRequestBody): Promise<T> {
  const url = new URL(config.baseUrl.replace(/\/+$/, '') + req.path);
  if (req.params) {
    Object.entries(req.params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const res = await fetch(url.toString(), {
    method: req.method ?? 'GET',
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`${req.path} failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
