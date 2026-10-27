// Movies (Radarr) on the TV - the phone's app/movies.tsx tabs through tv/components/ArrSection: the
// library grid (downloaded = green tick, monitored but missing = amber clock), Missing (no file, as the
// phone counts it), Upcoming (each movie at its soonest release date, 60 days), Activity (Radarr's
// queue: View Movie, Manual Import, Remove from Queue - Remove Only or Remove & Blocklist), History,
// and Server (Update Library, Search All Missing, Unmonitor All Downloaded).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Text } from 'react-native';
import { radarrApi, RadarrMovie } from '../../../src/api/radarr';
import { alert } from '../../../src/lib/alert';
import { formatBytes, formatRelativeTime, historyEventLabel } from '../../../src/lib/format';
import { colors } from '../../../src/theme/colors';
import { ArrItem, ArrRow, ArrSection, ArrServer } from '../../components/ArrSection';
import { Badge } from '../../components/Cards';
import { SortField } from '../../components/LibraryGrid';
import { errText } from '../../components/ui';
import { posterUrl } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';

type MovieItem = ArrItem & { movie: RadarrMovie };
const tint = colors.accent;

// The phone's Sort By fields for Movies (app/movies.tsx).
const SORTS: SortField[] = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'digitalRelease', label: 'Digital Release' },
  { key: 'size', label: 'Size', defaultAsc: false },
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
  { key: 'studio', label: 'Studio' },
];
/** The phone's "Date Added" / "Digital Release" sort value: nearest to today first. */
const since = (iso?: string) => (iso ? Math.abs(Date.now() - new Date(iso).getTime()) : Number.POSITIVE_INFINITY);
type Profile = { id: number; name: string };
const profileName = (profiles: Profile[], id: number) => profiles.find((p) => p.id === id)?.name.toLowerCase() ?? '';

const DOWNLOADED_BADGE: Badge = { icon: 'checkmark', color: colors.success };
const MISSING_BADGE: Badge = { icon: 'time-outline', color: colors.accent };

/** The rating the phone's cards lead with: TMDB, else IMDb. */
const rating = (m: RadarrMovie) => m.ratings?.tmdb?.value || m.ratings?.imdb?.value;

function toItem(m: RadarrMovie, profiles: Profile[]): MovieItem {
  const r = rating(m);
  return {
    key: `m-${m.id}`,
    movie: m,
    missing: !m.hasFile,
    title: m.title,
    sort: {
      title: m.title.toLowerCase(),
      year: m.year ?? 0,
      added: since(m.added),
      digitalRelease: since(m.digitalRelease),
      size: m.sizeOnDisk ?? 0,
      rating: m.ratings?.imdb?.value ?? 0,
      popularity: m.popularity ?? 0,
      qualityProfile: profileName(profiles, m.qualityProfileId),
      genre: m.genres?.[0]?.toLowerCase() ?? '',
      studio: m.studio?.toLowerCase() ?? '',
    },
    poster: posterUrl(m.images),
    badge: m.hasFile ? DOWNLOADED_BADGE : m.monitored ? MISSING_BADGE : undefined,
    subtitle: (
      <>
        {r ? (
          <Text>
            <Ionicons name="star" size={11} color={colors.sectionGreen} /> {r.toFixed(1)}
            {'   '}
          </Text>
        ) : null}
        {m.year ? m.year : ''}
      </>
    ),
    href: `/movies/${m.id}`,
  };
}

/** Radarr's soonest theatrical/digital/physical date that is not past (release days are UTC midnight). */
function nearestRelease(m: RadarrMovie): { day: Date; label: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let best: { day: Date; label: string } | null = null;
  for (const [iso, label] of [
    [m.inCinemas, 'In cinemas'],
    [m.digitalRelease, 'Digital'],
    [m.physicalRelease, 'Physical'],
  ] as const) {
    if (!iso) continue;
    const d = new Date(iso);
    const day = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (day < today) continue;
    if (!best || day < best.day) best = { day, label };
  }
  return best;
}

export default function TvMovies() {
  const { servers, ready } = useEnabledServers();
  const config = servers.radarr;

  const loadLibrary = useCallback(async () => {
    const [movies, profiles] = await Promise.all([radarrApi.getMovies(config!), radarrApi.getQualityProfiles(config!).catch(() => [])]);
    return movies.map((x) => toItem(x, profiles));
  }, [config]);

  const loadUpcoming = useCallback(async (): Promise<ArrRow[]> => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 60);
    const movies = await radarrApi.getCalendar(config!, start.toISOString(), end.toISOString());
    return movies
      .map((m) => ({ m, r: nearestRelease(m) }))
      .filter((x): x is { m: RadarrMovie; r: { day: Date; label: string } } => !!x.r)
      .sort((a, b) => a.r.day.getTime() - b.r.day.getTime())
      .map(({ m, r }) => ({
        key: `u-${m.id}`,
        title: m.title,
        subtitle: `${r.label} · ${r.day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}`,
        meta: m.hasFile ? 'Downloaded' : m.monitored ? 'Monitored' : 'Unmonitored',
        metaColor: m.hasFile ? colors.success : m.monitored ? tint : colors.textMuted,
        poster: posterUrl(m.images) ?? '',
        onPress: () => router.push(`/movies/${m.id}` as never),
      }));
  }, [config]);

  const loadActivity = useCallback(
    async (refresh: () => void): Promise<ArrRow[]> => {
      const q = await radarrApi.getQueue(config!);
      return q.records.map((item) => ({
        key: `q-${item.id}`,
        title: item.movie?.title ?? item.title,
        subtitle: item.errorMessage ?? item.title,
        meta: [item.trackedDownloadState ?? item.status, item.timeleft].filter(Boolean).join(' · '),
        metaColor: item.trackedDownloadStatus === 'warning' || item.trackedDownloadState === 'importBlocked' ? colors.danger : tint,
        progress: item.size > 0 ? 1 - item.sizeleft / item.size : 0,
        icon: 'download' as const,
        onPress: () =>
          alert(item.movie?.title ?? item.title, item.statusMessages?.flatMap((m) => m.messages).join('\n') || item.title, [
            { text: 'View Movie', onPress: () => router.push(`/movies/${item.movieId}` as never) },
            ...(item.downloadId
              ? [{ text: 'Manual Import', onPress: () => router.push(`/import?service=radarr&downloadId=${encodeURIComponent(item.downloadId!)}` as never) }]
              : []),
            {
              text: 'Remove from Queue',
              style: 'destructive' as const,
              onPress: () =>
                alert('Remove from Queue', `Remove "${item.title}" from the queue?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove Only', onPress: () => radarrApi.removeQueueItem(config!, item.id).then(refresh).catch((e) => alert('Failed', errText(e))) },
                  {
                    text: 'Remove & Blocklist',
                    style: 'destructive',
                    onPress: () => radarrApi.removeQueueItem(config!, item.id, { blocklist: true }).then(refresh).catch((e) => alert('Failed', errText(e))),
                  },
                ]),
            },
            { text: 'Cancel', style: 'cancel' as const },
          ]),
      }));
    },
    [config]
  );

  const loadHistory = useCallback(async (): Promise<ArrRow[]> => {
    const h = await radarrApi.getHistory(config!, 50);
    return h.records.map((r) => ({
      key: `h-${r.id}`,
      title: r.movie?.title ?? r.sourceTitle,
      subtitle: `${historyEventLabel(r.eventType)}${r.quality ? ` · ${r.quality.quality.name}` : ''} · ${r.sourceTitle}`,
      meta: formatRelativeTime(r.date),
      metaColor: r.eventType === 'grabbed' ? tint : r.eventType.includes('elete') ? colors.danger : colors.success,
      poster: posterUrl(r.movie?.images) ?? '',
      onPress: r.movie ? () => router.push(`/movies/${r.movieId}` as never) : undefined,
    }));
  }, [config]);

  const loadServer = useCallback(
    async (library: MovieItem[], refresh: () => void): Promise<ArrServer> => {
      const [status, disks] = await Promise.all([radarrApi.getSystemStatus(config!), radarrApi.getDiskSpace(config!)]);
      const movies = library.map((i) => i.movie);
      const run = (fn: () => Promise<unknown>, done: string) => () =>
        fn()
          .then(() => alert(done))
          .catch((e) => alert('Failed', errText(e)));
      return {
        version: status.version,
        stats: [
          { label: 'Movies', value: String(movies.length) },
          { label: 'Downloaded', value: String(movies.filter((m) => m.hasFile).length) },
          { label: 'Missing', value: String(movies.filter((m) => !m.hasFile).length) },
          { label: 'On Disk', value: formatBytes(movies.reduce((n, m) => n + (m.sizeOnDisk ?? 0), 0)) },
        ],
        disks,
        actions: [
          { label: 'Update Library', icon: 'refresh-outline', onPress: run(() => radarrApi.refreshAllMovies(config!), 'Library update started') },
          { label: 'Search All Missing', icon: 'search-outline', onPress: run(() => radarrApi.searchAllMissing(config!), 'Searching for all missing movies') },
          {
            label: 'Unmonitor All Downloaded',
            icon: 'bookmark-outline',
            onPress: () => {
              const ids = movies.filter((m) => m.hasFile).map((m) => m.id);
              if (ids.length === 0) return alert('Nothing to do', 'No downloaded movies found.');
              alert('Unmonitor All Downloaded', `Stop monitoring ${ids.length} movies that already have files?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Unmonitor', onPress: () => radarrApi.bulkUpdateMoviesMonitored(config!, ids, false).then(refresh).catch((e) => alert('Failed', errText(e))) },
              ]);
            },
          },
        ],
      };
    },
    [config]
  );

  return (
    <ArrSection
      section="movies"
      service="Radarr"
      tint={tint}
      configured={ready ? !!config : undefined}
      loadLibrary={loadLibrary}
      sorts={SORTS}
      sortScope="radarr"
      loadUpcoming={loadUpcoming}
      loadActivity={loadActivity}
      loadHistory={loadHistory}
      loadServer={loadServer}
    />
  );
}
