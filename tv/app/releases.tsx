// Interactive ("manual") release search on the TV - the phone's series/movie/artist releases screens
// in one: `service` = sonarr (seriesId [+ seasonNumber | episodeId]), radarr (movieId) or lidarr
// (artistId [+ albumId]). Lists what the indexers found with quality, size, age, seeders and indexer;
// a filter box narrows by title. OK grabs after a confirm; a rejected release shows why it was rejected
// first and can still be grabbed, as on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { lidarrApi } from '../../src/api/lidarr';
import { radarrApi } from '../../src/api/radarr';
import { sonarrApi } from '../../src/api/sonarr';
import { ArrRelease } from '../../src/api/types';
import { alert } from '../../src/lib/alert';
import { formatBytes } from '../../src/lib/format';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { errText, ListFrame, ListRow, Loading, Message, ScreenHeader, SIDE, TV_LIST, TvTextField, useLoad } from '../components/ui';
import { useEnabledServers } from '../lib/useEnabledServers';

const TINT = { sonarr: colors.sonarr, radarr: colors.accent, lidarr: colors.lidarr } as const;

const age = (days: number) => (days < 1 ? 'today' : days < 60 ? `${Math.round(days)}d` : days < 730 ? `${Math.round(days / 30)}mo` : `${Math.round(days / 365)}y`);

export default function TvReleases() {
  const p = useLocalSearchParams<{
    service: 'sonarr' | 'radarr' | 'lidarr';
    title?: string;
    seriesId?: string;
    seasonNumber?: string;
    episodeId?: string;
    movieId?: string;
    artistId?: string;
    albumId?: string;
  }>();
  const service = p.service ?? 'radarr';
  const tint = TINT[service];
  const { servers, ready } = useEnabledServers();
  const config = servers[service];
  const [filter, setFilter] = useState('');

  const load = useCallback((): Promise<ArrRelease[]> => {
    if (service === 'sonarr') {
      return sonarrApi.getReleases(config!, {
        seriesId: Number(p.seriesId),
        seasonNumber: p.seasonNumber != null ? Number(p.seasonNumber) : undefined,
        episodeId: p.episodeId != null ? Number(p.episodeId) : undefined,
      });
    }
    if (service === 'lidarr') {
      return lidarrApi.getReleases(config!, { artistId: Number(p.artistId), albumId: p.albumId != null ? Number(p.albumId) : undefined });
    }
    return radarrApi.getReleases(config!, Number(p.movieId));
  }, [service, config, p.seriesId, p.seasonNumber, p.episodeId, p.movieId, p.artistId, p.albumId]);

  const releases = useLoad(load, [load], ready && !!config);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = releases.data ?? [];
    // Approved first, as the indexers rank them; rejected after.
    const sorted = [...all.filter((r) => !r.rejected), ...all.filter((r) => r.rejected)];
    return q ? sorted.filter((r) => r.title.toLowerCase().includes(q)) : sorted;
  }, [releases.data, filter]);

  const grab = (r: ArrRelease) => {
    const doGrab = async () => {
      try {
        const body = { guid: r.guid, indexerId: r.indexerId };
        if (service === 'sonarr') await sonarrApi.grabRelease(config!, body);
        else if (service === 'lidarr') await lidarrApi.grabRelease(config!, body);
        else await radarrApi.grabRelease(config!, body);
        router.back();
      } catch (e) {
        alert('Grab failed', errText(e));
      }
    };
    alert(r.rejected ? 'Rejected release' : 'Grab Release', r.rejected ? `${r.rejections?.join('\n') ?? 'Rejected'}\n\nDownload "${r.title}" anyway?` : `Download "${r.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: r.rejected ? 'Grab anyway' : 'Grab', style: r.rejected ? 'destructive' : 'default', onPress: doGrab },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={p.title ?? 'Releases'} tint={tint} count={releases.data ? shown.length : undefined} subtitle="Interactive search" />
      <View style={{ paddingHorizontal: SIDE, marginBottom: 6 }}>
        <TvTextField value={filter} onChangeText={setFilter} placeholder="Filter releases…" />
      </View>
      {releases.loading ? (
        <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={shown}
            keyExtractor={(r) => `${r.indexerId}-${r.guid}`}
            contentContainerStyle={listStyles.list}
            initialNumToRender={12}
            ListEmptyComponent={<Message text={releases.error ?? 'No releases found.'} error={!!releases.error} />}
            renderItem={({ item: r, index }) => (
              <ListRow
                title={r.title}
                subtitle={[r.quality.quality.name, formatBytes(r.size), age(r.age), r.seeders != null ? `${r.seeders} seeders` : '', r.indexer].filter(Boolean).join('  ·  ')}
                meta={r.rejected ? 'Rejected' : 'Grab'}
                metaColor={r.rejected ? colors.danger : colors.success}
                icon={r.rejected ? 'alert-circle' : 'cloud-download'}
                tint={r.rejected ? colors.danger : tint}
                preferredFocus={index === 0}
                onPress={() => grab(r)}
              />
            )}
          />
        </ListFrame>
      )}
    </View>
  );
}
