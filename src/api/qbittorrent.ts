// qBittorrent WebUI API client. Unlike the other services, qBittorrent's
// WebUI authenticates via a session cookie from a username/password login
// (not a plain API key), with an optional Bearer API-key path for reverse-
// proxy setups that front it with their own auth.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

export interface QbittorrentTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0..1
  dlspeed: number; // bytes/s
  upspeed: number; // bytes/s
  num_seeds: number;
  num_leechs: number;
  state: string;
  eta: number; // seconds; 8640000 means infinite/unknown
  ratio: number;
  category: string;
  added_on: number;
  completion_on: number;
  save_path: string;
}

// Passed straight through to qBittorrent's own `filter` query param on
// /api/v2/torrents/info - authoritative server-side filtering rather than
// reimplementing its state-grouping logic client-side.
export type QbittorrentFilter = 'all' | 'active' | 'downloading' | 'seeding' | 'completed' | 'paused' | 'errored';

const DOWNLOADING_STATES = new Set([
  'downloading',
  'metaDL',
  'stalledDL',
  'forcedDL',
  'allocating',
  'checkingDL',
  'queuedDL',
]);
const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'forcedUP', 'queuedUP', 'checkingUP']);
const PAUSED_STATES = new Set(['pausedDL', 'pausedUP']);

// Maps one of qBittorrent's many internal torrent `state` values down to the
// small set of labels this app actually distinguishes in the UI.
export function qbittorrentStateLabel(state: string): string {
  if (state === 'error' || state === 'missingFiles') return 'Error';
  if (PAUSED_STATES.has(state)) return 'Paused';
  if (SEEDING_STATES.has(state)) return 'Seeding';
  if (DOWNLOADING_STATES.has(state)) return 'Downloading';
  if (state === 'moving') return 'Moving';
  if (state === 'checkingResumeData') return 'Checking';
  return 'Unknown';
}

export function qbittorrentIsPaused(state: string): boolean {
  return PAUSED_STATES.has(state);
}

// Strips any trailing slash(es) from a configured base URL before joining
// an API path onto it, avoiding an accidental "//" in the final URL.
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// qBittorrent's WebUI checks the Referer/Origin header against its own host
// as CSRF protection - omitting it gets every request (including login)
// rejected with 403 on a stock install.
async function login(config: ServiceConfig): Promise<void> {
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
    throw new Error('qBittorrent login failed - check the username and password.');
  }
}

// Options for one qBittorrent WebUI request - `form` (not `body`) because
// the WebUI API expects form-urlencoded bodies, not JSON.
interface QbRequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string>;
  form?: Record<string, string>;
}

// Session cookie (SID) is handled by RN's networking layer the same way a
// browser handles it - no manual cookie jar needed. If nothing comes back
// authenticated, log in (when credentials are configured) and retry once.
async function qbRequest<T>(config: ServiceConfig, path: string, options: QbRequestOptions = {}): Promise<T> {
  if (Platform.OS === 'web') {
    // The backend keeps its own per-profile session-cookie jar server-side
    // (Node's fetch has no implicit one either) and does the exact same
    // 401/403-then-retry-once login dance - see
    // server/src/services/qbittorrentProxy.ts.
    return webProxyFetch<T>('qbittorrent', config, {
      path,
      method: options.method,
      params: options.params,
      form: options.form,
    });
  }

  const base = trimBase(config.baseUrl);
  const url = new URL(base + path);
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const apiKey = config.apiKey?.trim();
  const headers: Record<string, string> = { Referer: base };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (options.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const doFetch = () =>
    fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.form ? new URLSearchParams(options.form).toString() : undefined,
    });

  let res = await doFetch();
  if ((res.status === 403 || res.status === 401) && !apiKey && (config.username || config.password)) {
    await login(config);
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

export const qbittorrentApi = {
  // Settings' "Test Connection" check - the version endpoint requires a
  // valid session/API key, so a successful response confirms auth works.
  testConnection: (config: ServiceConfig) => qbRequest<string>(config, '/api/v2/app/version'),

  listTorrents: (config: ServiceConfig, filter: QbittorrentFilter = 'all') =>
    qbRequest<QbittorrentTorrent[]>(config, '/api/v2/torrents/info', { params: { filter } }),

  // Hashes are pipe-joined since qBittorrent's WebUI accepts a batch of
  // torrents per call rather than requiring one request per torrent.
  pauseTorrents: (config: ServiceConfig, hashes: string[]) =>
    qbRequest(config, '/api/v2/torrents/pause', { method: 'POST', form: { hashes: hashes.join('|') } }),

  resumeTorrents: (config: ServiceConfig, hashes: string[]) =>
    qbRequest(config, '/api/v2/torrents/resume', { method: 'POST', form: { hashes: hashes.join('|') } }),

  deleteTorrents: (config: ServiceConfig, hashes: string[], deleteFiles: boolean) =>
    qbRequest(config, '/api/v2/torrents/delete', {
      method: 'POST',
      form: { hashes: hashes.join('|'), deleteFiles: String(deleteFiles) },
    }),
};
