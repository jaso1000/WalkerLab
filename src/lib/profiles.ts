// Storage for the list of profiles themselves (id/name pairs) and which one
// is currently active - NOT the profile-scoped data those profiles actually
// hold (that lives behind `profileKey()` in each profile-scoped module).
// `ProfilesContext.tsx` is the only consumer that should call these directly.
//
// On web, this list must live server-side (not browser storage) even though
// it isn't sensitive data itself: every service config in the encrypted
// backend store (server/src/store.ts) is keyed by profile id, so a second
// browser logging into the same instance needs to see the same profile list
// the first one created - a per-browser localStorage copy would silently
// diverge. The backend's GET/PUT /api/profiles mirror this file's whole-list
// get/set contract exactly, so ProfilesContext.tsx needs no changes.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { DEFAULT_PROFILE_ID } from './profileStorage';

export interface Profile {
  id: string;
  name: string;
}

const PROFILES_KEY = 'walkerlab_profiles';
const ACTIVE_PROFILE_KEY = 'walkerlab_active_profile_id';

// Every install starts with exactly one profile - the implicit "default" one
// that aliases to the pre-profiles legacy storage keys (see `profileKey()`).
const DEFAULT_PROFILES: Profile[] = [{ id: DEFAULT_PROFILE_ID, name: 'Home Lab' }];

export async function getProfiles(): Promise<Profile[]> {
  if (Platform.OS === 'web') {
    const profiles = await apiFetch<Profile[]>('/api/profiles');
    return profiles.length > 0 ? profiles : DEFAULT_PROFILES;
  }
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  if (!raw) return DEFAULT_PROFILES;
  const parsed = JSON.parse(raw) as Profile[];
  return parsed.length > 0 ? parsed : DEFAULT_PROFILES;
}

export async function setProfiles(profiles: Profile[]): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch('/api/profiles', { method: 'PUT', body: profiles });
    return;
  }
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export async function getActiveProfileId(): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await apiFetch<{ id: string }>('/api/profiles/active');
    return res.id;
  }
  const raw = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
  return raw ?? DEFAULT_PROFILE_ID;
}

export async function setActiveProfileId(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch('/api/profiles/active', { method: 'PUT', body: { id } });
    return;
  }
  await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

// Generates a short, collision-resistant id for a newly created profile
// (timestamp + random suffix, both base36) - good enough for a single-user
// local app, no need for a real UUID library. Used on web too (the client
// still assigns the id, matching native, rather than the backend assigning
// one - see configRoutes.ts's comment).
export function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
