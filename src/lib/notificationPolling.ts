// Native-only polling-based notifications - replaces the old push/relay
// system for native specifically (web keeps real push, see src/lib/
// notificationsApi.web.ts - it's always talking to an already-hosted
// server so it doesn't have this problem). A phone can't receive an
// inbound webhook directly, and the only two ways to give it one (every
// user self-hosts a relay, or WalkerLab's developer hosts one shared relay
// for everyone) were both explicitly rejected - so instead the app itself
// polls Sonarr/Radarr/Lidarr/Overseerr's own APIs on an interval, the same
// kind of call it already makes for every other screen, and fires a local
// (not push) notification when something's new. Nothing needs to be
// reachable by anything.
//
// expo-background-task/expo-task-manager both ship real web builds (no-op
// stubs - confirmed in node_modules before relying on this), so this
// module is safe to import from shared files like app/_layout.tsx without
// a .web.ts split; callers still gate the actual function calls behind
// Platform.OS !== 'web' since running them there is meaningless, not
// because importing would break the web bundle.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { lidarrApi } from '../api/lidarr';
import { overseerrApi } from '../api/overseerr';
import { radarrApi } from '../api/radarr';
import { sonarrApi } from '../api/sonarr';
import { ServiceConfig, ServiceName } from '../api/types';
import { getLastSeen, getPollingPrefs, PollIntervalMinutes, setLastSeenForService } from './notificationPrefs';
import { getServiceConfig } from './storage';

const TASK_NAME = 'walkerlab-notification-poll';

interface NewItem {
  id: number;
  title: string;
  body: string;
}

interface CheckResult {
  items: NewItem[];
  newestId: number | undefined;
}

// Sonarr and Radarr both use this exact camelCase event name for a
// completed import - confirmed directly against each project's own C#
// history-event enum this session (both declare DownloadFolderImported),
// not guessed from the webhook payload's differently-named eventType.
const IMPORT_EVENT_SONARR_RADARR = 'downloadFolderImported';
// Lidarr's own enum has two plausible candidates for a completed track/
// album import (TrackFileImported, DownloadImported) - accepts both since
// which one actually appears in a real instance's history couldn't be
// confirmed without live-testing, the same caveat already flagged
// elsewhere in this codebase for Lidarr's webhook event names.
const IMPORT_EVENTS_LIDARR = ['trackFileImported', 'downloadImported'];

async function checkSonarr(config: ServiceConfig, lastSeenId: number | undefined): Promise<CheckResult> {
  const { records } = await sonarrApi.getHistory(config, 25);
  const relevant = records.filter((r) => r.eventType === IMPORT_EVENT_SONARR_RADARR);
  const items =
    lastSeenId === undefined
      ? []
      : relevant
          .filter((r) => r.id > lastSeenId)
          .map((r) => {
            const tag = r.episode ? `S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')}` : undefined;
            const body = [r.series?.title, tag, r.episode?.title].filter(Boolean).join(' - ');
            return { id: r.id, title: 'New Episode Downloaded', body: body || r.sourceTitle };
          });
  return { items, newestId: relevant[0]?.id };
}

async function checkRadarr(config: ServiceConfig, lastSeenId: number | undefined): Promise<CheckResult> {
  const { records } = await radarrApi.getHistory(config, 25);
  const relevant = records.filter((r) => r.eventType === IMPORT_EVENT_SONARR_RADARR);
  const items =
    lastSeenId === undefined
      ? []
      : relevant.filter((r) => r.id > lastSeenId).map((r) => ({ id: r.id, title: 'New Movie Downloaded', body: r.movie?.title ?? r.sourceTitle }));
  return { items, newestId: relevant[0]?.id };
}

async function checkLidarr(config: ServiceConfig, lastSeenId: number | undefined): Promise<CheckResult> {
  const { records } = await lidarrApi.getHistory(config, 25);
  const relevant = records.filter((r) => IMPORT_EVENTS_LIDARR.includes(r.eventType));
  const items =
    lastSeenId === undefined
      ? []
      : relevant
          .filter((r) => r.id > lastSeenId)
          .map((r) => {
            const body = r.album?.title ? [r.artist?.artistName, r.album.title].filter(Boolean).join(' - ') : r.sourceTitle;
            return { id: r.id, title: 'New Album Downloaded', body };
          });
  return { items, newestId: relevant[0]?.id };
}

async function checkOverseerr(config: ServiceConfig, lastSeenId: number | undefined): Promise<CheckResult> {
  const { results } = await overseerrApi.getRequests(config, 'pending', 1, 25);
  const items =
    lastSeenId === undefined
      ? []
      : results
          .filter((r) => r.id > lastSeenId)
          .map((r) => ({ id: r.id, title: 'New Request', body: `${r.type === 'movie' ? 'Movie' : 'TV'} request from ${r.requestedBy.displayName}` }));
  return { items, newestId: results[0]?.id };
}

type CheckFn = (config: ServiceConfig, lastSeenId: number | undefined) => Promise<CheckResult>;

const CHECKERS: Partial<Record<ServiceName, CheckFn>> = {
  sonarr: checkSonarr,
  radarr: checkRadarr,
  lidarr: checkLidarr,
  overseerr: checkOverseerr,
};

export async function hasNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.status === 'granted';
}

// Only ever called from a real UI moment (the settings screen's own
// enable/save action) - never from inside the background task itself,
// since a backgrounded task can't show a system permission dialog anyway.
export async function requestNotificationPermission(): Promise<boolean> {
  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
}

async function notify(items: NewItem[]): Promise<void> {
  if (items.length === 0) return;
  if (items.length === 1) {
    await Notifications.scheduleNotificationAsync({ content: { title: items[0].title, body: items[0].body }, trigger: null });
    return;
  }
  // More than one new item in a single check gets one combined summary
  // notification, not a flood of individual ones.
  const preview = items
    .slice(0, 3)
    .map((i) => i.body)
    .join(', ');
  await Notifications.scheduleNotificationAsync({
    content: { title: 'WalkerLab', body: `${items.length} new items - ${preview}${items.length > 3 ? '…' : ''}` },
    trigger: null,
  });
}

// The one poll function used both by the background task and by the
// immediate check app/_layout.tsx runs on launch. Safe to call with no
// prefs saved yet or no services enabled (no-ops).
export async function checkForNewContent(): Promise<void> {
  const prefs = await getPollingPrefs();
  if (!prefs) return;
  const enabledServices = (Object.keys(prefs.services) as ServiceName[]).filter((s) => prefs.services[s] && CHECKERS[s]);
  if (enabledServices.length === 0) return;

  const lastSeen = await getLastSeen();
  const allNewItems: NewItem[] = [];

  for (const service of enabledServices) {
    const config = await getServiceConfig(prefs.profileId, service);
    if (!config) continue;
    const checker = CHECKERS[service]!;
    try {
      const { items, newestId } = await checker(config, lastSeen[service]);
      allNewItems.push(...items);
      // A service with nothing in its history page at all (newestId
      // undefined) leaves the cursor alone - nothing to baseline from yet.
      if (newestId !== undefined) await setLastSeenForService(service, newestId);
    } catch (e) {
      console.warn(`[notificationPolling] check failed for ${service}:`, e);
    }
  }

  if (await hasNotificationPermission()) await notify(allNewItems);
}

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await checkForNewContent();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.error('[notificationPolling] background task failed:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Registering an already-registered task just updates its interval -
// idempotent, safe to call on every app launch (see app/_layout.tsx).
export async function registerBackgroundPolling(intervalMinutes: PollIntervalMinutes): Promise<void> {
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: intervalMinutes });
}

export async function unregisterBackgroundPolling(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
}

export async function isBackgroundPollingRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(TASK_NAME);
}
