// Per-profile, per-service credential storage (URL/API key/username-password
// as applicable) - the most sensitive data in the app. Native uses the
// OS-backed secure store directly, same as always. Web routes through this
// app's own Node backend (server/) instead of browser storage: on a Docker
// deployment reachable from the internet, real secrets must never reach the
// browser at all - see server/src/store.ts for where they actually live,
// encrypted at rest. (This replaces the old plaintext-localStorage web
// fallback that existed before a real backend did.)
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ServiceConfig, ServiceName } from '../api/types';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';

const keyFor = (profileId: string, name: ServiceName) => profileKey(profileId, `walkerlab_${name}_config`);

// Shape of GET /api/config/:profileId/:service's response - see
// server/src/configRoutes.ts. Never carries `apiKey`/`password` themselves.
interface RedactedConfigResponse {
  isConfigured: boolean;
  baseUrl?: string;
  hasApiKey?: boolean;
  hasPassword?: boolean;
  username?: string;
  trustedCertFingerprint?: string;
}

async function getServiceConfigWeb(profileId: string, name: ServiceName): Promise<ServiceConfig | null> {
  const res = await apiFetch<RedactedConfigResponse>(`/api/config/${profileId}/${name}`);
  if (!res.isConfigured) return null;
  return {
    baseUrl: res.baseUrl ?? '',
    // Real secrets never leave the backend - these are blank placeholders;
    // `hasApiKey`/`hasPassword` tell the Settings screen a secret IS set
    // server-side so it can show "configured - leave blank to keep" instead
    // of implying nothing's saved.
    apiKey: '',
    username: res.username,
    password: res.hasPassword ? '' : undefined,
    trustedCertFingerprint: res.trustedCertFingerprint,
    isConfigured: true,
    hasApiKey: res.hasApiKey,
    hasPassword: res.hasPassword,
    profileId,
  };
}

// A blank `apiKey`/`password` here means "leave whatever's already stored
// alone" (mirrors the backend's own PUT contract in configRoutes.ts) -
// there's deliberately no separate "did the user touch this field" tracking
// needed client-side, since "blank" and "unchanged" already mean the same
// thing on both ends of this call.
async function setServiceConfigWeb(profileId: string, name: ServiceName, config: ServiceConfig): Promise<void> {
  await apiFetch(`/api/config/${profileId}/${name}`, {
    method: 'PUT',
    body: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey || undefined,
      username: config.username,
      password: config.password || undefined,
      trustedCertFingerprint: config.trustedCertFingerprint,
    },
  });
}

async function clearServiceConfigWeb(profileId: string, name: ServiceName): Promise<void> {
  await apiFetch(`/api/config/${profileId}/${name}`, { method: 'DELETE' });
}

export async function getServiceConfig(profileId: string, name: ServiceName): Promise<ServiceConfig | null> {
  if (Platform.OS === 'web') return getServiceConfigWeb(profileId, name);
  const raw = await SecureStore.getItemAsync(keyFor(profileId, name));
  return raw ? (JSON.parse(raw) as ServiceConfig) : null;
}

export async function setServiceConfig(profileId: string, name: ServiceName, config: ServiceConfig): Promise<void> {
  if (Platform.OS === 'web') return setServiceConfigWeb(profileId, name, config);
  await SecureStore.setItemAsync(keyFor(profileId, name), JSON.stringify(config));
}

export async function clearServiceConfig(profileId: string, name: ServiceName): Promise<void> {
  if (Platform.OS === 'web') return clearServiceConfigWeb(profileId, name);
  await SecureStore.deleteItemAsync(keyFor(profileId, name));
}
