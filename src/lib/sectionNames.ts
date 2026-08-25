// Per-profile drawer/section label overrides - lets a Settings config page
// rename its nav section (e.g. renaming "TV Shows" to something else)
// without changing the underlying `SectionId` used throughout the app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';

export type SectionId =
  | 'discover'
  | 'tvShows'
  | 'movies'
  | 'music'
  | 'downloads'
  | 'nzbget'
  | 'torrents'
  | 'transmission'
  | 'requests'
  | 'stats'
  | 'containers'
  | 'settings';

// Labels shown when a profile has no override for a given section.
export const DEFAULT_SECTION_NAMES: Record<SectionId, string> = {
  discover: 'Discover',
  tvShows: 'TV Shows',
  movies: 'Movies',
  music: 'Music',
  downloads: 'Downloads',
  // Defaults to the same label as the `downloads` section - they're both
  // "your Usenet download queue" to the user, just different clients under
  // the hood. Still independently renameable per-profile like any other
  // section (Settings > NZBGet > "Rename in drawer & header") if someone
  // runs both at once and wants to tell them apart in the nav.
  nzbget: 'Downloads',
  torrents: 'Torrents',
  // Defaults to the same label as `torrents` - they're both "your torrent
  // queue" to the user, just different clients under the hood. Still
  // independently renameable per-profile like `nzbget` above.
  transmission: 'Torrents',
  requests: 'Requests',
  stats: 'Stats',
  containers: 'Containers',
  settings: 'Settings',
};

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_section_names');

// Only sections the user actually renamed are present here - anything
// missing falls back to `DEFAULT_SECTION_NAMES`. On web this is stored
// server-side (see server/src/configRoutes.ts) rather than AsyncStorage, so
// it's shared across any browser logged into the same instance rather than
// diverging per-browser.
export async function getSectionNameOverrides(profileId: string): Promise<Partial<Record<SectionId, string>>> {
  if (Platform.OS === 'web') {
    return apiFetch<Partial<Record<SectionId, string>>>(`/api/section-names/${profileId}`);
  }
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  return raw ? (JSON.parse(raw) as Partial<Record<SectionId, string>>) : {};
}

export async function setSectionNameOverrides(
  profileId: string,
  overrides: Partial<Record<SectionId, string>>
): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/section-names/${profileId}`, { method: 'PUT', body: overrides });
    return;
  }
  await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(overrides));
}
