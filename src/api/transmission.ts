// Transmission RPC API client. Unlike qBittorrent's cookie-based session
// login, Transmission has no login endpoint at all - auth (if configured)
// is plain HTTP Basic on every request. Instead, every request needs a
// `X-Transmission-Session-Id` header purely as CSRF protection: the first
// request (or any request whose cached token has since expired/rotated)
// gets rejected with 409, carrying the fresh token in that same response
// header, and must be retried once with it attached.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

export interface TransmissionTorrent {
  id: number;
  name: string;
  status: number; // 0 stopped, 1 queued-verify, 2 verifying, 3 queued-download, 4 downloading, 5 queued-seed, 6 seeding
  percentDone: number; // 0..1
  rateDownload: number; // bytes/s
  rateUpload: number; // bytes/s
  sizeWhenDone: number; // bytes
  uploadRatio: number;
  eta: number; // seconds; -1 unknown, -2 infinite (seed-ratio capped)
  error: number; // 0 = no error
  errorString: string;
}

// Transmission's torrent-get has no implicit "all fields" response - every
// field wanted back has to be listed explicitly.
const TORRENT_FIELDS = [
  'id',
  'name',
  'status',
  'percentDone',
  'rateDownload',
  'rateUpload',
  'sizeWhenDone',
  'uploadRatio',
  'eta',
  'error',
  'errorString',
];

// Maps one of Transmission's numeric torrent `status` codes to the same
// small label vocabulary qbittorrentStateLabel() uses, so both backends'
// badges read identically.
export function transmissionStateLabel(status: number, hasError: boolean): string {
  if (hasError) return 'Error';
  switch (status) {
    case 0:
      return 'Paused';
    case 1:
    case 3:
    case 5:
      return 'Queued';
    case 2:
      return 'Checking';
    case 4:
      return 'Downloading';
    case 6:
      return 'Seeding';
    default:
      return 'Unknown';
  }
}

export function transmissionIsPaused(status: number): boolean {
  return status === 0;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Minimal base64 encoder for the Basic-auth header - avoids pulling in a
// Buffer polyfill on native, same reasoning as nzbget.ts's own copy (not
// shared with it - that one isn't shared with anything else either).
function base64Encode(input: string): string {
  let output = '';
  let i = 0;
  while (i < input.length) {
    const a = input.charCodeAt(i++);
    const b = i < input.length ? input.charCodeAt(i++) : NaN;
    const c = i < input.length ? input.charCodeAt(i++) : NaN;
    const chunk = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += BASE64_CHARS[(chunk >> 18) & 63];
    output += BASE64_CHARS[(chunk >> 12) & 63];
    output += Number.isNaN(b) ? '=' : BASE64_CHARS[(chunk >> 6) & 63];
    output += Number.isNaN(c) ? '=' : BASE64_CHARS[chunk & 63];
  }
  return output;
}

// CSRF token cache, keyed by base URL - a bare module-level variable isn't
// safe since the user can switch profiles/servers within one app session.
// Structurally identical to qbittorrentProxy.ts's server-side cookieJar,
// just living here (client-side) since native has no separate proxy layer
// to hold it.
const sessionIdCache = new Map<string, string>();

interface TransmissionRequestOptions {
  method: string;
  arguments?: Record<string, unknown>;
}

async function transmissionRequest<T>(config: ServiceConfig, options: TransmissionRequestOptions): Promise<T> {
  if (Platform.OS === 'web') {
    // The backend keeps its own per-profile session-id cache server-side -
    // see server/src/services/transmissionProxy.ts.
    return webProxyFetch<T>('transmission', config, {
      path: '/transmission/rpc',
      method: 'POST',
      body: { method: options.method, arguments: options.arguments ?? {} },
    });
  }

  const base = trimBase(config.baseUrl);
  const url = `${base}/transmission/rpc`;
  const username = config.username?.trim();
  const password = config.password;
  const apiKey = config.apiKey?.trim();

  const doFetch = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Basic auth (if configured) and the session-id CSRF header are
    // independent - unlike qBittorrent's mutually-exclusive cookie-login
    // vs Bearer-key paths, both can be sent on the same request here.
    if (username || password) headers.Authorization = `Basic ${base64Encode(`${username ?? ''}:${password ?? ''}`)}`;
    else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const sid = sessionIdCache.get(base);
    if (sid) headers['X-Transmission-Session-Id'] = sid;
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: options.method, arguments: options.arguments ?? {} }),
    });
  };

  let res = await doFetch();
  if (res.status === 409) {
    const sid = res.headers.get('X-Transmission-Session-Id');
    if (sid) sessionIdCache.set(base, sid);
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

export const transmissionApi = {
  // Settings' "Test Connection" check - session-get requires the CSRF
  // token dance (and Basic auth, if configured) to succeed, so a
  // successful response confirms both.
  testConnection: (config: ServiceConfig) => transmissionRequest(config, { method: 'session-get' }),

  listTorrents: async (config: ServiceConfig): Promise<TransmissionTorrent[]> => {
    const data = await transmissionRequest<{ torrents: TransmissionTorrent[] }>(config, {
      method: 'torrent-get',
      arguments: { fields: TORRENT_FIELDS },
    });
    return data.torrents;
  },

  startTorrents: (config: ServiceConfig, ids: number[]) =>
    transmissionRequest(config, { method: 'torrent-start', arguments: { ids } }),

  stopTorrents: (config: ServiceConfig, ids: number[]) =>
    transmissionRequest(config, { method: 'torrent-stop', arguments: { ids } }),

  removeTorrents: (config: ServiceConfig, ids: number[], deleteLocalData: boolean) =>
    transmissionRequest(config, {
      method: 'torrent-remove',
      arguments: { ids, 'delete-local-data': deleteLocalData },
    }),
};
