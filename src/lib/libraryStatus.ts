import { radarrApi, RadarrMovie } from '../api/radarr';
import { sonarrApi, SonarrSeries } from '../api/sonarr';
import { tmdbApi } from '../api/tmdb';
import { ServiceConfig } from '../api/types';
import { DiscoverCardBadge } from '../components/DiscoverRow';
import { colors } from '../theme/colors';
import { deletedLibrary } from './deletedLibrary';
import { getCachedTmdbIds, mergeCachedTmdbIds } from './seriesTmdbCache';

// A one-time-per-screen-focus snapshot of "what's already in the library or
// was previously deleted", keyed by tmdbId so Discover's poster badges can
// look either up with a plain Map/Set lookup per card instead of an API call
// per card.
export interface LibraryIndex {
  movieByTmdbId: Map<number, RadarrMovie>;
  seriesByTmdbId: Map<number, SonarrSeries>;
  deletedMovieIds: Set<number>;
  deletedSeriesTmdbIds: Set<number>;
}

// Safe default for screens that render before the real index has loaded.
export const EMPTY_LIBRARY_INDEX: LibraryIndex = {
  movieByTmdbId: new Map(),
  seriesByTmdbId: new Map(),
  deletedMovieIds: new Set(),
  deletedSeriesTmdbIds: new Set(),
};

// Radarr tracks tmdbId natively, so movie matching is a free Map lookup.
// Sonarr only tracks tvdbId/imdbId, so matching a series to a Discover TV
// card (which only has a tmdbId) needs a reverse lookup per library show -
// one TMDB call per show in the library, done once per fetch rather than
// once per visible card.
export async function buildLibraryIndex(opts: {
  tmdbConfig?: ServiceConfig;
  radarrConfig?: ServiceConfig;
  sonarrConfig?: ServiceConfig;
  // Callers that already fetched the raw lists for their own purposes (the
  // main Discover screen fetches both for its "Recently Added" row) should
  // pass them here instead of letting this function fetch its own second,
  // completely redundant copy - confirmed live via the Docker/web
  // deployment's proxy logs that Discover was firing two concurrent
  // /api/v3/series (and /api/v3/movie) requests on every single focus,
  // doubling bandwidth for no reason. Callers with no other use for the raw
  // lists (the category/network browse screens) can omit these and this
  // still fetches them internally as before.
  movies?: RadarrMovie[];
  series?: SonarrSeries[];
}): Promise<LibraryIndex> {
  const [movies, series, deletedMovieIds, deletedSeriesTmdbIds] = await Promise.all([
    opts.movies
      ? Promise.resolve(opts.movies)
      : opts.radarrConfig
        ? radarrApi.getMovies(opts.radarrConfig).catch(() => [])
        : Promise.resolve([] as RadarrMovie[]),
    opts.series
      ? Promise.resolve(opts.series)
      : opts.sonarrConfig
        ? sonarrApi.getSeries(opts.sonarrConfig).catch(() => [])
        : Promise.resolve([] as SonarrSeries[]),
    deletedLibrary.getDeletedMovieIds(),
    deletedLibrary.getDeletedSeriesTmdbIds(),
  ]);

  const movieByTmdbId = new Map(movies.map((m) => [m.tmdbId, m]));
  const seriesByTmdbId = new Map<number, SonarrSeries>();

  if (opts.tmdbConfig && opts.sonarrConfig && series.length > 0) {
    const tmdbConfig = opts.tmdbConfig;
    const sonarrBaseUrl = opts.sonarrConfig.baseUrl;
    const cached = await getCachedTmdbIds(sonarrBaseUrl);
    const newlyResolved: Record<number, number> = {};

    await Promise.all(
      series
        .filter((s): s is SonarrSeries & { tvdbId: number } => !!s.tvdbId)
        .map(async (s) => {
          // Already known from a previous resolve - a tvdbId's tmdbId never
          // changes, so no need to ask TMDB again.
          const cachedTmdbId = cached[s.tvdbId];
          if (cachedTmdbId !== undefined) {
            seriesByTmdbId.set(cachedTmdbId, s);
            return;
          }
          try {
            const res = await tmdbApi.findByTvdbId(tmdbConfig, s.tvdbId);
            const tvId = res.tv_results[0]?.id;
            if (tvId) {
              seriesByTmdbId.set(tvId, s);
              newlyResolved[s.tvdbId] = tvId;
            }
          } catch {
            // Best-effort, matches the previous .catch(() => {}) behavior.
          }
        })
    );

    await mergeCachedTmdbIds(sonarrBaseUrl, newlyResolved);
  }

  return { movieByTmdbId, seriesByTmdbId, deletedMovieIds, deletedSeriesTmdbIds };
}

// Status badge for a Discover movie card: a green check if the file is
// already downloaded, an amber clock if it's in the library but not
// downloaded yet, a red trash icon if it was previously removed, or no badge
// at all if none of those apply.
export function badgeForMovie(tmdbId: number, index: LibraryIndex): DiscoverCardBadge | undefined {
  const inLibrary = index.movieByTmdbId.get(tmdbId);
  if (inLibrary) {
    return inLibrary.hasFile ? { icon: 'checkmark', color: colors.success } : { icon: 'time-outline', color: colors.accent };
  }
  if (index.deletedMovieIds.has(tmdbId)) return { icon: 'trash', color: colors.danger };
  return undefined;
}

// Same as `badgeForMovie` but for TV: "complete" means every known episode
// has a file, not just "any file exists".
export function badgeForSeries(tmdbId: number, index: LibraryIndex): DiscoverCardBadge | undefined {
  const inLibrary = index.seriesByTmdbId.get(tmdbId);
  if (inLibrary) {
    const stats = inLibrary.statistics;
    const complete = !!stats && stats.episodeCount > 0 && stats.episodeFileCount >= stats.episodeCount;
    return complete ? { icon: 'checkmark', color: colors.success } : { icon: 'time-outline', color: colors.accent };
  }
  if (index.deletedSeriesTmdbIds.has(tmdbId)) return { icon: 'trash', color: colors.danger };
  return undefined;
}
