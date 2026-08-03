// Per-profile "side drawer vs bottom tabs" navigation style setting -
// mirrors `startupScreen.ts`'s exact storage pattern (native AsyncStorage,
// web via the backend so it's shared across any browser logged into the
// same instance). Deliberately not a live/hot-swappable setting - see
// `app/(drawer)/_layout.tsx`'s own comments for why changing this only
// takes effect on the next app launch/reload, not in place.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';

export type NavigationStyle = 'drawer' | 'tabs';

export const DEFAULT_NAVIGATION_STYLE: NavigationStyle = 'drawer';

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_navigation_style');

const VALID_STYLES = new Set<string>(['drawer', 'tabs']);

export async function getNavigationStyle(profileId: string): Promise<NavigationStyle> {
  if (Platform.OS === 'web') {
    const res = await apiFetch<{ style: NavigationStyle | null }>(`/api/navigation-style/${profileId}`);
    return res.style && VALID_STYLES.has(res.style) ? res.style : DEFAULT_NAVIGATION_STYLE;
  }
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  return raw && VALID_STYLES.has(raw) ? (raw as NavigationStyle) : DEFAULT_NAVIGATION_STYLE;
}

export async function setNavigationStyle(profileId: string, style: NavigationStyle): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/navigation-style/${profileId}`, { method: 'PUT', body: { style } });
    return;
  }
  await AsyncStorage.setItem(keyFor(profileId), style);
}
