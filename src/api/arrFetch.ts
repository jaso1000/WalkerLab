// Shared low-level HTTP helper for Sonarr/Radarr's near-identical v3 REST
// APIs - both auth the same way (X-Api-Key header) and both handle a 200
// response with an empty body the same way, so their API clients build on
// this instead of duplicating fetch/error-handling logic. Also the fallback
// path for Portainer's own API (see `portainerFetch` in portainer.ts) and
// Overseerr's, which happen to share this exact same request shape.
import { Platform } from 'react-native';
import { ServiceConfig, ServiceName } from './types';
import { webProxyFetch } from './webProxy';

export class ArrApiError extends Error {}

export interface ArrFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string>;
  body?: unknown;
}

// Issues one request against a Sonarr/Radarr instance and JSON-decodes the
// response. `path` is joined onto `config.baseUrl` (trailing slash on the
// base URL is tolerated). Throws `ArrApiError` on any non-2xx response.
//
// `serviceName` is only needed on web (see below) - every internal caller of
// this function (sonarr.ts/radarr.ts/overseerr.ts each wrap this in their
// own locally-shadowed `arrFetch` that bakes their own literal service name
// in, and portainer.ts passes it directly) always supplies it, so no
// *external* call site (any screen under app/) ever needs to know this
// parameter exists at all.
export async function arrFetch<T>(
  config: ServiceConfig,
  path: string,
  options: ArrFetchOptions = {},
  serviceName?: ServiceName
): Promise<T> {
  // On web, the real baseUrl/apiKey never reach the browser (see storage.ts)
  // - the backend holds them server-side, keyed by profile+service, and
  // makes the real request itself. `config.profileId` (stamped on by
  // storage.ts's web branch) tells the backend which profile's stored
  // config to use.
  if (Platform.OS === 'web') {
    if (!serviceName) throw new ArrApiError('arrFetch called on web without a serviceName - this is a bug.');
    return webProxyFetch<T>(serviceName, config, { path, method: options.method, params: options.params, body: options.body });
  }

  const url = new URL(config.baseUrl.replace(/\/+$/, '') + path);
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    throw new ArrApiError(`${path} failed: ${res.status} ${res.statusText}`);
  }

  // Sonarr/Radarr's DELETE endpoints return 200 with an empty body rather
  // than 204 - `JSON.parse('')` would throw, so an empty response short-
  // circuits to `undefined` instead of being treated as a parse failure.
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text);
}
