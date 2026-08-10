// Last.fm client - powers the Music tab in Discover (charts, genre tags,
// artist bios/similar artists/top tracks). Last.fm's own `image` fields have
// returned a fixed placeholder for every artist for years (confirmed via
// Last.fm's own support forum, an unresolved multi-year issue) - this client
// never surfaces them. Real cover art for Music Discover comes from
// `src/api/itunes.ts` instead, resolved separately by artist name.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

export interface LastfmArtist {
  name: string;
  mbid?: string;
  listeners?: string;
  playcount?: string;
  url: string;
}

export interface LastfmTag {
  name: string;
  reach?: number;
  taggings?: number;
}

export interface LastfmSimilarArtist {
  name: string;
  mbid?: string;
  match?: string;
  url: string;
}

export interface LastfmTrack {
  name: string;
  playcount?: string;
  listeners?: string;
  url: string;
}

export interface LastfmArtistInfo {
  name: string;
  mbid?: string;
  url: string;
  stats?: { listeners?: string; playcount?: string };
  tags?: { tag?: { name: string }[] };
  bio?: { summary?: string; content?: string };
}

// Raw Last.fm response shapes (the wrapper key/nesting is Last.fm's own,
// not this app's choice) - kept private, `lastfmApi` below returns the
// unwrapped, flattened shape every caller actually wants.
interface RawTopArtists {
  artists?: { artist?: LastfmArtist[] };
  topartists?: { artist?: LastfmArtist[] };
}
interface RawTopTags {
  tags?: { tag?: LastfmTag[] };
}
interface RawArtistInfo {
  artist?: LastfmArtistInfo;
}
interface RawSimilarArtists {
  similarartists?: { artist?: LastfmSimilarArtist[] };
}
interface RawTopTracks {
  toptracks?: { track?: LastfmTrack[] };
}
interface RawSearch {
  results?: { artistmatches?: { artist?: LastfmArtist[] } };
}

// Last.fm's bio HTML is simple enough (a paragraph or two plus a trailing
// "Read more on Last.fm" link) that a basic tag-strip is enough - no need
// for a full HTML parser dependency just for this. Shared by every screen
// that shows a Last.fm bio (Discover's artist page, the Lidarr artist
// page's About section).
export function stripBioHtml(html: string): string {
  return html
    .replace(/<a[^>]*>.*?read more on last\.fm.*?<\/a>/is, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// Issues one Last.fm request with the API key + `format=json` attached
// (Last.fm defaults to XML otherwise) and JSON-decodes the response,
// surfacing Last.fm's own `{error, message}` shape on failure - Last.fm
// signals errors this way in an HTTP 200 response, not via status code.
async function lastfmFetch<T>(config: ServiceConfig, method: string, params: Record<string, string> = {}): Promise<T> {
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('lastfm', config, { path: '', params: { method, ...params } });
  }

  const url = new URL(BASE_URL);
  url.searchParams.set('api_key', config.apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('method', method);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Last.fm request failed: ${res.status}`);
  }
  const json = await res.json();
  if (json && typeof json === 'object' && 'error' in json && json.error) {
    throw new Error(json.message ?? `Last.fm error ${json.error}`);
  }
  return json;
}

export const lastfmApi = {
  // Settings' "Test Connection" check - a cheap, always-valid call that
  // needs no artist name to succeed or fail meaningfully.
  testConnection: (config: ServiceConfig) => lastfmFetch(config, 'chart.getTopArtists', { limit: '1' }),

  topArtists: (config: ServiceConfig, page = 1, limit = 20) =>
    lastfmFetch<RawTopArtists>(config, 'chart.getTopArtists', { page: String(page), limit: String(limit) }).then(
      (r) => r.artists?.artist ?? []
    ),

  topTags: (config: ServiceConfig, limit = 20) =>
    lastfmFetch<RawTopTags>(config, 'chart.getTopTags', { limit: String(limit) }).then((r) => r.tags?.tag ?? []),

  topArtistsForTag: (config: ServiceConfig, tag: string, page = 1, limit = 20) =>
    lastfmFetch<RawTopArtists>(config, 'tag.getTopArtists', { tag, page: String(page), limit: String(limit) }).then(
      (r) => r.topartists?.artist ?? []
    ),

  artistInfo: (config: ServiceConfig, name: string) =>
    lastfmFetch<RawArtistInfo>(config, 'artist.getInfo', { artist: name, autocorrect: '1' }).then((r) => r.artist ?? null),

  similarArtists: (config: ServiceConfig, name: string, limit = 12) =>
    lastfmFetch<RawSimilarArtists>(config, 'artist.getSimilar', { artist: name, limit: String(limit), autocorrect: '1' }).then(
      (r) => r.similarartists?.artist ?? []
    ),

  topTracks: (config: ServiceConfig, name: string, limit = 10) =>
    lastfmFetch<RawTopTracks>(config, 'artist.getTopTracks', { artist: name, limit: String(limit), autocorrect: '1' }).then(
      (r) => r.toptracks?.track ?? []
    ),

  // Discover's search bar, when the Music tab is active - free-text artist
  // name search against Last.fm's own catalog (broader than Lidarr's own
  // lookup, and doesn't require Lidarr to be connected at all - consistent
  // with the rest of this tab only requiring Last.fm to browse, and only
  // requiring Lidarr once you actually try to add something).
  searchArtists: (config: ServiceConfig, query: string, limit = 15) =>
    lastfmFetch<RawSearch>(config, 'artist.search', { artist: query, limit: String(limit) }).then(
      (r) => r.results?.artistmatches?.artist ?? []
    ),
};
