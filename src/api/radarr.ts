// Radarr v3 REST API client - movie library management (Movies screen),
// backing the Discover detail page's "Add to Radarr" flow too. Mirrors
// `sonarr.ts`'s shape closely since the two `*arr` apps' APIs are near-
// identical, just movie- vs series-shaped.
import { arrFetch as arrFetchBase, ArrFetchOptions } from './arrFetch';
import { ArrRelease, ServiceConfig } from './types';

// Shadows the shared `arrFetch` with this service's own literal name baked
// in (needed for the web build's proxy routing, see arrFetch.ts) - every
// call site below is completely unchanged, still just `arrFetch(...)`.
const arrFetch = <T>(config: ServiceConfig, path: string, options?: ArrFetchOptions) =>
  arrFetchBase<T>(config, path, options, 'radarr');

export type RadarrRelease = ArrRelease;

// One artwork entry for a movie (poster/fanart/etc, `coverType` tells which).
export interface RadarrImage {
  coverType: string;
  remoteUrl?: string;
  url?: string;
}

export interface RadarrRating {
  value: number;
  votes?: number;
}

// A movie as tracked by Radarr - the primary shape used across the Movies
// list, detail page, and file-details card.
export interface RadarrMovie {
  id: number;
  title: string;
  overview?: string;
  year?: number;
  status: string;
  monitored: boolean;
  images: RadarrImage[];
  hasFile: boolean;
  tmdbId: number;
  imdbId?: string;
  movieFileId?: number;
  added?: string;
  sizeOnDisk?: number;
  runtime?: number;
  certification?: string;
  genres?: string[];
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  ratings?: { imdb?: RadarrRating; tmdb?: RadarrRating; rottenTomatoes?: RadarrRating };
  popularity?: number;
  qualityProfileId: number;
  rootFolderPath?: string;
  minimumAvailability?: string;
  studio?: string;
  originalLanguage?: { name: string };
  tags?: number[];
}

// One entry in Radarr's activity/history log (grabbed, imported, deleted,
// renamed, etc - see `historyEventLabel` in `format.ts` for display labels).
// `movie` is only populated because `getHistory` passes `includeMovie=true`
// - `images` powers the History tab's poster thumbnail.
export interface RadarrHistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle: string;
  quality?: { quality: { name: string } };
  movie?: { title: string; images: RadarrImage[] };
  data?: { downloadClient?: string };
}

// Technical media details for a downloaded movie file, shown on the file-
// details card (`FileDetailsCard.tsx`).
export interface RadarrMediaInfo {
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

// The actual on-disk file backing a downloaded movie (movie has `hasFile`
// true and `movieFileId` pointing here).
export interface RadarrMovieFile {
  id: number;
  relativePath: string;
  size: number;
  dateAdded: string;
  quality: { quality: { name: string } };
  mediaInfo?: RadarrMediaInfo;
}

// A movie's in-progress download as tracked by Radarr's own queue (distinct
// from SABnzbd's queue - this is Radarr's view of "is this being fetched").
export interface RadarrQueueItem {
  id: number;
  movieId: number;
  title: string;
  status: string;
  // Only present because `getQueue` passes `includeMovie=true` - powers the
  // Activity tab's poster art, matching the Upcoming/History tabs' cards.
  movie?: RadarrMovie;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
  timeleft?: string;
  size: number;
  sizeleft: number;
  // The download client's own id for this item (e.g. an nzo/torrent hash) -
  // needed to look up manual-import candidates for a stuck/blocked item
  // (`getManualImportItems`). See sonarr.ts's identical field for the story.
  downloadId?: string;
}

// One quality tier from Radarr's own quality-definition list (Settings >
// Profiles > Quality), e.g. "Bluray-1080p" - distinct from a
// `RadarrQualityProfile`, which is an ordered/cutoff *set* of these. Used by
// the manual-import screen's quality picker.
export interface RadarrQualityDefinition {
  id: number;
  quality: { id: number; name: string };
  title: string;
}

// One file candidate for a stuck/blocked queue item, as suggested by
// Radarr's own manual-import matcher (`getManualImportItems`) - `movie`/
// `quality`/`languages` are Radarr's best guess, editable before submitting
// via `importManually`. `rejections` explains why automatic import didn't
// happen (e.g. "matched to movie by ID").
export interface RadarrManualImportItem {
  id: number;
  path: string;
  relativePath?: string;
  folderName?: string;
  name?: string;
  size: number;
  movie?: RadarrMovie;
  movieFileId?: number;
  releaseGroup?: string;
  quality?: { quality: { id: number; name: string }; revision?: { version: number; real: number } };
  languages?: { id: number; name: string }[];
  downloadId?: string;
  rejections?: { reason: string; type: string }[];
}

export interface RadarrRootFolder {
  id: number;
  path: string;
}

// One mounted filesystem Radarr can see - distinct from RadarrRootFolder
// (which is about configured library folders, not raw disk capacity).
export interface RadarrDiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
}

// See sonarr.ts's identical upsertWalkerLabWebhook for the full design
// rationale - Radarr is the same Servarr-family Notification API with
// movie-specific onX flags in place of Sonarr's series/episode ones
// (confirmed against Radarr's own NotificationDefinition.cs).
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
    onRename: false,
    onMovieAdded: false,
    onMovieDelete: false,
    onMovieFileDelete: false,
    onMovieFileDeleteForUpgrade: false,
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

export const radarrApi = {
  // Settings' "Test Connection" check.
  testConnection: (config: ServiceConfig) => arrFetch(config, '/api/v3/system/status'),

  // Full movie library, used by the Movies list and the library-index
  // badges on Discover.
  getMovies: (config: ServiceConfig) => arrFetch<RadarrMovie[]>(config, '/api/v3/movie'),

  getMovie: (config: ServiceConfig, id: number) => arrFetch<RadarrMovie>(config, `/api/v3/movie/${id}`),

  // Full-object PUT - callers pass the whole (possibly-modified) movie back,
  // matching how Radarr's own update endpoint expects a complete resource
  // rather than a partial patch.
  updateMovie: (config: ServiceConfig, movie: RadarrMovie) =>
    arrFetch<RadarrMovie>(config, `/api/v3/movie/${movie.id}`, { method: 'PUT', body: movie }),

  bulkUpdateMoviesMonitored: (config: ServiceConfig, movieIds: number[], monitored: boolean) =>
    arrFetch<void>(config, '/api/v3/movie/editor', { method: 'PUT', body: { movieIds, monitored } }),

  getSystemStatus: (config: ServiceConfig) => arrFetch<{ version: string }>(config, '/api/v3/system/status'),

  // Triggers Radarr's own background refresh-metadata job for every movie.
  refreshAllMovies: (config: ServiceConfig) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'RefreshMovie' } }),

  // Triggers a search for every movie currently missing a file.
  searchAllMissing: (config: ServiceConfig) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'MissingMoviesSearch' } }),

  // Radarr's own title lookup (used by the Add Movie fallback form when TMDB
  // isn't configured) - doesn't require TMDB to function.
  searchMovies: (config: ServiceConfig, term: string) =>
    arrFetch<RadarrMovie[]>(config, '/api/v3/movie/lookup', { params: { term } }),

  // Adds a new movie to Radarr's library. `monitored`/`minimumAvailability`
  // default to sensible values (monitored on, "released") when the caller
  // doesn't specify them, matching Radarr's own Add Movie screen defaults.
  addMovie: (
    config: ServiceConfig,
    movie: {
      title: string;
      tmdbId: number;
      qualityProfileId: number;
      rootFolderPath: string;
      minimumAvailability?: string;
      monitored?: boolean;
      searchOnAdd?: boolean;
    }
  ) =>
    arrFetch<RadarrMovie>(config, '/api/v3/movie', {
      method: 'POST',
      body: {
        ...movie,
        monitored: movie.monitored ?? true,
        minimumAvailability: movie.minimumAvailability ?? 'released',
        addOptions: { searchForMovie: movie.searchOnAdd ?? true },
      },
    }),

  // Removes a movie from the library. `deleteFiles` controls whether the
  // downloaded file on disk is also deleted (the "Remove from Library"
  // 3-way prompt on the detail page maps to this flag).
  deleteMovie: (config: ServiceConfig, id: number, deleteFiles = false) =>
    arrFetch<void>(config, `/api/v3/movie/${id}`, { params: { deleteFiles: String(deleteFiles) }, method: 'DELETE' }),

  getMovieFile: (config: ServiceConfig, movieFileId: number) =>
    arrFetch<RadarrMovieFile>(config, `/api/v3/moviefile/${movieFileId}`),

  // Deletes just the on-disk file, keeping the movie itself monitored in
  // the library (distinct from `deleteMovie` with `deleteFiles: true`).
  deleteMovieFile: (config: ServiceConfig, movieFileId: number) =>
    arrFetch<void>(config, `/api/v3/moviefile/${movieFileId}`, { method: 'DELETE' }),

  // Triggers an automatic-grab search for one specific movie.
  searchMovieRelease: (config: ServiceConfig, movieId: number) =>
    arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'MoviesSearch', movieIds: [movieId] } }),

  // Radarr's own download queue (distinct from SABnzbd's queue - this
  // reflects Radarr's tracking of in-flight grabs, joined with movie titles).
  // `pageSize` is set well above any realistic queue size - see sonarr.ts's
  // identical `getQueue` comment for why.
  getQueue: (config: ServiceConfig) =>
    arrFetch<{ records: RadarrQueueItem[] }>(config, '/api/v3/queue', {
      params: { includeMovie: 'true', pageSize: '250' },
    }),

  // Removes one item from Radarr's queue - see sonarr.ts's identical
  // `removeQueueItem` for the full parameter rationale.
  removeQueueItem: (
    config: ServiceConfig,
    id: number,
    opts: { removeFromClient?: boolean; blocklist?: boolean; skipRedownload?: boolean } = {}
  ) =>
    arrFetch<void>(config, `/api/v3/queue/${id}`, {
      method: 'DELETE',
      params: {
        removeFromClient: String(opts.removeFromClient ?? true),
        blocklist: String(opts.blocklist ?? false),
        skipRedownload: String(opts.skipRedownload ?? false),
      },
    }),

  // Candidate file(s) for a queue item Radarr couldn't auto-import - see
  // sonarr.ts's identical `getManualImportItems` for the full rationale.
  getManualImportItems: (config: ServiceConfig, downloadId: string) =>
    arrFetch<RadarrManualImportItem[]>(config, '/api/v3/manualimport', {
      params: { downloadId, filterExistingFiles: 'true' },
    }),

  // The full list of quality tiers Radarr knows about - powers the manual-
  // import screen's quality picker, distinct from `getQualityProfiles`.
  getQualityDefinitions: (config: ServiceConfig) =>
    arrFetch<RadarrQualityDefinition[]>(config, '/api/v3/qualitydefinition'),

  // Confirms a manual import - see sonarr.ts's identical `importManually`
  // for the full rationale (movieId in place of seriesId/episodeIds, no
  // season concept).
  importManually: (
    config: ServiceConfig,
    files: Array<{
      path: string;
      folderName?: string;
      movieId: number;
      quality?: RadarrManualImportItem['quality'];
      languages?: RadarrManualImportItem['languages'];
      releaseGroup?: string;
      downloadId?: string;
    }>
  ) => arrFetch(config, '/api/v3/command', { method: 'POST', body: { name: 'ManualImport', files } }),

  getRootFolders: (config: ServiceConfig) => arrFetch<RadarrRootFolder[]>(config, '/api/v3/rootfolder'),

  // Raw disk capacity for the Server tab's "Free Space" stat - separate
  // endpoint from rootfolder, which doesn't carry totalSpace.
  getDiskSpace: (config: ServiceConfig) => arrFetch<RadarrDiskSpace[]>(config, '/api/v3/diskspace'),

  getQualityProfiles: (config: ServiceConfig) => arrFetch<RadarrQualityProfile[]>(config, '/api/v3/qualityprofile'),

  // Movies releasing within `start`..`end` - powers the Theatrical/Digital/
  // Physical release triptych and Upcoming tab.
  getCalendar: (config: ServiceConfig, start: string, end: string) =>
    arrFetch<RadarrMovie[]>(config, '/api/v3/calendar', { params: { start, end } }),

  // Most recent activity events, newest first.
  getHistory: (config: ServiceConfig, pageSize = 50) =>
    arrFetch<{ records: RadarrHistoryRecord[] }>(config, '/api/v3/history', {
      params: { page: '1', pageSize: String(pageSize), sortKey: 'date', sortDirection: 'descending', includeMovie: 'true' },
    }),

  // Interactive release search for one movie - what the manual "search for
  // a specific release" flow on the detail page hits.
  getReleases: (config: ServiceConfig, movieId: number) =>
    arrFetch<RadarrRelease[]>(config, '/api/v3/release', { params: { movieId: String(movieId) } }),

  // Manually grabs one specific release the user picked from `getReleases`.
  grabRelease: (config: ServiceConfig, release: { guid: string; indexerId: number }) =>
    arrFetch(config, '/api/v3/release', { method: 'POST', body: release }),

  setupWebhookNotification: (config: ServiceConfig, webhookUrl: string) => upsertWalkerLabWebhook(config, webhookUrl),
};
