// Shared types used across every API client module in this directory.

// Connection details for one configured service instance. Stored per-profile
// via `src/lib/storage.ts`.
export interface ServiceConfig {
  baseUrl: string;
  apiKey: string;
  // qBittorrent-only: its WebUI authenticates via a session login, not an
  // API key. Left undefined for every other service.
  username?: string;
  password?: string;
  // Portainer (currently) only: SHA-256 fingerprint of a self-signed HTTPS
  // certificate the user explicitly chose to trust, via the cert-trust
  // confirm flow on that service's Settings page (see
  // `modules/tls-trust` and `src/api/portainer.ts`'s `portainerFetch`).
  // Undefined means no cert has been pinned - requests go through the
  // normal system-trust path exactly like every other service.
  trustedCertFingerprint?: string;

  // --- Web-only fields, set by src/lib/storage.ts's web branch. Always
  // undefined on native - the real secrets live in expo-secure-store there
  // and this object holds them directly, same as always. On web, the real
  // secrets live server-side (see server/src/store.ts) and never reach the
  // browser: `apiKey`/`password` above are empty-string placeholders here,
  // and these fields tell the Settings screen whether a secret is actually
  // set server-side so it can show "configured - tap to replace" instead of
  // a blank field. `profileId` lets the low-level fetch helpers
  // (arrFetch/qbittorrent/portainer) know which profile's stored config to
  // proxy through without threading it through every API-client call site.
  isConfigured?: boolean;
  hasApiKey?: boolean;
  hasPassword?: boolean;
  profileId?: string;
}

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

// A single searchable release result from Sonarr/Radarr's interactive
// release-search endpoint (what you see when manually searching for a
// specific episode/movie release instead of waiting for automatic grab).
export interface ArrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  age: number;
  seeders?: number;
  quality: { quality: { name: string } };
  rejected: boolean;
  rejections?: string[];
}
