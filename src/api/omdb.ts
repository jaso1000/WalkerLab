// OMDb client - the only free source this app has for Rotten Tomatoes and
// Metacritic ratings (TMDB doesn't provide either). Note RT data is
// confirmed-missing for TV series on OMDb's side, a known upstream
// limitation, not a bug here.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

const BASE_URL = 'https://www.omdbapi.com/';

export interface OmdbRatings {
  imdbRating?: number;
  rottenTomatoes?: number;
  metacritic?: number;
}

interface OmdbRawResponse {
  Response: 'True' | 'False';
  Error?: string;
  imdbRating?: string;
  Ratings?: { Source: string; Value: string }[];
}

// Issues one OMDb request with the API key attached, decoding the JSON
// response. OMDb signals failures via `Response: 'False'` in a 200 response
// rather than an HTTP error status, so callers must check that field too.
async function omdbFetch(config: ServiceConfig, params: Record<string, string>): Promise<OmdbRawResponse> {
  if (Platform.OS === 'web') {
    return webProxyFetch<OmdbRawResponse>('omdb', config, { path: '', params });
  }

  const url = new URL(BASE_URL);
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`OMDb request failed: ${res.status}`);
  }
  return res.json();
}

// Extracts and normalizes the three ratings this app cares about out of
// OMDb's raw response shape (IMDb rating is a top-level field; RT/Metacritic
// are buried in a `Ratings` array keyed by source name and need their
// "%"/"X/10" suffixes stripped to become plain numbers).
function parseRatings(raw: OmdbRawResponse): OmdbRatings {
  const imdbRating = raw.imdbRating && raw.imdbRating !== 'N/A' ? Number(raw.imdbRating) : undefined;
  const rtValue = raw.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value;
  const rottenTomatoes = rtValue ? Number(rtValue.replace('%', '')) : undefined;
  const metacriticValue = raw.Ratings?.find((r) => r.Source === 'Metacritic')?.Value;
  const metacritic = metacriticValue ? Number(metacriticValue.split('/')[0]) : undefined;
  return {
    imdbRating: imdbRating !== undefined && !Number.isNaN(imdbRating) ? imdbRating : undefined,
    rottenTomatoes: rottenTomatoes !== undefined && !Number.isNaN(rottenTomatoes) ? rottenTomatoes : undefined,
    metacritic: metacritic !== undefined && !Number.isNaN(metacritic) ? metacritic : undefined,
  };
}

export const omdbApi = {
  // Settings' "Test Connection" check - looks up a fixed, always-valid IMDb
  // id (The Shawshank Redemption) just to confirm the API key itself works.
  testConnection: async (config: ServiceConfig) => {
    const raw = await omdbFetch(config, { i: 'tt0111161' });
    if (raw.Response === 'False') throw new Error(raw.Error ?? 'Invalid API key');
    return raw;
  },

  // Looks up ratings for a title by its IMDb id. Returns `null` (not a
  // thrown error) when OMDb has no record for that id, since that's a
  // normal/expected case (e.g. a title too new or obscure for OMDb).
  byImdbId: async (config: ServiceConfig, imdbId: string): Promise<OmdbRatings | null> => {
    const raw = await omdbFetch(config, { i: imdbId });
    if (raw.Response === 'False') return null;
    return parseRatings(raw);
  },
};
