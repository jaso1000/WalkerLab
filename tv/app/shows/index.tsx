// TV Shows (Sonarr) on the TV - the phone's app/index.tsx tabs through tv/components/ArrSection:
// the library grid with the phone's badges (complete = green tick, missing episodes = amber clock),
// Missing (episodes without files, as the phone counts them), Upcoming (the calendar from midnight
// today, 60 days), Activity (Sonarr's queue: View series, Manual Import, Remove from Queue - Remove
// Only or Remove & Blocklist), History, and Server (Update Library, Search All Missing, Unmonitor All
// Downloaded).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Text } from 'react-native';
import { sonarrApi, SonarrSeries } from '../../../src/api/sonarr';
import { alert } from '../../../src/lib/alert';
import { formatBytes, formatRelativeTime, historyEventLabel } from '../../../src/lib/format';
import { colors } from '../../../src/theme/colors';
import { ArrItem, ArrRow, ArrSection, ArrServer } from '../../components/ArrSection';
import { Badge } from '../../components/Cards';
import { SortField } from '../../components/LibraryGrid';
import { errText } from '../../components/ui';
import { posterUrl } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';

type ShowItem = ArrItem & { series: SonarrSeries };
const tint = colors.sonarr;

const isMissing = (s: SonarrSeries) => !s.statistics || s.statistics.episodeFileCount < s.statistics.episodeCount;

// The phone's Sort By fields for TV Shows (app/index.tsx).
const SORTS: SortField[] = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'size', label: 'Size', defaultAsc: false },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
];
/** The phone's "Date Added" / "Digital Release" sort value: nearest to today first. */
const since = (iso?: string) => (iso ? Math.abs(Date.now() - new Date(iso).getTime()) : Number.POSITIVE_INFINITY);
type Profile = { id: number; name: string };
const profileName = (profiles: Profile[], id: number) => profiles.find((p) => p.id === id)?.name.toLowerCase() ?? '';

const COMPLETE_BADGE: Badge = { icon: 'checkmark', color: colors.success };
const MISSING_BADGE: Badge = { icon: 'time-outline', color: colors.accent };

function toItem(s: SonarrSeries, profiles: Profile[]): ShowItem {
  const st = s.statistics;
  return {
    key: `s-${s.id}`,
    series: s,
    missing: isMissing(s),
    title: s.title,
    sort: {
      title: s.title.toLowerCase(),
      year: s.year ?? 0,
      added: since(s.added),
      size: st?.sizeOnDisk ?? 0,
      qualityProfile: profileName(profiles, s.qualityProfileId),
      genre: s.genres?.[0]?.toLowerCase() ?? '',
    },
    poster: posterUrl(s.images),
    badge: !isMissing(s) ? COMPLETE_BADGE : s.monitored ? MISSING_BADGE : undefined,
    subtitle: (
      <>
        {s.ratings?.value ? (
          <Text>
            <Ionicons name="star" size={11} color={colors.sectionGreen} /> {s.ratings.value.toFixed(1)}
            {'   '}
          </Text>
        ) : null}
        {st ? `${st.episodeFileCount}/${st.episodeCount} eps` : s.year ? s.year : ''}
      </>
    ),
    href: `/shows/${s.id}`,
  };
}

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'TBA';

export default function TvShows() {
  const { servers, ready } = useEnabledServers();
  const config = servers.sonarr;

  const loadLibrary = useCallback(async () => {
    const [series, profiles] = await Promise.all([sonarrApi.getSeries(config!), sonarrApi.getQualityProfiles(config!).catch(() => [])]);
    return series.map((x) => toItem(x, profiles));
  }, [config]);

  const loadUpcoming = useCallback(async (): Promise<ArrRow[]> => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 60);
    const eps = await sonarrApi.getCalendar(config!, start.toISOString(), end.toISOString());
    return eps
      .sort((a, b) => (a.airDateUtc ?? '').localeCompare(b.airDateUtc ?? ''))
      .map((e) => ({
        key: `ep-${e.id}`,
        title: e.series?.title ?? e.title,
        subtitle: `S${e.seasonNumber} · E${e.episodeNumber} · ${e.title} · ${when(e.airDateUtc)}`,
        meta: e.hasFile ? 'Downloaded' : e.monitored ? 'Monitored' : 'Unmonitored',
        metaColor: e.hasFile ? colors.success : e.monitored ? tint : colors.textMuted,
        poster: posterUrl(e.series?.images) ?? '',
        onPress: () => router.push(`/shows/${e.seriesId}` as never),
      }));
  }, [config]);

  const loadActivity = useCallback(
    async (refresh: () => void): Promise<ArrRow[]> => {
      const q = await sonarrApi.getQueue(config!);
      return q.records.map((item) => ({
        key: `q-${item.id}`,
        title: item.series?.title ?? item.title,
        subtitle: item.errorMessage ?? item.title,
        meta: [item.trackedDownloadState ?? item.status, item.timeleft].filter(Boolean).join(' · '),
        metaColor: item.trackedDownloadStatus === 'warning' || item.trackedDownloadState === 'importBlocked' ? colors.danger : tint,
        progress: item.size > 0 ? 1 - item.sizeleft / item.size : 0,
        icon: 'download' as const,
        onPress: () =>
          alert(item.series?.title ?? item.title, item.statusMessages?.flatMap((m) => m.messages).join('\n') || item.title, [
            { text: 'View Series', onPress: () => router.push(`/shows/${item.seriesId}` as never) },
            ...(item.downloadId
              ? [{ text: 'Manual Import', onPress: () => router.push(`/import?service=sonarr&downloadId=${encodeURIComponent(item.downloadId!)}` as never) }]
              : []),
            {
              text: 'Remove from Queue',
              style: 'destructive' as const,
              onPress: () =>
                alert('Remove from Queue', `Remove "${item.title}" from the queue?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove Only', onPress: () => sonarrApi.removeQueueItem(config!, item.id).then(refresh).catch((e) => alert('Failed', errText(e))) },
                  {
                    text: 'Remove & Blocklist',
                    style: 'destructive',
                    onPress: () => sonarrApi.removeQueueItem(config!, item.id, { blocklist: true }).then(refresh).catch((e) => alert('Failed', errText(e))),
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
    const h = await sonarrApi.getHistory(config!, 50);
    return h.records.map((r) => ({
      key: `h-${r.id}`,
      title: r.series?.title ?? r.sourceTitle,
      subtitle: `${historyEventLabel(r.eventType)}${r.episode ? ` · S${r.episode.seasonNumber} E${r.episode.episodeNumber} · ${r.episode.title}` : ''}${r.quality ? ` · ${r.quality.quality.name}` : ''}`,
      meta: formatRelativeTime(r.date),
      metaColor: r.eventType === 'grabbed' ? tint : r.eventType.includes('elete') ? colors.danger : colors.success,
      poster: posterUrl(r.series?.images) ?? '',
      onPress: r.series ? () => router.push(`/shows/${r.seriesId}` as never) : undefined,
    }));
  }, [config]);

  const loadServer = useCallback(
    async (library: ShowItem[], refresh: () => void): Promise<ArrServer> => {
      const [status, disks] = await Promise.all([sonarrApi.getSystemStatus(config!), sonarrApi.getDiskSpace(config!)]);
      const series = library.map((i) => i.series);
      const run = (fn: () => Promise<unknown>, done: string) => () =>
        fn()
          .then(() => alert(done))
          .catch((e) => alert('Failed', errText(e)));
      return {
        version: status.version,
        stats: [
          { label: 'Series', value: String(series.length) },
          { label: 'Downloaded', value: String(series.filter((s) => !isMissing(s)).length) },
          { label: 'Missing', value: String(series.filter(isMissing).length) },
          { label: 'On Disk', value: formatBytes(series.reduce((n, s) => n + (s.statistics?.sizeOnDisk ?? 0), 0)) },
        ],
        disks,
        actions: [
          { label: 'Update Library', icon: 'refresh-outline', onPress: run(() => sonarrApi.refreshAllSeries(config!), 'Library update started') },
          { label: 'Search All Missing', icon: 'search-outline', onPress: run(() => sonarrApi.searchAllMissing(config!), 'Searching for all missing episodes') },
          {
            label: 'Unmonitor All Downloaded',
            icon: 'bookmark-outline',
            onPress: () => {
              const ids = series.filter((s) => !isMissing(s) && s.monitored).map((s) => s.id);
              if (ids.length === 0) return alert('Nothing to do', 'No fully downloaded series are monitored.');
              alert('Unmonitor All Downloaded', `Stop monitoring ${ids.length} series that already have every episode?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Unmonitor', onPress: () => sonarrApi.bulkUpdateSeriesMonitored(config!, ids, false).then(refresh).catch((e) => alert('Failed', errText(e))) },
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
      section="tvShows"
      service="Sonarr"
      tint={tint}
      configured={ready ? !!config : undefined}
      loadLibrary={loadLibrary}
      sorts={SORTS}
      sortScope="sonarr"
      loadUpcoming={loadUpcoming}
      loadActivity={loadActivity}
      loadHistory={loadHistory}
      loadServer={loadServer}
    />
  );
}
