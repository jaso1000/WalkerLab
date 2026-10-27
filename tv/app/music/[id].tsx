// An artist on the TV (the phone's app/artist/[id]): fanart backdrop, name, type, status, overview
// and totals; Search (automatic), Interactive search, Monitored toggle and Remove from Library (Remove
// Only, or Remove and delete files). Albums below, newest first; OK on an album offers Open (its
// tracks), Monitor/Unmonitor, Automatic album search and Manual album search.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { LidarrAlbum, lidarrApi, LidarrArtist } from '../../../src/api/lidarr';
import { alert } from '../../../src/lib/alert';
import { formatBytes } from '../../../src/lib/format';
import { colors } from '../../../src/theme/colors';
import { ActionButton, ButtonRow, Backdrop, detailStyles, TitleBlock, useNotice } from '../../components/Detail';
import { listStyles } from '../../components/DownloadClientView';
import { Thumb } from '../../components/TautulliHistory';
import { errText, ListFrame, ListRow, TV_LIST } from '../../components/ui';
import { albumImage, artistImage } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';

const tint = colors.lidarr;

export default function TvArtist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const artistId = Number(id);
  const { servers, ready } = useEnabledServers();
  const config = servers.lidarr;
  const [artist, setArtist] = useState<LidarrArtist | null>(null);
  const [albums, setAlbums] = useState<LidarrAlbum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const notice = useNotice();

  const load = useCallback(async () => {
    if (!config) return;
    try {
      const [a, al] = await Promise.all([lidarrApi.getArtistById(config, artistId), lidarrApi.getAlbums(config, artistId)]);
      setArtist(a);
      setAlbums(al.sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? '')));
    } catch (e) {
      setError(errText(e));
    }
  }, [config, artistId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (ready && !config) return <Text style={detailStyles.error}>Lidarr is not set up in this profile.</Text>;
  if (error) return <Text style={detailStyles.error}>{error}</Text>;
  if (!artist || !config) {
    return (
      <View style={detailStyles.loading}>
        <ActivityIndicator color={tint} size="large" />
      </View>
    );
  }

  const st = artist.statistics;
  const removeFromLibrary = () =>
    alert('Remove from Library', `Remove "${artist.artistName}" from Lidarr?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Only', onPress: () => lidarrApi.deleteArtist(config, artist.id, false).then(() => router.back()).catch((e) => alert('Failed', errText(e))) },
      {
        text: 'Remove and delete files',
        style: 'destructive',
        onPress: () => lidarrApi.deleteArtist(config, artist.id, true).then(() => router.back()).catch((e) => alert('Failed', errText(e))),
      },
    ]);

  const albumMenu = (album: LidarrAlbum) =>
    alert(album.title, [album.albumType, album.releaseDate?.slice(0, 4)].filter(Boolean).join(' · '), [
      { text: 'Open', onPress: () => router.push(`/music/album?albumId=${album.id}&artistId=${artist.id}` as never) },
      {
        text: album.monitored ? 'Unmonitor' : 'Monitor',
        onPress: () =>
          lidarrApi
            .updateAlbumsMonitored(config, [album.id], !album.monitored)
            .then(load)
            .catch((e) => alert('Failed', errText(e))),
      },
      {
        text: 'Automatic album search',
        onPress: () =>
          lidarrApi
            .searchAlbumRelease(config, album.id)
            .then(() => notice.show(`Searching for ${album.title}…`))
            .catch((e) => alert('Failed', errText(e))),
      },
      {
        text: 'Manual album search',
        onPress: () =>
          router.push(`/releases?service=lidarr&artistId=${artist.id}&albumId=${album.id}&title=${encodeURIComponent(`${artist.artistName} · ${album.title}`)}` as never),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={detailStyles.screen}>
      <Backdrop uri={artistImage(artist, config, 'fanart', 1000)} />
      <ListFrame>
        <FlatList
          {...TV_LIST}
         
          data={albums}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={[listStyles.list, { paddingHorizontal: 56, paddingTop: 60 }]}
          ListHeaderComponent={
            <View style={{ marginBottom: 10 }}>
              <TitleBlock
                title={artist.artistName}
                meta={[artist.artistType, artist.status, st && `${st.albumCount} albums`, st && `${st.trackFileCount}/${st.trackCount} tracks`, st && formatBytes(st.sizeOnDisk)]}
                genres={artist.genres}
                overview={artist.overview}
              />
              <ButtonRow>
                <ActionButton
                  icon="search"
                  label="Search"
                  tint={tint}
                  primary
                  preferredFocus
                  onPress={() =>
                    lidarrApi
                      .searchArtistRelease(config, artist.id)
                      .then(() => notice.show(`Searching for ${artist.artistName}…`))
                      .catch((e) => notice.show(errText(e), true))
                  }
                />
                <ActionButton icon="list" label="Interactive" tint={tint} onPress={() => router.push(`/releases?service=lidarr&artistId=${artist.id}&title=${encodeURIComponent(artist.artistName)}` as never)} />
                <ActionButton
                  icon={artist.monitored ? 'eye' : 'eye-off'}
                  label={artist.monitored ? 'Monitored' : 'Not monitored'}
                  tint={artist.monitored ? colors.success : colors.textMuted}
                  onPress={() =>
                    lidarrApi
                      .updateArtist(config, { ...artist, monitored: !artist.monitored })
                      .then(setArtist)
                      .catch((e) => notice.show(errText(e), true))
                  }
                />
                <ActionButton icon="trash-outline" label="Remove" tint={colors.danger} onPress={removeFromLibrary} />
              </ButtonRow>
              {notice.view}
              <Text style={detailStyles.sectionTitle}>Albums</Text>
            </View>
          }
          renderItem={({ item: al }) => (
            <ListRow
              title={al.title}
              subtitle={[al.albumType, al.releaseDate?.slice(0, 4), al.statistics && `${al.statistics.trackFileCount}/${al.statistics.trackCount} tracks`].filter(Boolean).join(' · ')}
              meta={al.monitored ? (al.statistics && al.statistics.trackFileCount >= al.statistics.trackCount && al.statistics.trackCount > 0 ? 'Complete' : 'Monitored') : 'Unmonitored'}
              metaColor={al.monitored ? tint : colors.textMuted}
              thumb={<Thumb uri={albumImage(al, config)} />}
              onPress={() => albumMenu(al)}
            />
          )}
        />
      </ListFrame>
    </View>
  );
}
