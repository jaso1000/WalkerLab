// Per-profile enabled/disabled flags for each service - a disabled service's
// nav section is hidden from the hamburger drawer entirely (see
// `serviceForSection` in `serviceMeta.ts`).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ServiceName } from '../api/types';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_service_enabled');

// Absent from the stored overrides means enabled - only explicit `false`
// entries are persisted, so existing installs default to everything on. On
// web this is stored server-side (see server/src/configRoutes.ts) rather
// than AsyncStorage, so it's shared across any browser logged into the same
// instance.
export async function getServiceEnabledOverrides(profileId: string): Promise<Partial<Record<ServiceName, boolean>>> {
  if (Platform.OS === 'web') {
    return apiFetch<Partial<Record<ServiceName, boolean>>>(`/api/service-enabled/${profileId}`);
  }
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  return raw ? (JSON.parse(raw) as Partial<Record<ServiceName, boolean>>) : {};
}

export async function setServiceEnabledOverrides(
  profileId: string,
  overrides: Partial<Record<ServiceName, boolean>>
): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/service-enabled/${profileId}`, { method: 'PUT', body: overrides });
    return;
  }
  await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(overrides));
}
