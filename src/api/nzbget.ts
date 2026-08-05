// NZBGet client - an alternative Usenet download client to SABnzbd (see
// sabnzbd.ts), offered as the second possible backend for the Downloads
// screen (src/lib/downloadClient.ts normalizes both into one shape - see
// that file for why, and app/downloads.tsx for how the active one is
// picked). Unlike SABnzbd's single query-string `/api` endpoint, NZBGet
// speaks JSON-RPC 1.0 over one fixed path (`/jsonrpc`): every call POSTs
// `{method, params}` and gets back `{result}` on success or `{error}` on
// failure - confirmed against NZBGet's own API docs
// (https://nzbget.com/documentation/api/) before writing any of this, the
// same way sabnzbd.ts's own `mode=version` bug was found and fixed by
// checking docs rather than assuming.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

// One entry from `listgroups` - an active/queued download. `Status` is one
// of NZBGet's own enum strings (DOWNLOADING, PAUSED, QUEUED, FETCHING,
// PP_QUEUED, and several post-processing sub-states) - only PAUSED is
// actually branched on today (mirrors SABnzbd's own single 'Paused' check).
export interface NzbgetGroup {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  DownloadedSizeMB: number;
}

// One entry from `history` - a completed/failed download. `Status` is
// prefixed by outcome (SUCCESS/..., WARNING/..., FAILURE/..., DELETED/...)
// - only the FAILURE prefix is branched on today, matching SABnzbd's own
// binary Failed-vs-not tone. NZBGet has no dedicated failure-message field
// the way SABnzbd's `fail_message` is - `Status` itself is the closest
// equivalent (e.g. "FAILURE/PAR").
export interface NzbgetHistoryItem {
  NZBID: number;
  Name: string;
  Status: string;
  FileSizeMB: number;
  DestDir: string;
  FinalDir: string;
}

// Overall queue state from `status` - `DownloadRate` is bytes/sec (NZBGet
// deprecated this in favor of a 32-bit Lo/Hi pair in v24.2 for values past
// 2GB/s, which no home Usenet connection will ever hit, so the plain field
// is used as-is). There's no ETA field at all - src/lib/downloadClient.ts
// derives one from RemainingSizeMB / DownloadRate, same idea as SABnzbd's
// own pre-formatted `timeleft` string but computed client-side instead.
export interface NzbgetStatus {
  DownloadRate: number;
  DownloadPaused: boolean;
  RemainingSizeMB: number;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Minimal base64 encoder for the Basic-auth header on native - avoids
// depending on `btoa` (not guaranteed present on every Hermes build) or
// pulling in a `buffer` polyfill dependency for this one small use. Handles
// ASCII input, which covers any realistic username/password.
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

// Issues one JSON-RPC call and unwraps NZBGet's `{result}`/`{error}`
// envelope, throwing on the latter so callers can `catch` it like any other
// failed request. `apiKey`, when set, is sent as a Bearer token instead of
// Basic auth - mirrors qbittorrentProxy.ts's same optional-reverse-proxy-
// token pattern (Settings' API Key field already describes this generically
// for every credential-based service, not just qBittorrent).
async function nzbgetRequest<T>(config: ServiceConfig, method: string, params: unknown[] = []): Promise<T> {
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('nzbget', config, { path: '/jsonrpc', method: 'POST', body: { method, params } });
  }

  const url = config.baseUrl.replace(/\/+$/, '') + '/jsonrpc';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else {
    headers.Authorization = `Basic ${base64Encode(`${config.username ?? ''}:${config.password ?? ''}`)}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ method, params }) });
  if (!res.ok) {
    throw new Error(`NZBGet request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? 'NZBGet request failed');
  }
  return json.result as T;
}

export const nzbgetApi = {
  // Settings' "Test Connection" check - `status` requires valid credentials
  // (checked against ControlUsername/ControlPassword server-side), unlike
  // SABnzbd's `version` mode, so a wrong password genuinely fails here.
  testConnection: (config: ServiceConfig) => nzbgetRequest<NzbgetStatus>(config, 'status'),

  getStatus: (config: ServiceConfig) => nzbgetRequest<NzbgetStatus>(config, 'status'),

  // Active/queued downloads, in queue order (array index == queue
  // position) - polled the same way SABnzbd's queue is (see downloads.tsx).
  listGroups: (config: ServiceConfig) => nzbgetRequest<NzbgetGroup[]>(config, 'listgroups'),

  getHistory: (config: ServiceConfig) => nzbgetRequest<NzbgetHistoryItem[]>(config, 'history'),

  pauseQueue: (config: ServiceConfig) => nzbgetRequest<boolean>(config, 'pausedownload'),

  resumeQueue: (config: ServiceConfig) => nzbgetRequest<boolean>(config, 'resumedownload'),

  // `editqueue(Command, Param, IDs)` - the 3-param signature current since
  // v18.0 (an older 4-param `(Command, Offset, Param, IDs)` form exists for
  // pre-v18 installs, not supported here since v18 shipped in 2018).
  pauseItem: (config: ServiceConfig, nzbId: number) => nzbgetRequest<boolean>(config, 'editqueue', ['GroupPause', '', [nzbId]]),

  resumeItem: (config: ServiceConfig, nzbId: number) => nzbgetRequest<boolean>(config, 'editqueue', ['GroupResume', '', [nzbId]]),

  // `GroupFinalDelete` (not `GroupDelete`) so the removed item doesn't get
  // silently archived into History - matches SABnzbd's own delete (which
  // also doesn't leave a history trace) rather than NZBGet's default
  // "delete but keep a history record" behavior.
  deleteFromQueue: (config: ServiceConfig, nzbId: number) =>
    nzbgetRequest<boolean>(config, 'editqueue', ['GroupFinalDelete', '', [nzbId]]),

  // Moves one item up/down by exactly one queue position.
  reorderQueue: (config: ServiceConfig, nzbId: number, direction: 'up' | 'down') =>
    nzbgetRequest<boolean>(config, 'editqueue', ['GroupMoveOffset', direction === 'up' ? '-1' : '1', [nzbId]]),
};
