// Shared dropdown/picker option lists used by the Radarr/Sonarr add flows.

// Radarr's `minimumAvailability` values - controls how early Radarr is
// allowed to grab a release relative to the movie's release-date triptych.
export const AVAILABILITY_OPTIONS = [
  { value: 'announced', label: 'Announced' },
  { value: 'inCinemas', label: 'In Cinemas' },
  { value: 'released', label: 'Released' },
];

// Sonarr's addOptions.monitor values - which episodes get monitored when a
// series is first added. Matches Sonarr's own "Add Series" screen.
export const SONARR_MONITOR_OPTIONS = [
  { value: 'all', label: 'All Episodes' },
  { value: 'future', label: 'Future Episodes' },
  { value: 'missing', label: 'Missing Episodes' },
  { value: 'existing', label: 'Existing Episodes' },
  { value: 'pilot', label: 'Pilot Episode' },
  { value: 'firstSeason', label: 'Only First Season' },
  { value: 'latestSeason', label: 'Only Latest Season' },
  { value: 'none', label: 'None' },
] as const;

export type SonarrMonitorOption = (typeof SONARR_MONITOR_OPTIONS)[number]['value'];
