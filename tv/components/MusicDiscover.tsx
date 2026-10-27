// Discover's Music tab on the TV (the phone's app/discover.tsx Music page): Recently Added from the
// Lidarr library, Last.fm's Top Artists (See all → the chart as a grid), Apple's New Releases and
// Last.fm's top Genres (each → that genre's top artists). Needs a Last.fm key, as on the phone;
// adding an artist happens on its Discover page.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { AppleAlbum, itunesApi } from '../../src/api/itunes';
import { lastfmApi, LastfmArtist, LastfmTag } from '../../src/api/lastfm';
import { lidarrApi, LidarrArtist } from '../../src/api/lidarr';
import { capitalizeWords } from '../../src/lib/format';
import { colors } from '../../src/theme/colors';
import { useEnabledServers } from '../lib/useEnabledServers';
import { artistImage } from '../lib/images';
import { PosterTile } from './Cards';
import { LogoTileRow } from './DiscoverRows';
import { ArtistRow, artistHref, ArtistTileItem } from './Music';
import { Row } from './Row';
import { errText, NotConfigured, TV_LIST } from './ui';

const COUNT = 20;

export function MusicDiscover() {
  const { servers } = useEnabledServers();
  const lastfm = servers.lastfm;
  const lidarr = servers.lidarr;
  const [top, setTop] = useState<LastfmArtist[] | null>(null);
  const [tags, setTags] = useState<LastfmTag[]>([]);
  const [recent, setRecent] = useState<LidarrArtist[]>([]);
  const [releases, setReleases] = useState<AppleAlbum[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lastfm) return;
    Promise.all([lastfmApi.topArtists(lastfm, 1, COUNT), lastfmApi.topTags(lastfm, COUNT)])
      .then(([a, t]) => {
        setTop(a);
        setTags(t);
      })
      .catch((e) => setError(errText(e)));
    itunesApi.newReleaseAlbums().then(setReleases).catch(() => {});
  }, [lastfm]);

  useEffect(() => {
    if (!lidarr) return;
    lidarrApi
      .getArtists(lidarr)
      .then((list) => setRecent([...list].filter((a) => a.added).sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '')).slice(0, COUNT)))
      .catch(() => {});
  }, [lidarr]);

  if (!lastfm) return <NotConfigured service="Last.fm" />;
  if (!top) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {error ? <Text style={{ color: colors.danger, fontSize: 15 }}>{error}</Text> : <ActivityIndicator color={colors.sectionGreen} size="large" />}
      </View>
    );
  }

  const open = (a: ArtistTileItem) => router.push(artistHref(a) as never);
  const recentItems: ArtistTileItem[] = recent.map((a) => ({ name: a.artistName, id: a.id, poster: lidarr ? artistImage(a, lidarr) : undefined }));

  return (
    <ScrollView {...TV_LIST} contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <ArtistRow title="Recently Added" items={recentItems} onPressItem={open} preferredFocus />
      <ArtistRow
        title="Top Artists"
        items={top.map((a) => ({ name: a.name, subtitle: a.listeners ? `${Number(a.listeners).toLocaleString()} listeners` : undefined }))}
        onPressItem={open}
        onSeeAll={() => router.push('/discover/music/category' as never)}
        preferredFocus={recentItems.length === 0}
      />
      {releases.length > 0 ? (
        <Row title="New Releases" accent={colors.sectionGreen}>
          {releases.slice(0, COUNT).map((al) => (
            <PosterTile
              key={al.id}
              title={al.name}
              subtitle={al.artistName}
              poster={al.artworkUrl100}
              recyclingKey={`album-${al.id}`}
              onPress={() => router.push(artistHref({ name: al.artistName }) as never)}
            />
          ))}
        </Row>
      ) : null}
      <LogoTileRow
        title="Genres"
        icon="musical-notes"
        items={tags.map((t, i) => ({ id: i, name: capitalizeWords(t.name) }))}
        onPressItem={(item) => router.push(`/discover/music/category?tag=${encodeURIComponent(tags[item.id]?.name ?? item.name)}` as never)}
      />
    </ScrollView>
  );
}
