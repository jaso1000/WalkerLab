// Lidarr v1 REST API client - music library management (Music screen).
// Mirrors `sonarr.ts`'s shape closely (same underlying `*arr` API family),
// with artist/album/track standing in for series/season/episode. Endpoint
// paths, field names, and enum values below are verified directly against
// Lidarr's own openapi.json spec (Lidarr/Lidarr repo, develop branch), not
// assumed from Sonarr's shape - see a few genuine differences noted inline.
import { Platform } from 'react-native';
import { arrFetch as arrFetchBase, ArrFetchOptions } from './arrFetch';
import { ArrRelease, ServiceConfig } from './types';

// Shadows the shared `arrFetch` with this service's own literal name baked
// in (needed for the web build's proxy routing, see arrFetch.ts) - every
// call site below is completely unchanged, still just `arrFetch(...)`.
const arrFetch = <T>(config: ServiceConfig, path: string, options?: ArrFetchOptions) =>
  arrFetchBase<T>(config, path, options, 'lidarr');

export type LidarrRelease = ArrRelease;

// One artwork entry for an artist/album (poster/fanart/etc, `coverType`
// tells which) - same shape as Sonarr's image entries, plus `extension`
// (Lidarr's real API response includes it, e.g. `.jpg`) which
// `lidarrImageUrl` below needs to build a request against the reliable
// route rather than reusing the (unreliable) `url` field's own path.
export interface LidarrImage {
  coverType: string;
  extension?: string;
  remoteUrl?: string;
  url?: string;
}

// Resolves one image entry to an actually-loadable URL. Everything below
// was verified live against a real instance - two earlier passes at this
// each turned out wrong, don't re-guess it again:
//
// - Unlike Sonarr/Radarr (whose `remoteUrl` reliably points at TheTVDB/
//   TMDB's own CDN), Lidarr's `remoteUrl` isn't always a genuine absolute
//   URL - an artist's was `/config/MediaCover/1/poster.jpg`, another
//   local-relative path, while an album's (Cover Art Archive-sourced) WAS
//   a real external URL. Only trusted here when genuinely `http(s)://`.
// - The legacy local path in `url` (`/MediaCover/{id}/{file}`, what an
//   earlier pass built requests against) intermittently requires
//   authentication a bare request can't satisfy - confirmed live: some
//   coverType/size combinations 302-redirected to Lidarr's own login page
//   even with a valid API key attached as a query param or `X-Api-Key`
//   header, while others (already cached, apparently from the user's own
//   authenticated browser session) happened to succeed - almost certainly
//   an access gate (e.g. Cloudflare Access) in front of the whole app,
//   with an exception for `/api/v1/*` specifically. The officially-
//   documented `/api/v1/mediacover/{artist|album}/{id}/{coverType}-{size}
//   {extension}` route, with `?apikey=` attached, DOES reliably work
//   (confirmed live for both artist and album entities, multiple sizes) -
//   built from `entity`/`image.coverType`/`image.extension` directly, not
//   derived from `url`'s own path at all anymore.
// - On web, the real apiKey never reaches the browser (see `ServiceConfig`'s
//   own doc comment) - routes through this app's own image-proxy server
//   route instead, mirroring `tautulliImageUrl()`'s exact same native-vs-
//   web split for the identical reason (an authenticated source an `<Image>`
//   tag can't attach credentials to itself).
export function lidarrImageUrl(
  image: LidarrImage | undefined,
  config: ServiceConfig,
  entity: { type: 'artist' | 'album'; id: number },
  size = 500
): string | undefined {
  if (!image) return undefined;
  if (image.remoteUrl?.startsWith('http')) return image.remoteUrl;
  if (!image.coverType) return undefined;
  const filename = `${image.coverType}-${size}${image.extension || '.jpg'}`;

  if (Platform.OS === 'web') {
    if (!config.profileId) return undefined;
    const url = new URL(`/api/image-proxy/${config.profileId}/lidarr`, window.location.origin);
    url.searchParams.set('entityType', entity.type);
    url.searchParams.set('entityId', String(entity.id));
    url.searchParams.set('filename', filename);
    return url.toString();
  }

  const url = new URL(`${config.baseUrl.replace(/\/+$/, '')}/api/v1/mediacover/${entity.type}/${entity.id}/${filename}`);
  url.searchParams.set('apikey', config.apiKey);
  return url.toString();
}

export interface LidarrArtistStatistics {
  albumCount: number;
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrAlbumStatistics {
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

// A music artist as tracked by Lidarr - the primary shape used across the
// Music list, detail page, and album/track drill-down. `status` is
// `continuing | ended | deleted` (Lidarr's own ArtistStatusType - note the
// `deleted` value Sonarr's series status doesn't have).
export interface LidarrArtist {
  id: number;
  foreignArtistId?: string;
  artistName: string;
  overview?: string;
  artistType?: string;
  status: string;
  monitored: boolean;
  added?: string;
  images: LidarrImage[];
  genres?: string[];
  qualityProfileId: number;
  rootFolderPath?: string;
  statistics?: LidarrArtistStatistics;
  ratings?: { value: number; votes?: number };
  // Minimal inline shape (only what the "next release" countdown badge
  // needs), same pattern as SonarrEpisode's embedded `series` field -
  // avoids a real circular type against `LidarrAlbum`.
  nextAlbum?: { releaseDate?: string };
}

export interface LidarrAlbum {
  id: number;
  artistId: number;
  foreignAlbumId?: string;
  title: string;
  releaseDate?: string;
  albumType?: string;
  monitored: boolean;
  images: LidarrImage[];
  statistics?: LidarrAlbumStatistics;
  // Only populated on endpoints that explicitly join it in (e.g. calendar),
  // same as SonarrEpisode's embedded `series` field.
  artist?: { artistName: string; images: LidarrImage[] };
}

// One track within an album. `hasFile`/`trackFileId` mirror Sonarr's
// episode shape; `trackNumber` is a display string (e.g. "1/12"),
// `absoluteTrackNumber` the plain numeric sort key.
export interface LidarrTrack {
  id: number;
  artistId: number;
  albumId: number;
  trackNumber: string;
  absoluteTrackNumber: number;
  title: string;
  duration: number;
  hasFile: boolean;
  trackFileId: number;
}

// Technical media details for a downloaded track file, shown on the
// file-details card (`FileDetailsCard.tsx`) - same shape Sonarr's episode
// file uses.
export interface LidarrMediaInfo {
  audioBitrate?: number;
  audioChannels?: number;
  audioCodec?: string;
  audioLanguages?: string;
  audioStreamCount?: number;
}

// The actual on-disk file backing a downloaded track.
export interface LidarrTrackFile {
  id: number;
  artistId: number;
  albumId: number;
  path?: string;
  size: number;
  dateAdded?: string;
  quality: { quality: { name: string } };
  mediaInfo?: LidarrMediaInfo;
}

// One entry in Lidarr's activity/history log. `eventType` values are
// track-specific (trackFileImported/trackFileDeleted/etc, verified against
// Lidarr's own EntityHistoryEventType enum) - see `HISTORY_EVENT_LABELS`
// in `format.ts` for the friendly-label mapping.
export interface LidarrHistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle: string;
  quality?: { quality: { name: string } };
  artist?: { artistName: string };
  album?: { title: string };
  track?: { title: string; trackNumber: string };
}

// An artist/album's in-progress download as tracked by Lidarr's own queue
// (distinct from SABnzbd's queue - this is Lidarr's view of "is this being
// fetched").
export interface LidarrQueueItem {
  id: number;
  artistId?: number;
  albumId?: number;
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

export interface LidarrRootFolder {
  id: number;
  path: string;
}

// One mounted filesystem Lidarr can see - distinct from LidarrRootFolder
// (which is about configured library folders, not raw disk capacity).
export interface LidarrDiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface LidarrQualityProfile {
  id: number;
  name: string;
}

export const lidarrApi = {
  // Settings' "Test Connection" check.
  testConnection: (config: ServiceConfig) => arrFetch(config, '/api/v1/system/status'),

  // Full artist library, used by the Music list.
  getArtists: (config: ServiceConfig) => arrFetch<LidarrArtist[]>(config, '/api/v1/artist'),

  getArtistById: (config: ServiceConfig, id: number) => arrFetch<LidarrArtist>(config, `/api/v1/artist/${id}`),

  // Full-object PUT - callers pass the whole (possibly-modified) artist
  // back, matching how Lidarr's own update endpoint expects a complete
  // resource rather than a partial patch.
  updateArtist: (config: ServiceConfig, artist: LidarrArtist) =>
    arrFetch<LidarrArtist>(config, `/api/v1/artist/${artist.id}`, { method: 'PUT', body: artist }),

  bulkUpdateArtistsMonitored: (config: ServiceConfig, artistIds: number[], monitored: boolean) =>
    arrFetch<void>(config, '/api/v1/artist/editor', { method: 'PUT', body: { artistIds, monitored } }),

  getSystemStatus: (config: ServiceConfig) => arrFetch<{ version: string }>(config, '/api/v1/system/status'),

  // Triggers Lidarr's own background refresh-metadata job for every artist.
  refreshAllArtists: (config: ServiceConfig) =>
    arrFetch(config, '/api/v1/command', { method: 'POST', body: { name: 'RefreshArtist' } }),

  // Triggers a search for every album currently missing a file.
  searchAllMissing: (config: ServiceConfig) =>
    arrFetch(config, '/api/v1/command', { method: 'POST', body: { name: 'MissingAlbumSearch' } }),

  // Removes an artist from the library. `deleteFiles` controls whether the
  // downloaded track files on disk are also deleted (the "Remove from
  // Library" 3-way prompt on the detail page maps to this flag).
  deleteArtist: (config: ServiceConfig, id: number, deleteFiles = false) =>
    arrFetch<void>(config, `/api/v1/artist/${id}`, { params: { deleteFiles: String(deleteFiles) }, method: 'DELETE' }),

  // Lidarr's own artist lookup (used by the Add Artist search) - doesn't
  // require any other service to function.
  searchArtists: (config: ServiceConfig, term: string) =>
    arrFetch<LidarrArtist[]>(config, '/api/v1/artist/lookup', { params: { term } }),

  // Adds a new artist to Lidarr's library. `monitorOption` drives both the
  // album-level monitor setting (all/future/missing/etc, see
  // `LIDARR_MONITOR_OPTIONS`) and the artist-level `monitored` flag, which
  // is only turned off when the option is explicitly 'none' - matching
  // Lidarr's own Add Artist screen, which doesn't expose `monitored` as a
  // separate toggle either.
  addArtist: (
    config: ServiceConfig,
    artist: {
      artistName: string;
      foreignArtistId: string;
      qualityProfileId: number;
      rootFolderPath: string;
      monitored?: boolean;
      searchOnAdd?: boolean;
      monitorOption?: string;
    }
  ) =>
    arrFetch<LidarrArtist>(config, '/api/v1/artist', {
      method: 'POST',
      body: {
        ...artist,
        monitored: artist.monitored ?? artist.monitorOption !== 'none',
        addOptions: {
          monitor: artist.monitorOption ?? 'all',
          searchForMissingAlbums: artist.searchOnAdd ?? true,
        },
      },
    }),

  getAlbums: (config: ServiceConfig, artistId: number) =>
    arrFetch<LidarrAlbum[]>(config, '/api/v1/album', { params: { artistId: String(artistId) } }),

  getAlbumById: (config: ServiceConfig, id: number) => arrFetch<LidarrAlbum>(config, `/api/v1/album/${id}`),

  // Bulk monitor/unmonitor toggle for albums (mirrors Sonarr's episode
  // monitor endpoint, one level up the hierarchy here).
  updateAlbumsMonitored: (config: ServiceConfig, albumIds: number[], monitored: boolean) =>
    arrFetch<void>(config, '/api/v1/album/monitor', { method: 'PUT', body: { albumIds, monitored } }),

  // Unlike Sonarr's episode endpoint (no season filter, forcing a client-
  // side filter - see season/[season].tsx), Lidarr's track endpoint
  // genuinely supports server-side albumId filtering.
  getTracks: (config: ServiceConfig, albumId: number) =>
    arrFetch<LidarrTrack[]>(config, '/api/v1/track', { params: { albumId: String(albumId) } }),

  // Also server-side filterable by albumId - fetches every track file for
  // an album in one call instead of Sonarr's per-episode-file N+1 pattern.
  getTrackFiles: (config: ServiceConfig, albumId: number) =>
    arrFetch<LidarrTrackFile[]>(config, '/api/v1/trackfile', { params: { albumId: String(albumId) } }),

  // Deletes just the on-disk file, keeping the track itself monitored in
  // the library (distinct from `deleteArtist` with `deleteFiles: true`).
  deleteTrackFile: (config: ServiceConfig, trackFileId: number) =>
    arrFetch<void>(config, `/api/v1/trackfile/${trackFileId}`, { method: 'DELETE' }),

  // Same as `deleteTrackFile` but for a multi-selected batch at once
  // (album/track screen's multi-select delete).
  deleteTrackFilesBulk: (config: ServiceConfig, trackFileIds: number[]) =>
    arrFetch<void>(config, '/api/v1/trackfile/bulk', { method: 'DELETE', body: { trackFileIds } }),

  // Triggers an automatic-grab search for one specific artist.
  searchArtistRelease: (config: ServiceConfig, artistId: number) =>
    arrFetch(config, '/api/v1/command', { method: 'POST', body: { name: 'ArtistSearch', artistId } }),

  // Triggers an automatic-grab search for one specific album.
  searchAlbumRelease: (config: ServiceConfig, albumId: number) =>
    arrFetch(config, '/api/v1/command', { method: 'POST', body: { name: 'AlbumSearch', albumIds: [albumId] } }),

  // Lidarr's own download queue (distinct from SABnzbd's queue - this
  // reflects Lidarr's tracking of in-flight grabs, joined with artist/album
  // titles).
  getQueue: (config: ServiceConfig) =>
    arrFetch<{ records: LidarrQueueItem[] }>(config, '/api/v1/queue', { params: { includeArtist: 'true', includeAlbum: 'true' } }),

  getRootFolders: (config: ServiceConfig) => arrFetch<LidarrRootFolder[]>(config, '/api/v1/rootfolder'),

  // Raw disk capacity for the Server tab's "Free Space" stat - separate
  // endpoint from rootfolder, which doesn't carry totalSpace.
  getDiskSpace: (config: ServiceConfig) => arrFetch<LidarrDiskSpace[]>(config, '/api/v1/diskspace'),

  getQualityProfiles: (config: ServiceConfig) => arrFetch<LidarrQualityProfile[]>(config, '/api/v1/qualityprofile'),

  // Albums releasing within `start`..`end` - powers the Upcoming tab.
  getCalendar: (config: ServiceConfig, start: string, end: string) =>
    arrFetch<LidarrAlbum[]>(config, '/api/v1/calendar', { params: { start, end } }),

  // Most recent activity events, newest first.
  getHistory: (config: ServiceConfig, pageSize = 50) =>
    arrFetch<{ records: LidarrHistoryRecord[] }>(config, '/api/v1/history', {
      params: { page: '1', pageSize: String(pageSize), sortKey: 'date', sortDirection: 'descending' },
    }),

  // Interactive release search, scoped to an artist or one specific album
  // depending on which optional param is given - what the manual "search
  // for a specific release" flow hits at each drill-down level.
  getReleases: (config: ServiceConfig, params: { artistId: number; albumId?: number }) =>
    arrFetch<LidarrRelease[]>(config, '/api/v1/release', {
      params: {
        artistId: String(params.artistId),
        ...(params.albumId !== undefined ? { albumId: String(params.albumId) } : {}),
      },
    }),

  // Manually grabs one specific release the user picked from `getReleases`.
  grabRelease: (config: ServiceConfig, release: { guid: string; indexerId: number }) =>
    arrFetch(config, '/api/v1/release', { method: 'POST', body: release }),
};
