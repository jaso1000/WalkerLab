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

// A TV show's ids on other databases - specifically used to get the
// `tvdb_id` needed to add a Discover TV result into Sonarr (which keys on
// tvdbId, not tmdbId).
export interface TmdbExternalIds {
  tvdb_id?: number;
  imdb_id?: string;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  color: string;
}

// Fixed list powering Discover's "Browse by Network" filter bar (TV only) -
// TMDB doesn't expose a clean "list all networks" endpoint suitable for a
// browse UI, so this is a curated set of the major streaming networks with
// their real brand colors, matched against TMDB's own numeric network ids.
export const TMDB_NETWORKS: TmdbNetwork[] = [
  { id: 213, name: 'Netflix', color: '#E50914' },
  { id: 2739, name: 'Disney+', color: '#113CCF' },
  { id: 3186, name: 'HBO Max', color: '#8E44EF' },
  { id: 1024, name: 'Prime Video', color: '#00A8E1' },
  { id: 2552, name: 'Apple TV+', color: '#A3AAAE' },
  { id: 453, name: 'Hulu', color: '#1CE783' },
  { id: 4330, name: 'Paramount+', color: '#0064FF' },
  { id: 3353, name: 'Peacock', color: '#F5A623' },
];

// Builds a full image URL from a TMDB-relative path (e.g. `/abc123.jpg`) at
// one of TMDB's fixed CDN size buckets. Returns `undefined` unchanged so
// callers can conditionally render a placeholder when there's no image.
export function tmdbImageUrl(path: string | undefined, size: 'w185' | 'w342' | 'w780' = 'w342'): string | undefined {
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

  popularMovies: (config: ServiceConfig, page = 1) =>
    tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/movie/popular', { page: String(page) }),

  popularTv: (config: ServiceConfig, page = 1) =>
    tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, '/tv/popular', { page: String(page) }),

  // TMDB's `/movie/upcoming` endpoint matches if ANY of a movie's many
  // release-date entries (any region, any type) falls in its internal
  // upcoming window - including regional theatrical re-releases and
  // anniversary re-issues of old catalog titles. The plain `release_date`
  // field on each result stays that movie's real primary release date
  // though (e.g. a 1984 film re-released this year still reports
  // "1984-10-26"), so filtering out results whose own `release_date` isn't
  // actually recent/near-future reliably excludes these without a second
  // API call per movie - confirmed this is what was happening (not
  // guessed): the old titles the user saw were showing their real,
  // decades-old year on the card, TMDB's own endpoint just included them.
  upcomingMovies: async (config: ServiceConfig, page = 1) => {
    const data = await tmdbFetch<{ results: TmdbMovie[]; total_pages: number }>(config, '/movie/upcoming', {
      page: String(page),
      region: 'US',
    });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return { ...data, results: data.results.filter((m) => !m.release_date || new Date(m.release_date) >= cutoff) };
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

  // Discover's "Browse by Network" screen - one TMDB network id per pill.
  tvByNetwork: (config: ServiceConfig, networkId: number, page = 1) =>
    tmdbFetch<{ results: TmdbTv[]; total_pages: number }>(config, '/discover/tv', {
      with_networks: String(networkId),
      sort_by: 'popularity.desc',
      page: String(page),
    }),

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

  personDetail: (config: ServiceConfig, id: number) => tmdbFetch<TmdbPerson>(config, `/person/${id}`),

  // Powers the person filmography page - "combined" because it merges a
  // person's movie and TV credits into one response (each entry's
  // `media_type` still distinguishes them).
  personCombinedCredits: (config: ServiceConfig, id: number) =>
    tmdbFetch<{ cast: TmdbPersonCredit[]; crew: TmdbPersonCredit[] }>(config, `/person/${id}/combined_credits`),
};
