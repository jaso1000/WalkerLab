// Overseerr client, shown to the user as "Seer" (see `serviceMeta.ts`) but
// kept internally named `overseerr` throughout. Reuses `arrFetch` since
// Overseerr's REST API shape (JSON body, non-2xx = error) matches Sonarr/
// Radarr's closely enough, even though it's header-auth via API key rather
// than the arr apps' own auth scheme (arrFetch is auth-shape agnostic here -
// it just always sends the config's apiKey as X-Api-Key, which Overseerr
// also accepts).
import { arrFetch as arrFetchBase, ArrFetchOptions } from './arrFetch';
import { ServiceConfig } from './types';

// Shadows the shared `arrFetch` with this service's own literal name baked
// in (needed for the web build's proxy routing, see arrFetch.ts) - every
// call site below is completely unchanged, still just `arrFetch(...)`.
const arrFetch = <T>(config: ServiceConfig, path: string, options?: ArrFetchOptions) =>
  arrFetchBase<T>(config, path, options, 'overseerr');

// 1 = pending, 2 = approved, 3 = declined
export type OverseerrRequestStatus = 1 | 2 | 3;
// 1 = unknown, 2 = pending, 3 = processing, 4 = partially available, 5 = available
export type OverseerrMediaStatus = 1 | 2 | 3 | 4 | 5;

export interface OverseerrRequest {
  id: number;
  status: OverseerrRequestStatus;
  type: 'movie' | 'tv';
  createdAt: string;
  media: {
    id: number;
    tmdbId: number;
    tvdbId?: number;
    status: OverseerrMediaStatus;
    status4k: OverseerrMediaStatus;
  };
  requestedBy: {
    id: number;
    displayName: string;
    email?: string;
    avatar?: string;
  };
  seasons?: { id: number; seasonNumber: number; status: OverseerrMediaStatus }[];
}

export interface OverseerrRequestsResponse {
  pageInfo: { pages: number; pageSize: number; results: number; page: number };
  results: OverseerrRequest[];
}

// Confirmed against a real Overseerr instance - 'declined' is not a valid
// filter value for GET /api/v1/request (400s), even though a request
// object's own `status` field can be 3 (declined). Declined requests still
// show up under the 'all' filter with that status - see requestStatusInfo
// in app/overseerr.tsx.
export type OverseerrFilter =
  | 'all'
  | 'pending'
  | 'approved'
  | 'processing'
  | 'available'
  | 'failed'
  | 'unavailable';

// Overseerr's webhook notification agent (Settings > Notifications >
// Webhook) - unlike Sonarr/Radarr/Lidarr's Notification API, this is one
// global slot for the whole instance, not a list of named connections
// (confirmed against Overseerr's own source: `settings.notifications.
// agents.webhook`, a single object, not an array). `jsonPayload` is a JSON
// *string* the server base64-encodes as-is - Overseerr's real POST route
// only validates that it parses, so a plain `JSON.stringify(...)` of the
// template is exactly what its own frontend sends underneath its own
// (unrelated) double-encoding quirk.
export interface OverseerrWebhookConfig {
  enabled: boolean;
  types: number;
  options: { webhookUrl: string; jsonPayload: string; authHeader?: string };
}

// Copied verbatim from Overseerr's own shipped "Reset to Default" template
// (`NotificationsWebhook/index.tsx`'s `defaultPayload`) - already includes
// the top-level `notification_type`/`subject`/`message` fields
// server/src/services/notificationPayloads.ts's parseOverseerrPayload
// reads, so no parser changes were needed to support this.
const DEFAULT_WEBHOOK_PAYLOAD = {
  notification_type: '{{notification_type}}',
  event: '{{event}}',
  subject: '{{subject}}',
  message: '{{message}}',
  image: '{{image}}',
  '{{media}}': {
    media_type: '{{media_type}}',
    tmdbId: '{{media_tmdbid}}',
    tvdbId: '{{media_tvdbid}}',
    status: '{{media_status}}',
    status4k: '{{media_status4k}}',
  },
  '{{request}}': {
    request_id: '{{request_id}}',
    requestedBy_email: '{{requestedBy_email}}',
    requestedBy_username: '{{requestedBy_username}}',
    requestedBy_avatar: '{{requestedBy_avatar}}',
    requestedBy_settings_discordId: '{{requestedBy_settings_discordId}}',
    requestedBy_settings_telegramChatId: '{{requestedBy_settings_telegramChatId}}',
  },
  '{{issue}}': {
    issue_id: '{{issue_id}}',
    issue_type: '{{issue_type}}',
    issue_status: '{{issue_status}}',
    reportedBy_email: '{{reportedBy_email}}',
    reportedBy_username: '{{reportedBy_username}}',
    reportedBy_avatar: '{{reportedBy_avatar}}',
    reportedBy_settings_discordId: '{{reportedBy_settings_discordId}}',
    reportedBy_settings_telegramChatId: '{{reportedBy_settings_telegramChatId}}',
  },
  '{{comment}}': {
    comment_message: '{{comment_message}}',
    commentedBy_email: '{{commentedBy_email}}',
    commentedBy_username: '{{commentedBy_username}}',
    commentedBy_avatar: '{{commentedBy_avatar}}',
    commentedBy_settings_discordId: '{{commentedBy_settings_discordId}}',
    commentedBy_settings_telegramChatId: '{{commentedBy_settings_telegramChatId}}',
  },
  '{{extra}}': [],
};

// 'MEDIA_PENDING' - confirmed via Overseerr's own Notification enum
// (server/lib/notifications/index.ts). Matches "new... request" from this
// feature's ask, not approved/available/declined.
const MEDIA_PENDING = 2;

export const overseerrApi = {
  // Settings' "Test Connection" check - fetches the currently-authenticated
  // user, which only succeeds with a valid API key.
  testConnection: (config: ServiceConfig) => arrFetch(config, '/api/v1/auth/me'),

  // Paginated request list for a given status filter, newest-added first.
  getRequests: (config: ServiceConfig, filter: OverseerrFilter, page = 1, pageSize = 25) =>
    arrFetch<OverseerrRequestsResponse>(config, '/api/v1/request', {
      params: { filter, take: String(pageSize), skip: String((page - 1) * pageSize), sort: 'added' },
    }),

  approveRequest: (config: ServiceConfig, id: number) =>
    arrFetch(config, `/api/v1/request/${id}/approve`, { method: 'POST' }),

  declineRequest: (config: ServiceConfig, id: number) =>
    arrFetch(config, `/api/v1/request/${id}/decline`, { method: 'POST' }),

  deleteRequest: (config: ServiceConfig, id: number) =>
    arrFetch(config, `/api/v1/request/${id}`, { method: 'DELETE' }),

  getWebhookConfig: (config: ServiceConfig) => arrFetch<OverseerrWebhookConfig>(config, '/api/v1/settings/notifications/webhook'),

  // True only when this instance's webhook slot is already enabled and
  // pointed somewhere other than our own URL - Settings > Push
  // Notifications shows a confirm dialog before overwriting in that case,
  // since (unlike Sonarr/Radarr/Lidarr) there's no way to add a second,
  // independent connection here.
  hasConflictingWebhook: async (config: ServiceConfig, webhookUrl: string): Promise<boolean> => {
    const existing = await overseerrApi.getWebhookConfig(config);
    return existing.enabled && existing.options.webhookUrl !== webhookUrl;
  },

  setupWebhookNotification: (config: ServiceConfig, webhookUrl: string) =>
    arrFetch(config, '/api/v1/settings/notifications/webhook', {
      method: 'POST',
      body: {
        enabled: true,
        types: MEDIA_PENDING,
        options: { webhookUrl, jsonPayload: JSON.stringify(DEFAULT_WEBHOOK_PAYLOAD), authHeader: '' },
      },
    }),
};
