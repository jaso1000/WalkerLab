// Small, non-sensitive per-screen UI preferences (sort order, group-headers
// toggle, last-used quality profile) - kept in plain AsyncStorage rather than
// SecureStore since none of it is credential data. Not currently
// profile-scoped like `storage.ts`/`sectionNames.ts` are.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SortPreference {
  sortKey: string;
  sortAsc: boolean;
}

// `scope` is a caller-chosen string (e.g. "movies", "tvShows") so each list
// screen gets its own independent sort/group/quality-profile memory.
const sortKeyFor = (scope: string) => `walkerlab_sort_${scope}`;
const groupKeyFor = (scope: string) => `walkerlab_group_${scope}`;
const qualityProfileKeyFor = (scope: string) => `walkerlab_last_quality_profile_${scope}`;

// Reads the remembered sort key/direction for a given list screen, or `null`
// if the user hasn't changed it from the default yet.
export async function getSortPreference(scope: string): Promise<SortPreference | null> {
  const raw = await AsyncStorage.getItem(sortKeyFor(scope));
  return raw ? (JSON.parse(raw) as SortPreference) : null;
}

export async function setSortPreference(scope: string, pref: SortPreference): Promise<void> {
  await AsyncStorage.setItem(sortKeyFor(scope), JSON.stringify(pref));
}

// Whether a list screen should render its items under group/section headers.
// Defaults to `true` (on) when nothing's been stored yet.
export async function getGroupHeaders(scope: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(groupKeyFor(scope));
  return raw === null ? true : raw === 'true';
}

export async function setGroupHeaders(scope: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(groupKeyFor(scope), String(value));
}

// Remembers the last quality profile used when adding a movie/series, so
// future adds (including Discover's quick-add) default to it instead of
// always falling back to whatever profile happens to be first in the list.
export async function getLastQualityProfileId(scope: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(qualityProfileKeyFor(scope));
  return raw ? Number(raw) : null;
}

export async function setLastQualityProfileId(scope: string, id: number): Promise<void> {
  await AsyncStorage.setItem(qualityProfileKeyFor(scope), String(id));
}

// Discover's "streaming availability" region (TMDB watch-provider filter,
// Streaming Service row) - set from Settings > TMDB (Discover)'s "Default
// Region" picker. Falls back to `FALLBACK_WATCH_REGION` when the user
// hasn't picked one yet, not TMDB's own US-centric default - most of this
// app's actual install base isn't in the US.
const DEFAULT_REGION_KEY = 'walkerlab_default_region';
export const FALLBACK_WATCH_REGION = 'AU';

export async function getDefaultRegion(): Promise<string> {
  const raw = await AsyncStorage.getItem(DEFAULT_REGION_KEY);
  return raw || FALLBACK_WATCH_REGION;
}

export async function setDefaultRegion(code: string): Promise<void> {
  await AsyncStorage.setItem(DEFAULT_REGION_KEY, code);
}
