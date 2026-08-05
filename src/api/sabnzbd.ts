// SABnzbd client - the Usenet download client behind the Downloads screen.
// Unlike the arr apps' REST-style JSON APIs, SABnzbd's whole API is a single
// endpoint (`/api`) dispatched by a `mode` query param, with errors reported
// as `{ error: "..." }` inside an otherwise-200 JSON response rather than as
// an HTTP status code.
import { Platform } from 'react-native';
import { ServiceConfig } from './types';
import { webProxyFetch } from './webProxy';

export interface SabnzbdQueueItem {
  nzo_id: string;
  index: number;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  size: string;
  sizeleft: string;
  mb: string;
  mbleft: string;
}

export interface SabnzbdQueueResponse {
  queue: {
    slots: SabnzbdQueueItem[];
    speed: string;
    paused: boolean;
    timeleft: string;
    sizeleft: string;
  };
}

// One completed (or failed) download in SABnzbd's history log.
export interface SabnzbdHistoryItem {
  nzo_id: string;
  name: string;
  status: string;
  size: string;
  storage: string;
  fail_message: string;
  download_time: number;
  completed: number;
}

export interface SabnzbdHistoryResponse {
  history: {
    slots: SabnzbdHistoryItem[];
  };
}

// Issues one SABnzbd API call for the given `mode` (its dispatch parameter)
// and decodes the JSON response, surfacing SABnzbd's in-body error field as
// a thrown JS error so callers can `catch` it like any other failed request.
async function sabRequest<T>(
  config: ServiceConfig,
  mode: string,
  params: Record<string, string> = {}
): Promise<T> {
  const fullParams = { mode, output: 'json', ...params };
  if (Platform.OS === 'web') {
    return webProxyFetch<T>('sabnzbd', config, { path: '/api', params: fullParams });
  }

  const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/api');
  url.searchParams.set('apikey', config.apiKey);
  Object.entries(fullParams).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SABnzbd ${mode} failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json && typeof json === 'object' && 'error' in json && json.error) {
    throw new Error(String(json.error));
  }

  return json as T;
}

export const sabnzbdApi = {
  // Settings' "Test Connection" check. Deliberately NOT `mode=version` -
  // SABnzbd's own API docs exempt `version` (and `auth`) from needing an
  // apikey at all (by design, for external health checks), so it returns
  // success for literally any key, right or wrong or blank - confirmed live
  // as a real false-positive. `queue` is a lightweight endpoint that does
  // enforce the apikey, so a bad key actually surfaces as a failure here.
  testConnection: (config: ServiceConfig) => sabRequest(config, 'queue', { limit: '1' }),

  // Current download queue - polled every 3s while the Queue tab is focused
  // so progress/speed update live (see Downloads screen).
  getQueue: (config: ServiceConfig) => sabRequest<SabnzbdQueueResponse>(config, 'queue'),

  getHistory: (config: ServiceConfig) => sabRequest<SabnzbdHistoryResponse>(config, 'history', { limit: '50' }),

  // Pauses/resumes the entire queue (global, not a single item).
  pauseQueue: (config: ServiceConfig) => sabRequest(config, 'pause'),

  resumeQueue: (config: ServiceConfig) => sabRequest(config, 'resume'),

  // Removes one item from the queue; `delFiles` also deletes any
  // partially-downloaded data for it.
  deleteFromQueue: (config: ServiceConfig, nzoId: string, delFiles = true) =>
    sabRequest(config, 'queue', { name: 'delete', value: nzoId, del_files: delFiles ? '1' : '0' }),

  // Pauses/resumes one specific queue item (distinct from the global
  // pause/resume above) - powers the per-item "..." menu.
  pauseItem: (config: ServiceConfig, nzoId: string) => sabRequest(config, 'queue', { name: 'pause', value: nzoId }),

  resumeItem: (config: ServiceConfig, nzoId: string) => sabRequest(config, 'queue', { name: 'resume', value: nzoId }),

  // Moves an item to a new position in the queue (drag-to-reorder).
  reorderQueue: (config: ServiceConfig, nzoId: string, targetIndex: number) =>
    sabRequest(config, 'switch', { value: nzoId, value2: String(targetIndex) }),
};
