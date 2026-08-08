// Bundles/unbundles everything that belongs to one profile into a single
// encrypted "backup code", built on top of `backupCrypto.ts`'s generic
// encrypt/decrypt. This is the one place that knows the full shape of a
// profile's data (credentials + renames + enabled services + startup
// screen) - if a new profile-scoped setting is added elsewhere, it needs to
// be added to `ProfileBackupPayload`/`SERVICE_NAMES` here too or it silently
// won't survive a backup/restore round trip.
import { Platform } from 'react-native';
import { ServiceConfig, ServiceName } from '../api/types';
import { apiFetch } from './backendApi';
import { decryptPayload, encryptPayload } from './backupCrypto';
import { SectionId, getSectionNameOverrides, setSectionNameOverrides } from './sectionNames';
import { getServiceConfig, setServiceConfig } from './storage';
import { getServiceEnabledOverrides, setServiceEnabledOverrides } from './serviceEnabled';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, setStartupScreen, StartupSectionId } from './startupScreen';

const SERVICE_NAMES: ServiceName[] = ['sonarr', 'radarr', 'lidarr', 'sabnzbd', 'nzbget', 'tmdb', 'omdb', 'overseerr', 'qbittorrent', 'tautulli', 'portainer'];

// `getServiceConfig` (storage.ts) is redacted on web - the real apiKey/
// password never reach the browser during normal use (see storage.ts's own
// comment). Backup is the one legitimate exception: it needs the real
// values to encrypt client-side, the same way native already does, or a
// web-created backup would silently contain blank credentials. This calls
// a dedicated unredacted endpoint instead (server/src/configRoutes.ts),
// used nowhere else - not a general-purpose way to read secrets back out.
async function getServiceConfigForBackup(profileId: string, name: ServiceName): Promise<ServiceConfig | null> {
  if (Platform.OS === 'web') {
    return apiFetch<ServiceConfig | null>(`/api/config/${profileId}/${name}/unredacted`);
  }
  return getServiceConfig(profileId, name);
}

interface ProfileBackupPayload {
  v: 1;
  profileName: string;
  servers: Partial<Record<ServiceName, ServiceConfig>>;
  sectionNames: Partial<Record<SectionId, string>>;
  serviceEnabled: Partial<Record<ServiceName, boolean>>;
  startupScreen: StartupSectionId;
}

/** Gathers everything that belongs to one profile - credentials, renames, enabled services, startup screen - and returns an encrypted, shareable backup code. */
export async function exportProfile(profileId: string, profileName: string, passphrase: string): Promise<string> {
  const servers: Partial<Record<ServiceName, ServiceConfig>> = {};
  for (const name of SERVICE_NAMES) {
    const config = await getServiceConfigForBackup(profileId, name);
    if (config) servers[name] = config;
  }

  const payload: ProfileBackupPayload = {
    v: 1,
    profileName,
    servers,
    sectionNames: await getSectionNameOverrides(profileId),
    serviceEnabled: await getServiceEnabledOverrides(profileId),
    startupScreen: await getStartupScreen(profileId),
  };

  return encryptPayload(passphrase, payload);
}

/** Decrypts a backup code and writes its contents into the given (already-created) profile id. Returns the profile name that was saved in the backup. */
export async function importProfileInto(profileId: string, backupCode: string, passphrase: string): Promise<string> {
  const payload = await decryptPayload<ProfileBackupPayload>(passphrase, backupCode);

  for (const name of SERVICE_NAMES) {
    const config = payload.servers?.[name];
    if (config) await setServiceConfig(profileId, name, config);
  }
  await setSectionNameOverrides(profileId, payload.sectionNames ?? {});
  await setServiceEnabledOverrides(profileId, payload.serviceEnabled ?? {});
  await setStartupScreen(profileId, payload.startupScreen ?? DEFAULT_STARTUP_SCREEN);

  return payload.profileName || 'Restored Profile';
}
