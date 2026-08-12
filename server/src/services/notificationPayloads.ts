// Turns a raw inbound webhook body from Sonarr/Radarr/Lidarr/Overseerr into
// a short push-notification title/body, or `undefined` if this particular
// event isn't one we notify on (e.g. a "Grab" event, or an Overseerr status
// change other than a new pending request) or the payload doesn't look like
// what we expect at all. Every parser is defensive by design - these are
// untrusted bodies from the user's own services, not validated against a
// schema, so a missing/renamed field should silently skip the notification,
// never throw and 500 the whole webhook route.
//
// Sonarr/Radarr/Lidarr's shapes are all confirmed directly against each
// project's own C# source on GitHub (WebhookImportPayload.cs and friends) -
// all three fire `eventType: 'Download'` on a completed import, with
// `series`+`episodes` (Sonarr), `movie` (Radarr), or `artist`+`album`
// (Lidarr - singular `Album` object, not a plural array; Lidarr's own
// config flag for enabling this event is called `onReleaseImport`, not
// `onDownload`, but the payload it sends still uses the same `eventType:
// 'Download'` convention as the other two - see the auto-setup functions in
// src/api/*.ts for where that distinction actually matters). Overseerr's
// exact default JSON template structure is also confirmed (`NotificationsWebhook/
// index.tsx`'s `defaultPayload`) - `notification_type`/`subject`/`message`
// are real top-level fields in the template WalkerLab's own auto-setup
// button installs; deliberately not parsing anything deeper into `media`/
// `request` for a hand-configured webhook, since those object shapes aren't
// independently confirmed here.
import { ServiceName } from '../types';

export interface NotificationContent {
  title: string;
  body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSonarrPayload(payload: unknown): NotificationContent | undefined {
  if (!isRecord(payload) || payload.eventType !== 'Download') return undefined;
  const series = isRecord(payload.series) ? payload.series : undefined;
  const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];
  const episode = isRecord(episodes[0]) ? episodes[0] : undefined;
  const seriesTitle = typeof series?.title === 'string' ? series.title : undefined;
  if (!seriesTitle) return undefined;
  const season = typeof episode?.seasonNumber === 'number' ? String(episode.seasonNumber).padStart(2, '0') : undefined;
  const ep = typeof episode?.episodeNumber === 'number' ? String(episode.episodeNumber).padStart(2, '0') : undefined;
  const episodeTitle = typeof episode?.title === 'string' ? episode.title : undefined;
  const tag = season && ep ? `S${season}E${ep}` : undefined;
  return {
    title: 'New Episode Downloaded',
    body: [seriesTitle, tag, episodeTitle].filter(Boolean).join(' - '),
  };
}

function parseRadarrPayload(payload: unknown): NotificationContent | undefined {
  if (!isRecord(payload) || payload.eventType !== 'Download') return undefined;
  const movie = isRecord(payload.movie) ? payload.movie : undefined;
  const title = typeof movie?.title === 'string' ? movie.title : undefined;
  if (!title) return undefined;
  const year = typeof movie?.year === 'number' ? String(movie.year) : undefined;
  return {
    title: 'New Movie Downloaded',
    body: year ? `${title} (${year})` : title,
  };
}

function parseLidarrPayload(payload: unknown): NotificationContent | undefined {
  if (!isRecord(payload) || payload.eventType !== 'Download') return undefined;
  const artist = isRecord(payload.artist) ? payload.artist : undefined;
  const album = isRecord(payload.album) ? payload.album : undefined;
  const artistName = typeof artist?.name === 'string' ? artist.name : undefined;
  if (!artistName) return undefined;
  const albumTitle = typeof album?.title === 'string' ? album.title : undefined;
  return {
    title: 'New Album Downloaded',
    body: albumTitle ? `${artistName} - ${albumTitle}` : artistName,
  };
}

// Scoped to a new pending request specifically (matching "new... Seer
// request" from the feature ask), not every status change Overseerr can
// notify on (approved/available/declined) - `notification_type` is the one
// field every Overseerr notification agent's payload is guaranteed to carry
// verbatim from its own internal event name, so it's the safest thing to
// branch on even without the full template confirmed.
function parseOverseerrPayload(payload: unknown): NotificationContent | undefined {
  if (!isRecord(payload) || payload.notification_type !== 'MEDIA_PENDING') return undefined;
  const subject = typeof payload.subject === 'string' ? payload.subject : undefined;
  const message = typeof payload.message === 'string' ? payload.message : undefined;
  if (!subject && !message) return undefined;
  return {
    title: subject ?? 'New Request',
    body: message ?? subject ?? '',
  };
}

export function parseNotificationPayload(service: ServiceName, payload: unknown): NotificationContent | undefined {
  switch (service) {
    case 'sonarr':
      return parseSonarrPayload(payload);
    case 'radarr':
      return parseRadarrPayload(payload);
    case 'lidarr':
      return parseLidarrPayload(payload);
    case 'overseerr':
      return parseOverseerrPayload(payload);
    default:
      return undefined;
  }
}
