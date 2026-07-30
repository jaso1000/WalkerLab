// Tautulli API client - Plex watch-history/stats, shown in-app as "Stats".
// Like SABnzbd, Tautulli's whole API is one endpoint (`/api/v2`) dispatched
// by a `cmd` query param, authenticated via an `apikey` query param (not a
// header, unlike the arr apps). Every response is wrapped in
// `{ response: { result, message, data } }` regardless of `cmd`.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

// One active/recent playback session, as returned inside `get_activity`'s
// `sessions` array.
export interface TautulliSession {
  session_key: string;
  session_id: string;
  user_id: number;
  user: string;
  friendly_name: string;
  user_thumb?: string;
  title: string;
  full_title: string;
  media_type: 'movie' | 'episode' | 'track' | 'photo' | 'clip' | string;
  grandparent_title?: string;
  parent_media_index?: string;
  media_index?: string;
  year?: string;
  thumb?: string;
  rating_key?: string;
  state: 'playing' | 'paused' | 'buffering' | string;
  progress_percent: string;
  // Overall per-session decision. `video_decision`/`audio_decision` are the
  // more precise per-stream versions - e.g. a session can be an overall
  // "transcode" because the video is being re-encoded while the audio is
  // just being copied through untouched.
  transcode_decision: 'direct play' | 'copy' | 'transcode' | string;
  video_decision?: 'direct play' | 'copy' | 'transcode' | string;
  audio_decision?: 'direct play' | 'copy' | 'transcode' | string;
  platform: string;
  platform_name?: string;
  player: string;
  product: string;
  device?: string;
  ip_address: string;
  bandwidth?: string;
  // Source (actual file) quality - what's on disk.
  video_resolution?: string;
  video_codec?: string;
  audio_codec?: string;
  audio_channels?: string;
  container?: string;
  // Stream (delivered-to-player) quality - identical to the source fields
  // above on direct play, different when actively transcoding/copying.
  stream_video_resolution?: string;
  stream_video_codec?: string;
  stream_audio_codec?: string;
  stream_container?: string;
}

// Top-level `get_activity` response - aggregate stream counts plus the
// individual sessions.
export interface TautulliActivity {
  sessions: TautulliSession[];
  stream_count: string;
  stream_count_direct_play: number;
  stream_count_direct_stream: number;
  stream_count_transcode: number;
  total_bandwidth: number;
  wan_bandwidth: number;
  lan_bandwidth: number;
}

// One row of `get_users_table` - a user's account info joined with their
// aggregate play stats and most-recently-watched item (this is the one
// endpoint that actually carries play-count/watch-time totals per user,
// unlike the plain `get_users`, which only returns account metadata).
export interface TautulliUserRow {
  user_id: number;
  username: string;
  friendly_name: string;
  user_thumb?: string;
  plays: number;
  duration: number;
  last_seen?: number;
  last_played?: string;
  media_type?: string;
  thumb?: string;
}

// One row of `get_history` - a single playback record.
export interface TautulliHistoryItem {
  row_id: number;
  date: number;
  started: number;
  stopped: number;
  user: string;
  user_id: number;
  friendly_name: string;
  full_title: string;
  title: string;
  media_type: string;
  thumb?: string;
  grandparent_title?: string;
  media_index?: number;
  parent_media_index?: number;
  year?: number;
  percent_complete: number;
  watched_status: number;
  duration: number;
}

// A paginated Tautulli table response shape - shared by `get_users_table`
// and `get_history`.
interface TautulliTableResponse<T> {
  recordsTotal: number;
  recordsFiltered: number;
  data: T[];
}

// One row within a `get_home_stats` stat group - field relevance varies by
// `stat_id` (e.g. `users_watched` only makes sense for the "popular_*"
// groups, `user`/`platform` only for `top_users`/`top_platforms`).
export interface TautulliStatRow {
  title?: string;
  rating_key?: number;
  thumb?: string;
  grandparent_thumb?: string;
  user_thumb?: string;
  total_plays?: number;
  total_duration?: number;
  users_watched?: number;
  user?: string;
  friendly_name?: string;
  platform?: string;
  last_play?: number;
  year?: number;
}

// One group within `get_home_stats`'s response array.
export interface TautulliStatGroup {
  stat_id: string;
  stat_type: 'plays' | 'duration' | string;
  rows: TautulliStatRow[];
}

// Shape shared by `get_plays_by_date`/`get_plays_by_dayofweek`/
// `get_plays_by_month` - one data point per category, one series per media
// type (Movies/TV/Music/Live TV).
export interface TautulliGraphData {
  categories: string[];
  series: { name: string; data: number[] }[];
}

// Issues one Tautulli API call and unwraps its `response.data`, throwing
// `response.message` (or a generic error) when `result` isn't 'success'.
async function tautulliFetch<T>(config: ServiceConfig, cmd: string, params: Record<string, string> = {}): Promise<T> {
  const fullParams = { cmd, out_type: 'json', ...params };
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('tautulli', config, { path: '/api/v2', params: fullParams });
  }

  const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/api/v2');
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(fullParams).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Tautulli ${cmd} failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const response = json?.response;
  if (!response || response.result !== 'success') {
    throw new Error(response?.message || `Tautulli ${cmd} failed`);
  }
  return response.data as T;
}

// Builds a poster/thumbnail URL via Tautulli's `pms_image_proxy` command,
// which proxies an image straight from Plex - mirrors `tmdbImageUrl`'s
// signature (returns `undefined` when there's nothing to point at). On
// native, the API key ends up inlined directly in the image URL; that's
// unavoidable there (a plain `<img>`-style GET, not a JSON call) and matches
// how Tautulli's own web UI constructs these URLs. On web, an `<img src>`
// can't reach the user's LAN-only Tautulli instance any more than a
// `fetch()` call could, so this points at this app's own backend image
// proxy instead (`GET /api/image-proxy/:profileId/tautulli`, see
// server/src/imageProxyRoutes.ts), which holds the real key server-side.
export function tautulliImageUrl(
  config: ServiceConfig,
  opts: { ratingKey?: string | number; img?: string; width?: number; height?: number }
): string | undefined {
  if (!opts.ratingKey && !opts.img) return undefined;

  if (Platform.OS === 'web') {
    const url = new URL(`/api/image-proxy/${config.profileId}/tautulli`, window.location.origin);
    if (opts.ratingKey !== undefined) url.searchParams.set('rating_key', String(opts.ratingKey));
    if (opts.img) url.searchParams.set('img', opts.img);
    url.searchParams.set('width', String(opts.width ?? 300));
    url.searchParams.set('height', String(opts.height ?? 450));
    url.searchParams.set('fallback', 'poster');
    return url.toString();
  }

  const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/api/v2');
  url.searchParams.set('apikey', config.apiKey);
  url.searchParams.set('cmd', 'pms_image_proxy');
  if (opts.ratingKey !== undefined) url.searchParams.set('rating_key', String(opts.ratingKey));
  if (opts.img) url.searchParams.set('img', opts.img);
  url.searchParams.set('width', String(opts.width ?? 300));
  url.searchParams.set('height', String(opts.height ?? 450));
  url.searchParams.set('fallback', 'poster');
  return url.toString();
}

export const tautulliApi = {
  // Settings' "Test Connection" check - cheap and always returns a valid
  // (possibly empty) result, so it just confirms the API key/URL work.
  testConnection: (config: ServiceConfig) => tautulliFetch<TautulliActivity>(config, 'get_activity'),

  getActivity: (config: ServiceConfig) => tautulliFetch<TautulliActivity>(config, 'get_activity'),

  // Ordered by play count descending, with a generous page size since home
  // Plex libraries typically have few users - no infinite scroll needed.
  getUsersTable: (config: ServiceConfig, length = 100) =>
    tautulliFetch<TautulliTableResponse<TautulliUserRow>>(config, 'get_users_table', {
      order_column: 'plays',
      order_dir: 'desc',
      start: '0',
      length: String(length),
    }),

  // Paginated playback history, optionally scoped to one user (the per-user
  // watch-history screen reuses this with `userId` set).
  getHistory: (config: ServiceConfig, opts: { start?: number; length?: number; userId?: number } = {}) =>
    tautulliFetch<TautulliTableResponse<TautulliHistoryItem>>(config, 'get_history', {
      start: String(opts.start ?? 0),
      length: String(opts.length ?? 25),
      order_column: 'date',
      order_dir: 'desc',
      ...(opts.userId !== undefined ? { user_id: String(opts.userId) } : {}),
    }),

  // Called with no `stat_id` filter to get Tautulli's full default set of
  // home-page stat groups in one call; callers pick out the specific
  // `stat_id`s they need (top_movies, popular_movies, popular_tv, top_users,
  // most_concurrent) from the returned array.
  getHomeStats: (config: ServiceConfig, timeRange = 30) =>
    tautulliFetch<TautulliStatGroup[]>(config, 'get_home_stats', {
      time_range: String(timeRange),
      stats_count: '5',
    }),

  getPlaysByDate: (config: ServiceConfig, days = 30) =>
    tautulliFetch<TautulliGraphData>(config, 'get_plays_by_date', { time_range: String(days) }),

  getPlaysByDayOfWeek: (config: ServiceConfig, days = 30) =>
    tautulliFetch<TautulliGraphData>(config, 'get_plays_by_dayofweek', { time_range: String(days) }),

  getPlaysByMonth: (config: ServiceConfig, months = 12) =>
    tautulliFetch<TautulliGraphData>(config, 'get_plays_by_month', { time_range: String(months) }),
};
