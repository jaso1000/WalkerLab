import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { overseerrApi, OverseerrFilter, OverseerrRequest } from '../src/api/overseerr';
import { tmdbApi, tmdbImageUrl, TmdbMovieDetail, TmdbTvDetail } from '../src/api/tmdb';
import { ActionSheet, ActionSheetOption } from '../src/components/ActionSheet';
import { Badge, BadgeTone } from '../src/components/Badge';
import { NotConfigured } from '../src/components/NotConfigured';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { WebRefreshButton } from '../src/components/WebRefreshButton';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { dedupeById } from '../src/lib/discoverCategories';
import { formatDate } from '../src/lib/format';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// Requests screen (Overseerr, shown as "Seer" in Settings) - a Pending tab
// (default) and an All tab with single-select status filter chips, both
// paginated infinite-scroll lists (unlike Downloads/Torrents' polled-but-
// unpaginated lists) since Overseerr's request history can be long.
const TABS = ['Pending', 'All'] as const;

// No 'Declined' chip here - see the comment on `requestStatusInfo` below and
// PLAN.md for why that filter value 400s on a real Overseerr instance even
// though declined requests still show up under 'all'.
const ALL_FILTERS: { key: OverseerrFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'processing', label: 'Processing' },
  { key: 'available', label: 'Available' },
  { key: 'failed', label: 'Failed' },
];

// TMDB-derived display info for one request, cached by `${type}:${tmdbId}`
// since Overseerr's own request objects don't carry a title/poster.
interface TmdbInfo {
  title: string;
  posterUrl?: string;
}

// Requests only carry request/decline status (1/2/3) + the underlying
// media's own availability status (1-5) - Overseerr's own UI derives a
// single displayed status by combining both the same way.
function requestStatusInfo(req: OverseerrRequest): { label: string; tone: BadgeTone } {
  if (req.status === 3) return { label: 'Declined', tone: 'danger' };
  if (req.status === 1) return { label: 'Pending', tone: 'info' };
  switch (req.media.status) {
    case 5:
      return { label: 'Available', tone: 'success' };
    case 4:
      return { label: 'Partially Available', tone: 'success' };
    case 3:
      return { label: 'Processing', tone: 'accent' };
    default:
      return { label: 'Approved', tone: 'accent' };
  }
}

export default function OverseerrScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.overseerr;
  const tmdbConfig = servers.tmdb;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const [activeTab, setActiveTab] = useState(0);
  const [filter, setFilter] = useState<OverseerrFilter>('all');

  const [pending, setPending] = useState<OverseerrRequest[]>([]);
  const [pendingPage, setPendingPage] = useState(0);
  const [pendingTotalPages, setPendingTotalPages] = useState(1);
  const [loadingPending, setLoadingPending] = useState(false);
  const [loadingMorePending, setLoadingMorePending] = useState(false);

  const [all, setAll] = useState<OverseerrRequest[]>([]);
  const [allPage, setAllPage] = useState(0);
  const [allTotalPages, setAllTotalPages] = useState(1);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingMoreAll, setLoadingMoreAll] = useState(false);

  const [tmdbInfo, setTmdbInfo] = useState<Record<string, TmdbInfo>>({});
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const allLoaded = useRef(false);
  // Guards against duplicate "load more" calls firing while a page request
  // is already in flight (FlatList's onEndReached can fire multiple times
  // in quick succession during a fast scroll).
  const pendingLoadMoreLock = useRef(false);
  const allLoadMoreLock = useRef(false);
  // Lets `enrichWithTmdb` read the latest cache inside a `useCallback` whose
  // own dependency array doesn't include `tmdbInfo` (avoiding it becoming
  // unstable across every enrichment batch).
  const tmdbInfoRef = useRef(tmdbInfo);
  tmdbInfoRef.current = tmdbInfo;

  // Request list responses carry only tmdbId + media type, not title/poster
  // - same gap Discover already solves. Enrich via the existing TMDB detail
  // calls, keyed on `${type}:${tmdbId}` and cached for the screen's lifetime.
  const enrichWithTmdb = useCallback(
    async (requests: OverseerrRequest[]) => {
      if (!tmdbConfig) return;
      const missing = requests.filter((r) => !tmdbInfoRef.current[`${r.type}:${r.media.tmdbId}`]);
      if (missing.length === 0) return;
      const uniqueByKey = new Map(missing.map((r) => [`${r.type}:${r.media.tmdbId}`, r]));
      const entries = await Promise.all(
        Array.from(uniqueByKey.entries()).map(async ([key, r]) => {
          try {
            const detail =
              r.type === 'movie'
                ? await tmdbApi.movieDetail(tmdbConfig, r.media.tmdbId)
                : await tmdbApi.tvDetail(tmdbConfig, r.media.tmdbId);
            const title = r.type === 'movie' ? (detail as TmdbMovieDetail).title : (detail as TmdbTvDetail).name;
            return [key, { title, posterUrl: tmdbImageUrl(detail.poster_path) }] as const;
          } catch {
            return null;
          }
        })
      );
      setTmdbInfo((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    },
    [tmdbConfig]
  );

  // Loads page 1 of Pending, replacing the whole list (used on focus and
  // pull-to-refresh, not for pagination - see `loadMorePending` for that).
  const loadPending = useCallback(async () => {
    if (!config) return;
    setLoadingPending(true);
    try {
      const res = await overseerrApi.getRequests(config, 'pending', 1);
      setPending(res.results);
      setPendingPage(1);
      setPendingTotalPages(res.pageInfo.pages);
      enrichWithTmdb(res.results);
    } catch (e) {
      alert('Failed to load requests', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingPending(false);
    }
  }, [config, enrichWithTmdb]);

  // Loads page 1 of the All tab under the current filter, replacing the
  // whole list.
  const loadAll = useCallback(async () => {
    if (!config) return;
    setLoadingAll(true);
    try {
      const res = await overseerrApi.getRequests(config, filter, 1);
      setAll(res.results);
      setAllPage(1);
      setAllTotalPages(res.pageInfo.pages);
      allLoaded.current = true;
      enrichWithTmdb(res.results);
    } catch (e) {
      alert('Failed to load requests', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingAll(false);
    }
  }, [config, filter, enrichWithTmdb]);

  useFocusEffect(
    useCallback(() => {
      loadPending();
      if (activeTab === 1) loadAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadPending])
  );

  // Re-fetch the All tab whenever its filter chip changes, resetting to page
  // 1 - same reset-on-filter-change pattern as discover/category/[category].
  useEffect(() => {
    if (activeTab === 1) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleTabChange = (index: number) => {
    setActiveTab(index);
    if (index === 1 && !allLoaded.current) loadAll();
  };

  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` calls whichever load function the
  // currently-active tab actually needs, mirroring what each tab's own
  // `RefreshControl.onRefresh` already does.
  const refreshActiveTab = () => {
    if (activeTab === 1) loadAll();
    else loadPending();
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  // Infinite-scroll continuation for Pending - a no-op while already
  // loading, before the first page has loaded, or once every page is in.
  const loadMorePending = () => {
    if (!config || pendingLoadMoreLock.current || pendingPage === 0 || pendingPage >= pendingTotalPages) return;
    pendingLoadMoreLock.current = true;
    setLoadingMorePending(true);
    overseerrApi
      .getRequests(config, 'pending', pendingPage + 1)
      .then((res) => {
        setPending((prev) => [...prev, ...dedupeById(prev, res.results)]);
        setPendingPage((p) => p + 1);
        setPendingTotalPages(res.pageInfo.pages);
        enrichWithTmdb(res.results);
      })
      .finally(() => {
        setLoadingMorePending(false);
        pendingLoadMoreLock.current = false;
      });
  };

  // Same as `loadMorePending` but for the All tab under the current filter.
  const loadMoreAll = () => {
    if (!config || allLoadMoreLock.current || allPage === 0 || allPage >= allTotalPages) return;
    allLoadMoreLock.current = true;
    setLoadingMoreAll(true);
    overseerrApi
      .getRequests(config, filter, allPage + 1)
      .then((res) => {
        setAll((prev) => [...prev, ...dedupeById(prev, res.results)]);
        setAllPage((p) => p + 1);
        setAllTotalPages(res.pageInfo.pages);
        enrichWithTmdb(res.results);
      })
      .finally(() => {
        setLoadingMoreAll(false);
        allLoadMoreLock.current = false;
      });
  };

  // Called after any action that changes a request's state (approve/
  // decline/delete) - Pending always needs refreshing since its membership
  // can change; All only needs it if that tab is actually visible.
  const refreshBoth = async () => {
    await Promise.all([loadPending(), activeTab === 1 ? loadAll() : Promise.resolve()]);
  };

  // Builds the per-request "..." action sheet: Approve/Decline only offered
  // while still pending, Delete always offered (with its own confirm step).
  const openItemMenu = (item: OverseerrRequest) => {
    if (!config) return;
    const key = `${item.type}:${item.media.tmdbId}`;
    const title = tmdbInfo[key]?.title ?? (item.type === 'movie' ? 'Movie request' : 'TV request');
    const options: ActionSheetOption[] = [];
    if (item.status === 1) {
      options.push(
        {
          label: 'Approve',
          onPress: async () => {
            setBusy(true);
            try {
              await overseerrApi.approveRequest(config, item.id);
              await refreshBoth();
            } catch (e) {
              alert('Failed', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setBusy(false);
            }
          },
        },
        {
          label: 'Decline',
          destructive: true,
          onPress: async () => {
            setBusy(true);
            try {
              await overseerrApi.declineRequest(config, item.id);
              await refreshBoth();
            } catch (e) {
              alert('Failed', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setBusy(false);
            }
          },
        }
      );
    }
    options.push({
      label: 'Delete Request',
      destructive: true,
      onPress: () => {
        alert('Delete Request', `Remove the request for "${title}"?`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await overseerrApi.deleteRequest(config, item.id);
                await refreshBoth();
              } catch (e) {
                alert('Delete failed', e instanceof Error ? e.message : 'Unknown error');
              } finally {
                setBusy(false);
              }
            },
          },
        ]);
      },
    });
    setMenu({ title, options });
  };

  const rowKey = (row: OverseerrRequest[]) => row.map((r) => r.id).join('-');
  const chunkedPending = useMemo(() => chunk(pending, columns), [pending, columns]);
  const chunkedAll = useMemo(() => chunk(all, columns), [all, columns]);

  if (!config) return <NotConfigured service="Seer" tint={colors.overseerr} />;

  // One request tile - the whole card is tappable (opens the action sheet),
  // not just the small "..." button, per user feedback that a tiny tap
  // target felt fiddly.
  const renderRequestRow = (item: OverseerrRequest) => {
    const key = `${item.type}:${item.media.tmdbId}`;
    const info = tmdbInfo[key];
    const { label, tone } = requestStatusInfo(item);
    return (
      <Pressable style={styles.card} onPress={() => openItemMenu(item)} disabled={busy}>
        {info?.posterUrl ? (
          <Image source={{ uri: info.posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name={item.type === 'movie' ? 'film-outline' : 'tv-outline'} size={20} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {info?.title ?? (item.type === 'movie' ? 'Movie request' : 'TV request')}
          </Text>
          <Badge label={label} tone={tone} />
          <Text style={styles.subtitle}>
            {item.requestedBy.displayName} · {formatDate(item.createdAt) ?? ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.menuButton} onPress={() => openItemMenu(item)} disabled={busy}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.requests.icon} tint={SECTION_META.requests.tint} title={names.requests} />,
        }}
      />
      <View style={styles.tabBarRow}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TABS}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={colors.overseerr}
          />
        </View>
        <WebRefreshButton onPress={refreshActiveTab} tint={colors.overseerr} />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        snapToInterval={width}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={onPagerScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        <View style={[styles.page, { width }]}>
          <FlatList
            style={styles.flatList}
            data={chunkedPending}
            keyExtractor={rowKey}
            refreshControl={
              <RefreshControl tintColor={colors.overseerr} refreshing={loadingPending} onRefresh={loadPending} />
            }
            contentContainerStyle={[pending.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            onEndReachedThreshold={0.5}
            onEndReached={loadMorePending}
            ListFooterComponent={
              loadingMorePending ? <ActivityIndicator color={colors.overseerr} style={{ marginVertical: 16 }} /> : null
            }
            ListEmptyComponent={!loadingPending ? <Text style={styles.empty}>No pending requests.</Text> : null}
            initialNumToRender={8}
            maxToRenderPerBatch={4}
            windowSize={5}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.id} style={styles.rowItem}>
                    {renderRequestRow(item)}
                  </View>
                ))}
              </View>
            )}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <View style={styles.filterRow}>
            {ALL_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <FlatList
            style={styles.flatList}
            data={chunkedAll}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.overseerr} refreshing={loadingAll} onRefresh={loadAll} />}
            contentContainerStyle={[all.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            onEndReachedThreshold={0.5}
            onEndReached={loadMoreAll}
            ListFooterComponent={
              loadingMoreAll ? <ActivityIndicator color={colors.overseerr} style={{ marginVertical: 16 }} /> : null
            }
            ListEmptyComponent={!loadingAll ? <Text style={styles.empty}>No requests found.</Text> : null}
            initialNumToRender={8}
            maxToRenderPerBatch={4}
            windowSize={5}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.id} style={styles.rowItem}>
                    {renderRequestRow(item)}
                  </View>
                ))}
              </View>
            )}
          />
        </View>
      </Animated.ScrollView>

      {menu ? <ActionSheet visible title={menu.title} options={menu.options} onClose={() => setMenu(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  flatList: { flex: 1 },
  // See app/index.tsx's identical comment - fixes "can't scroll"
  // on the web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.overseerrMuted, borderColor: colors.overseerr },
  filterChipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  filterChipTextActive: { color: colors.overseerr },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  // `minWidth: 0` matters here (and on `info` below) for the same reason
  // documented elsewhere in this codebase for react-native-web: a flex
  // item's default `min-width: auto` refuses to shrink below its own
  // content's natural width, so an unwrapped row wide enough could force
  // this whole card past its 1/columns share of the row - overflowing the
  // actual screen width instead of respecting it, especially once 3 columns
  // only have ~300px each to work with.
  rowItem: { flex: 1, minWidth: 0 },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 10, minWidth: 0 },
  poster: { width: 50, height: 75, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  menuButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
