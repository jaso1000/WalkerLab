import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import {
  lidarrApi,
  LidarrAlbum,
  LidarrArtist,
  LidarrDiskSpace,
  LidarrHistoryRecord,
  LidarrQualityProfile,
  LidarrQueueItem,
  lidarrImageUrl,
} from '../src/api/lidarr';
import { ActionSheet, ActionSheetOption } from '../src/components/ActionSheet';
import { Badge } from '../src/components/Badge';
import { RatingBadges } from '../src/components/RatingBadges';
import { NotConfigured } from '../src/components/NotConfigured';
import { ServerPanel } from '../src/components/ServerPanel';
import { SortMenu } from '../src/components/SortMenu';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { WebRefreshButton } from '../src/components/WebRefreshButton';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import {
  artistStatusTone,
  formatBytes,
  formatCountdown,
  formatDate,
  formatDayGroup,
  formatMonthYear,
  historyEventLabel,
  titleCase,
} from '../src/lib/format';
import { groupConsecutive } from '../src/lib/groupBy';
import { getGroupHeaders, getSortPreference, setGroupHeaders, setSortPreference } from '../src/lib/preferences';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// Music screen (Lidarr) - the library root screen (`app/music.tsx` route).
// Mirrors `app/index.tsx` (TV Shows/Sonarr) closely: All/Missing/Upcoming/
// Activity/History/Server swipeable tabs, same paged-tab pattern. Artists
// stand in for series, albums for seasons, tracks for episodes. No `year`
// sort/group field - artists have no single equivalent the way series do.
const TABS = ['All', 'Missing', 'Upcoming', 'Activity', 'History', 'Server'] as const;
const LIST_PERF_PROPS = { initialNumToRender: 8, maxToRenderPerBatch: 4, windowSize: 5 };
const PREFS_SCOPE = 'lidarr';

const SORT_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'added', label: 'Date Added' },
  { key: 'size', label: 'Size' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
] as const;
type SortKey = (typeof SORT_FIELDS)[number]['key'];

// An artist counts as "missing" if it doesn't have every known track's file
// yet (or has no statistics at all, treated conservatively as missing).
function isArtistMissing(item: LidarrArtist) {
  const stats = item.statistics;
  return !stats || stats.trackFileCount < stats.trackCount;
}

// Status/progress badge for an artist row: falls back to its raw artist
// status (continuing/ended/deleted, colored via `artistStatusTone`) when
// there's no track-count data at all, otherwise shows Complete/Missing/a
// file-count fraction - mirrors Sonarr's `episodeBadge` exactly, one level
// up the hierarchy (tracks are the leaf unit here, same as episodes there).
function albumBadge(item: LidarrArtist) {
  if (!item.statistics || item.statistics.trackCount === 0) {
    return <Badge label={titleCase(item.status)} tone={artistStatusTone(item.status)} />;
  }
  const { trackFileCount, trackCount } = item.statistics;
  if (trackFileCount >= trackCount) return <Badge label="Complete" tone="success" />;
  if (trackFileCount === 0) return <Badge label="Missing" tone="danger" />;
  return <Badge label={`${trackFileCount}/${trackCount} tracks`} tone="lidarr" />;
}

// Maps Lidarr's queue item tracked-download status to a badge color.
function activityTone(item: LidarrQueueItem): 'danger' | 'lidarr' | 'success' {
  if (item.trackedDownloadStatus === 'error') return 'danger';
  if (item.trackedDownloadStatus === 'warning') return 'lidarr';
  return 'success';
}

// Only these sort fields make sense as section-header groups.
const GROUPABLE_KEYS: SortKey[] = ['title', 'added', 'qualityProfile', 'genre'];

// Computes the section-header label an artist falls under for the current
// group-by field.
function groupLabel(item: LidarrArtist, key: SortKey, profiles: LidarrQualityProfile[]): string {
  switch (key) {
    case 'title': {
      const c = item.artistName.trim()[0]?.toUpperCase() ?? '#';
      return /[A-Z]/.test(c) ? c : '#';
    }
    case 'added':
      return formatMonthYear(item.added);
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name ?? 'Unknown';
    case 'genre':
      return item.genres?.[0] ?? 'Unknown';
    default:
      return '';
  }
}

// Size defaults to descending (largest first is more useful than smallest
// first); every other field defaults ascending.
function defaultSortAsc(key: SortKey): boolean {
  return key !== 'size';
}

// Extracts the comparable value for an artist under the current sort field.
function sortValue(item: LidarrArtist, key: SortKey, profiles: LidarrQualityProfile[]): string | number {
  switch (key) {
    case 'title':
      return item.artistName.toLowerCase();
    case 'added':
      return item.added ? Math.abs(Date.now() - new Date(item.added).getTime()) : Number.POSITIVE_INFINITY;
    case 'size':
      return item.statistics?.sizeOnDisk ?? 0;
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name.toLowerCase() ?? '';
    case 'genre':
      return item.genres?.[0]?.toLowerCase() ?? '';
  }
}

export default function MusicScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.lidarr;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const [artists, setArtists] = useState<LidarrArtist[]>([]);
  const [profiles, setProfiles] = useState<LidarrQualityProfile[]>([]);
  const [upcoming, setUpcoming] = useState<LidarrAlbum[]>([]);
  const [activity, setActivity] = useState<LidarrQueueItem[]>([]);
  const [history, setHistory] = useState<LidarrHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingServer, setLoadingServer] = useState(false);
  const [version, setVersion] = useState('');
  const [diskSpace, setDiskSpace] = useState<LidarrDiskSpace[]>([]);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [menuFor, setMenuFor] = useState<LidarrArtist | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [defaultSort, setDefaultSort] = useState<{ key: SortKey; asc: boolean } | null>(null);
  const [groupHeadersEnabled, setGroupHeadersEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const profilesLoaded = useRef(false);
  const upcomingLoaded = useRef(false);
  const activityLoaded = useRef(false);
  const historyLoaded = useRef(false);
  const serverLoaded = useRef(false);
  const prefsLoaded = useRef(false);
  const libraryLoadInFlight = useRef(false);

  const toggleSection = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const loadLibrary = useCallback(async () => {
    if (!config || libraryLoadInFlight.current) return;
    libraryLoadInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const artistList = await lidarrApi.getArtists(config);
      setArtists(artistList);
      if (!profilesLoaded.current) {
        profilesLoaded.current = true;
        lidarrApi.getQualityProfiles(config).then(setProfiles);
      }
      if (!prefsLoaded.current) {
        prefsLoaded.current = true;
        const [savedSort, savedGroup] = await Promise.all([
          getSortPreference(PREFS_SCOPE),
          getGroupHeaders(PREFS_SCOPE),
        ]);
        if (savedSort) {
          setDefaultSort({ key: savedSort.sortKey as SortKey, asc: savedSort.sortAsc });
          setSortKey(savedSort.sortKey as SortKey);
          setSortAsc(savedSort.sortAsc);
        }
        setGroupHeadersEnabled(savedGroup);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load artists');
    } finally {
      setLoading(false);
      libraryLoadInFlight.current = false;
    }
  }, [config]);

  const loadUpcoming = useCallback(async () => {
    if (!config) return;
    setLoadingUpcoming(true);
    try {
      // Start from midnight today, not the exact current moment - otherwise
      // Lidarr's calendar API itself excludes an album that already
      // released earlier today.
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() + 60);
      setUpcoming(await lidarrApi.getCalendar(config, start.toISOString(), end.toISOString()));
      upcomingLoaded.current = true;
    } catch (e) {
      alert('Failed to load upcoming', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingUpcoming(false);
    }
  }, [config]);

  // Loads Lidarr's own in-flight download queue for the Activity tab.
  const loadActivity = useCallback(async () => {
    if (!config) return;
    setLoadingActivity(true);
    try {
      const queue = await lidarrApi.getQueue(config);
      setActivity(queue.records);
      activityLoaded.current = true;
    } catch (e) {
      alert('Failed to load activity', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingActivity(false);
    }
  }, [config]);

  // Loads the 50 most recent activity/history events for the History tab.
  const loadHistory = useCallback(async () => {
    if (!config) return;
    setLoadingHistory(true);
    try {
      const hist = await lidarrApi.getHistory(config, 50);
      setHistory(hist.records);
      historyLoaded.current = true;
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingHistory(false);
    }
  }, [config]);

  // Loads just the Lidarr version string for the Server tab's header.
  const loadServer = useCallback(async () => {
    if (!config) return;
    setLoadingServer(true);
    try {
      const [status, disks] = await Promise.all([lidarrApi.getSystemStatus(config), lidarrApi.getDiskSpace(config)]);
      setVersion(status.version);
      setDiskSpace(disks);
      serverLoaded.current = true;
    } catch (e) {
      alert('Failed to load server info', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingServer(false);
    }
  }, [config]);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
      if (activeTab === 2 && !upcomingLoaded.current) loadUpcoming();
      if (activeTab === 3 && !activityLoaded.current) loadActivity();
      if (activeTab === 4 && !historyLoaded.current) loadHistory();
      if (activeTab === 5 && !serverLoaded.current) loadServer();
      // Only run on focus; tab-driven lazy loads are handled by handleTabChange.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLibrary])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (query) {
          setQuery('');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [query])
  );

  const handleTabChange = (index: number) => {
    if (index !== activeTab && query) setQuery('');
    setActiveTab(index);
    if (index === 2 && !upcomingLoaded.current) loadUpcoming();
    if (index === 3 && !activityLoaded.current) loadActivity();
    if (index === 4 && !historyLoaded.current) loadHistory();
    if (index === 5 && !serverLoaded.current) loadServer();
  };

  // Server tab action: triggers Lidarr's own background metadata-refresh
  // job for every artist.
  const updateLibrary = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await lidarrApi.refreshAllArtists(config);
      alert('Update started', 'Refreshing the entire library.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: triggers a search for every missing album
  // library-wide.
  const searchAllMissing = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await lidarrApi.searchAllMissing(config);
      alert('Search started', 'Searching for all missing albums.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: bulk-unmonitors every artist that already has at
  // least one downloaded track - a bulk cleanup action, confirmed first
  // since it affects potentially many artists at once.
  const unmonitorAllDownloaded = () => {
    const downloadedIds = artists.filter((a) => a.statistics && a.statistics.trackFileCount > 0).map((a) => a.id);
    if (downloadedIds.length === 0) {
      alert('Nothing to do', 'No downloaded artists found.');
      return;
    }
    alert('Unmonitor All Downloaded', `Stop monitoring ${downloadedIds.length} artists that already have files?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmonitor',
        onPress: async () => {
          if (!config) return;
          setBusyAction(true);
          try {
            await lidarrApi.bulkUpdateArtistsMonitored(config, downloadedIds, false);
            await loadLibrary();
          } catch (e) {
            alert('Failed', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusyAction(false);
          }
        },
      },
    ]);
  };

  // Client-side title filter (search box) applied before sort/grouping.
  const filtered = useMemo(() => {
    if (!query.trim()) return artists;
    const q = query.toLowerCase();
    return artists.filter((a) => a.artistName.toLowerCase().includes(q));
  }, [artists, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey, profiles);
      const bv = sortValue(b, sortKey, profiles);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortAsc, profiles]);

  const missing = useMemo(() => sorted.filter(isArtistMissing), [sorted]);

  const groupable = groupHeadersEnabled && GROUPABLE_KEYS.includes(sortKey);
  const allSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(sorted, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: sorted }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [sorted, sortKey, profiles, groupable, collapsed]);
  const missingSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(missing, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: missing }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [missing, sortKey, profiles, groupable, collapsed]);

  // Upcoming always groups by release-date day (independent of the
  // All/Missing sort/group settings, which don't apply to this tab).
  const upcomingSections = useMemo(() => {
    const sortedUpcoming = [...upcoming].sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));
    return groupConsecutive(sortedUpcoming, (item) => formatDayGroup(item.releaseDate));
  }, [upcoming]);

  const rowKey = (row: { id: number }[]) => row.map((r) => r.id).join('-');
  const chunkedAllSections = useMemo(
    () => allSections.map((s) => ({ ...s, data: chunk(s.data, columns) })),
    [allSections, columns]
  );
  const chunkedMissingSections = useMemo(
    () => missingSections.map((s) => ({ ...s, data: chunk(s.data, columns) })),
    [missingSections, columns]
  );
  const chunkedUpcomingSections = useMemo(
    () => upcomingSections.map((s) => ({ ...s, data: chunk(s.data, columns) })),
    [upcomingSections, columns]
  );
  const chunkedActivity = useMemo(() => chunk(activity, columns), [activity, columns]);
  const chunkedHistory = useMemo(() => chunk(history, columns), [history, columns]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const refreshActiveTab = () => {
    if (activeTab === 2) loadUpcoming();
    else if (activeTab === 3) loadActivity();
    else if (activeTab === 4) loadHistory();
    else if (activeTab === 5) loadServer();
    else loadLibrary();
  };

  // Per-row long-press menu action: toggles one artist's monitored flag.
  const toggleMonitored = async (item: LidarrArtist) => {
    if (!config) return;
    try {
      await lidarrApi.updateArtist(config, { ...item, monitored: !item.monitored });
      loadLibrary();
    } catch (e) {
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Per-row long-press menu action: removes an artist, always keeping
  // files on disk (the fuller 3-way delete-files choice lives on the
  // detail page, not this quick list-row menu).
  const removeFromLibrary = (item: LidarrArtist) => {
    alert('Remove from Library', `Remove "${item.artistName}" from Lidarr? Files on disk are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          try {
            await lidarrApi.deleteArtist(config, item.id, false);
            loadLibrary();
          } catch (e) {
            alert('Failed to remove', e instanceof Error ? e.message : 'Unknown error');
          }
        },
      },
    ]);
  };

  const menuOptions: ActionSheetOption[] = menuFor
    ? [
        { label: menuFor.monitored ? 'Unmonitor' : 'Monitor', onPress: () => toggleMonitored(menuFor) },
        { label: 'Remove from Library', destructive: true, onPress: () => removeFromLibrary(menuFor) },
      ]
    : [];

  const handleSortSelect = (key: string) => {
    const sortField = key as SortKey;
    if (sortKey === sortField) setSortAsc((v) => !v);
    else {
      setSortKey(sortField);
      setSortAsc(defaultSortAsc(sortField));
    }
  };

  const handleSetDefaultSort = () => {
    setDefaultSort({ key: sortKey, asc: sortAsc });
    setSortPreference(PREFS_SCOPE, { sortKey, sortAsc });
  };

  const handleToggleGroupHeaders = (value: boolean) => {
    setGroupHeadersEnabled(value);
    setGroupHeaders(PREFS_SCOPE, value);
  };

  if (!config) return <NotConfigured service="Lidarr" tint={colors.lidarr} />;

  // Shared row renderer for both All and Missing tabs (same card layout,
  // different underlying data source) - tap opens the detail page,
  // long-press opens the per-row action menu.
  const renderArtistRow = (item: LidarrArtist) => {
    const poster = item.images.find((i) => i.coverType === 'poster');
    const posterUrl = lidarrImageUrl(poster, config, { type: 'artist', id: item.id });
    const countdown = formatCountdown(item.nextAlbum?.releaseDate);
    return (
      <Pressable style={styles.card} onPress={() => router.push(`/artist/${item.id}`)} onLongPress={() => setMenuFor(item)}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]} />
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {item.artistName}
          </Text>
          <View style={styles.badgeRow}>
            {albumBadge(item)}
            {countdown ? <Badge label={countdown} tone="info" /> : null}
            {item.statistics?.sizeOnDisk ? <Text style={styles.size}>{formatBytes(item.statistics.sizeOnDisk)}</Text> : null}
          </View>
          <RatingBadges imdb={item.ratings?.value} tint={colors.lidarr} compact />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          headerLeft: () => null,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.music.icon} tint={SECTION_META.music.tint} title={names.music} />,
        }}
      />
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search library..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => router.push('/artist/add')}>
          <Ionicons name="add" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabBarRow}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TABS}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={colors.lidarr}
          />
        </View>
        <WebRefreshButton onPress={refreshActiveTab} tint={colors.lidarr} />
      </View>

      {activeTab < 2 ? (
        <TouchableOpacity style={styles.sortPill} onPress={() => setSortMenuOpen(true)}>
          <Text style={styles.sortPillText}>{SORT_FIELDS.find((f) => f.key === sortKey)?.label}</Text>
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.lidarr} />
        </TouchableOpacity>
      ) : null}

      <View style={{ flex: 1 }}>
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
          <SectionList
            sections={chunkedAllSections}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.lidarr} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={[sorted.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{error ?? 'No artists found'}</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'artist' : 'artists'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.lidarr}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((a) => (
                  <View key={a.id} style={styles.rowItem}>
                    {renderArtistRow(a)}
                  </View>
                ))}
              </View>
            )}
            {...LIST_PERF_PROPS}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <SectionList
            sections={chunkedMissingSections}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.lidarr} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={[missing.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>Nothing missing</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'artist' : 'artists'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.lidarr}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((a) => (
                  <View key={a.id} style={styles.rowItem}>
                    {renderArtistRow(a)}
                  </View>
                ))}
              </View>
            )}
            {...LIST_PERF_PROPS}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <SectionList
            sections={chunkedUpcomingSections}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.lidarr} refreshing={loadingUpcoming} onRefresh={loadUpcoming} />}
            contentContainerStyle={[upcoming.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingUpcoming ? <Text style={styles.empty}>Nothing upcoming</Text> : null}
            renderSectionHeader={({ section }) => <Text style={styles.dayHeader}>{section.title}</Text>}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const poster = item.artist?.images.find((i) => i.coverType === 'poster');
                  const posterUrl = lidarrImageUrl(poster, config, { type: 'artist', id: item.artistId });
                  return (
                    <Pressable key={item.id} style={[styles.card, styles.rowItem]} onPress={() => router.push(`/artist/${item.artistId}`)}>
                      {posterUrl ? (
                        <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.poster, styles.posterPlaceholder]} />
                      )}
                      <View style={styles.info}>
                        <Text style={styles.title} numberOfLines={1}>
                          {item.artist?.artistName ?? 'Unknown artist'}
                        </Text>
                        <Text style={styles.historySubtitle}>{item.title}</Text>
                        <Text style={styles.historyDate}>{formatDate(item.releaseDate) ?? ''}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {...LIST_PERF_PROPS}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedActivity}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.lidarr} refreshing={loadingActivity} onRefresh={loadActivity} />}
            contentContainerStyle={[activity.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingActivity ? <Text style={styles.empty}>Nothing pending</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const pct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 100;
                  const messages = item.statusMessages?.flatMap((m) => m.messages) ?? [];
                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.historyRow, styles.rowItem]}
                      onPress={() => item.artistId && router.push(`/artist/${item.artistId}`)}
                    >
                      <Text style={styles.historyTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View style={styles.badgeRow}>
                        <Badge label={titleCase(item.status)} tone={activityTone(item)} />
                        <Text style={styles.historySubtitle}>
                          {pct}% · {formatBytes(item.size)}
                        </Text>
                      </View>
                      {item.errorMessage ? <Text style={styles.activityWarning}>{item.errorMessage}</Text> : null}
                      {messages.map((msg, i) => (
                        <Text key={i} style={styles.activityWarning}>
                          • {msg}
                        </Text>
                      ))}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {...LIST_PERF_PROPS}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedHistory}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.lidarr} refreshing={loadingHistory} onRefresh={loadHistory} />}
            contentContainerStyle={[history.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingHistory ? <Text style={styles.empty}>No history yet</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.id} style={[styles.historyRow, styles.rowItem]}>
                    <Text style={styles.historyTitle} numberOfLines={2}>
                      {item.sourceTitle}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={historyEventLabel(item.eventType)} tone={item.eventType === 'grabbed' ? 'lidarr' : 'success'} />
                      {item.quality ? <Text style={styles.historySubtitle}>{item.quality.quality.name}</Text> : null}
                    </View>
                    <Text style={styles.historyDate}>{formatDate(item.date) ?? ''}</Text>
                  </View>
                ))}
              </View>
            )}
            {...LIST_PERF_PROPS}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <ServerPanel
            serviceIcon="musical-notes"
            title="Lidarr"
            version={version}
            refreshing={loadingServer}
            onRefresh={loadServer}
            tint={colors.lidarr}
            stats={[
              { label: 'Artists', value: String(artists.length) },
              { label: 'Downloaded', value: String(artists.filter((a) => !isArtistMissing(a)).length) },
              { label: 'Missing', value: String(missing.length) },
              { label: 'On Disk', value: formatBytes(artists.reduce((sum, a) => sum + (a.statistics?.sizeOnDisk ?? 0), 0)) },
            ]}
            diskSpace={diskSpace}
            actionGroups={[
              [
                { label: 'Lidarr Settings', icon: 'settings-outline', onPress: () => router.push('/settings') },
                {
                  label: 'View Lidarr on Web',
                  icon: 'open-outline',
                  onPress: () => config && Linking.openURL(config.baseUrl),
                },
              ],
              [
                { label: 'Update Library', icon: 'refresh-outline', onPress: updateLibrary },
                { label: 'Search All Missing', icon: 'search-outline', onPress: searchAllMissing },
                { label: 'Unmonitor All Downloaded', icon: 'bookmark-outline', onPress: unmonitorAllDownloaded },
              ],
            ]}
          />
        </View>
        </Animated.ScrollView>
      </View>

      <ActionSheet visible={!!menuFor} title={menuFor?.artistName ?? ''} options={menuOptions} onClose={() => setMenuFor(null)} />
      <SortMenu
        visible={sortMenuOpen}
        fields={SORT_FIELDS as unknown as { key: string; label: string }[]}
        activeKey={sortKey}
        activeAsc={sortAsc}
        defaultKey={defaultSort?.key ?? null}
        groupHeaders={groupHeadersEnabled}
        onSelect={handleSortSelect}
        onSetDefault={handleSetDefaultSort}
        onToggleGroupHeaders={handleToggleGroupHeaders}
        onClose={() => setSortMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.lidarr,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  pager: { flex: 1 },
  page: { flex: 1 },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sortPillText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  list: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1, minWidth: 0 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: colors.background,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  sectionHeaderTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  sectionHeaderCount: { color: colors.textSecondary, fontSize: 13 },
  sectionHeaderChevron: { marginLeft: 'auto' },
  dayHeader: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: colors.background,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, minWidth: 0 },
  poster: { width: 60, height: 90, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  info: { flex: 1, justifyContent: 'center', minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  size: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  historyRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  historyTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  historySubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  historyDate: { color: colors.lidarr, fontSize: 12, fontWeight: '600', marginTop: 6 },
  activityWarning: { color: colors.lidarr, fontSize: 12, marginTop: 6, lineHeight: 16 },
});
