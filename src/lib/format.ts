// Grab-bag of small, pure display-formatting helpers shared across the app -
// byte sizes, dates/times, and a couple of Sonarr/Radarr-specific label maps.
// None of these hit the network or storage; they just turn raw API values
// into the strings shown on screen.
import type { BadgeTone } from '../components/Badge';

// Formats a raw byte count as "X.X GB" (1 decimal) once it's at least 1 GB,
// otherwise falls back to whole-number MB. Used for file sizes on the
// TV Shows/Movies file-details cards and Downloads queue.
export function formatBytes(bytes?: number): string {
  if (!bytes) return '0 GB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

// Formats a duration in seconds as e.g. "2h 14m" (or just "45m" / "30s" once
// it drops below an hour/minute) - used for Tautulli's per-user/per-item
// total watch time.
export function formatDuration(seconds?: number): string {
  if (!seconds) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.round(seconds)}s`;
}

// Formats an SABnzbd "MB" queue field (arrives as a numeric string) with
// thousands separators, e.g. "1,024".
export function formatMb(mb: string): string {
  const value = Math.round(Number(mb) || 0);
  return value.toLocaleString();
}

// Formats an ISO date string as e.g. "Jan 5, 2026", or `null` if missing/
// unparseable so callers can decide how to render an absent date.
export function formatDate(date?: string): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Formats an ISO date string as e.g. "January 2026" (no day) - used where
// only the release month/year matters (e.g. a movie's digital release).
export function formatMonthYear(date?: string): string {
  if (!date) return 'Unknown';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

// Formats a past ISO timestamp as a short relative-time string ("5m ago",
// "3hr ago", "2d ago") - used for history/activity rows.
export function formatRelativeTime(date?: string): string {
  if (!date) return '';
  const diffMs = Date.now() - new Date(date).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}hr ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Formats a future ISO date as a short countdown ("Today"/"Tomorrow"/"in N
// days"), or `null` once it's more than 60 days out or already in the past -
// callers treat `null` as "don't show a countdown badge at all". Compares
// against start-of-day (not the exact current moment) so a release doesn't
// silently disappear from "Today" as the day goes on.
export function formatCountdown(date?: string): string | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - startOfToday.getTime()) / 86400000);
  if (days < 0 || days > 60) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

// English ordinal suffix for a day-of-month number (1 -> "st", 2 -> "nd",
// 3 -> "rd", everything else -> "th", with the 11th/12th/13th exceptions).
function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

// Formats a date as a section-header label for grouped lists (Upcoming tabs):
// "Today"/"Tomorrow"/"Yesterday" for near dates, otherwise a full weekday +
// month + ordinal day, e.g. "Thursday, January 15th". Compares start-of-day
// to start-of-day so the label doesn't flip mid-day like `formatCountdown`
// is careful to avoid.
export function formatDayGroup(date?: string): string {
  if (!date) return 'Unknown';
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return 'Unknown';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(target);
  startOfTarget.setHours(0, 0, 0, 0);
  const days = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const weekday = target.toLocaleDateString(undefined, { weekday: 'long' });
  const month = target.toLocaleDateString(undefined, { month: 'long' });
  const day = target.getDate();
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}`;
}

// Formats a unix-seconds timestamp (Docker/Portainer's `Created` field uses
// this, unlike every other API in this app which returns ISO strings) as a
// full local date + time, e.g. "Jul 14, 2026, 4:01 AM".
export function formatUnixDateTime(seconds?: number): string {
  if (!seconds) return 'Unknown';
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Formats an ISO timestamp as a local time-of-day, e.g. "9:41 AM".
export function formatTime(date?: string): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Converts a camelCase API field/enum value into a spaced, capitalized
// display string, e.g. "downloadFolderImported" -> "Download Folder Imported".
export function titleCase(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// Maps a Sonarr series status ('continuing' | 'ended' | 'upcoming' |
// 'deleted') to the Badge color/tone used for its status pill, giving each
// status a visually distinct color instead of one flat style for all of them.
export function seriesStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'continuing':
      return 'success';
    case 'upcoming':
      return 'info';
    case 'ended':
      return 'sonarr';
    default:
      return 'danger';
  }
}

// Friendlier labels for Sonarr/Radarr history event types that don't read
// well in raw camelCase form. Anything not listed here falls back to
// `titleCase` via `historyEventLabel` below.
const HISTORY_EVENT_LABELS: Record<string, string> = {
  grabbed: 'Grabbed',
  downloadFolderImported: 'Imported from download folder',
  downloadImported: 'Imported',
  episodeFileDeleted: 'File Deleted',
  movieFileDeleted: 'File Deleted',
  episodeFileRenamed: 'Renamed',
  movieFileRenamed: 'Renamed',
  seriesFolderImported: 'Imported',
};

// Looks up a friendly label for a Sonarr/Radarr history `eventType`, falling
// back to a title-cased version of the raw value for anything not in the map.
export function historyEventLabel(eventType: string): string {
  return HISTORY_EVENT_LABELS[eventType] ?? titleCase(eventType);
}
