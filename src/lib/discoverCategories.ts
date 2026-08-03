// Shared logic for Discover's category rows/grids (Trending/Popular/Upcoming/
// Recently Released) - both the main Discover screen's preview rows and the
// full-screen infinite-scroll grid (`app/discover/category/[category].tsx`)
// route through `fetchDiscoverCategory` so they can't drift out of sync.
import { tmdbApi, TmdbMovie, TmdbTv } from '../api/tmdb';
import { ServiceConfig } from '../api/types';

export type MediaKind = 'movie' | 'tv';
export type DiscoverCategory = 'trending' | 'popular' | 'upcoming' | 'recent';
// 'all' is Discover's mixed-content tab - a third `fetchDiscoverCategory`
// mode alongside the two real `MediaKind`s, not itself a `MediaKind` (TMDB
// items are always concretely movie or tv; 'all' only ever describes a
// *query*, resolved back to a real MediaKind per item via resolveMediaKind).
export type DiscoverMediaFilter = MediaKind | 'all';

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

// Fetches one page of a Discover category for the given media filter,
// routing to the right TMDB endpoint(s). `releaseTypes` only applies to the
// 'recent' category (Theatrical/Digital/Physical filter), and is ignored
// otherwise. `mediaType: 'all'` powers Discover's "All" tab (and its rows'
// "See All" full-grid pages): Trending uses TMDB's real combined endpoint;
// Popular/Upcoming have no combined equivalent, so both types are fetched
// for the same page and interleaved client-side - `total_pages` is the max
// of the two so paging continues until BOTH are exhausted (once one list
// runs out, further pages are one-sided rather than perfectly alternating,
// which is fine). 'recent' has no cross-media concept at all (see
// RELEASE_TYPE_FILTERS' own comment) and falls back to movies-only even
// under 'all' - Discover's main screen never surfaces this combination
// (the All tab omits Recently Released entirely), so this only matters if
// a future caller navigates here directly.
export function fetchDiscoverCategory(
  config: ServiceConfig,
  category: DiscoverCategory,
  mediaType: DiscoverMediaFilter,
  page: number,
  releaseTypes?: number[]
): Promise<{ results: (TmdbMovie | TmdbTv)[]; total_pages: number }> {
  if (mediaType === 'all') {
    if (category === 'trending') {
      return tmdbApi.trendingAll(config, 'week', page).then((res) => ({
        results: res.results.filter((item) => item.media_type !== 'person'),
        total_pages: res.total_pages,
      }));
    }
    if (category === 'recent') {
      return tmdbApi.recentlyReleasedMovies(config, page, releaseTypes);
    }
    const [fetchMovie, fetchTv] =
      category === 'popular'
        ? [tmdbApi.popularMovies(config, page), tmdbApi.popularTv(config, page)]
        : [tmdbApi.upcomingMovies(config, page), tmdbApi.upcomingTv(config, page)];
    return Promise.all([fetchMovie, fetchTv]).then(([m, t]) => ({
      results: interleave<TmdbMovie | TmdbTv>(m.results, t.results),
      total_pages: Math.max(m.total_pages, t.total_pages),
    }));
  }
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

// Interleaves two lists alternating a[0], b[0], a[1], b[1], ... - used to
// build Discover's "All" tab's Popular/Upcoming rows from separate
// movie+TV calls (TMDB has no combined endpoint for either, unlike Trending
// - see tmdbApi.trendingAll). Continues with whichever list has leftovers
// once the shorter one is exhausted, rather than truncating.
export function interleave<T>(a: T[], b: T[]): T[] {
  const result: T[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) result.push(a[i]);
    if (i < b.length) result.push(b[i]);
  }
  return result;
}

// Reliable per-item movie-vs-tv discrimination for a mixed array that
// doesn't carry an explicit media_type tag on every item (unlike
// tmdbApi.trendingAll's results) - a TmdbMovie always has `.title`, a
// TmdbTv always has `.name` (same trick already used inline in
// discover.tsx's search results renderer).
export function resolveMediaKind(item: TmdbMovie | TmdbTv): MediaKind {
  return 'title' in item ? 'movie' : 'tv';
}
