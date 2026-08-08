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
  | 'overseerr'
  | 'qbittorrent'
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
  'overseerr',
  'qbittorrent',
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
  };
}
