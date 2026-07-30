// Per-profile "which screen opens first" setting - Settings can't itself be
// the startup screen (hence excluding 'settings' from `SectionId`), since
// there'd be nothing useful to land on immediately after opening the app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';
import { SectionId } from './sectionNames';

export type StartupSectionId = Exclude<SectionId, 'settings'>;

export const DEFAULT_STARTUP_SCREEN: StartupSectionId = 'tvShows';

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_startup_screen');

// Maps each eligible section to the Expo Router path it opens on launch.
const ROUTE_FOR: Record<StartupSectionId, string> = {
  discover: '/discover',
  tvShows: '/',
  movies: '/movies',
  downloads: '/downloads',
  torrents: '/torrents',
  requests: '/overseerr',
  stats: '/tautulli',
  containers: '/containers',
};

// Guards against a stored value that no longer maps to a real section (e.g.
// after a code change), falling back to the default rather than crashing
// the router.
const VALID_IDS = new Set<string>(Object.keys(ROUTE_FOR));

// On web this is stored server-side (see server/src/configRoutes.ts) rather
// than AsyncStorage, so it's shared across any browser logged into the same
// instance.
export async function getStartupScreen(profileId: string): Promise<StartupSectionId> {
  if (Platform.OS === 'web') {
    const res = await apiFetch<{ id: StartupSectionId | null }>(`/api/startup-screen/${profileId}`);
    return res.id && VALID_IDS.has(res.id) ? res.id : DEFAULT_STARTUP_SCREEN;
  }
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  return raw && VALID_IDS.has(raw) ? (raw as StartupSectionId) : DEFAULT_STARTUP_SCREEN;
}

export async function setStartupScreen(profileId: string, id: StartupSectionId): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/startup-screen/${profileId}`, { method: 'PUT', body: { id } });
    return;
  }
  await AsyncStorage.setItem(keyFor(profileId), id);
}

export function startupRoute(id: StartupSectionId): string {
  return ROUTE_FOR[id];
}
