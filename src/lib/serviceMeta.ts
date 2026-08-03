import { Ionicons } from '@expo/vector-icons';
import { ServiceName } from '../api/types';
import { colors } from '../theme/colors';
import { StartupSectionId } from './startupScreen';

// Static per-service metadata driving the Settings screen: what each
// service's config page shows (description, placeholder URL, examples),
// which nav section it owns (if any), and a couple of auth-shape flags for
// services that don't fit the common "URL + API key" mold (qBittorrent's
// username/password session auth).
export interface ServiceMeta {
  name: ServiceName;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  description: string;
  requiresUrl: boolean;
  placeholder: string;
  urlExamples?: string[];
  signupUrl?: string;
  /** The nav section this service drives — lets its config page own that section's rename + startup-screen controls. */
  sectionId?: StartupSectionId;
  /** Shows Username/Password fields for services (qBittorrent) whose WebUI authenticates via session login instead of an API key. */
  usesCredentials?: boolean;
  /** When true, the API Key field isn't required to save/test (e.g. it's just an alternate auth path for a reverse proxy). */
  apiKeyOptional?: boolean;
  /** Shows the cert-trust section (Settings screen) for services whose self-signed HTTPS cert may need an explicit, user-reviewed trust decision - see `ServiceConfig.trustedCertFingerprint`. */
  supportsCertTrust?: boolean;
}

// One entry per supported service, in the order they appear on the Settings
// list. Order here is purely display order and has no other effect.
export const SERVICE_META: ServiceMeta[] = [
  {
    name: 'sonarr',
    label: 'Sonarr',
    icon: 'tv-outline',
    tint: colors.sonarr,
    description:
      "Sonarr manages your TV library — it monitors your shows, automatically grabs new episodes as they're released, and keeps files organized once they're downloaded.",
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:8989',
    urlExamples: ['http://192.168.1.10:8989 — another device on your network (default port 8989)', 'http://localhost:8989 — same device as this app'],
    sectionId: 'tvShows',
  },
  {
    name: 'radarr',
    label: 'Radarr',
    icon: 'film-outline',
    tint: colors.accent,
    description:
      'Radarr does for movies what Sonarr does for TV — it monitors your collection and automatically grabs new releases as they become available.',
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:7878',
    urlExamples: ['http://192.168.1.10:7878 — another device on your network (default port 7878)', 'http://localhost:7878 — same device as this app'],
    sectionId: 'movies',
  },
  {
    name: 'sabnzbd',
    label: 'SABnzbd',
    icon: 'download-outline',
    tint: colors.sabnzbd,
    description:
      "SABnzbd is the Usenet download client that actually retrieves files once Sonarr or Radarr queue something. The Downloads screen reads its queue and history directly from here.",
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:8080',
    urlExamples: ['http://192.168.1.10:8080 — another device on your network (default port 8080)', 'http://localhost:8080 — same device as this app'],
    sectionId: 'downloads',
  },
  {
    name: 'qbittorrent',
    label: 'qBittorrent',
    icon: 'swap-vertical-outline',
    tint: colors.qbittorrent,
    description:
      'qBittorrent handles torrent downloads — the Torrents screen mirrors its list so you can pause, resume, or remove torrents and see what\'s actively seeding.',
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:8080',
    urlExamples: ['http://192.168.1.10:8080 — another device on your network (default port 8080)', 'http://localhost:8080 — same device as this app'],
    sectionId: 'torrents',
    usesCredentials: true,
    apiKeyOptional: true,
  },
  {
    name: 'overseerr',
    label: 'Seer',
    icon: 'list-outline',
    tint: colors.overseerr,
    description:
      'Overseerr (shown in this app as "Seer") lets you browse and request movies or shows, forwarding approved requests straight to Sonarr and Radarr.',
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:5055',
    urlExamples: ['http://192.168.1.10:5055 — another device on your network (default port 5055)', 'http://localhost:5055 — same device as this app'],
    sectionId: 'requests',
  },
  {
    name: 'tmdb',
    label: 'TMDB (Discover)',
    icon: 'compass-outline',
    tint: colors.sectionGreen,
    description:
      "The Movie Database (TMDB) powers the Discover tab — search, trending/popular/upcoming rows, posters, cast & crew, and the add-to-library flow all come from here.",
    requiresUrl: false,
    placeholder: '',
    signupUrl: 'https://www.themoviedb.org/settings/api',
    sectionId: 'discover',
  },
  {
    name: 'omdb',
    label: 'OMDb (Rotten Tomatoes)',
    icon: 'star-outline',
    tint: colors.danger,
    description:
      "OMDb supplies the extra IMDb, Rotten Tomatoes, and Metacritic ratings shown in Review Sources on movie and TV detail pages — TMDB alone doesn't provide RT or Metacritic scores.",
    requiresUrl: false,
    placeholder: '',
    signupUrl: 'https://www.omdbapi.com/apikey.aspx',
  },
  {
    name: 'tautulli',
    label: 'Tautulli',
    icon: 'stats-chart-outline',
    tint: colors.tautulli,
    description:
      'Tautulli tracks everything watched on your Plex server — see who\'s streaming right now, browse playback history, and check usage stats and trends over time.',
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:8181',
    urlExamples: ['http://192.168.1.10:8181 — another device on your network (default port 8181)', 'http://localhost:8181 — same device as this app'],
    sectionId: 'stats',
  },
  {
    name: 'portainer',
    label: 'Containers',
    icon: 'cube-outline',
    tint: colors.portainer,
    description:
      'Portainer manages the Docker containers and stacks running your whole server. The Containers screen mirrors it so you can check status and start, stop, or recreate anything without opening the web UI.',
    requiresUrl: true,
    placeholder: 'http://192.168.1.10:9000',
    urlExamples: ['http://192.168.1.10:9000 — another device on your network (default port 9000)', 'http://localhost:9000 — same device as this app'],
    sectionId: 'containers',
    supportsCertTrust: true,
  },
];

/** The service that owns a given nav section, if any - lets AdaptiveNav hide a section when that service is disabled. */
export function serviceForSection(sectionId: StartupSectionId): ServiceName | undefined {
  return SERVICE_META.find((s) => s.sectionId === sectionId)?.name;
}
