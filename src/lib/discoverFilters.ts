// Filter/sort model for the Discover category screen's optional filter
// sheet (`app/discover/category/[category].tsx`'s Filters button, Trending/
// Popular/Upcoming only) - the screen starts on that category's own real
// data and only switches to this general `/discover` query once the user
// actually applies a filter (see that screen's `filtersApplied`). Separate
// from `discoverCategories.ts`, which powers the fixed, unfiltered initial
// view every category starts on.
import { TmdbCompany, TmdbGenre, TmdbKeyword, TmdbLanguage, TmdbPersonSearchResult, TmdbWatchProvider, TmdbWatchRegion } from '../api/tmdb';
import { MediaKind } from './discoverCategories';
import { FALLBACK_WATCH_REGION } from './preferences';

export type SortKey = 'popularity' | 'date' | 'rating' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface SortChoice {
  key: SortKey;
  direction: SortDirection;
  label: string;
}

// Same 8 options Seerr's own DiscoverMovies/DiscoverTv screens expose
// (Popularity/Release-or-Air-Date/Rating/Title x Ascending/Descending) - one
// generic list here since the UI doesn't distinguish movie vs TV, the actual
// TMDB field name is resolved per media type in `sortByParam` below.
export const SORT_OPTIONS: SortChoice[] = [
  { key: 'popularity', direction: 'desc', label: 'Popularity Descending' },
  { key: 'popularity', direction: 'asc', label: 'Popularity Ascending' },
  { key: 'date', direction: 'desc', label: 'Release Date Descending' },
  { key: 'date', direction: 'asc', label: 'Release Date Ascending' },
  { key: 'rating', direction: 'desc', label: 'Rating Descending' },
  { key: 'rating', direction: 'asc', label: 'Rating Ascending' },
  { key: 'title', direction: 'desc', label: 'Title Descending' },
  { key: 'title', direction: 'asc', label: 'Title Ascending' },
];

export const DEFAULT_SORT: SortChoice = SORT_OPTIONS[0];

function sortByParam(sort: SortChoice, mediaType: MediaKind): string {
  const field: Record<SortKey, string> = {
    popularity: 'popularity',
    date: mediaType === 'movie' ? 'primary_release_date' : 'first_air_date',
    rating: 'vote_average',
    title: mediaType === 'movie' ? 'original_title' : 'original_name',
  };
  return `${field[sort.key]}.${sort.direction}`;
}

export interface DiscoverFilters {
  sort: SortChoice;
  // Split rather than one shared `genres` list because movie and TV genre
  // ids are two disjoint TMDB id-spaces (e.g. TV's "Action & Adventure" is
  // a different id than movie's "Action") - the "All" category screen's
  // filter sheet needs both selectable independently, each only ever sent
  // to its own side's `/discover` call (see `buildDiscoverParams`). A
  // movie-only or tv-only sheet only ever populates its own matching list.
  movieGenres: TmdbGenre[];
  tvGenres: TmdbGenre[];
  // Applies to both movie and tv discover queries equally (unlike
  // genres/studio/network), so unlike those there's no per-mediaType split.
  actors: TmdbPersonSearchResult[];
  keywords: TmdbKeyword[];
  excludeKeywords: TmdbKeyword[];
  studio?: TmdbCompany; // movie only
  originalLanguage?: TmdbLanguage;
  runtimeGte?: number;
  runtimeLte?: number;
  voteAverageGte?: number;
  voteAverageLte?: number;
  voteCountGte?: number;
  voteCountLte?: number;
  watchProviders: TmdbWatchProvider[];
  watchRegion?: TmdbWatchRegion;
  // Movie-only. TMDB's certification filter only supports one exact value
  // or a contiguous gte/lte range ordered by /certification/movie/list's
  // own `order` field (same constraint Seerr's own `certificationMode:
  // 'exact' | 'range'` works around) - the filter sheet picks these from a
  // chip row by selecting a contiguous span, not an arbitrary multi-select.
  // Equal gte/lte (or only one set) means an exact match.
  certificationGte?: string;
  certificationLte?: string;
  releaseDateGte?: string; // ISO yyyy-mm-dd; movie -> primary_release_date, tv -> first_air_date
  releaseDateLte?: string;
}

export const EMPTY_FILTERS: DiscoverFilters = {
  sort: DEFAULT_SORT,
  movieGenres: [],
  tvGenres: [],
  actors: [],
  keywords: [],
  excludeKeywords: [],
  watchProviders: [],
};

// Counts "real" filters only - `sort` is always set (it's an ordering
// choice, not a restriction) so it never contributes to the Filters
// button's badge count.
export function countActiveFilters(filters: DiscoverFilters): number {
  let count = 0;
  if (filters.movieGenres.length > 0 || filters.tvGenres.length > 0) count++;
  if (filters.actors.length > 0) count++;
  if (filters.keywords.length > 0) count++;
  if (filters.excludeKeywords.length > 0) count++;
  if (filters.studio) count++;
  if (filters.originalLanguage) count++;
  if (filters.runtimeGte != null || filters.runtimeLte != null) count++;
  if (filters.voteAverageGte != null || filters.voteAverageLte != null) count++;
  if (filters.voteCountGte != null || filters.voteCountLte != null) count++;
  if (filters.watchProviders.length > 0) count++;
  if (filters.certificationGte || filters.certificationLte) count++;
  if (filters.releaseDateGte || filters.releaseDateLte) count++;
  return count;
}

// Converts a `DiscoverFilters` selection into the exact TMDB `/discover/
// movie|tv` query params for `tmdbApi.discoverMovies`/`discoverTv`. Genres/
// keywords/watch-providers are pipe-joined (TMDB's OR syntax) - "Action or
// Comedy", not "Action and Comedy" - since that's the useful interpretation
// for a browse filter; `without_keywords` is comma-joined (TMDB's AND/
// default), which is fine since exclusion doesn't have the same OR-vs-AND
// ambiguity a multi-select include does.
export function buildDiscoverParams(filters: DiscoverFilters, mediaType: MediaKind): Record<string, string> {
  const params: Record<string, string> = {
    sort_by: sortByParam(filters.sort, mediaType),
  };

  const genres = mediaType === 'movie' ? filters.movieGenres : filters.tvGenres;
  if (genres.length > 0) params.with_genres = genres.map((g) => g.id).join('|');
  if (filters.actors.length > 0) params.with_cast = filters.actors.map((a) => a.id).join('|');
  if (filters.keywords.length > 0) params.with_keywords = filters.keywords.map((k) => k.id).join('|');
  if (filters.excludeKeywords.length > 0) params.without_keywords = filters.excludeKeywords.map((k) => k.id).join(',');
  if (mediaType === 'movie' && filters.studio) params.with_companies = String(filters.studio.id);
  if (filters.originalLanguage) params.with_original_language = filters.originalLanguage.iso_639_1;
  if (filters.runtimeGte != null) params['with_runtime.gte'] = String(filters.runtimeGte);
  if (filters.runtimeLte != null) params['with_runtime.lte'] = String(filters.runtimeLte);
  if (filters.voteAverageGte != null) params['vote_average.gte'] = String(filters.voteAverageGte);
  if (filters.voteAverageLte != null) params['vote_average.lte'] = String(filters.voteAverageLte);
  if (filters.voteCountGte != null) params['vote_count.gte'] = String(filters.voteCountGte);
  if (filters.voteCountLte != null) params['vote_count.lte'] = String(filters.voteCountLte);

  if (filters.watchProviders.length > 0) {
    params.with_watch_providers = filters.watchProviders.map((p) => p.provider_id).join('|');
    params.watch_region = filters.watchRegion?.iso_3166_1 ?? FALLBACK_WATCH_REGION;
  }

  if (mediaType === 'movie' && (filters.certificationGte || filters.certificationLte)) {
    params.certification_country = 'US';
    if (filters.certificationGte && filters.certificationGte === filters.certificationLte) {
      params.certification = filters.certificationGte;
    } else {
      if (filters.certificationGte) params['certification.gte'] = filters.certificationGte;
      if (filters.certificationLte) params['certification.lte'] = filters.certificationLte;
    }
  }

  const dateGteKey = mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
  const dateLteKey = mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
  if (filters.releaseDateGte) params[dateGteKey] = filters.releaseDateGte;
  if (filters.releaseDateLte) params[dateLteKey] = filters.releaseDateLte;

  return params;
}
