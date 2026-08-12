// Local-only settings for native's polling-based notifications - no server
// involved at all (see src/lib/notificationPolling.ts for why: polling
// replaced the old push/relay system specifically so nobody, ever, has to
// host anything for notifications to work). Stored with plain AsyncStorage
// keys, not profileKey()'d, since the config itself names which profile to
// poll (v1 scope is one profile, not "whichever is currently active" - see
// notificationPolling.ts's own header comment) rather than being scoped
// per-profile the way most local prefs in this app are.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ServiceName } from '../api/types';

const PREFS_KEY = 'walkerlab_notification_polling_prefs';
const LAST_SEEN_KEY = 'walkerlab_notification_last_seen';

export type PollIntervalMinutes = 15 | 30 | 60;

export interface PollingPrefs {
  profileId: string;
  intervalMinutes: PollIntervalMinutes;
  services: Partial<Record<ServiceName, boolean>>;
}

export async function getPollingPrefs(): Promise<PollingPrefs | null> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  return raw ? (JSON.parse(raw) as PollingPrefs) : null;
}

export async function setPollingPrefs(prefs: PollingPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// Highest history/request id already seen per service - the dedup cursor
// that lets a poll tell "new since last check" from "already notified
// about." A service with no entry here yet hasn't had its first-ever
// baseline check run (see checkService in notificationPolling.ts - that
// first check seeds this without notifying, so turning polling on doesn't
// immediately fire for every pre-existing item).
type LastSeenMap = Partial<Record<ServiceName, number>>;

export async function getLastSeen(): Promise<LastSeenMap> {
  const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
  return raw ? (JSON.parse(raw) as LastSeenMap) : {};
}

export async function setLastSeenForService(service: ServiceName, id: number): Promise<void> {
  const current = await getLastSeen();
  current[service] = id;
  await AsyncStorage.setItem(LAST_SEEN_KEY, JSON.stringify(current));
}
