import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tmdbImageUrl, TmdbMovie, TmdbTv } from '../../../src/api/tmdb';
import { useServers } from '../../../src/context/ServersContext';
import {
  CATEGORY_LABELS,
  DiscoverCategory,
  dedupeById,
  DiscoverMediaFilter,
  fetchDiscoverCategory,
  RELEASE_TYPE_FILTERS,
  ReleaseTypeFilterKey,
  resolveMediaKind,
} from '../../../src/lib/discoverCategories';
import { badgeForMovie, badgeForSeries, buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../../src/lib/libraryStatus';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Full-screen infinite-scroll grid for one Discover category (Trending/
// Popular/Upcoming/Recently Released), opened by tapping a category row's
// title on the main Discover screen. "Recently Released" additionally shows
// a multi-select Theatrical/Digital/Physical filter bar since it's the only
// category with a meaningful release-type distinction.
const ALL_RELEASE_FILTER_KEYS = RELEASE_TYPE_FILTERS.map((f) => f.key);

export default function DiscoverCategoryScreen() {
  const tabBarClearance = useTabBarClearance();
  const { category, mediaType } = useLocalSearchParams<{ category: DiscoverCategory; mediaType: DiscoverMediaFilter }>();
  const { servers } = useServers();
  const config = servers.tmdb;
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;

  const [items, setItems] = useState<(TmdbMovie | TmdbTv)[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);
  const [releaseFilters, setReleaseFilters] = useState<Set<ReleaseTypeFilterKey>>(new Set(ALL_RELEASE_FILTER_KEYS));
  const loadMoreLock = useRef(false);

  const title = CATEGORY_LABELS[category] ?? 'Discover';
  const showReleaseFilters = category === 'recent';

  // undefined (no filter) when every option is selected, so the "all
  // selected" state behaves identically to not filtering at all.
  const releaseTypes = useMemo(() => {
    if (!showReleaseFilters || releaseFilters.size === ALL_RELEASE_FILTER_KEYS.length) return undefined;
    return RELEASE_TYPE_FILTERS.filter((f) => releaseFilters.has(f.key)).flatMap((f) => f.types);
  }, [showReleaseFilters, releaseFilters]);

  // Toggles one release-type chip, refusing to deselect the last remaining
  // one - the grid always needs at least one type selected to have anything
  // to show.
  const toggleReleaseFilter = (key: ReleaseTypeFilterKey) => {
    setReleaseFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // always keep at least one selected
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Plain effect, not useFocusEffect: this only needs to (re)load when the
  // category/mediaType/filters actually change, not every time the screen
  // regains focus (e.g. navigating back from a title) - that was resetting
  // the loaded pages and scroll position back to the top on every return.
  useEffect(() => {
    if (!config) return;
    setLoading(true);
    setPage(0);
    fetchDiscoverCategory(config, category, mediaType, 1, releaseTypes)
      .then((res) => {
        setItems(res.results);
        setPage(1);
        setTotalPages(res.total_pages);
      })
      .finally(() => setLoading(false));
  }, [config, category, mediaType, releaseTypes]);

  // Safe to refresh on every focus - only touches badge colors on
  // already-rendered items, not the loaded pages/scroll position.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      buildLibraryIndex({ tmdbConfig: config, radarrConfig, sonarrConfig }).then(setLibrary);
    }, [config, radarrConfig, sonarrConfig])
  );

  // Infinite-scroll continuation, guarded against duplicate concurrent
  // calls (FlatList's onEndReached can fire more than once per scroll burst).
  const loadMore = () => {
    if (!config || loadMoreLock.current || page === 0 || page >= totalPages) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    fetchDiscoverCategory(config, category, mediaType, page + 1, releaseTypes)
      .then((res) => {
        setItems((prev) => [...prev, ...dedupeById(prev, res.results)]);
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
        <Text style={styles.topBarTitle}>{title}</Text>
        <View style={{ width: 38 }} />
      </View>

      {showReleaseFilters ? (
        <View style={styles.filterRow}>
          {RELEASE_TYPE_FILTERS.map((filter) => {
            const active = releaseFilters.has(filter.key);
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => toggleReleaseFilter(filter.key)}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          contentContainerStyle={[styles.grid, { paddingBottom: tabBarClearance }]}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.sectionGreen} style={{ marginVertical: 16 }} /> : null}
          renderItem={({ item }) => {
            // 'all' mixes movies+TV in one grid - each item resolves its own
            // type rather than trusting the screen-level `mediaType` filter,
            // same trick the main Discover screen's "All" tab uses.
            const itemType = mediaType === 'all' ? resolveMediaKind(item) : mediaType;
            const posterUrl = tmdbImageUrl(item.poster_path);
            const badge = itemType === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library);
            return (
              <TouchableOpacity style={styles.card} onPress={() => router.push(`/discover/${itemType}/${item.id}`)}>
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
                  {itemType === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name}
                </Text>
              </TouchableOpacity>
            );
          }}
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.sectionGreenMuted, borderColor: colors.sectionGreen },
  filterChipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  filterChipTextActive: { color: colors.sectionGreen },
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
