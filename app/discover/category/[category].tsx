import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tmdbApi, tmdbImageUrl, TmdbMovie, TmdbTv } from '../../../src/api/tmdb';
import { DiscoverFilterSheet } from '../../../src/components/DiscoverFilterSheet';
import { useServers } from '../../../src/context/ServersContext';
import {
  CATEGORY_LABELS,
  DiscoverCategory,
  dedupeById,
  DiscoverMediaFilter,
  fetchDiscoverCategory,
  interleave,
  RELEASE_TYPE_FILTERS,
  ReleaseTypeFilterKey,
  resolveMediaKind,
} from '../../../src/lib/discoverCategories';
import { buildDiscoverParams, countActiveFilters, DiscoverFilters, EMPTY_FILTERS, SORT_OPTIONS } from '../../../src/lib/discoverFilters';
import { badgeForMovie, badgeForSeries, buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../../src/lib/libraryStatus';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Full-screen infinite-scroll grid for one Discover category (Trending/
// Popular/Upcoming/Recently Released), opened by tapping a category row's
// title on the main Discover screen. "Recently Released" additionally shows
// a multi-select Theatrical/Digital/Physical filter bar since it's the only
// category with a meaningful release-type distinction.
const ALL_RELEASE_FILTER_KEYS = RELEASE_TYPE_FILTERS.map((f) => f.key);

// Sensible starting `sort` for the full filter sheet, per category - purely
// a starting point for the sheet's own Sort By field, not something that
// changes what's shown until the user actually applies a filter (see
// `filtersApplied` below). "Recently Released" never opens the sheet at all
// (kept on its own dedicated Theatrical/Digital/Physical filter instead -
// folding it into the general filter sheet would silently break that
// existing control, since TMDB's release-type filter has no equivalent in
// the general `/discover` filter set), so its entry here is unused but kept
// for type completeness.
const DEFAULT_SORT_BY_CATEGORY: Record<DiscoverCategory, DiscoverFilters['sort']> = {
  trending: SORT_OPTIONS[0], // Popularity Descending
  popular: SORT_OPTIONS[0], // Popularity Descending
  upcoming: SORT_OPTIONS.find((s) => s.key === 'date' && s.direction === 'asc')!,
  recent: SORT_OPTIONS.find((s) => s.key === 'date' && s.direction === 'desc')!,
};

// Grid card - memoized since this is likely the longest list in the app
// (hundreds of items once paginated in). `mediaType`/`library` are stable
// across most renders (a route param and a per-focus-rebuilt index,
// respectively), so this actually skips re-rendering off-screen cards on
// unrelated state changes (typing in the filter sheet, etc).
const DiscoverGridCard = memo(function DiscoverGridCard({
  item,
  mediaType,
  library,
}: {
  item: TmdbMovie | TmdbTv;
  mediaType: DiscoverMediaFilter;
  library: LibraryIndex;
}) {
  // 'all' mixes movies+TV in one grid - each item resolves its own type
  // rather than trusting the screen-level `mediaType` filter, same trick
  // the main Discover screen's "All" tab uses.
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
});

export default function DiscoverCategoryScreen() {
  const tabBarClearance = useTabBarClearance();
  // providerId/providerName/studioId/studioName: optional deep-link params
  // from the main Discover screen's Streaming Service/Studios rows - when
  // present, this screen skips straight to the filtered `/discover` query
  // with that provider/studio pre-selected instead of starting on the
  // category's own unfiltered data (see the `filters`/`filtersApplied` lazy
  // initializers below).
  const { category, mediaType, providerId, providerName, studioId, studioName } = useLocalSearchParams<{
    category: DiscoverCategory;
    mediaType: DiscoverMediaFilter;
    providerId?: string;
    providerName?: string;
    studioId?: string;
    studioName?: string;
  }>();
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

  // General filter sheet - offered for every media type including "All"
  // (which runs two parallel `/discover` queries, one per real media type,
  // and interleaves them - see `fetchFiltered` below, same `interleave`
  // helper the main Discover screen's own "All" tab already uses for
  // Popular/Upcoming) except "Recently Released" (see
  // `DEFAULT_SORT_BY_CATEGORY`'s comment above).
  const showFilters = category !== 'recent';
  const [filters, setFilters] = useState<DiscoverFilters>(() => {
    const seeded: DiscoverFilters = { ...EMPTY_FILTERS, sort: DEFAULT_SORT_BY_CATEGORY[category] };
    if (providerId && providerName) {
      seeded.watchProviders = [{ provider_id: Number(providerId), provider_name: providerName }];
    }
    if (studioId && studioName) {
      seeded.studio = { id: Number(studioId), name: studioName };
    }
    return seeded;
  });
  // Starts false (the screen still shows this category's own real data
  // until the user actually applies something from the filter sheet) unless
  // deep-linked in with a provider/studio pre-selected, in which case the
  // filtered query is exactly what should show immediately - see the
  // `filters` initializer above for where that selection comes from.
  const [filtersApplied, setFiltersApplied] = useState(!!(providerId || studioId));
  const [sheetOpen, setSheetOpen] = useState(false);

  const title = providerName ?? studioName ?? CATEGORY_LABELS[category] ?? 'Discover';
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

  // Built per-side even in 'all' mode: `buildDiscoverParams` already gates
  // every movie-only/tv-only field (studio/network/certification/genres)
  // internally by the `mediaType` argument it's given, so calling it once
  // with 'movie' and once with 'tv' against the same `filters` object
  // naturally produces two correct, independent queries with no extra
  // branching needed here.
  const movieParams = useMemo(() => (mediaType !== 'tv' ? buildDiscoverParams(filters, 'movie') : undefined), [filters, mediaType]);
  const tvParams = useMemo(() => (mediaType !== 'movie' ? buildDiscoverParams(filters, 'tv') : undefined), [filters, mediaType]);

  // Only meaningful once `filtersApplied` - runs one or two `/discover`
  // calls depending on `mediaType`, interleaving movie+tv results for
  // 'all' the same way the main Discover screen's own "All" tab already
  // does for its Popular/Upcoming rows (no combined `/discover` endpoint
  // exists to do this server-side).
  const fetchFiltered = (page: number) => {
    if (mediaType === 'all') {
      return Promise.all([tmdbApi.discoverMovies(config!, movieParams!, page), tmdbApi.discoverTv(config!, tvParams!, page)]).then(
        ([m, t]) => ({
          results: interleave<TmdbMovie | TmdbTv>(m.results, t.results),
          total_pages: Math.max(m.total_pages, t.total_pages),
        })
      );
    }
    return mediaType === 'movie' ? tmdbApi.discoverMovies(config!, movieParams!, page) : tmdbApi.discoverTv(config!, tvParams!, page);
  };

  // Plain effect, not useFocusEffect: this only needs to (re)load when the
  // category/mediaType/filters actually change, not every time the screen
  // regains focus (e.g. navigating back from a title) - that was resetting
  // the loaded pages and scroll position back to the top on every return.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    setLoading(true);
    setPage(0);
    const request = filtersApplied ? fetchFiltered(1) : fetchDiscoverCategory(config, category, mediaType, 1, releaseTypes);
    request
      .then((res) => {
        if (cancelled) return;
        setItems(res.results);
        setPage(1);
        setTotalPages(res.total_pages);
      })
      .catch((e) => {
        if (!cancelled) console.error('Failed to load discover category', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, category, mediaType, releaseTypes, filtersApplied, movieParams, tvParams]);

  // Safe to refresh on every focus - only touches badge colors on
  // already-rendered items, not the loaded pages/scroll position.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      buildLibraryIndex({ tmdbConfig: config, radarrConfig, sonarrConfig })
        .then(setLibrary)
        .catch((e) => console.error('Failed to build library index', e));
    }, [config, radarrConfig, sonarrConfig])
  );

  // Infinite-scroll continuation, guarded against duplicate concurrent
  // calls (FlatList's onEndReached can fire more than once per scroll burst).
  const loadMore = () => {
    if (!config || loadMoreLock.current || page === 0 || page >= totalPages) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    const request = filtersApplied ? fetchFiltered(page + 1) : fetchDiscoverCategory(config, category, mediaType, page + 1, releaseTypes);
    request
      .then((res) => {
        setItems((prev) => [...prev, ...dedupeById(prev, res.results)]);
        setPage((p) => p + 1);
        setTotalPages(res.total_pages);
      })
      .catch((e) => console.error('Failed to load more', e))
      .finally(() => {
        setLoadingMore(false);
        loadMoreLock.current = false;
      });
  };

  const activeFilterCount = countActiveFilters(filters);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{title}</Text>
        {showFilters ? (
          <TouchableOpacity style={styles.iconButton} onPress={() => setSheetOpen(true)}>
            <Ionicons name="options-outline" size={22} color={colors.textPrimary} />
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 38 }} />
        )}
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
          renderItem={({ item }) => <DiscoverGridCard item={item} mediaType={mediaType} library={library} />}
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing found.</Text>}
        />
      )}

      {showFilters && config ? (
        <DiscoverFilterSheet
          visible={sheetOpen}
          mediaType={mediaType}
          config={config}
          filters={filters}
          onApply={(next) => {
            setFilters(next);
            setFiltersApplied(true);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  filterBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.sectionGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: colors.background, fontSize: 10, fontWeight: '800' },
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
