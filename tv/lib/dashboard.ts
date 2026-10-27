// Data for the TV Home dashboard, built only from the shared API clients in src/api - the TV app
// adds no API code of its own. Each row loads independently (Promise.allSettled), so one service
// being down or unconfigured empties its own row without blanking the rest of the screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { radarrApi, RadarrMovie } from '../../src/api/radarr';
import { sabnzbdApi } from '../../src/api/sabnzbd';
import { sonarrApi, SonarrEpisode } from '../../src/api/sonarr';
import { tautulliApi, TautulliSession } from '../../src/api/tautulli';
import { ServiceConfig, ServiceName } from '../../src/api/types';
import { posterUrl as smallPoster } from './images';

type Servers = Partial<Record<ServiceName, ServiceConfig>>;

export interface PosterItem {
  key: string;
  kind: 'tv' | 'movie';
  title: string;
  /** "S2 · E5", "Digital", "In cinemas" */
  detail: string;
  /** Air time, release day, or import time (ms). */
  when: number;
  allDay: boolean;
  hasFile: boolean;
  poster?: string;
  /** The detail page this card opens: /shows/<id> or /movies/<id>. */
  href?: string;
}

export interface QueueItem {
  key: string;
  title: string;
  subtitle: string;
  progress: number; // 0..1
  status: string;
  timeleft?: string;
  source: 'sonarr' | 'radarr' | 'sabnzbd';
  href?: string;
}

export interface DashboardData {
  upNext: PosterItem[];
  upcomingMovies: PosterItem[];
  recentlyAdded: PosterItem[];
  downloading: QueueItem[];
  nowPlaying: TautulliSession[];
  /** Per-row error text, keyed like the fields above. */
  errors: Partial<Record<keyof Omit<DashboardData, 'errors'>, string>>;
}

const EMPTY: DashboardData = { upNext: [], upcomingMovies: [], recentlyAdded: [], downloading: [], nowPlaying: [], errors: {} };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sonarr's Upcoming, as the phone app's TV Shows > Upcoming tab builds it, for the next 7 days. */
async function loadUpNext(config: ServiceConfig): Promise<PosterItem[]> {
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const episodes: SonarrEpisode[] = await sonarrApi.getCalendar(config, start.toISOString(), end.toISOString());
  // One tile per series per day: a double episode shows as "E5–6".
  const groups = new Map<string, { item: PosterItem; lo: number; hi: number; season: number }>();
  for (const ep of [...episodes].sort((a, b) => (a.airDateUtc ?? '').localeCompare(b.airDateUtc ?? ''))) {
    if (!ep.airDateUtc) continue;
    const when = new Date(ep.airDateUtc).getTime();
    const key = `${ep.seriesId}/${ep.seasonNumber}/${new Date(when).toDateString()}`;
    const g = groups.get(key);
    if (g) {
      g.lo = Math.min(g.lo, ep.episodeNumber);
      g.hi = Math.max(g.hi, ep.episodeNumber);
      g.item.hasFile = g.item.hasFile && ep.hasFile;
      continue;
    }
    groups.set(key, {
      lo: ep.episodeNumber,
      hi: ep.episodeNumber,
      season: ep.seasonNumber,
      item: {
        key: `ep-${ep.id}`,
        kind: 'tv',
        title: ep.series?.title ?? ep.title,
        detail: '',
        when,
        allDay: false,
        hasFile: ep.hasFile,
        poster: smallPoster(ep.series?.images),
        href: `/shows/${ep.seriesId}`,
      },
    });
  }
  return [...groups.values()].map(({ item, lo, hi, season }) => ({
    ...item,
    detail: `S${season} · E${lo}${hi !== lo ? `–${hi}` : ''}`,
  }));
}

/** Radarr's Upcoming: each movie at its soonest theatrical/digital/physical date not already past. */
async function loadUpcomingMovies(config: ServiceConfig): Promise<PosterItem[]> {
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  const movies: RadarrMovie[] = await radarrApi.getCalendar(config, start.toISOString(), end.toISOString());
  const out: PosterItem[] = [];
  for (const m of movies) {
    const candidates: [string | undefined, string][] = [
      [m.inCinemas, 'In cinemas'],
      [m.digitalRelease, 'Digital'],
      [m.physicalRelease, 'Physical'],
    ];
    let best: { when: number; label: string } | null = null;
    for (const [date, label] of candidates) {
      if (!date) continue;
      // Radarr's release dates are calendar days stored as UTC midnight: compare and show them as days.
      const d = new Date(date);
      const day = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
      if (day < start.getTime()) continue;
      if (!best || day < best.when) best = { when: day, label };
    }
    if (!best) continue;
    out.push({
      key: `movie-${m.id}`,
      kind: 'movie',
      title: m.title,
      detail: best.label,
      when: best.when,
      allDay: true,
      hasFile: m.hasFile,
      poster: smallPoster(m.images),
      href: `/movies/${m.id}`,
    });
  }
  return out.sort((a, b) => a.when - b.when);
}

/** The newest imports from Sonarr and Radarr history, one tile per show or movie. */
async function loadRecentlyAdded(servers: Servers): Promise<PosterItem[]> {
  const [tv, movies] = await Promise.all([
    servers.sonarr ? sonarrApi.getHistory(servers.sonarr, 60).then((r) => r.records) : Promise.resolve([]),
    servers.radarr ? radarrApi.getHistory(servers.radarr, 40).then((r) => r.records) : Promise.resolve([]),
  ]);
  const items: PosterItem[] = [];
  const seen = new Set<string>();
  for (const r of tv) {
    if (r.eventType !== 'downloadFolderImported' || !r.series) continue;
    const key = `s-${r.seriesId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key: `hist-${r.id}`,
      kind: 'tv',
      title: r.series.title,
      detail: r.episode ? `S${r.episode.seasonNumber} · E${r.episode.episodeNumber}` : '',
      when: new Date(r.date).getTime(),
      allDay: false,
      hasFile: true,
      poster: smallPoster(r.series.images),
      href: `/shows/${r.seriesId}`,
    });
  }
  for (const r of movies) {
    if (r.eventType !== 'downloadFolderImported' || !r.movie) continue;
    const key = `m-${r.movieId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key: `hist-m-${r.id}`,
      kind: 'movie',
      title: r.movie.title,
      detail: r.quality?.quality.name ?? 'Movie',
      when: new Date(r.date).getTime(),
      allDay: false,
      hasFile: true,
      poster: smallPoster(r.movie.images),
      href: `/movies/${r.movieId}`,
    });
  }
  return items.sort((a, b) => b.when - a.when).slice(0, 20);
}

/**
 * What is downloading: Sonarr's and Radarr's own queues (so torrents and Usenet both show, with the
 * show or movie they belong to), plus anything in SABnzbd that neither of them grabbed.
 */
async function loadDownloading(servers: Servers): Promise<QueueItem[]> {
  const [tv, movies, sab] = await Promise.all([
    servers.sonarr ? sonarrApi.getQueue(servers.sonarr).then((r) => r.records).catch(() => []) : Promise.resolve([]),
    servers.radarr ? radarrApi.getQueue(servers.radarr).then((r) => r.records).catch(() => []) : Promise.resolve([]),
    servers.sabnzbd ? sabnzbdApi.getQueue(servers.sabnzbd).then((r) => r.queue.slots).catch(() => []) : Promise.resolve([]),
  ]);
  const items: QueueItem[] = [];
  const claimed = new Set<string>();
  const progress = (size: number, left: number) => (size > 0 ? Math.max(0, Math.min(1, 1 - left / size)) : 0);
  for (const q of tv) {
    if (q.downloadId) claimed.add(q.downloadId.toLowerCase());
    items.push({
      key: `sq-${q.id}`,
      title: q.series?.title ?? q.title,
      subtitle: q.title,
      progress: progress(q.size, q.sizeleft),
      status: q.trackedDownloadState ?? q.status,
      timeleft: q.timeleft,
      source: 'sonarr',
      href: `/shows/${q.seriesId}`,
    });
  }
  for (const q of movies) {
    if (q.downloadId) claimed.add(q.downloadId.toLowerCase());
    items.push({
      key: `rq-${q.id}`,
      title: q.movie?.title ?? q.title,
      subtitle: q.title,
      progress: progress(q.size, q.sizeleft),
      status: q.trackedDownloadState ?? q.status,
      timeleft: q.timeleft,
      source: 'radarr',
      href: `/movies/${q.movieId}`,
    });
  }
  for (const s of sab) {
    if (claimed.has(s.nzo_id.toLowerCase())) continue;
    items.push({
      key: `sab-${s.nzo_id}`,
      title: s.filename,
      subtitle: `${s.sizeleft} left of ${s.size}`,
      progress: Math.max(0, Math.min(1, Number(s.percentage) / 100 || 0)),
      status: s.status,
      timeleft: s.timeleft,
      source: 'sabnzbd',
    });
  }
  return items;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Could not load');

/** Loads every row, refreshing every minute and whenever the app comes back to the foreground. */
export function useDashboard(servers: Servers, ready: boolean) {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    const [upNext, upcomingMovies, recentlyAdded, downloading, nowPlaying] = await Promise.allSettled([
      servers.sonarr ? loadUpNext(servers.sonarr) : Promise.resolve([]),
      servers.radarr ? loadUpcomingMovies(servers.radarr) : Promise.resolve([]),
      servers.sonarr || servers.radarr ? loadRecentlyAdded(servers) : Promise.resolve([]),
      loadDownloading(servers),
      servers.tautulli ? tautulliApi.getActivity(servers.tautulli).then((a) => a.sessions ?? []) : Promise.resolve([]),
    ]);
    const errors: DashboardData['errors'] = {};
    const value = <T,>(r: PromiseSettledResult<T[]>, key: keyof DashboardData['errors']): T[] => {
      if (r.status === 'fulfilled') return r.value;
      errors[key] = errorText(r.reason);
      return [];
    };
    setData({
      upNext: value(upNext, 'upNext'),
      upcomingMovies: value(upcomingMovies, 'upcomingMovies'),
      recentlyAdded: value(recentlyAdded, 'recentlyAdded'),
      downloading: value(downloading, 'downloading'),
      nowPlaying: value(nowPlaying, 'nowPlaying'),
      errors,
    });
    setLoading(false);
    inFlight.current = false;
  }, [servers, ready]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  return { data, loading, reload: load };
}
