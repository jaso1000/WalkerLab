import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { itunesApi } from '../../../src/api/itunes';
import { lastfmApi, LastfmArtist } from '../../../src/api/lastfm';
import { useServers } from '../../../src/context/ServersContext';
import { capitalizeWords } from '../../../src/lib/format';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Discover Music's "See All" grid - Top Artists (no `tag` param) or one
// genre's top artists (`tag` param, from the Genres row). Intentionally
// simpler than the movie/TV category screen (no filter sheet - Last.fm
// charts have no equivalent filter dimensions to expose): a plain infinite-
// scroll grid, paginated via Last.fm's own page/limit params. "Has more"
// is inferred from whether the last page came back full-sized, since
// `lastfmApi.topArtists`/`topArtistsForTag` unwrap straight to a flat
// array and don't carry Last.fm's own total-pages metadata through.
const LIMIT = 30;

function ArtistCard({ artist }: { artist: LastfmArtist }) {
  const [artUrl, setArtUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    itunesApi.searchArtistArtwork(artist.name).then((url) => {
      if (!cancelled) setArtUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [artist.name]);

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/discover/music/${encodeURIComponent(artist.name)}`)}>
      {artUrl ? (
        <Image source={{ uri: artUrl }} style={styles.art} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.art, styles.artPlaceholder]}>
          <Ionicons name="musical-notes" size={22} color={colors.textMuted} />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {artist.name}
      </Text>
    </Pressable>
  );
}

export default function DiscoverMusicCategoryScreen() {
  const tabBarClearance = useTabBarClearance();
  const { tag } = useLocalSearchParams<{ tag?: string }>();
  const { servers } = useServers();
  const config = servers.lastfm;

  const [items, setItems] = useState<LastfmArtist[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreLock = useRef(false);

  const title = tag ? capitalizeWords(tag) : 'Top Artists';

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    setPage(0);
    const request = tag ? lastfmApi.topArtistsForTag(config, tag, 1, LIMIT) : lastfmApi.topArtists(config, 1, LIMIT);
    request
      .then((results) => {
        setItems(results);
        setPage(1);
        setHasMore(results.length === LIMIT);
      })
      .finally(() => setLoading(false));
  }, [config, tag]);

  const loadMore = () => {
    if (!config || loadMoreLock.current || !hasMore || page === 0) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    const request = tag ? lastfmApi.topArtistsForTag(config, tag, page + 1, LIMIT) : lastfmApi.topArtists(config, page + 1, LIMIT);
    request
      .then((results) => {
        setItems((prev) => [...prev, ...results]);
        setPage((p) => p + 1);
        setHasMore(results.length === LIMIT);
      })
      .finally(() => {
        setLoadingMore(false);
        loadMoreLock.current = false;
      });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{title}</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.lastfm} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.mbid || item.name}-${i}`}
          numColumns={3}
          contentContainerStyle={[styles.grid, { paddingBottom: tabBarClearance }]}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.lastfm} style={{ marginVertical: 16 }} /> : null}
          renderItem={({ item }) => <ArtistCard artist={item} />}
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing found.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  grid: { padding: 12, gap: 4 },
  card: { flex: 1 / 3, padding: 6 },
  art: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  artPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
});
