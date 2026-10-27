// Music (Lidarr) on the TV - the phone's app/music.tsx tabs through tv/components/ArrSection: artists
// as a grid (complete = green tick, missing tracks = amber clock), Missing, Upcoming (album releases
// over the next 60 days), Activity (Lidarr's queue), History, and Server (Update Library, Search All
// Missing, Unmonitor All Downloaded). OK on an artist opens its albums.
import { router } from 'expo-router';
import { useCallback } from 'react';
import { lidarrApi, LidarrArtist, lidarrImageUrl } from '../../../src/api/lidarr';
import { alert } from '../../../src/lib/alert';
import { formatBytes, formatRelativeTime, historyEventLabel } from '../../../src/lib/format';
import { colors } from '../../../src/theme/colors';
import { ArrItem, ArrRow, ArrSection, ArrServer } from '../../components/ArrSection';
import { Badge } from '../../components/Cards';
import { SortField } from '../../components/LibraryGrid';
import { errText } from '../../components/ui';
import { artistImage } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';

type ArtistItem = ArrItem & { artist: LidarrArtist };
const tint = colors.lidarr;

const isMissing = (a: LidarrArtist) => !a.statistics || a.statistics.trackFileCount < a.statistics.trackCount;

// The phone's Sort By fields for Music (app/music.tsx).
const SORTS: SortField[] = [
  { key: 'title', label: 'Title' },
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

export default function TvMusic() {
  const { servers, ready } = useEnabledServers();
  const config = servers.lidarr;

  const loadLibrary = useCallback(
    async () => {
      const [artists, profiles] = await Promise.all([lidarrApi.getArtists(config!), lidarrApi.getQualityProfiles(config!).catch(() => [])]);
      return artists.map(
        (a): ArtistItem => ({
          key: `a-${a.id}`,
          artist: a,
          missing: isMissing(a),
          title: a.artistName,
          sort: {
            title: a.artistName.toLowerCase(),
            added: since(a.added),
            size: a.statistics?.sizeOnDisk ?? 0,
            qualityProfile: profileName(profiles, a.qualityProfileId),
            genre: a.genres?.[0]?.toLowerCase() ?? '',
          },
          poster: artistImage(a, config!),
          badge: !isMissing(a) ? COMPLETE_BADGE : a.monitored ? MISSING_BADGE : undefined,
          subtitle: a.statistics ? `${a.statistics.albumCount} albums · ${a.statistics.trackFileCount}/${a.statistics.trackCount} tracks` : a.status,
          href: `/music/${a.id}`,
        })
      );
    },
    [config]
  );

  const loadUpcoming = useCallback(async (): Promise<ArrRow[]> => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 60);
    const albums = await lidarrApi.getCalendar(config!, start.toISOString(), end.toISOString());
    return albums
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''))
      .map((al) => ({
        key: `u-${al.id}`,
        title: al.title,
        subtitle: `${al.artist?.artistName ?? ''}${al.albumType ? ` · ${al.albumType}` : ''} · ${al.releaseDate ? new Date(al.releaseDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : 'TBA'}`,
        meta: al.monitored ? 'Monitored' : 'Unmonitored',
        metaColor: al.monitored ? tint : colors.textMuted,
        poster: lidarrImageUrl(al.images.find((i) => i.coverType === 'cover') ?? al.images[0], config!, { type: 'album', id: al.id }, 250) ?? '',
        onPress: () => router.push(`/music/${al.artistId}` as never),
      }));
  }, [config]);

  const loadActivity = useCallback(async (): Promise<ArrRow[]> => {
    const q = await lidarrApi.getQueue(config!);
    return q.records.map((item) => ({
      key: `q-${item.id}`,
      title: item.title,
      subtitle: item.errorMessage ?? item.statusMessages?.flatMap((m) => m.messages).join(' · '),
      meta: [item.trackedDownloadState ?? item.status, item.timeleft].filter(Boolean).join(' · '),
      metaColor: item.trackedDownloadStatus === 'warning' ? colors.danger : tint,
      progress: item.size > 0 ? 1 - item.sizeleft / item.size : 0,
      icon: 'download' as const,
      onPress: item.artistId ? () => router.push(`/music/${item.artistId}` as never) : undefined,
    }));
  }, [config]);

  const loadHistory = useCallback(async (): Promise<ArrRow[]> => {
    const h = await lidarrApi.getHistory(config!, 50);
    return h.records.map((r) => ({
      key: `h-${r.id}`,
      title: r.artist?.artistName ?? r.sourceTitle,
      subtitle: `${historyEventLabel(r.eventType)}${r.album ? ` · ${r.album.title}` : ''}${r.track ? ` · ${r.track.title}` : ''}`,
      meta: formatRelativeTime(r.date),
      metaColor: r.eventType === 'grabbed' ? tint : r.eventType.includes('elete') ? colors.danger : colors.success,
      icon: 'musical-notes' as const,
    }));
  }, [config]);

  const loadServer = useCallback(
    async (library: ArtistItem[], refresh: () => void): Promise<ArrServer> => {
      const [status, disks] = await Promise.all([lidarrApi.getSystemStatus(config!), lidarrApi.getDiskSpace(config!)]);
      const artists = library.map((i) => i.artist);
      const run = (fn: () => Promise<unknown>, done: string) => () =>
        fn()
          .then(() => alert(done))
          .catch((e) => alert('Failed', errText(e)));
      return {
        version: status.version,
        stats: [
          { label: 'Artists', value: String(artists.length) },
          { label: 'Downloaded', value: String(artists.filter((a) => !isMissing(a)).length) },
          { label: 'Missing', value: String(artists.filter(isMissing).length) },
          { label: 'On Disk', value: formatBytes(artists.reduce((n, a) => n + (a.statistics?.sizeOnDisk ?? 0), 0)) },
        ],
        disks,
        actions: [
          { label: 'Update Library', icon: 'refresh-outline', onPress: run(() => lidarrApi.refreshAllArtists(config!), 'Library update started') },
          { label: 'Search All Missing', icon: 'search-outline', onPress: run(() => lidarrApi.searchAllMissing(config!), 'Searching for all missing albums') },
          {
            label: 'Unmonitor All Downloaded',
            icon: 'bookmark-outline',
            onPress: () => {
              const ids = artists.filter((a) => !isMissing(a) && a.monitored).map((a) => a.id);
              if (ids.length === 0) return alert('Nothing to do', 'No fully downloaded artists are monitored.');
              alert('Unmonitor All Downloaded', `Stop monitoring ${ids.length} artists that already have every track?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Unmonitor', onPress: () => lidarrApi.bulkUpdateArtistsMonitored(config!, ids, false).then(refresh).catch((e) => alert('Failed', errText(e))) },
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
      section="music"
      service="Lidarr"
      tint={tint}
      configured={ready ? !!config : undefined}
      loadLibrary={loadLibrary}
      sorts={SORTS}
      sortScope="lidarr"
      loadUpcoming={loadUpcoming}
      loadActivity={loadActivity}
      loadHistory={loadHistory}
      loadServer={loadServer}
    />
  );
}
