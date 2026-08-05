// Canonical per-section icon/tint/route data - the single source of truth
// both the persistent Sidebar and the floating pill build their nav items
// from (see src/components/Sidebar.tsx and FloatingPill.tsx).
// `src/lib/serviceMeta.ts` is a deliberately separate, NOT-duplicate
// concern: it's keyed by `ServiceName` (not `SectionId`, and includes
// services with no section at all, like OMDb), and intentionally uses
// outline icon variants for the Settings "SERVICES" list's different
// visual context - don't fold it into this file.
import { Ionicons } from '@expo/vector-icons';
import { SectionId } from './sectionNames';
import { colors } from '../theme/colors';

export interface SectionMeta {
  icon: keyof typeof Ionicons.glyphMap;
  // Settings has no per-section accent color (its rows use the neutral
  // colors.textSecondary throughout), unlike every real nav section.
  tint?: string;
  href: string;
  // Extra path prefixes (beyond `href` itself) that should still count as
  // this section being active - only needed for the two sections whose
  // detail routes use a genuinely different word than their own href
  // (Movies' href is the plural `/movies`, but detail/add pages are the
  // singular `/movie/*`; TV Shows' href is the root `/`, which
  // isSectionActive() deliberately exact-matches rather than prefix-matches
  // - see that file's own comment - so `/series/*` needs to be listed
  // explicitly too). Every other section's detail routes are already
  // nested directly under its own href (`/discover/movie/*`,
  // `/containers/[id]`, `/tautulli/user/[id]`, etc.), so the normal prefix
  // match in isSectionActive() already covers them without this.
  activePrefixes?: string[];
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  discover: { icon: 'compass', tint: colors.sectionGreen, href: '/discover' },
  tvShows: { icon: 'tv', tint: colors.sonarr, href: '/', activePrefixes: ['/series'] },
  movies: { icon: 'film', tint: colors.accent, href: '/movies', activePrefixes: ['/movie'] },
  downloads: { icon: 'download', tint: colors.sabnzbd, href: '/downloads' },
  nzbget: { icon: 'cloud-download', tint: colors.nzbget, href: '/nzbget' },
  torrents: { icon: 'swap-vertical', tint: colors.qbittorrent, href: '/torrents' },
  requests: { icon: 'list', tint: colors.overseerr, href: '/overseerr' },
  stats: { icon: 'stats-chart', tint: colors.tautulli, href: '/tautulli' },
  containers: { icon: 'cube', tint: colors.portainer, href: '/containers' },
  settings: { icon: 'settings-outline', href: '/settings' },
};

// Default/fallback full display order (Settings always last) - used as the
// starting point for the user-configurable tab order (see
// `src/lib/tabOrder.ts`) and anywhere a canonical "all sections" list is
// needed before any per-profile preference has loaded.
export const SECTION_ORDER: SectionId[] = [
  'discover',
  'tvShows',
  'movies',
  'downloads',
  'nzbget',
  'torrents',
  'requests',
  'stats',
  'containers',
  'settings',
];
