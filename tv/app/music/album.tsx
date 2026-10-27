// An album's tracks on the TV (the phone's app/artist/[id]/album/[albumId]): each track with its
// length and whether it is downloaded, plus Search (automatic), Interactive search, and Delete files
// (the album's downloaded tracks, after a confirm).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, View } from 'react-native';
import { lidarrApi } from '../../../src/api/lidarr';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';
import { ActionButton, detailStyles, useNotice } from '../../components/Detail';
import { listStyles } from '../../components/DownloadClientView';
import { errText, ListFrame, ListRow, Loading, Message, ScreenHeader, SIDE, TV_LIST, useLoad } from '../../components/ui';
import { useEnabledServers } from '../../lib/useEnabledServers';

const tint = colors.lidarr;
const length = (ms: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');

export default function TvAlbum() {
  const { albumId, artistId } = useLocalSearchParams<{ albumId: string; artistId: string }>();
  const id = Number(albumId);
  const { servers, ready } = useEnabledServers();
  const config = servers.lidarr;
  const notice = useNotice();

  const load = useCallback(async () => {
    const [album, tracks, files] = await Promise.all([lidarrApi.getAlbumById(config!, id), lidarrApi.getTracks(config!, id), lidarrApi.getTrackFiles(config!, id)]);
    return { album, tracks: tracks.sort((a, b) => a.absoluteTrackNumber - b.absoluteTrackNumber), files };
  }, [config, id]);
  const data = useLoad(load, [load], ready && !!config);

  if (data.loading) return <Loading tint={tint} />;
  if (!data.data) return <Message text={data.error ?? 'Album not found.'} error />;
  const { album, tracks, files } = data.data;

  const deleteFiles = () => {
    const ids = files.map((f) => f.id);
    if (ids.length === 0) return alert('Nothing to delete', 'No downloaded tracks on this album.');
    alert('Delete Files', `Delete ${ids.length} downloaded track file${ids.length === 1 ? '' : 's'} from "${album.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => lidarrApi.deleteTrackFilesBulk(config!, ids).then(data.reload).catch((e) => alert('Delete failed', errText(e))) },
    ]);
  };

  return (
    <View style={detailStyles.screen}>
      <ScreenHeader title={album.title} tint={tint} subtitle={[album.artist?.artistName, album.albumType, album.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')} />
      <View style={[detailStyles.buttons, { paddingHorizontal: SIDE, marginTop: 4 }]}>
        <ActionButton
          icon="search"
          label="Search"
          tint={tint}
          primary
          preferredFocus
          onPress={() => lidarrApi.searchAlbumRelease(config!, id).then(() => notice.show(`Searching for ${album.title}…`)).catch((e) => notice.show(errText(e), true))}
        />
        <ActionButton
          icon="list"
          label="Interactive"
          tint={tint}
          onPress={() => router.push(`/releases?service=lidarr&artistId=${artistId}&albumId=${id}&title=${encodeURIComponent(album.title)}` as never)}
        />
        <ActionButton icon="trash-outline" label="Delete files" tint={colors.danger} onPress={deleteFiles} />
      </View>
      <View style={{ paddingHorizontal: SIDE }}>{notice.view}</View>
      <ListFrame>
        <FlatList
          {...TV_LIST}
          data={tracks}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={listStyles.list}
          renderItem={({ item: t }) => (
            <ListRow
              title={`${t.trackNumber}. ${t.title}`}
              subtitle={length(t.duration)}
              meta={t.hasFile ? 'Downloaded' : 'Missing'}
              metaColor={t.hasFile ? colors.success : colors.accent}
              icon={t.hasFile ? 'checkmark-circle' : 'time-outline'}
              tint={t.hasFile ? colors.success : colors.accent}
            />
          )}
        />
      </ListFrame>
    </View>
  );
}
