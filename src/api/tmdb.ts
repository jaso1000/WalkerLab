// TMDB (The Movie Database) v3 client - powers the entire Discover section:
// search, trending/popular/upcoming/recently-released rows, posters,
// cast & crew, ratings (vote_average), and the tvdbId->tmdbId resolution
// Discover needs to match Sonarr's TV library against TMDB cards. The
// biggest/most-varied API client in the app since Discover's detail pages
// surface almost everything TMDB returns.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Minimal movie shape returned by list/search endpoints (trending, popular,
// search results, etc) - just enough for a poster card.
export interface TmdbMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  vote_average?: number;
  genre_ids?: number[];
}

// Minimal TV shape returned by list/search endpoints, same role as
// `TmdbMovie` but for series.
export interface TmdbTv {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
}

export interface TmdbProductionCompany {
  id: number;
  name: string;
  logo_path?: string;
  origin_country?: string;
}

export interface TmdbProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface TmdbSpokenLanguage {
  iso_639_1: string;
  name: string;
  english_name?: string;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

// Discover filter option shapes - genres/languages/certifications ship
// baked into the app (TMDB's own lists), everything else is looked up live.
export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCompany {
  id: number;
  name: string;
  logo_path?: string;
}

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string;
}

export interface TmdbWatchRegion {
  iso_3166_1: string;
  english_name: string;
}

export interface TmdbLanguage {
  iso_639_1: string;
  english_name: string;
  name: string;
}

export interface TmdbCertification {
  certification: string;
  meaning: string;
  order: number;
}

// Resolves a title's `original_language` ISO code (e.g. "ja") to a readable
// name (e.g. "Japanese") by cross-referencing its own `spoken_languages`
// list, falling back to the raw code if no match is found.
export function originalLanguageName(detail: { original_language?: string; spoken_languages?: TmdbSpokenLanguage[] }): string | undefined {
  if (!detail.original_language) return undefined;
  const match = detail.spoken_languages?.find((l) => l.iso_639_1 === detail.original_language);
  return match?.english_name ?? match?.name ?? detail.original_language;
}

// One release-date entry for a movie in one region. `type` is TMDB's own
// numeric code (see `RELEASE_TYPE_*` constants and `extractMovieReleaseInfo`
// below for how these become the Theatrical/Digital/Physical triptych).
export interface TmdbReleaseDateEntry {
  type: number;
  release_date: string;
  note?: string;
  certification?: string;
}

export interface TmdbReleaseDatesResponse {
  results: { iso_3166_1: string; release_dates: TmdbReleaseDateEntry[] }[];
}

// Cast/crew shapes for the *movie* credits endpoint (flat lists, one entry
// per cast/crew role).
export interface TmdbCastMember {
  id: number;
  name: string;
  character?: string;
  profile_path?: string;
  order: number;
}

export interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  profile_path?: string;
}

export interface TmdbCredits {
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
}

// TV's "aggregate credits" endpoint groups a person's multiple roles/jobs
// across a whole series under one entry (`roles`/`jobs` arrays) instead of
// one row per episode - these raw shapes get flattened back into the same
// `TmdbCredits` shape movies use via `normalizeAggregateCredits` below, so
// `CastCrewSection` can treat movies and TV identically.
interface TmdbAggregateCastMember {
  id: number;
  name: string;
  profile_path?: string;
  order: number;
  roles?: { character: string }[];
}

interface TmdbAggregateCrewMember {
  id: number;
  name: string;
  profile_path?: string;
  jobs?: { job: string }[];
}

export interface TmdbAggregateCredits {
  cast: TmdbAggregateCastMember[];
  crew: TmdbAggregateCrewMember[];
}

// Flattens TV's aggregate-credits shape down to the same flat `TmdbCredits`
// shape movies use: each cast member keeps only their first-listed
// character, and each crew member gets one output entry per job they held
// (so someone who was both writer and director appears twice, once per job).
export function normalizeAggregateCredits(agg: TmdbAggregateCredits | undefined): TmdbCredits {
  if (!agg) return { cast: [], crew: [] };
  return {
    cast: agg.cast.map((c) => ({
      id: c.id,
      name: c.name,
      character: c.roles?.[0]?.character,
      profile_path: c.profile_path,
      order: c.order,
    })),
    crew: agg.crew.flatMap((c) => (c.jobs ?? []).map((j) => ({ id: c.id, name: c.name, job: j.job, profile_path: c.profile_path }))),
  };
}

export interface TmdbCrewCredit {
  id: number;
  name: string;
  profile_path?: string;
}

// Pulls out crew members matching any of the given `jobs` (e.g. ["Director"]
// or ["Writer", "Screenplay"]), de-duplicating by person id so someone
// credited for the same job twice (rare but happens in TMDB data) only shows
// once.
export function extractCrewCredits(crew: TmdbCrewMember[], jobs: string[]): TmdbCrewCredit[] {
  const seen = new Set<number>();
  const result: TmdbCrewCredit[] = [];
  for (const c of crew) {
    if (!jobs.includes(c.job) || seen.has(c.id)) continue;
    seen.add(c.id);
    result.push({ id: c.id, name: c.name, profile_path: c.profile_path });
  }
  return result;
}

// Full movie detail response (Discover's movie detail page), requested with
// `append_to_response=release_dates,credits,keywords` so all of this comes
// back in one call instead of three.
export interface TmdbMovieDetail extends TmdbMovie {
  runtime?: number;
  genres?: { id: number; name: string }[];
  status?: string;
  production_companies?: TmdbProductionCompany[];
  production_countries?: TmdbProductionCountry[];
  original_language?: string;
  spoken_languages?: TmdbSpokenLanguage[];
  release_dates?: TmdbReleaseDatesResponse;
  credits?: TmdbCredits;
  imdb_id?: string;
  keywords?: { keywords: TmdbKeyword[] };
}

// Full TV detail response (Discover's series detail page), requested with
// `append_to_response=aggregate_credits,keywords`.
export interface TmdbTvDetail extends TmdbTv {
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  networks?: { id: number; name: string }[];
  status?: string;
  last_air_date?: string;
  in_production?: boolean;
  number_of_seasons?: number;
  number_of_episodes?: number;
  production_companies?: TmdbProductionCompany[];
  production_countries?: TmdbProductionCountry[];
  original_language?: string;
  spoken_languages?: TmdbSpokenLanguage[];
  created_by?: { id: number; name: string; profile_path?: string }[];
  aggregate_credits?: TmdbAggregateCredits;
  keywords?: { results: TmdbKeyword[] };
}

// TMDB's keywords endpoint nests the array under a different field name for
// movies (`keywords`) vs TV (`results`) - this normalizes both to a plain
// array so `TagList` doesn't need to know which media type it's rendering.
export function extractKeywords(detail: { keywords?: { keywords?: TmdbKeyword[]; results?: TmdbKeyword[] } }): TmdbKeyword[] {
  return detail.keywords?.keywords ?? detail.keywords?.results ?? [];
}

export interface MovieReleaseInfo {
  theatrical?: string;
  digital?: string;
  physical?: string;
}

const RELEASE_TYPE_THEATRICAL = [2, 3];
const RELEASE_TYPE_DIGITAL = 4;
const RELEASE_TYPE_PHYSICAL = 5;

// Reduces TMDB's per-region, per-type release-dates response down to the
// single Theatrical/Digital/Physical triptych shown on movie detail pages.
// Prefers the US region (falls back to whichever region TMDB returned
// first), and picks the earliest date within each type bucket when TMDB
// lists multiple dates of the same type (e.g. limited then wide theatrical).
export function extractMovieReleaseInfo(response: TmdbReleaseDatesResponse | undefined): MovieReleaseInfo {
  if (!response) return {};
  const region = response.results.find((r) => r.iso_3166_1 === 'US') ?? response.results[0];
  if (!region) return {};

  const earliest = (types: number[]) =>
    region.release_dates
      .filter((d) => types.includes(d.type))
      .map((d) => d.release_date)
      .sort()[0];

  return {
    theatrical: earliest(RELEASE_TYPE_THEATRICAL),
    digital: earliest([RELEASE_TYPE_DIGITAL]),
    physical: earliest([RELEASE_TYPE_PHYSICAL]),
  };
}

// Cast & Crew's "tap through to filmography" person page shapes.
export interface TmdbPerson {
  id: number;
  name: string;
  profile_path?: string;
  biography?: string;
  known_for_department?: string;
}

export interface TmdbPersonCredit {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  character?: string;
  job?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
}

// Discover's Actors filter - the search-result/selected-chip shape (mirrors
// `TmdbCompany`'s role for the Studio filter).
export interface TmdbPersonSearchResult {
  id: number;
  name: string;
  profile_path?: string;
  known_for_department?: string;
}

export interface TmdbPersonImagesResponse {
  profiles: TmdbImage[];
}

// One row from `/search/multi` - can be a movie, TV show, or person, hence
// `media_type` and the mostly-optional fields (only the relevant subset is
// populated depending on which type it is).
export interface TmdbSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

// One entry from the `/movie/{id}/images` or `/tv/{id}/images` endpoints -
// used to power the full-screen poster gallery on a detail page (as opposed
// to `poster_path` on the detail payload itself, which is just TMDB's single
// current pick).
export interface TmdbImage {
  file_path: string;
  width: number;
  height: number;
  iso_639_1?: string | null;
  vote_average?: number;
}

export interface TmdbImagesResponse {
  posters: TmdbImage[];
}

// A TV show's ids on other databases - specifically used to get the
// `tvdb_id` needed to add a Discover TV result into Sonarr (which keys on
// tvdbId, not tmdbId).
export interface TmdbExternalIds {
  tvdb_id?: number;
  imdb_id?: string;
}

// Fixed list powering Discover's "Studios" row (movie-only - TMDB's studio/
// production-company concept doesn't really extend to TV the way it does
// for movies) - TMDB doesn't expose a "list all studios" endpoint suitable
// for a browse UI, so this is a curated set of major/notable studios
// instead (the app's old TV-only "Network" equivalent of this was removed
// once the Streaming Service row/filter made it redundant - real watch-
// provider data, not a fixed 8-network list). Every id below was
// individually verified against TMDB's own
// company pages (not guessed) before being added - two initial guesses
// during that process turned out to resolve to entirely different
// companies, which is exactly the failure mode verifying each one guards
// against. Logos are fetched live per-id via `tmdbApi.company` (real
// `logo_path`, not hardcoded) since this list only carries id/name.
export const TMDB_STUDIOS: { id: number; name: string }[] = [
  { id: 2, name: 'Walt Disney Pictures' },
  { id: 3, name: 'Pixar' },
  { id: 420, name: 'Marvel Studios' },
  { id: 1, name: 'Lucasfilm' },
  { id: 174, name: 'Warner Bros. Pictures' },
  { id: 12, name: 'New Line Cinema' },
  { id: 33, name: 'Universal Pictures' },
  { id: 521, name: 'DreamWorks Animation' },
  { id: 4, name: 'Paramount Pictures' },
  { id: 5, name: 'Columbia Pictures' },
  { id: 25, name: '20th Century Studios' },
  { id: 923, name: 'Legendary Pictures' },
  { id: 3172, name: 'Blumhouse Productions' },
  { id: 41077, name: 'A24' },
];

// Builds a full image URL from a TMDB-relative path (e.g. `/abc123.jpg`) at
// one of TMDB's fixed CDN size buckets. Returns `undefined` unchanged so
// callers can conditionally render a placeholder when there's no image.
export function tmdbImageUrl(path: string | undefined, size: 'w45' | 'w185' | 'w342' | 'w780' = 'w342'): string | undefined {
  return path ? `${IMAGE_BASE}/${size}${path}` : undefined;
}

// Issues one TMDB v3 request with the API key attached as a query param
// (TMDB's v3 auth scheme, as opposed to the newer v4 bearer-token scheme
// this app doesn't use) and JSON-decodes the response, surfacing TMDB's own
// `status_message` field on error responses when present.
async function tmdbFetch<T>(config: ServiceConfig, path: string, params: Record<string, string> = {}): Promise<T> {
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('tmdb', config, { path, params });
  }

  const url = new URL(BASE_URL + path);
  url.searchParams.set('api_key', config.apiKey);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.status_message ?? `TMDB request failed: ${res.status}`);
  }
  return res.json();
}

export const tmdbApi = {
  // Settings' "Test Connection" check - TMDB's own auth-validation endpoint.
  testConnection: (config: ServiceConfig) => tmdbFetch(config, '/authentication'),

  trendingMovies: (config: ServiceConfig, window: 'day' | 'week' = 'week', page = 1) =>
    tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, `/trending/movie/${window}`, { page: String(page) }),

  trendingTv: (config: ServiceConfig, window: 'day' | 'week' = 'week', page = 1) =>
    tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, `/trending/tv/${window}`, { page: String(page) }),

  // Discover's "All" tab Trending row - TMDB's real combined endpoint, the
  // only one of the three preview rows with genuine server-side movie+TV
  // ranking (Popular/Upcoming have no combined equivalent - see
  // discoverCategories.ts's `interleave` helper for how those are handled
  // instead). Can return `media_type: 'person'` entries too - callers must
  // filter those out before rendering.
  trendingAll: (config: ServiceConfig, window: 'day' | 'week' = 'week', page = 1) =>
    tmdbFetch<{ results: ((TmdbMovie | TmdbTv) & { media_type: 'movie' | 'tv' | 'person' })[]; total_pages: number }>(
      config,
      `/trending/all/${window}`,
      { page: String(page) }
    ),

  popularMovies: (config: ServiceConfig, page = 1) =>
    tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/movie/popular', { page: String(page) }),

  popularTv: (config: ServiceConfig, page = 1) =>
    tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, '/tv/popular', { page: String(page) }),

  // TMDB's `/movie/upcoming` endpoint matches if ANY of a movie's many
  // release-date entries (any region, any type) falls in its internal
  // upcoming window - including regional theatrical re-releases and
  // anniversary re-issues of old catalog titles, which used to require a
  // client-side cutoff filter to hide (confirmed live: the old titles the
  // user saw were showing their real, decades-old `release_date`, TMDB's
  // own endpoint just included them anyway). Switched to the same strategy
  // Seerr uses: `/discover/movie` with `primary_release_date.gte` filters
  // on that real primary-release-date field directly, so the workaround
  // isn't needed at all - same shape as `upcomingTv` below, which already
  // used `/discover/tv` for the equivalent reason (no dedicated endpoint).
  upcomingMovies: (config: ServiceConfig, page = 1) => {
    const today = new Date().toISOString().slice(0, 10);
    return tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/discover/movie', {
      'primary_release_date.gte': today,
      sort_by: 'popularity.desc',
      region: 'US',
      page: String(page),
    });
  },

  // TV has no dedicated "/upcoming" endpoint like movies do, so this uses
  // the generic discover endpoint filtered to series first-airing today or
  // later, sorted by popularity.
  upcomingTv: (config: ServiceConfig, page = 1) => {
    const today = new Date().toISOString().slice(0, 10);
    return tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, '/discover/tv', {
      'first_air_date.gte': today,
      sort_by: 'popularity.desc',
      page: String(page),
    });
  },

  // releaseTypes are TMDB's release_dates type codes (2/3 theatrical,
  // 4 digital, 5 physical - see extractMovieReleaseInfo below). Pipe-joined
  // so multiple selected types are OR'd together, matching TMDB's own
  // with_release_type query syntax (comma = AND, pipe = OR).
  // `with_release_type` is always sent, defaulting to [2,3,4,5] when the
  // caller doesn't pass anything - omitting it entirely (the previous
  // behavior when every filter chip was selected, treated as "no filter")
  // let TMDB match type 1 ("Premiere") too, which reads as "recently
  // announced" rather than released, and is exactly the leak the user
  // reported. Theatrical/Digital/Physical is this category's whole
  // premise, so it should never be unrestricted.
  recentlyReleasedMovies: (config: ServiceConfig, page = 1, releaseTypes?: number[]) => {
    const today = new Date().toISOString().slice(0, 10);
    const types = releaseTypes && releaseTypes.length > 0 ? releaseTypes : [2, 3, 4, 5];
    const params: Record<string, string> = {
      sort_by: 'primary_release_date.desc',
      'release_date.lte': today,
      region: 'US',
      page: String(page),
      with_release_type: types.join('|'),
    };
    return tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/discover/movie', params);
  },

  // The two general-purpose Discover Movies/TV browse screens' workhorse
  // calls - `params` is a fully-built TMDB query (see
  // `src/lib/discoverFilters.ts`'s `buildDiscoverParams`), this stays a thin
  // passthrough so the filter-to-query-param mapping lives in one place.
  discoverMovies: (config: ServiceConfig, params: Record<string, string>, page = 1) =>
    tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/discover/movie', { ...params, page: String(page) }),

  discoverTv: (config: ServiceConfig, params: Record<string, string>, page = 1) =>
    tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, '/discover/tv', { ...params, page: String(page) }),

  movieGenres: (config: ServiceConfig) => tmdbFetch<{ genres: TmdbGenre[] }>(config, '/genre/movie/list').then((r) => r.genres),

  tvGenres: (config: ServiceConfig) => tmdbFetch<{ genres: TmdbGenre[] }>(config, '/genre/tv/list').then((r) => r.genres),

  searchKeywords: (config: ServiceConfig, query: string) =>
    tmdbFetch<{ results: TmdbKeyword[] }>(config, '/search/keyword', { query }).then((r) => r.results),

  // Studio picker (movie-only filter, matches Seerr's own CompanySelector).
  searchCompanies: (config: ServiceConfig, query: string) =>
    tmdbFetch<{ results: TmdbCompany[] }>(config, '/search/company', { query }).then((r) => r.results),

  watchProviders: (config: ServiceConfig, mediaType: 'movie' | 'tv', region: string) =>
    tmdbFetch<{ results: TmdbWatchProvider[] }>(config, `/watch/providers/${mediaType}`, { watch_region: region }).then(
      (r) => r.results
    ),

  watchProviderRegions: (config: ServiceConfig) =>
    tmdbFetch<{ results: TmdbWatchRegion[] }>(config, '/watch/providers/regions').then((r) => r.results),

  languages: (config: ServiceConfig) => tmdbFetch<TmdbLanguage[]>(config, '/configuration/languages'),

  // US-only, matching Seerr's own `USCertificationSelector` - TMDB's
  // certification system is genuinely per-country (different rating boards),
  // and US is this app's only real-world install base so far.
  movieCertifications: (config: ServiceConfig) =>
    tmdbFetch<{ certifications: Record<string, TmdbCertification[]> }>(config, '/certification/movie/list').then(
      (r) => r.certifications.US ?? []
    ),

  // Discover's "Studios" row - `TMDB_STUDIOS` only carries id/name, so this
  // resolves each entry's real logo (and confirms the name still matches)
  // straight from TMDB rather than hardcoding logo paths too.
  company: (config: ServiceConfig, id: number) => tmdbFetch<TmdbCompany>(config, `/company/${id}`),

  // "More Like This" row on the detail page.
  movieRecommendations: (config: ServiceConfig, id: number) =>
    tmdbFetch<{ results: TmdbMovie[] }>(config, `/movie/${id}/recommendations`),

  tvRecommendations: (config: ServiceConfig, id: number) =>
    tmdbFetch<{ results: TmdbTv[] }>(config, `/tv/${id}/recommendations`),

  // Discover's universal search bar - one endpoint covers movies, TV, and
  // people, disambiguated by each result's `media_type`.
  searchMulti: (config: ServiceConfig, query: string) =>
    tmdbFetch<{ results: TmdbSearchResult[] }>(config, '/search/multi', { query }),

  movieDetail: (config: ServiceConfig, id: number) =>
    tmdbFetch<TmdbMovieDetail>(config, `/movie/${id}`, { append_to_response: 'release_dates,credits,keywords' }),

  tvDetail: (config: ServiceConfig, id: number) =>
    tmdbFetch<TmdbTvDetail>(config, `/tv/${id}`, { append_to_response: 'aggregate_credits,keywords' }),

  // Fetches a series' external ids (specifically tvdbId) - needed before
  // adding a Discover TV result to Sonarr, since Sonarr's add endpoint
  // requires a tvdbId, not a tmdbId.
  tvExternalIds: (config: ServiceConfig, id: number) => tmdbFetch<TmdbExternalIds>(config, `/tv/${id}/external_ids`),

  // Reverse lookup: given a tvdbId (what Sonarr tracks natively), finds the
  // matching TMDB tv id. Used by `buildLibraryIndex` in `libraryStatus.ts`
  // to match Sonarr library entries against Discover's tmdbId-keyed cards.
  findByTvdbId: (config: ServiceConfig, tvdbId: number) =>
    tmdbFetch<{ tv_results: TmdbTv[] }>(config, `/find/${tvdbId}`, { external_source: 'tvdb_id' }),

  // Powers the full-screen poster gallery on the movie/series detail pages -
  // `include_image_language` widens the default (which otherwise only
  // returns textless/no-language posters) to also include English-labeled
  // ones, matching what most releases' actual poster art looks like without
  // pulling in dozens of near-duplicate foreign-language variants. TMDB
  // itself returns `posters` sorted by vote_average desc already.
  movieImages: (config: ServiceConfig, id: number) =>
    tmdbFetch<TmdbImagesResponse>(config, `/movie/${id}/images`, { include_image_language: 'en,null' }),

  tvImages: (config: ServiceConfig, id: number) =>
    tmdbFetch<TmdbImagesResponse>(config, `/tv/${id}/images`, { include_image_language: 'en,null' }),

  personDetail: (config: ServiceConfig, id: number) => tmdbFetch<TmdbPerson>(config, `/person/${id}`),

  // Powers the person filmography page - "combined" because it merges a
  // person's movie and TV credits into one response (each entry's
  // `media_type` still distinguishes them).
  personCombinedCredits: (config: ServiceConfig, id: number) =>
    tmdbFetch<{ cast: TmdbPersonCredit[]; crew: TmdbPersonCredit[] }>(config, `/person/${id}/combined_credits`),

  // Discover filter sheet's Actors search (debounced call site).
  searchPeople: (config: ServiceConfig, query: string) =>
    tmdbFetch<{ results: TmdbPersonSearchResult[] }>(config, '/search/person', { query }).then((r) => r.results),

  // Powers the person page's photo gallery, the same role `movieImages`/
  // `tvImages` play for a title's poster gallery - person images live under
  // `profiles` instead of `posters`, otherwise the same `TmdbImage` shape.
  personImages: (config: ServiceConfig, id: number) => tmdbFetch<TmdbPersonImagesResponse>(config, `/person/${id}/images`),
};
