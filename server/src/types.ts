// Server-side mirrors of the shapes already defined client-side in
// src/api/types.ts, src/lib/profiles.ts, src/lib/sectionNames.ts, and
// src/lib/startupScreen.ts. Duplicated rather than imported: the server is a
// standalone Node project (own package.json/tsconfig, no shared module
// resolution with the Expo app), and these types are small and change rarely
// - if you touch one side, check the other stays in sync.

export type ServiceName =
  | 'sonarr'
  | 'radarr'
  | 'sabnzbd'
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
  | 'downloads'
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

export interface AdminRecord {
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRecord {
  expiresAt: string;
}

// The full at-rest shape, encrypted as one blob. Only `admin`/`sessions` are
// populated by Phase 1 (auth) - the rest is filled in by Phase 2 (config
// storage) but declared now so the store's shape doesn't need to change
// shape later.
export interface StoreFile {
  v: 1;
  admin?: AdminRecord;
  sessions: Record<string, SessionRecord>;
  profiles: Profile[];
  activeProfileId: string;
  serviceConfigs: Record<string, Partial<Record<ServiceName, ServiceConfig>>>;
  sectionNames: Record<string, Partial<Record<SectionId, string>>>;
  serviceEnabled: Record<string, Partial<Record<ServiceName, boolean>>>;
  startupScreen: Record<string, StartupSectionId>;
}

// Shape every web-only client fetch helper (arrFetch/qbittorrent/portainer)
// sends to POST /api/proxy/:profileId/:service - see src/api/webProxy.ts.
export interface ProxyRequestBody {
  path: string;
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
}

export function isServiceName(value: string): value is ServiceName {
  return (SERVICE_NAMES as string[]).includes(value);
}

export const SERVICE_NAMES: ServiceName[] = [
  'sonarr',
  'radarr',
  'sabnzbd',
  'tmdb',
  'omdb',
  'overseerr',
  'qbittorrent',
  'tautulli',
  'portainer',
];

// Mirrors src/lib/profiles.ts's newProfileId() exactly - good enough for a
// single-admin app, no need for a real UUID library.
export function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyStore(): StoreFile {
  return {
    v: 1,
    sessions: {},
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Home Lab' }],
    activeProfileId: DEFAULT_PROFILE_ID,
    serviceConfigs: {},
    sectionNames: {},
    serviceEnabled: {},
    startupScreen: {},
  };
}
