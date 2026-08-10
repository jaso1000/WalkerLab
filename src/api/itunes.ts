// Cover-art + New Releases for Music Discover, backed by two keyless Apple
// endpoints - chart/artist discovery data all comes from src/api/lastfm.ts
// (whose own images are broken - see that file's header comment) except
// this file's own New Releases row, which Last.fm has no equivalent for
// (its charts are popularity-based, not release-date based - no "recently
// released" concept at all).
//
// No API key, no ServiceConfig for either endpoint - there's nothing to
// configure. Native calls Apple's domains directly (no CORS restriction
// off-browser); web routes through this app's own `/api/itunes/*`
// passthrough instead, since neither endpoint sends CORS headers for
// arbitrary browser origins (verified live) - see server/src/itunesRoutes.ts.
import { Platform } from 'react-native';
import { apiFetch } from '../lib/backendApi';

const SEARCH_URL = 'https://itunes.apple.com/search';
// Apple's Marketing Tools RSS feed (the modern replacement for the old
// iTunes RSS Generator) - "most-played" is a real Top Albums chart, not a
// release-date sort (there's no such chart type - confirmed live, a
// `new-releases` slug guess 404s), but its results skew heavily toward
// genuinely new/recent albums in practice (spot-checked live: top entries
// were released days apart from the request), so it's used as this app's
// "New Releases" row.
const NEW_RELEASES_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/25/albums.json';

interface ItunesSearchResponse {
  results: { artworkUrl100?: string }[];
}

export interface AppleAlbum {
  id: string;
  name: string;
  artistName: string;
  releaseDate: string;
  artworkUrl100: string;
  url: string;
}

interface AppleChartResponse {
  feed?: { results?: AppleAlbum[] };
}

// iTunes' default artwork size is a 100x100 thumbnail; the URL's size
// segment is swappable for a larger one (a well-known, widely-relied-on
// convention for this API, confirmed against a live response this
// session), so this upsizes to a more usable tile resolution.
function upsize(url: string): string {
  return url.replace('100x100bb', '400x400bb');
}

// In-memory only (not persisted) - avoids re-querying iTunes for the same
// artist name repeatedly within a session, since chart/similar-artist rows
// commonly repeat names. Keyed by lowercased name.
const cache = new Map<string, Promise<string | undefined>>();

async function fetchArtwork(name: string): Promise<string | undefined> {
  const params = new URLSearchParams({ term: name, entity: 'album', limit: '1' });
  const json =
    Platform.OS === 'web'
      ? await apiFetch<ItunesSearchResponse>(`/api/itunes/search?${params.toString()}`)
      : await fetch(`${SEARCH_URL}?${params.toString()}`).then((res) => res.json() as Promise<ItunesSearchResponse>);
  const artworkUrl100 = json.results[0]?.artworkUrl100;
  return artworkUrl100 ? upsize(artworkUrl100) : undefined;
}

export const itunesApi = {
  searchArtistArtwork(name: string): Promise<string | undefined> {
    const key = name.trim().toLowerCase();
    if (!key) return Promise.resolve(undefined);
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchArtwork(name).catch(() => undefined);
      cache.set(key, pending);
    }
    return pending;
  },

  async newReleaseAlbums(): Promise<AppleAlbum[]> {
    try {
      const json =
        Platform.OS === 'web'
          ? await apiFetch<AppleChartResponse>('/api/itunes/new-releases')
          : await fetch(NEW_RELEASES_URL).then((res) => res.json() as Promise<AppleChartResponse>);
      return (json.feed?.results ?? []).map((a) => ({ ...a, artworkUrl100: upsize(a.artworkUrl100) }));
    } catch {
      return [];
    }
  },
};
