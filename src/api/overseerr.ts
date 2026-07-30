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
// in app/(drawer)/overseerr.tsx.
export type OverseerrFilter =
  | 'all'
  | 'pending'
  | 'approved'
  | 'processing'
  | 'available'
  | 'failed'
  | 'unavailable';

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
};
