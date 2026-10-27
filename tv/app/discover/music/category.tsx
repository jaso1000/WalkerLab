// Discover Music's "See all" on the TV (the phone's app/discover/music/category): Last.fm's Top Artists
// chart, or one genre's top artists (`tag`), as a grid that pages in 30 at a time as you scroll down.
// OK opens the artist (its library page if it's in Lidarr, else its Discover page).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { lastfmApi, LastfmArtist } from '../../../../src/api/lastfm';
import { capitalizeWords } from '../../../../src/lib/format';
import { colors } from '../../../../src/theme/colors';
import { POSTER_W } from '../../../components/Cards';
import { artistHref, ArtistTile } from '../../../components/Music';
import { errText, ListFrame, Loading, Message, NotConfigured, ScreenHeader, SIDE, SNAP_CELL, TV_GRID } from '../../../components/ui';
import { useEnabledServers } from '../../../lib/useEnabledServers';

const LIMIT = 30;
const COLUMNS = 6;
const tint = colors.sectionGreen;

export default function TvMusicCategory() {
  const { tag } = useLocalSearchParams<{ tag?: string }>();
  const { servers, ready } = useEnabledServers();
  const config = servers.lastfm;
  const [items, setItems] = useState<LastfmArtist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = useRef(0);
  const more = useRef(true);
  const busy = useRef(false);

  const fetchPage = (p: number) => (tag ? lastfmApi.topArtistsForTag(config!, tag, p, LIMIT) : lastfmApi.topArtists(config!, p, LIMIT));

  useEffect(() => {
    if (!config) return;
    fetchPage(1)
      .then((r) => {
        page.current = 1;
        more.current = r.length === LIMIT;
        setItems(r);
      })
      .catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, tag]);

  const loadMore = () => {
    if (!config || busy.current || !more.current || page.current === 0) return;
    busy.current = true;
    setLoadingMore(true);
    fetchPage(page.current + 1)
      .then((r) => {
        page.current += 1;
        more.current = r.length === LIMIT;
        setItems((prev) => [...(prev ?? []), ...r]);
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        setLoadingMore(false);
      });
  };

  if (ready && !config) return <NotConfigured service="Last.fm" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={tag ? capitalizeWords(tag) : 'Top Artists'} tint={tint} count={items?.length} />
      {!items ? (
        error ? <Message text={error} error /> : <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_GRID}
            data={items}
            keyExtractor={(a, i) => `${a.mbid || a.name}-${i}`}
            numColumns={COLUMNS}
            windowSize={7}
            columnWrapperStyle={{ gap: 18, width: COLUMNS * (POSTER_W + 18) }}
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 40, gap: 14 }}
            onEndReachedThreshold={0.6}
            onEndReached={loadMore}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={tint} style={{ marginVertical: 16 }} /> : null}
            ListEmptyComponent={<Message text="Nothing found." />}
            renderItem={({ item, index }) => (
              <View {...SNAP_CELL}>
                <ArtistTile name={item.name} preferredFocus={index === 0} onPress={() => router.push(artistHref({ name: item.name }) as never)} />
              </View>
            )}
          />
        </ListFrame>
      )}
    </View>
  );
}
