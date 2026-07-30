// Shared web-only transport for every API client's low-level fetch helper
// (arrFetch.ts, qbittorrent.ts, portainer.ts) - on web, none of them call
// `fetch()` against the real service directly (the real baseUrl/apiKey
// never reach the browser, see storage.ts); instead they all POST here,
// which forwards to this app's own Node backend (server/), which holds the
// real per-profile config and makes the actual request server-side.
import { apiFetch } from '../lib/backendApi';
import { ServiceConfig, ServiceName } from './types';

export interface WebProxyRequest {
  path: string;
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
}

export async function webProxyFetch<T>(service: ServiceName, config: ServiceConfig, request: WebProxyRequest): Promise<T> {
  if (!config.profileId) {
    throw new Error(`Missing profileId on ${service}'s config for a web proxy request - this is a bug.`);
  }
  return apiFetch<T>(`/api/proxy/${config.profileId}/${service}`, { method: 'POST', body: request });
}
