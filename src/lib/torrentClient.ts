// Normalizes qBittorrent and Transmission - two alternative torrent
// clients, since some home labs genuinely want both running - into one
// shared shape so TorrentClientScreen only ever has to render ONE data
// model regardless of which is actually configured. Mirrors
// downloadClient.ts's role for SABnzbd/NZBGet exactly.
import { qbittorrentApi, QbittorrentFilter, QbittorrentTorrent, qbittorrentIsPaused, qbittorrentStateLabel } from '../api/qbittorrent';
import { transmissionApi, TransmissionTorrent, transmissionIsPaused, transmissionStateLabel } from '../api/transmission';
import { ServiceConfig } from '../api/types';
import { BadgeTone } from '../components/Badge';

export type TorrentClientKind = 'qbittorrent' | 'transmission';

// UI-facing tab identity shared by both backends - qBittorrent's own filter
// strings happen to match these keys, which is what lets listTorrents()
// below pass `tab` straight through as its server-side `filter` param.
export type TorrentTab = 'all' | 'active' | 'downloading' | 'completed' | 'errored';

export const TORRENT_TABS: { key: TorrentTab; label: string; empty: string }[] = [
  { key: 'all', label: 'All', empty: 'No torrents here.' },
  { key: 'active', label: 'Active', empty: 'Nothing active right now.' },
  { key: 'downloading', label: 'Downloading', empty: 'Nothing downloading right now.' },
  { key: 'completed', label: 'Finished', empty: 'No finished torrents.' },
  { key: 'errored', label: 'Error', empty: 'No torrents with errors.' },
];

// One shared torrent shape both backends normalize onto, with `id` (a
// plain string either way) and precomputed `stateLabel`/`tone`/`isPaused`
// so TorrentClientScreen never has to know which backend produced a row.
export interface TorrentItem {
  id: string; // qBittorrent: hash; Transmission: String(torrent id)
  name: string;
  size: number; // bytes
  progress: number; // 0..1
  dlspeed: number; // bytes/s
  upspeed: number; // bytes/s
  ratio: number;
  eta: number | null; // seconds; null = unknown/infinite - hide ETA
  stateLabel: string;
  tone: BadgeTone;
  isPaused: boolean;
}

function qbTone(state: string): BadgeTone {
  if (state === 'error' || state === 'missingFiles') return 'danger';
  if (qbittorrentIsPaused(state)) return 'muted';
  const label = qbittorrentStateLabel(state);
  if (label === 'Seeding') return 'success';
  if (label === 'Downloading') return 'info';
  return 'accent';
}

function qbToItem(t: QbittorrentTorrent): TorrentItem {
  return {
    id: t.hash,
    name: t.name,
    size: t.size,
    progress: t.progress,
    dlspeed: t.dlspeed,
    upspeed: t.upspeed,
    ratio: t.ratio,
    eta: !t.eta || t.eta >= 8640000 ? null : t.eta,
    stateLabel: qbittorrentStateLabel(t.state),
    tone: qbTone(t.state),
    isPaused: qbittorrentIsPaused(t.state),
  };
}

function trTone(t: TransmissionTorrent): BadgeTone {
  if (t.error !== 0) return 'danger';
  if (transmissionIsPaused(t.status)) return 'muted';
  const label = transmissionStateLabel(t.status, false);
  if (label === 'Seeding') return 'success';
  if (label === 'Downloading') return 'info';
  return 'accent';
}

function trToItem(t: TransmissionTorrent): TorrentItem {
  return {
    id: String(t.id),
    name: t.name,
    size: t.sizeWhenDone,
    progress: t.percentDone,
    dlspeed: t.rateDownload,
    upspeed: t.rateUpload,
    ratio: t.uploadRatio,
    eta: t.eta < 0 ? null : t.eta, // -1 unknown, -2 infinite (seed-cap) - both hidden
    stateLabel: transmissionStateLabel(t.status, t.error !== 0),
    tone: trTone(t),
    isPaused: transmissionIsPaused(t.status),
  };
}

// Transmission has no server-side filter= equivalent - every tab is
// computed here, once, so both backends agree on what e.g. "Active" means
// even though only one of them asks the server to do it.
function matchesTab(item: TorrentItem, tab: TorrentTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'active':
      return item.dlspeed > 0 || item.upspeed > 0;
    case 'downloading':
      return !item.isPaused && item.progress < 1 && item.tone !== 'danger';
    case 'completed':
      return item.progress >= 1;
    case 'errored':
      return item.tone === 'danger';
  }
}

export const torrentClientApi = {
  testConnection: (client: TorrentClientKind, config: ServiceConfig) =>
    client === 'qbittorrent' ? qbittorrentApi.testConnection(config) : transmissionApi.testConnection(config),

  // qBittorrent: pushes `tab` straight through as its own server-side
  // `filter` param. Transmission: fetches the full list every call
  // (its RPC has no partial-filter concept) and filters in JS via
  // matchesTab - more bytes over the wire per poll tick, accepted as the
  // cost of Transmission's simpler RPC surface rather than reimplementing
  // five different "what counts as X" rules twice.
  listTorrents: async (client: TorrentClientKind, config: ServiceConfig, tab: TorrentTab): Promise<TorrentItem[]> => {
    if (client === 'qbittorrent') {
      const data = await qbittorrentApi.listTorrents(config, tab as QbittorrentFilter);
      return data.map(qbToItem);
    }
    const data = await transmissionApi.listTorrents(config);
    return data.map(trToItem).filter((item) => matchesTab(item, tab));
  },

  pause: (client: TorrentClientKind, config: ServiceConfig, ids: string[]) =>
    client === 'qbittorrent' ? qbittorrentApi.pauseTorrents(config, ids) : transmissionApi.stopTorrents(config, ids.map(Number)),

  resume: (client: TorrentClientKind, config: ServiceConfig, ids: string[]) =>
    client === 'qbittorrent' ? qbittorrentApi.resumeTorrents(config, ids) : transmissionApi.startTorrents(config, ids.map(Number)),

  remove: (client: TorrentClientKind, config: ServiceConfig, ids: string[], deleteFiles: boolean) =>
    client === 'qbittorrent'
      ? qbittorrentApi.deleteTorrents(config, ids, deleteFiles)
      : transmissionApi.removeTorrents(config, ids.map(Number), deleteFiles),
};
