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
  return apiFetch<T>(`/api/proxy/${config.profileId}/${service}`, {
    method: 'POST',
    body: {
      ...request,
      // Forwards whatever connection fields this call was actually given so
      // the server can merge them over the profile's stored config (see
      // server/src/services/mergeServiceConfig.ts) instead of always using
      // whichever config was last saved. For almost every call site `config`
      // already exactly mirrors the stored value (secrets are always blank
      // client-side on web, see storage.ts), so this merge is a no-op there
      // - the one place it isn't is Settings' "Test Connection," which
      // builds `config` straight from the currently-typed, not-yet-saved
      // fields, so this is what lets that actually test them instead of
      // silently testing whatever was last saved (the previous behavior:
      // this whole `config` object was received and then discarded here).
      configOverride: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        username: config.username,
        password: config.password,
        trustedCertFingerprint: config.trustedCertFingerprint,
      },
    },
  });
}
