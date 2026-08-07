// Persistent cache for Discover's Streaming Service/Studios rows
// (`app/discover.tsx`). Added after the user reported Discover feeling
// noticeably slower once those rows shipped - root cause: the "All" tab's
// own load function re-fetches on *every* focus (pre-existing behavior for
// Trending/Popular/Upcoming, but now also re-fetching watch-providers for
// both movie and tv every single time, e.g. every back-navigation from a
// detail page), and Studios resolves 14 real TMDB `/company/{id}` calls the
// first time it loads. Both are genuinely slow-changing data (a studio's
// logo essentially never changes; a region's streaming catalog shifts
// occasionally, not by the minute), so caching them in AsyncStorage with a
// generous TTL trades a small amount of staleness for skipping the network
// round-trip entirely on a cache hit - including across app restarts, which
// an in-memory-only cache (e.g. a ref) wouldn't cover.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LogoRowItem } from '../components/LogoRow';

interface CacheEntry {
  items: LogoRowItem[];
  cachedAt: number;
}

const STUDIOS_KEY = 'walkerlab_cache_studios';
const STUDIOS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - studio logos are effectively static

const PROVIDERS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day - streaming catalogs shift, but not by the minute
const providersKeyFor = (mediaType: string, region: string) => `walkerlab_cache_providers_${mediaType}_${region}`;

async function readCache(key: string, ttlMs: number): Promise<LogoRowItem[] | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.items;
  } catch {
    return null;
  }
}

async function writeCache(key: string, items: LogoRowItem[]): Promise<void> {
  const entry: CacheEntry = { items, cachedAt: Date.now() };
  await AsyncStorage.setItem(key, JSON.stringify(entry));
}

export const getCachedStudios = () => readCache(STUDIOS_KEY, STUDIOS_TTL_MS);
export const setCachedStudios = (items: LogoRowItem[]) => writeCache(STUDIOS_KEY, items);

export const getCachedProviders = (mediaType: string, region: string) => readCache(providersKeyFor(mediaType, region), PROVIDERS_TTL_MS);
export const setCachedProviders = (mediaType: string, region: string, items: LogoRowItem[]) =>
  writeCache(providersKeyFor(mediaType, region), items);
