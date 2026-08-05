// Normalizes SABnzbd and NZBGet - two alternative Usenet download clients,
// never run side by side in a real home lab - into one shared shape so
// app/downloads.tsx only ever has to render ONE data model regardless of
// which is actually configured. The shared shape is exactly what SABnzbd's
// own API already returned before NZBGet support existed (field names kept
// identical on purpose) - NZBGet's very different JSON-RPC response shape
// (MB integers, an ALL_CAPS Status enum, no per-item or overall ETA field
// at all) gets converted into that same shape here, once, instead of
// downloads.tsx branching on which backend it's talking to everywhere it
// touches a field.
import { nzbgetApi, NzbgetGroup } from '../api/nzbget';
import { sabnzbdApi } from '../api/sabnzbd';
import { ServiceConfig } from '../api/types';
import { formatBytes } from './format';

export type DownloadClientKind = 'sabnzbd' | 'nzbget';

export interface DownloadQueueItem {
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

export interface DownloadQueueResponse {
  queue: {
    slots: DownloadQueueItem[];
    speed: string;
    paused: boolean;
    timeleft: string;
    sizeleft: string;
  };
}

export interface DownloadHistoryItem {
  nzo_id: string;
  name: string;
  status: string;
  size: string;
  storage: string;
  fail_message: string;
}

export interface DownloadHistoryResponse {
  history: {
    slots: DownloadHistoryItem[];
  };
}

// Formats a duration in seconds as SABnzbd's own "H:MM:SS" style (what
// downloads.tsx already expects for `timeleft`) - NZBGet has no equivalent
// field at all, per-item or overall, so this is derived from remaining
// size / current download rate instead of read directly.
function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Matches SABnzbd's own `speed` field format ("0", "234.5 K", "1.2 M") -
// downloads.tsx renders it as `${speed}B/s` for either backend, so this has
// to look the same, not just mean the same thing.
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} K`;
  return `${(kb / 1024).toFixed(1)} M`;
}

// NZBGet's Status enum is ALL_CAPS/underscored (PAUSED, DOWNLOADING,
// QUEUED, FETCHING, PP_QUEUED, LOADING_PARS, VERIFYING_SOURCES, ...) -
// `PAUSED` and `DOWNLOADING` specifically have to come out as exactly
// "Paused"/"Downloading" (capital-first, no other caps) since downloads.tsx
// does an exact `item.status === 'Paused'` check and a
// `.toLowerCase() === 'downloading'` check, mirroring SABnzbd's own status
// strings; everything else just needs to read reasonably as display text.
function nzbgetStatusLabel(status: string): string {
  if (status === 'PAUSED') return 'Paused';
  if (status === 'DOWNLOADING') return 'Downloading';
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function nzbgetGroupToItem(group: NzbgetGroup, index: number, overallRateBytesPerSec: number): DownloadQueueItem {
  const totalMb = group.FileSizeMB;
  const remainingMb = group.RemainingSizeMB;
  const percentage = totalMb > 0 ? Math.min(100, Math.max(0, ((totalMb - remainingMb) / totalMb) * 100)) : 0;
  // The overall download rate only actually applies to whichever single
  // group is currently DOWNLOADING (NZBGet downloads one group at a time by
  // default) - a queued-but-not-yet-started group has no meaningful ETA to
  // show, same as how SABnzbd itself leaves a queued item's timeleft blank.
  const isDownloading = group.Status === 'DOWNLOADING';
  const etaSeconds = isDownloading && overallRateBytesPerSec > 0 ? (remainingMb * 1024 * 1024) / overallRateBytesPerSec : 0;
  return {
    nzo_id: String(group.NZBID),
    index,
    filename: group.NZBName,
    status: nzbgetStatusLabel(group.Status),
    percentage: percentage.toFixed(0),
    timeleft: isDownloading ? formatEtaSeconds(etaSeconds) : '',
    size: formatBytes(totalMb * 1024 * 1024),
    sizeleft: formatBytes(remainingMb * 1024 * 1024),
    mb: String(totalMb),
    mbleft: String(remainingMb),
  };
}

export const downloadClientApi = {
  testConnection: (client: DownloadClientKind, config: ServiceConfig) =>
    client === 'sabnzbd' ? sabnzbdApi.testConnection(config) : nzbgetApi.testConnection(config),

  getQueue: async (client: DownloadClientKind, config: ServiceConfig): Promise<DownloadQueueResponse> => {
    if (client === 'sabnzbd') return sabnzbdApi.getQueue(config);
    const [status, groups] = await Promise.all([nzbgetApi.getStatus(config), nzbgetApi.listGroups(config)]);
    return {
      queue: {
        slots: groups.map((g, i) => nzbgetGroupToItem(g, i, status.DownloadRate)),
        speed: formatSpeed(status.DownloadRate),
        paused: status.DownloadPaused,
        timeleft:
          status.DownloadRate > 0 ? formatEtaSeconds((status.RemainingSizeMB * 1024 * 1024) / status.DownloadRate) : '',
        sizeleft: formatBytes(status.RemainingSizeMB * 1024 * 1024),
      },
    };
  },

  getHistory: async (client: DownloadClientKind, config: ServiceConfig): Promise<DownloadHistoryResponse> => {
    if (client === 'sabnzbd') return sabnzbdApi.getHistory(config);
    const items = await nzbgetApi.getHistory(config);
    return {
      history: {
        slots: items.map((h) => {
          const failed = h.Status.startsWith('FAILURE');
          return {
            nzo_id: String(h.NZBID),
            name: h.Name,
            status: failed ? 'Failed' : 'Completed',
            size: formatBytes(h.FileSizeMB * 1024 * 1024),
            storage: h.FinalDir || h.DestDir,
            // NZBGet has no dedicated failure-message field the way
            // SABnzbd's `fail_message` is - its own Status string (e.g.
            // "FAILURE/PAR") is the closest equivalent.
            fail_message: failed ? h.Status : '',
          };
        }),
      },
    };
  },

  pauseQueue: (client: DownloadClientKind, config: ServiceConfig) =>
    client === 'sabnzbd' ? sabnzbdApi.pauseQueue(config) : nzbgetApi.pauseQueue(config),

  resumeQueue: (client: DownloadClientKind, config: ServiceConfig) =>
    client === 'sabnzbd' ? sabnzbdApi.resumeQueue(config) : nzbgetApi.resumeQueue(config),

  pauseItem: (client: DownloadClientKind, config: ServiceConfig, item: DownloadQueueItem) =>
    client === 'sabnzbd' ? sabnzbdApi.pauseItem(config, item.nzo_id) : nzbgetApi.pauseItem(config, Number(item.nzo_id)),

  resumeItem: (client: DownloadClientKind, config: ServiceConfig, item: DownloadQueueItem) =>
    client === 'sabnzbd' ? sabnzbdApi.resumeItem(config, item.nzo_id) : nzbgetApi.resumeItem(config, Number(item.nzo_id)),

  deleteFromQueue: (client: DownloadClientKind, config: ServiceConfig, item: DownloadQueueItem) =>
    client === 'sabnzbd'
      ? sabnzbdApi.deleteFromQueue(config, item.nzo_id)
      : nzbgetApi.deleteFromQueue(config, Number(item.nzo_id)),

  // SABnzbd's own reorder takes an absolute target index; NZBGet's takes a
  // relative one-position offset - both driven from the same `direction`
  // here so downloads.tsx's `moveItem` doesn't need to know which.
  reorderQueue: (client: DownloadClientKind, config: ServiceConfig, item: DownloadQueueItem, direction: 'up' | 'down') =>
    client === 'sabnzbd'
      ? sabnzbdApi.reorderQueue(config, item.nzo_id, item.index + (direction === 'up' ? -1 : 1))
      : nzbgetApi.reorderQueue(config, Number(item.nzo_id), direction),
};
