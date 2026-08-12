// Sonarr v3 REST API client - TV library management (TV Shows screen),
// backing the Discover detail page's "Add to Sonarr" flow too. Mirrors
// `radarr.ts`'s shape closely (same underlying `*arr` API family), with the
// extra season/episode granularity TV needs that movies don't.
import { arrFetch as arrFetchBase, ArrFetchOptions } from './arrFetch';
import { ArrRelease, ServiceConfig } from './types';

// Shadows the shared `arrFetch` with this service's own literal name baked
// in (needed for the web build's proxy routing, see arrFetch.ts) - every
// call site below is completely unchanged, still just `arrFetch(...)`.
const arrFetch = <T>(config: ServiceConfig, path: string, options?: ArrFetchOptions) =>
  arrFetchBase<T>(config, path, options, 'sonarr');

export type SonarrRelease = ArrRelease;

// One artwork entry for a series (poster/fanart/etc, `coverType` tells which).
export interface SonarrImage {
  coverType: string;
  remoteUrl?: string;
  url?: string;
}

// Per-season file-completion counts, used for the season list's progress.
export interface SonarrSeasonStatistics {
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: SonarrSeasonStatistics;
}

// A TV series as tracked by Sonarr - the primary shape used across the
// TV Shows list, detail page, and season/episode drill-down.
export interface SonarrSeries {
  id: number;
  tvdbId?: number;
  imdbId?: string;
  title: string;
  overview?: string;
  year?: number;
  added?: string;
  status: string;
  monitored: boolean;
  images: SonarrImage[];
  genres?: string[];
  network?: string;
  nextAiring?: string;
  seriesType?: string;
  originalLanguage?: { name: string };
  ratings?: { value: number; votes?: number };
  seasons?: SonarrSeason[];
  qualityProfileId: number;
  rootFolderPath?: string;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

// One episode within a series. `series` is only populated on endpoints that
// explicitly join it in (e.g. calendar/history), not on plain episode fetches.
export interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  hasFile: boolean;
  episodeFileId: number;
  monitored: boolean;
  series?: { title: string; images: SonarrImage[] };
}

// Technical media details for a downloaded episode file, shown on the file-
// details card (`FileDetailsCard.tsx`).
export interface SonarrMediaInfo {
  audioBitrate?: number;
  audioChannels?: number;
  audioCodec?: string;
  audioLanguages?: string;
  audioStreamCount?: number;
  videoBitDepth?: number;
  videoBitrate?: number;
  videoCodec?: string;
  videoFps?: number;
  resolution?: string;
  runTime?: string;
  videoDynamicRangeType?: string;
}

// The actual on-disk file backing a downloaded episode.
export interface SonarrEpisodeFile {
  id: number;
  relativePath?: string;
  size: number;
  dateAdded?: string;
  quality: { quality: { name: string } };
  mediaInfo?: SonarrMediaInfo;
}

// One entry in Sonarr's activity/history log (grabbed, imported, deleted,
// renamed, etc). `episode` is only present for episode-scoped events.
export interface SonarrHistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle: string;
  quality?: { quality: { name: string } };
  series?: { title: string };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}


// A series/episode's in-progress download as tracked by Sonarr's own queue
// (distinct from SABnzbd's queue - this is Sonarr's view of "is this being
// fetched").
export interface SonarrQueueItem {
  id: number;
  seriesId: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
  timeleft?: string;
  size: number;
  sizeleft: number;
}

export interface SonarrRootFolder {
  id: number;
  path: string;
}

// One mounted filesystem Sonarr can see - distinct from SonarrRootFolder
// (which is about configured library folders, not raw disk capacity).
export interface SonarrDiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
}

// Creates or updates a "WalkerLab" Webhook connection under Sonarr's own
// Settings > Connect, so the user doesn't have to paste the webhook URL in
// by hand (Settings > Push Notifications' "Auto Setup" button). Upserts by
// name - re-running this (e.g. re-clicking the button) updates the existing
// connection in place rather than piling up duplicates. Field names/casing
// (`onDownload`, `fields: [{name: 'url', ...}]`, `method: 1` for POST) are
// verified directly against Sonarr's own source (WebhookSettings.cs,
// NotificationDefinition.cs, SchemaBuilder.cs's camelCase field-name
// derivation), not guessed - this is the same request Sonarr's own Connect
// UI sends. Only `onDownload` is enabled - notify on new episodes, not
// renames/deletes/health checks/etc.
async function upsertWalkerLabWebhook(config: ServiceConfig, webhookUrl: string): Promise<void> {
  const existing = await arrFetch<Array<{ id: number; name: string }>>(config, '/api/v3/notification');
  const match = existing.find((n) => n.name === 'WalkerLab');
  const body = {
    name: 'WalkerLab',
    implementation: 'Webhook',
    implementationName: 'Webhook',
    configContract: 'WebhookSettings',
    onGrab: false,
    onDownload: true,
    onUpgrade: false,
    onImportComplete: false,
    onRename: false,
    onSeriesAdd: false,
    onSeriesDelete: false,
    onEpisodeFileDelete: false,
    onEpisodeFileDeleteForUpgrade: false,
    onHealthIssue: false,
    includeHealthWarnings: false,
    onHealthRestored: false,
    onApplicationUpdate: false,
    onManualInteractionRequired: false,
    fields: [
      { name: 'url', value: webhookUrl },
      { name: 'method', value: 1 },
      { name: 'username', value: '' },
      { name: 'password', value: '' },
    ],
    tags: [] as number[],
  };
  if (match) {
    await arrFetch(config, `/api/v3/notification/${match.id}`, { method: 'PUT', body: { ...body, id: match.id } });
  } else {
    await arrFetch(config, '/api/v3/notification', { method: 'POST', body });
  }
}

export const sonarrApi = {
  // Settings' "Test Connection" check.
  testConnection: (config: ServiceConfig) => arrFetch(config, '/api/v3/system/status'),

  // Full series library, used by the TV Shows list and the library-index
  // badges on Discover.
  getSeries: (config: ServiceConfig) => arrFetch<SonarrSeries[]>(config, '/api/v3/series'),

  getSeriesById: (config: ServiceConfig, id: number) => arrFetch<SonarrSeries>(config, `/api/v3/series/${id}`),

  // Full-object PUT - callers pass the whole (possibly-modified) series
  // back, matching how Sonarr's own update endpoint expects a complete
  // resource rather than a partial patch.
  updateSeries: (config: ServiceConfig, series: SonarrSeries) =>
    arrFetch<SonarrSeries>(config, `/api/v3/series/${series.id}`, { method: 'PUT', body: series }),

  bulkUpdateSeriesMonitored: (config: ServiceConfig, seriesIds: number[], monitored: boolean) =>
    arrFetch<void>(config, '/api/v3/series/editor', { method: 'PUT', body: { seriesIds, monitored } }),

  getSystemStatus: (config: ServiceConfig) => arrFetch<{ version: string }>(config, '/api/v3/system/status'),

  // Triggers Sonarr's own background refresh-metadata job for every series.
  refreshAllSeries: (config: ServiceConfig) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'RefreshSeries' } }),

  // Triggers a search for every episode currently missing a file.
  searchAllMissing: (config: ServiceConfig) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'MissingEpisodeSearch' } }),

  // Removes a series from the library. `deleteFiles` controls whether the
  // downloaded episode files on disk are also deleted (the "Remove from
  // Library" 3-way prompt on the detail page maps to this flag).
  deleteSeries: (config: ServiceConfig, id: number, deleteFiles = false) =>
    arrFetch<void>(config, `/api/v3/series/${id}`, { params: { deleteFiles: String(deleteFiles) }, method: 'DELETE' }),

  // Sonarr's own title lookup (used by the Add Series fallback form when
  // TMDB isn't configured) - doesn't require TMDB to function.
  searchSeries: (config: ServiceConfig, term: string) =>
    arrFetch<SonarrSeries[]>(config, '/api/v3/series/lookup', { params: { term } }),

  // Adds a new series to Sonarr's library. `monitorOption` drives both the
  // episode-level monitor setting (all/future/missing/etc, see
  // `SONARR_MONITOR_OPTIONS`) and the series-level `monitored` flag, which
  // is only turned off when the option is explicitly 'none' - matching
  // Sonarr's own Add Series screen, which doesn't expose `monitored` as a
  // separate toggle either.
  addSeries: (
    config: ServiceConfig,
    series: {
      title: string;
      tvdbId: number;
      qualityProfileId: number;
      rootFolderPath: string;
      monitored?: boolean;
      searchOnAdd?: boolean;
      monitorOption?: string;
    }
  ) =>
    arrFetch<SonarrSeries>(config, '/api/v3/series', {
      method: 'POST',
      body: {
        ...series,
        monitored: series.monitored ?? series.monitorOption !== 'none',
        addOptions: {
          monitor: series.monitorOption ?? 'all',
          searchForMissingEpisodes: series.searchOnAdd ?? true,
        },
      },
    }),

  getEpisodes: (config: ServiceConfig, seriesId: number) =>
    arrFetch<SonarrEpisode[]>(config, '/api/v3/episode', { params: { seriesId: String(seriesId) } }),

  // Full-object PUT for one episode (e.g. toggling its monitored state).
  updateEpisode: (config: ServiceConfig, episode: SonarrEpisode) =>
    arrFetch<SonarrEpisode>(config, `/api/v3/episode/${episode.id}`, { method: 'PUT', body: episode }),

  // Bulk monitor/unmonitor toggle, used by the season/episode multi-select.
  updateEpisodesMonitored: (config: ServiceConfig, episodeIds: number[], monitored: boolean) =>
    arrFetch<void>(config, '/api/v3/episode/monitor', { method: 'PUT', body: { episodeIds, monitored } }),

  getEpisodeFile: (config: ServiceConfig, episodeFileId: number) =>
    arrFetch<SonarrEpisodeFile>(config, `/api/v3/episodefile/${episodeFileId}`),

  // Deletes just the on-disk file, keeping the episode itself monitored in
  // the library (distinct from `deleteSeries` with `deleteFiles: true`).
  deleteEpisodeFile: (config: ServiceConfig, episodeFileId: number) =>
    arrFetch<void>(config, `/api/v3/episodefile/${episodeFileId}`, { method: 'DELETE' }),

  // Same as `deleteEpisodeFile` but for a multi-selected batch of episodes
  // at once (season/episode screen's multi-select delete).
  deleteEpisodeFilesBulk: (config: ServiceConfig, episodeFileIds: number[]) =>
    arrFetch<void>(config, '/api/v3/episodefile/bulk', { method: 'DELETE', body: { episodeFileIds } }),

  // Triggers an automatic-grab search for one specific series.
  searchSeriesRelease: (config: ServiceConfig, seriesId: number) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'SeriesSearch', seriesId } }),

  // Triggers an automatic-grab search for every missing episode in one season.
  searchSeasonRelease: (config: ServiceConfig, seriesId: number, seasonNumber: number) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'SeasonSearch', seriesId, seasonNumber } }),

  // Triggers an automatic-grab search for a specific set of episodes
  // (multi-select "Search" action).
  searchEpisodeRelease: (config: ServiceConfig, episodeIds: number[]) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'EpisodeSearch', episodeIds } }),

  // Sonarr's own download queue (distinct from SABnzbd's queue - this
  // reflects Sonarr's tracking of in-flight grabs, joined with series titles).
  getQueue: (config: ServiceConfig) =>
    arrFetch<{ records: SonarrQueueItem[] }>(config, '/api/v3/queue', { params: { includeSeries: 'true' } }),

  getRootFolders: (config: ServiceConfig) => arrFetch<SonarrRootFolder[]>(config, '/api/v3/rootfolder'),

  // Raw disk capacity for the Server tab's "Free Space" stat - separate
  // endpoint from rootfolder, which doesn't carry totalSpace.
  getDiskSpace: (config: ServiceConfig) => arrFetch<SonarrDiskSpace[]>(config, '/api/v3/diskspace'),

  getQualityProfiles: (config: ServiceConfig) => arrFetch<SonarrQualityProfile[]>(config, '/api/v3/qualityprofile'),

  // Episodes airing within `start`..`end` - powers the Upcoming tab.
  getCalendar: (config: ServiceConfig, start: string, end: string) =>
    arrFetch<SonarrEpisode[]>(config, '/api/v3/calendar', { params: { start, end, includeSeries: 'true' } }),

  // Most recent activity events, newest first.
  getHistory: (config: ServiceConfig, pageSize = 50) =>
    arrFetch<{ records: SonarrHistoryRecord[] }>(config, '/api/v3/history', {
      params: { page: '1', pageSize: String(pageSize), sortKey: 'date', sortDirection: 'descending', includeSeries: 'true', includeEpisode: 'true' },
    }),

  // Interactive release search, scoped to a series, one season, or one
  // episode depending on which optional params are given - what the manual
  // "search for a specific release" flow hits at each drill-down level.
  getReleases: (config: ServiceConfig, params: { seriesId: number; seasonNumber?: number; episodeId?: number }) =>
    arrFetch<SonarrRelease[]>(config, '/api/v3/release', {
      params: {
        seriesId: String(params.seriesId),
        ...(params.seasonNumber !== undefined ? { seasonNumber: String(params.seasonNumber) } : {}),
        ...(params.episodeId !== undefined ? { episodeId: String(params.episodeId) } : {}),
      },
    }),

  // Manually grabs one specific release the user picked from `getReleases`.
  grabRelease: (config: ServiceConfig, release: { guid: string; indexerId: number }) =>
    arrFetch(config, '/api/v3/release', { method: 'POST', body: release }),

  setupWebhookNotification: (config: ServiceConfig, webhookUrl: string) => upsertWalkerLabWebhook(config, webhookUrl),
};
