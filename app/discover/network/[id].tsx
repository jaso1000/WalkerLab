import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TMDB_NETWORKS, tmdbApi, tmdbImageUrl, TmdbTv } from '../../../src/api/tmdb';
import { useServers } from '../../../src/context/ServersContext';
import { dedupeById } from '../../../src/lib/discoverCategories';
import { badgeForSeries, buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../../src/lib/libraryStatus';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// "Browse by Network" full-screen grid (TV only) - one fixed TMDB network id
// per pill on Discover's filter bar, infinite-scroll paginated. Structurally
// near-identical to `discover/category/[category].tsx` (same load-more-lock
// pattern, same plain-effect-vs-useFocusEffect split) but keyed by network
// id instead of a discover category.
export default function NetworkBrowseScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { servers } = useServers();
  const config = servers.tmdb;
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;

  const [shows, setShows] = useState<TmdbTv[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);
  const loadMoreLock = useRef(false);

  const networkId = Number(id);
  const network = TMDB_NETWORKS.find((n) => n.id === networkId);
  const title = name ?? network?.name ?? 'Network';

  // Plain effect, not useFocusEffect: only (re)load when the network
  // actually changes, not on every return-to-screen focus - otherwise
  // navigating back from a show reset the loaded pages and scroll
  // position back to the top.
  useEffect(() => {
    if (!config || !networkId) return;
    setLoading(true);
    setPage(0);
    tmdbApi
      .tvByNetwork(config, networkId, 1)
      .then((res) => {
        setShows(res.results);
        setPage(1);
        setTotalPages(res.total_pages);
      })
      .finally(() => setLoading(false));
  }, [config, networkId]);

  // Safe to refresh on every focus - only touches badge colors on
  // already-rendered items, not the loaded pages/scroll position.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      buildLibraryIndex({ tmdbConfig: config, radarrConfig, sonarrConfig }).then(setLibrary);
    }, [config, radarrConfig, sonarrConfig])
  );

  // Infinite-scroll continuation, guarded against duplicate concurrent
  // calls the same way category/network browse screens all are.
  const loadMore = () => {
    if (!config || loadMoreLock.current || page === 0 || page >= totalPages) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    tmdbApi
      .tvByNetwork(config, networkId, page + 1)
      .then((res) => {
        setShows((prev) => [...prev, ...dedupeById(prev, res.results)]);
        setPage((p) => p + 1);
        setTotalPages(res.total_pages);
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
        <View style={styles.topBarTitleRow}>
          {network ? <View style={[styles.dot, { backgroundColor: network.color }]} /> : null}
          <Text style={styles.topBarTitle}>{title}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {loading && shows.length === 0 ? (
        <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shows}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          contentContainerStyle={[styles.grid, { paddingBottom: tabBarClearance }]}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.sectionGreen} style={{ marginVertical: 16 }} /> : null}
          renderItem={({ item }) => {
            const posterUrl = tmdbImageUrl(item.poster_path);
            const badge = badgeForSeries(item.id, library);
            return (
              <TouchableOpacity style={styles.card} onPress={() => router.push(`/discover/tv/${item.id}`)}>
                <View>
                  {posterUrl ? (
                    <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.poster, styles.posterPlaceholder]} />
                  )}
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: badge.color }]}>
                      <Ionicons name={badge.icon} size={12} color={colors.background} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No shows found for this network.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  grid: { padding: 12, gap: 4 },
  card: { flex: 1 / 3, padding: 6 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
});
