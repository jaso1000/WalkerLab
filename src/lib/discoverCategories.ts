// Shared logic for Discover's category rows/grids (Trending/Popular/Upcoming/
// Recently Released) - both the main Discover screen's preview rows and the
// full-screen infinite-scroll grid (`app/discover/category/[category].tsx`)
// route through `fetchDiscoverCategory` so they can't drift out of sync.
import { tmdbApi, TmdbMovie, TmdbTv } from '../api/tmdb';
import { ServiceConfig } from '../api/types';

export type MediaKind = 'movie' | 'tv';
export type DiscoverCategory = 'trending' | 'popular' | 'upcoming' | 'recent';

export const CATEGORY_LABELS: Record<DiscoverCategory, string> = {
  trending: 'Trending',
  popular: 'Popular',
  upcoming: 'Upcoming',
  recent: 'Recently Released',
};

// "Recently Released" is movie-only - Radarr/TMDB track a theatrical/
// digital/physical release triptych for movies (see ReleaseTriptych), but
// TV has no equivalent concept, only per-episode air dates. Kept separate
// from the shared CATEGORIES list in discover.tsx for that reason, same
// pattern as "Browse by Network" being TV-only.
export const RELEASE_TYPE_FILTERS = [
  { key: 'theatrical', label: 'Theatrical', types: [2, 3] },
  { key: 'digital', label: 'Digital', types: [4] },
  { key: 'physical', label: 'Physical', types: [5] },
] as const;
export type ReleaseTypeFilterKey = (typeof RELEASE_TYPE_FILTERS)[number]['key'];

// Fetches one page of a Discover category for the given media type, routing
// to the right TMDB endpoint. `releaseTypes` only applies to the 'recent'
// category (Theatrical/Digital/Physical filter), and is ignored otherwise.
export function fetchDiscoverCategory(
  config: ServiceConfig,
  category: DiscoverCategory,
  mediaType: MediaKind,
  page: number,
  releaseTypes?: number[]
): Promise<{ results: (TmdbMovie | TmdbTv)[]; total_pages: number }> {
  if (category === 'trending') {
    return mediaType === 'movie' ? tmdbApi.trendingMovies(config, 'week', page) : tmdbApi.trendingTv(config, 'week', page);
  }
  if (category === 'popular') {
    return mediaType === 'movie' ? tmdbApi.popularMovies(config, page) : tmdbApi.popularTv(config, page);
  }
  if (category === 'recent') {
    return tmdbApi.recentlyReleasedMovies(config, page, releaseTypes);
  }
  return mediaType === 'movie' ? tmdbApi.upcomingMovies(config, page) : tmdbApi.upcomingTv(config, page);
}

// TMDB's ranked lists (trending/popular) can shift between calls, so
// consecutive pages sometimes overlap - append naively and React throws a
// duplicate-key error on the repeated id.
export function dedupeById<T extends { id: number }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  return incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
