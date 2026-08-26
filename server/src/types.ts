// Server-side mirrors of the shapes already defined client-side in
// src/api/types.ts, src/lib/profiles.ts, src/lib/sectionNames.ts, and
// src/lib/startupScreen.ts. Duplicated rather than imported: the server is a
// standalone Node project (own package.json/tsconfig, no shared module
// resolution with the Expo app), and these types are small and change rarely
// - if you touch one side, check the other stays in sync.

export type ServiceName =
  | 'sonarr'
  | 'radarr'
  | 'lidarr'
  | 'sabnzbd'
  | 'nzbget'
  | 'tmdb'
  | 'omdb'
  | 'lastfm'
  | 'overseerr'
  | 'qbittorrent'
  | 'transmission'
  | 'tautulli'
  | 'portainer';

export interface ServiceConfig {
  baseUrl: string;
  apiKey: string;
  username?: string;
  password?: string;
  trustedCertFingerprint?: string;
}

export type SectionId =
  | 'discover'
  | 'tvShows'
  | 'movies'
  | 'music'
  | 'downloads'
  | 'nzbget'
  | 'torrents'
  | 'transmission'
  | 'spin'
  | 'requests'
  | 'stats'
  | 'containers'
  | 'settings';

export type StartupSectionId = Exclude<SectionId, 'settings'>;

export interface Profile {
  id: string;
  name: string;
}

export const DEFAULT_PROFILE_ID = 'default';

// One saved Spin wheel - see src/lib/wheels.ts for the client-side
// mirror and the "why" (denormalized snapshot, not a live Sonarr/Radarr
// reference, keyed by each service's own local id rather than tmdbId
// since Sonarr series carry no tmdbId at all).
export type WheelItemMediaType = 'movie' | 'tv';

export interface WheelItem {
  id: string;
  mediaType: WheelItemMediaType;
  // Exactly one of these is set - `libraryId` for items from the user's
  // Sonarr/Radarr library, `tmdbId` for items added from the wheel
  // builder's TMDB tab (a title not necessarily in their library at all).
  libraryId?: number;
  tmdbId?: number;
  title: string;
  posterUrl?: string;
}

export interface Wheel {
  id: string;
  name: string;
  items: WheelItem[];
  removeAfterSpin: boolean;
  // Web/multi-user only (see store.ts's getVisibleWheels/saveWheel/
  // deleteWheel) - makes this wheel visible to, and fully editable by,
  // every other user on this instance, not just its creator. Always
  // `false` and inert on native, which has no concept of other users.
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

// One login account. Every profile/service-config/etc. below is scoped
// under a user's own id, not global - multiple people can each have their
// own set of Server Profiles on one instance. `role` gates the admin-only
// user-management endpoints (create/delete other users) - there's exactly
// one admin per instance (whoever completed first-run setup), everyone
// else is a plain 'user'.
export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface SessionRecord {
  userId: string;
  expiresAt: string;
}

// One registered browser for web push notifications - a user can have more
// than one (multiple tabs/browsers), so this is an array, not a single
// value. `profileId` records which profile the subscription registered
// under (informational only - delivery is per-user, every registered
// subscription gets every notification relayed for that user, regardless
// of which profile is active on it at relay time). Web-only: native push
// (Expo push tokens) was replaced entirely by local polling - see
// src/lib/notificationPolling.ts's header comment for why - so this no
// longer needs to be a discriminated union of two platforms.
export interface PushDevice {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  profileId: string;
  registeredAt: string;
}

// This server instance's own Web Push identity (not per-user - VAPID
// identifies the sending server, and every user on one instance shares the
// same server). Generated lazily on first use, same pattern as
// getOrCreateNotificationWebhookSecret.
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// The address Sonarr/Radarr/Lidarr/Overseerr - which typically live on the
// same LAN as this server, not necessarily reachable via whatever public
// domain a browser happens to be using - should use to reach this
// WalkerLab instance's own webhook receiver. Not per-user: this describes
// the deployment's own network reachability, the same fact regardless of
// which account is logged in. Must be explicitly set by the user (no
// sensible default to guess, unlike VapidKeys' lazy generation). One
// address for every service uniformly - not derived per-service from each
// *arr app's own baseUrl (an earlier design this session that added
// complexity for no real benefit in the common case: most home-lab setups
// have every service, including this one, reachable at the same host).
export interface WebhookCallback {
  scheme: 'http' | 'https';
  host: string;
  port: number;
}

// The full at-rest shape, encrypted as one blob. Every field below `users`/
// `sessions` is keyed first by userId, then exactly the same way it was
// before multi-user support (profileId, then service/section/etc.) - see
// store.ts's own migration in initStore() for how an existing single-admin
// v1 file becomes this shape (the old admin becomes the first user, all
// their existing data moves under that user's new id, nothing is lost).
export interface StoreFile {
  v: 2;
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  profiles: Record<string, Profile[]>;
  activeProfileId: Record<string, string>;
  serviceConfigs: Record<string, Record<string, Partial<Record<ServiceName, ServiceConfig>>>>;
  sectionNames: Record<string, Record<string, Partial<Record<SectionId, string>>>>;
  serviceEnabled: Record<string, Record<string, Partial<Record<ServiceName, boolean>>>>;
  startupScreen: Record<string, Record<string, StartupSectionId>>;
  tabOrder: Record<string, Record<string, StartupSectionId[]>>;
  // Spin's saved wheels - the first per-profile ARRAY field in the store
  // (pushDevices below is array-shaped but keyed by userId only, not
  // per-profile). See src/lib/wheels.ts for the client-side mirror.
  wheels: Record<string, Record<string, Wheel[]>>;
  // Push notifications (see notificationRoutes.ts) - registered devices are
  // keyed by userId only (delivery is per-user); prefs and webhook secrets
  // follow the same userId -> profileId -> ServiceName shape as
  // serviceEnabled above, since "notify on new Sonarr episode" is a
  // per-profile-per-service concept (which Sonarr instance's webhook this
  // is) even though delivery itself isn't profile-scoped.
  pushDevices: Record<string, PushDevice[]>;
  notificationPrefs: Record<string, Record<string, Partial<Record<ServiceName, boolean>>>>;
  notificationWebhookSecrets: Record<string, Record<string, Partial<Record<ServiceName, string>>>>;
  // Not per-user - see VapidKeys' own comment above.
  vapidKeys: VapidKeys | null;
  // Not per-user - see WebhookCallback's own comment above.
  webhookCallback: WebhookCallback | null;
}

// Shape every web-only client fetch helper (arrFetch/qbittorrent/portainer)
// sends to POST /api/proxy/:profileId/:service - see src/api/webProxy.ts.
export interface ProxyRequestBody {
  path: string;
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  // The client's own in-memory config at the time of the request, merged
  // over the profile's stored config (see mergeServiceConfig.ts) before
  // dispatching. For nearly every call site this exactly mirrors the
  // stored config already (secrets are always blank client-side, so the
  // merge is a no-op) - the one place it isn't is Settings' "Test
  // Connection," which sends whatever's currently typed but not yet saved,
  // so a test can probe those values instead of always hitting whatever
  // was last saved.
  configOverride?: Partial<ServiceConfig>;
}

export function isServiceName(value: string): value is ServiceName {
  return (SERVICE_NAMES as string[]).includes(value);
}

export const SERVICE_NAMES: ServiceName[] = [
  'sonarr',
  'radarr',
  'lidarr',
  'sabnzbd',
  'nzbget',
  'tmdb',
  'omdb',
  'lastfm',
  'overseerr',
  'qbittorrent',
  'transmission',
  'tautulli',
  'portainer',
];

// Mirrors src/lib/profiles.ts's newProfileId() exactly - good enough for a
// self-hosted app with a handful of users, no need for a real UUID library.
export function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Same scheme, different prefix, for user ids - kept visually distinct from
// profile ids in logs/debugging even though nothing parses the prefix.
export function newUserId(): string {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Every new user (a brand new account, or an existing v1 install's admin
// being migrated into the first user - see store.ts's initStore()) starts
// with exactly one real, already-persisted profile, matching how a fresh
// install has always bootstrapped - src/lib/profiles.ts's client-side
// DEFAULT_PROFILES fallback only ever covers *rendering* before a real
// list is fetched, it doesn't persist anything on its own.
export const DEFAULT_PROFILES: Profile[] = [{ id: DEFAULT_PROFILE_ID, name: 'Home Lab' }];

export function emptyStore(): StoreFile {
  return {
    v: 2,
    users: {},
    sessions: {},
    profiles: {},
    activeProfileId: {},
    serviceConfigs: {},
    sectionNames: {},
    serviceEnabled: {},
    startupScreen: {},
    tabOrder: {},
    wheels: {},
    pushDevices: {},
    notificationPrefs: {},
    notificationWebhookSecrets: {},
    vapidKeys: null,
    webhookCallback: null,
  };
}
