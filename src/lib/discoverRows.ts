// Discover's row builders - TMDB results and the Radarr/Sonarr library turned into poster-card items
// (with library status badges), and the Streaming Service row's providers. Shared by the phone's
// Discover screen (app/discover.tsx) and the Android TV app's Discover (tv/app/index.tsx), so both
// show the same rows from the same rules.
import { RadarrMovie } from '../api/radarr';
import { SonarrSeries } from '../api/sonarr';
import { tmdbApi, tmdbImageUrl, TmdbMovie, TmdbTv, TmdbWatchProvider } from '../api/tmdb';
import { ServiceConfig } from '../api/types';
import { DiscoverCardItem } from '../components/DiscoverRow';
import { LogoRowItem } from '../components/LogoRow';
import { getCachedProviders, setCachedProviders } from './discoverCache';
import { MediaKind, resolveMediaKind } from './discoverCategories';
import { badgeForMovie, badgeForSeries, LibraryIndex } from './libraryStatus';

export const PREVIEW_COUNT = 15;
export const PROVIDER_PREVIEW_COUNT = 20;

// Movies/TV Shows tabs - a single-type array, same shape as before this
// screen had an "All" tab at all.
export function toCardItems(items: (TmdbMovie | TmdbTv)[], type: MediaKind, library: LibraryIndex): DiscoverCardItem[] {
  return items.slice(0, PREVIEW_COUNT).map((item) => ({
    id: item.id,
    title: type === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name,
    posterUrl: tmdbImageUrl(item.poster_path),
    rating: item.vote_average,
    badge: type === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library),
  }));
}

// "All" tab's mixed-array counterpart - tags each card with its own
// resolved type so DiscoverRow's onPressItem can route it correctly.
export function toMixedCardItems(items: (TmdbMovie | TmdbTv)[], library: LibraryIndex): DiscoverCardItem[] {
  return items.slice(0, PREVIEW_COUNT).map((item) => {
    const type = resolveMediaKind(item);
    return {
      id: item.id,
      title: type === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name,
      posterUrl: tmdbImageUrl(item.poster_path),
      rating: item.vote_average,
      badge: type === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library),
      mediaType: type,
    };
  });
}

// Sourced from Radarr/Sonarr's own `added` timestamp (not TMDB), sorted
// newest-first and capped the same way the TMDB preview rows are.
export function toLocalMovieCardItems(movies: RadarrMovie[]): DiscoverCardItem[] {
  return [...movies]
    .filter((m) => m.added)
    .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
    .slice(0, PREVIEW_COUNT)
    .map((m) => ({
      id: m.id,
      title: m.title,
      posterUrl: m.images.find((i) => i.coverType === 'poster')?.remoteUrl,
      rating: m.ratings?.imdb?.value,
    }));
}

export function toLocalSeriesCardItems(series: SonarrSeries[]): DiscoverCardItem[] {
  return [...series]
    .filter((s) => s.added)
    .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
    .slice(0, PREVIEW_COUNT)
    .map((s) => ({
      id: s.id,
      title: s.title,
      posterUrl: s.images.find((i) => i.coverType === 'poster')?.remoteUrl,
      rating: s.ratings?.value,
    }));
}

export function providersToItems(providers: TmdbWatchProvider[]): LogoRowItem[] {
  return providers.slice(0, PROVIDER_PREVIEW_COUNT).map((p) => ({
    id: p.provider_id,
    name: p.provider_name,
    logoUrl: tmdbImageUrl(p.logo_path, 'w185'),
  }));
}

// Cache-first: a region's streaming catalog doesn't change minute to
// minute, so a warm cache hit turns this into a local AsyncStorage read
// instead of a real TMDB round-trip - the "All" tab's own load function
// calls this on *every* focus (same as it already did for Trending/Popular/
// Upcoming before Streaming Service existed), so this is what actually
// keeps repeat visits fast (see discoverCache.ts's own header comment for
// the full story on why this was added).
export async function loadProviders(config: ServiceConfig, mediaType: 'movie' | 'tv', region: string): Promise<LogoRowItem[]> {
  const cached = await getCachedProviders(mediaType, region);
  if (cached) return cached;
  const fresh = await tmdbApi.watchProviders(config, mediaType, region).catch(() => [] as TmdbWatchProvider[]);
  const items = providersToItems(fresh);
  if (items.length > 0) setCachedProviders(mediaType, region, items);
  return items;
}

// "All" tab's Streaming Service row merges both catalogs (deduped by id -
// the same service carries the same provider id across movie/tv catalogs
// in the same region) since a single row has to represent both.
export function mergeProviderItems(a: LogoRowItem[], b: LogoRowItem[]): LogoRowItem[] {
  const seen = new Set<number>();
  return [...a, ...b].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// "All" tab's Recently Added - true chronological merge of both libraries by
// their real `added` timestamp (not alternating, unlike Popular/Upcoming
// below - both already carry a real added date to sort by).
export function toMixedLocalCardItems(movies: RadarrMovie[], series: SonarrSeries[]): DiscoverCardItem[] {
  const tagged = [
    ...movies
      .filter((m) => m.added)
      .map((m) => ({
        id: m.id,
        title: m.title,
        added: m.added!,
        posterUrl: m.images.find((i) => i.coverType === 'poster')?.remoteUrl,
        rating: m.ratings?.imdb?.value,
        mediaType: 'movie' as const,
      })),
    ...series
      .filter((s) => s.added)
      .map((s) => ({
        id: s.id,
        title: s.title,
        added: s.added!,
        posterUrl: s.images.find((i) => i.coverType === 'poster')?.remoteUrl,
        rating: s.ratings?.value,
        mediaType: 'tv' as const,
      })),
  ];
  tagged.sort((a, b) => new Date(b.added).getTime() - new Date(a.added).getTime());
  return tagged.slice(0, PREVIEW_COUNT);
}
