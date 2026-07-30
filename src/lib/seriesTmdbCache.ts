import AsyncStorage from '@react-native-async-storage/async-storage';

// Persistent tvdbId -> tmdbId cache backing buildLibraryIndex's TV
// poster-badge matching (see libraryStatus.ts). A given tvdbId always
// resolves to the same tmdbId - once resolved, a show's mapping never needs
// to change - so redoing all of them on every single Discover focus is pure
// waste once a library gets into the hundreds of shows (confirmed live: a
// 143-show library was firing 143 concurrent TMDB reverse-lookup calls on
// every load, the actual bottleneck behind a slow first Discover load on a
// real deployment). Keyed by the configured Sonarr server's own baseUrl
// rather than a fixed key or the active profile id - a different server
// implies a different tvdbId space, and this avoids threading profile
// context through every buildLibraryIndex caller just for cache isolation.
function cacheKey(sonarrBaseUrl: string): string {
  return `walkerlab_series_tmdb_cache_${sonarrBaseUrl}`;
}

export async function getCachedTmdbIds(sonarrBaseUrl: string): Promise<Record<number, number>> {
  const raw = await AsyncStorage.getItem(cacheKey(sonarrBaseUrl));
  return raw ? (JSON.parse(raw) as Record<number, number>) : {};
}

// Merges newly-resolved tvdbId->tmdbId pairs into the existing cache rather
// than overwriting it, so a partial resolve (some lookups failed/timed out)
// never loses previously-cached entries.
export async function mergeCachedTmdbIds(sonarrBaseUrl: string, entries: Record<number, number>): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  const existing = await getCachedTmdbIds(sonarrBaseUrl);
  await AsyncStorage.setItem(cacheKey(sonarrBaseUrl), JSON.stringify({ ...existing, ...entries }));
}
