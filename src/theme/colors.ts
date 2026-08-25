// Central dark-theme color palette for the whole app. Every screen/component
// pulls its colors from here rather than hardcoding hex values, so a palette
// change only has to happen in one place.
//
// Service colors (sonarr/overseerr/sabnzbd/qbittorrent) are kept as their own
// named tokens instead of being reused across unrelated features, even when a
// hex value happens to match another token (e.g. `info` and `overseerr` share
// a hex today, but they mean different things and can diverge independently).
export const colors = {
  // Primary brand accent, used sparingly (e.g. splash/onboarding).
  brand: '#5B8CFF',

  // Base surface layers, darkest to lightest, plus the hairline border color
  // used between cards/list rows.
  background: '#131419',
  surface: '#1D1F27',
  surfaceAlt: '#22242E',
  // Semi-transparent variant of `surface` for FloatingPill's glass effect.
  surfaceGlass: 'rgba(29,31,39,0.7)',
  border: 'rgba(255,255,255,0.08)',

  // Text hierarchy: primary (headings/values), secondary (labels), muted
  // (least important, e.g. placeholder/disabled text).
  textPrimary: '#FFFFFF',
  textSecondary: '#9498A3',
  textMuted: '#6B6E79',

  // Radarr's amber accent, also used as the app's generic "action" tint
  // wherever a screen isn't specifically Sonarr/Discover/etc.-themed.
  accent: '#F5A623',
  accentMuted: 'rgba(245,166,35,0.15)',

  // Generic positive-state color (e.g. "continuing" status, success toasts).
  success: '#34D399',
  successMuted: 'rgba(52,211,153,0.15)',

  // Generic destructive/error-state color (delete actions, failed states).
  danger: '#F0574F',
  dangerMuted: 'rgba(240,87,79,0.15)',

  // Generic informational purple - also used for the "in X days" countdown
  // badge on Movies/TV rows. Don't assume this is exclusively Overseerr's
  // color just because the hex matches; grep for `colors.info` before
  // repointing it.
  info: '#8C7CF0',
  infoMuted: 'rgba(140,124,240,0.18)',

  // Discover's green accent (drawer icon, category chrome).
  sectionGreen: '#3FDA84',
  sectionGreenMuted: 'rgba(63,218,132,0.15)',

  // Sonarr/TV Shows blue.
  sonarr: '#3AB4EA',
  sonarrMuted: 'rgba(58,180,234,0.15)',

  // Overseerr/Requests purple (shares its hex with `info` above by design -
  // see the note on `info`).
  overseerr: '#8C7CF0',
  overseerrMuted: 'rgba(140,124,240,0.18)',

  // SABnzbd/Downloads yellow, matching SABnzbd's real icon color.
  sabnzbd: '#FDD835',
  sabnzbdMuted: 'rgba(253,216,53,0.15)',

  // qBittorrent/Torrents blue.
  qbittorrent: '#4A90E2',
  qbittorrentMuted: 'rgba(74,144,226,0.15)',

  // Tautulli/Stats yellow - Plex's own brand gold, matching Tautulli's icon.
  tautulli: '#E5A00D',
  tautulliMuted: 'rgba(229,160,13,0.15)',

  // Portainer/Containers teal - close to Portainer's own brand blue without
  // reusing any other service's hue (sonarr/qbittorrent are already blue).
  portainer: '#13C4CC',
  portainerMuted: 'rgba(19,196,204,0.15)',

  // NZBGet - alternate Downloads-section client alongside SABnzbd (see
  // downloads.tsx). A distinct orange, deliberately not reusing sabnzbd's
  // yellow or accent's amber so the Downloads screen still reads as
  // clearly "which client is this" when either one is active.
  nzbget: '#FF7043',
  nzbgetMuted: 'rgba(255,112,67,0.15)',

  // Lidarr/Music green - Lidarr's own real brand color, verified against
  // their logo SVG in the Lidarr/Lidarr GitHub repo (both
  // frontend/src/Content/Images/logo.svg and Logo/Lidarr.svg use #009252),
  // not guessed.
  lidarr: '#009252',
  lidarrMuted: 'rgba(0,146,82,0.15)',

  // Last.fm's own real brand red, verified against their published brand
  // palette, not guessed.
  lastfm: '#D51007',
  lastfmMuted: 'rgba(213,16,7,0.15)',

  // Transmission - alternate Torrents-section client alongside qBittorrent
  // (see torrents.tsx/transmission.tsx). No single verified brand hex the
  // way Lidarr/Last.fm have (unlike them, Transmission has no published
  // brand palette) - a warm rust chosen to evoke its turtle-shell mascot
  // while staying clearly distinct from qbittorrent's blue and every other
  // existing tint.
  transmission: '#8D6E63',
  transmissionMuted: 'rgba(141,110,99,0.15)',
};
