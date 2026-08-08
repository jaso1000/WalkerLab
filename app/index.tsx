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
  sonarrApi,
  SonarrDiskSpace,
  SonarrEpisode,
  SonarrHistoryRecord,
  SonarrQualityProfile,
  SonarrQueueItem,
  SonarrSeries,
} from '../src/api/sonarr';
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
  formatBytes,
  formatCountdown,
  formatDate,
  formatDayGroup,
  formatMonthYear,
  formatTime,
  historyEventLabel,
  seriesStatusTone,
  titleCase,
} from '../src/lib/format';
import { groupConsecutive } from '../src/lib/groupBy';
import { getGroupHeaders, getSortPreference, setGroupHeaders, setSortPreference } from '../src/lib/preferences';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// TV Shows screen (Sonarr) - the library root screen (`app/index.tsx`
// route). All/Missing/Upcoming/Activity/History/Server swipeable tabs, each
// its own paged FlatList/SectionList inside one shared horizontal
// Animated.ScrollView (same paged-tab pattern as Downloads/Torrents/
// Requests). All/Missing share sort+group-header state and section logic;
// Upcoming groups by day instead; Activity/History are flat lists; Server
// is the `ServerPanel` shell with Sonarr-specific stats/actions.
const TABS = ['All', 'Missing', 'Upcoming', 'Activity', 'History', 'Server'] as const;
// Tuned down from React Native's defaults specifically for this screen's
// card design (poster + badges + rating) after profiling a real scroll-jank
// regression - see PLAN.md's "TV Shows/Movies scroll-jank investigation".
const LIST_PERF_PROPS = { initialNumToRender: 8, maxToRenderPerBatch: 4, windowSize: 5 };
const PREFS_SCOPE = 'sonarr';

const SORT_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'size', label: 'Size' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
] as const;
type SortKey = (typeof SORT_FIELDS)[number]['key'];

// A series counts as "missing" if it doesn't have every known episode's
// file yet (or has no statistics at all, treated conservatively as missing).
function isMissing(item: SonarrSeries) {
  const stats = item.statistics;
  return !stats || stats.episodeFileCount < stats.episodeCount;
}

// Status/progress badge for a series row: falls back to its raw series
// status (continuing/ended/etc, colored via `seriesStatusTone`) when there's
// no episode-count data at all, otherwise shows Complete/Missing/a file-count
// fraction.
function episodeBadge(item: SonarrSeries) {
  if (!item.statistics || item.statistics.episodeCount === 0) {
    return <Badge label={titleCase(item.status)} tone={seriesStatusTone(item.status)} />;
  }
  const { episodeFileCount, episodeCount } = item.statistics;
  if (episodeFileCount >= episodeCount) return <Badge label="Complete" tone="success" />;
  if (episodeFileCount === 0) return <Badge label="Missing" tone="danger" />;
  return <Badge label={`${episodeFileCount}/${episodeCount} eps`} tone="sonarr" />;
}

// Maps Sonarr's queue item tracked-download status to a badge color.
function activityTone(item: SonarrQueueItem): 'danger' | 'sonarr' | 'success' {
  if (item.trackedDownloadStatus === 'error') return 'danger';
  if (item.trackedDownloadStatus === 'warning') return 'sonarr';
  return 'success';
}

// Only these sort fields make sense as section-header groups ("size" would
// produce a group per distinct byte count, which is meaningless).
const GROUPABLE_KEYS: SortKey[] = ['title', 'year', 'added', 'qualityProfile', 'genre'];

// Computes the section-header label a series falls under for the current
// group-by field (A-Z letter bucket for title, year, "Month Year" for
// added-date, etc).
function groupLabel(item: SonarrSeries, key: SortKey, profiles: SonarrQualityProfile[]): string {
  switch (key) {
    case 'title': {
      const c = item.title.trim()[0]?.toUpperCase() ?? '#';
      return /[A-Z]/.test(c) ? c : '#';
    }
    case 'year':
      return item.year ? String(item.year) : 'Unknown';
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
// first); every other field defaults ascending (A-Z, oldest-first, etc).
function defaultSortAsc(key: SortKey): boolean {
  return key !== 'size';
}

// Extracts the comparable value for a series under the current sort field -
// "added" sorts by recency (distance from now) rather than the raw date
// string, since a plain string sort wouldn't order dates correctly across
// different formats/precision.
function sortValue(item: SonarrSeries, key: SortKey, profiles: SonarrQualityProfile[]): string | number {
  switch (key) {
    case 'title':
      return item.title.toLowerCase();
    case 'year':
      return item.year ?? 0;
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

export default function SeriesScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.sonarr;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [profiles, setProfiles] = useState<SonarrQualityProfile[]>([]);
  const [upcoming, setUpcoming] = useState<SonarrEpisode[]>([]);
  const [activity, setActivity] = useState<SonarrQueueItem[]>([]);
  const [history, setHistory] = useState<SonarrHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingServer, setLoadingServer] = useState(false);
  const [version, setVersion] = useState('');
  const [diskSpace, setDiskSpace] = useState<SonarrDiskSpace[]>([]);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [menuFor, setMenuFor] = useState<SonarrSeries | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [defaultSort, setDefaultSort] = useState<{ key: SortKey; asc: boolean } | null>(null);
  const [groupHeadersEnabled, setGroupHeadersEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Each tab's data (and quality profiles / saved sort+group prefs) only
  // needs to load once per screen visit, not on every focus - these guard
  // against redundant refetches when returning from a detail page.
  const profilesLoaded = useRef(false);
  const upcomingLoaded = useRef(false);
  const activityLoaded = useRef(false);
  const historyLoaded = useRef(false);
  const serverLoaded = useRef(false);
  const prefsLoaded = useRef(false);
  // Unlike the one-time guards above, the library legitimately reloads on
  // every focus - this instead just stops two overlapping in-flight loads
  // (e.g. a double focus event navigating back from a detail page) from both
  // fetching the full series list concurrently. Imperceptible on native/LAN
  // (both would resolve near-instantly), but doubles the actual bytes
  // transferred over a bandwidth-constrained link like the Docker/web
  // deployment's cloud tunnel - the same class of issue fixed in
  // SwipeTabBar.tsx's onSettle firing.
  const libraryLoadInFlight = useRef(false);

  // Collapses/expands one section-header group (All/Missing tabs only).
  const toggleSection = (title: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  // Loads the full series library (used by All/Missing/Server), plus
  // quality profiles and saved sort/group preferences on first load only.
  const loadLibrary = useCallback(async () => {
    if (!config || libraryLoadInFlight.current) return;
    libraryLoadInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const seriesList = await sonarrApi.getSeries(config);
      setSeries(seriesList);
      if (!profilesLoaded.current) {
        profilesLoaded.current = true;
        sonarrApi.getQualityProfiles(config).then(setProfiles);
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
      setError(e instanceof Error ? e.message : 'Failed to load series');
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
      // Sonarr's calendar API itself excludes an episode that already aired
      // earlier today (e.g. a 9am air time when it's now 3pm).
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() + 60);
      setUpcoming(await sonarrApi.getCalendar(config, start.toISOString(), end.toISOString()));
      upcomingLoaded.current = true;
    } catch (e) {
      alert('Failed to load upcoming', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingUpcoming(false);
    }
  }, [config]);

  // Loads Sonarr's own in-flight download queue for the Activity tab.
  const loadActivity = useCallback(async () => {
    if (!config) return;
    setLoadingActivity(true);
    try {
      const queue = await sonarrApi.getQueue(config);
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
      const hist = await sonarrApi.getHistory(config, 50);
      setHistory(hist.records);
      historyLoaded.current = true;
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingHistory(false);
    }
  }, [config]);

  // Loads just the Sonarr version string for the Server tab's header.
  const loadServer = useCallback(async () => {
    if (!config) return;
    setLoadingServer(true);
    try {
      const [status, disks] = await Promise.all([sonarrApi.getSystemStatus(config), sonarrApi.getDiskSpace(config)]);
      setVersion(status.version);
      setDiskSpace(disks);
      serverLoaded.current = true;
    } catch (e) {
      alert('Failed to load server info', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingServer(false);
    }
  }, [config]);

  // Library always reloads on focus (it's the primary tab and cheap enough
  // to refresh); the other tabs only lazily load if their data hasn't been
  // fetched yet for this screen visit and are currently active.
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

  // Hardware back clears an active search query first, matching how a
  // search UI usually "backs out" one step at a time - returning `false`
  // when there's no query to clear lets the default back behavior (pop
  // the stack) proceed instead of swallowing the event.
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

  // Central place to react to the active tab changing (tap or swipe) -
  // clears the search query on tab switch (a search scoped to one tab
  // shouldn't silently carry over to another) and lazily loads whichever
  // tab's data hasn't been fetched yet.
  const handleTabChange = (index: number) => {
    if (index !== activeTab && query) setQuery('');
    setActiveTab(index);
    if (index === 2 && !upcomingLoaded.current) loadUpcoming();
    if (index === 3 && !activityLoaded.current) loadActivity();
    if (index === 4 && !historyLoaded.current) loadHistory();
    if (index === 5 && !serverLoaded.current) loadServer();
  };

  // Server tab action: triggers Sonarr's own background metadata-refresh
  // job for every series.
  const updateLibrary = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await sonarrApi.refreshAllSeries(config);
      alert('Update started', 'Refreshing the entire library.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: triggers a search for every missing episode
  // library-wide.
  const searchAllMissing = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await sonarrApi.searchAllMissing(config);
      alert('Search started', 'Searching for all missing episodes.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: bulk-unmonitors every series that already has at
  // least one downloaded episode - a bulk cleanup action, confirmed first
  // since it affects potentially many series at once.
  const unmonitorAllDownloaded = () => {
    const downloadedIds = series.filter((s) => s.statistics && s.statistics.episodeFileCount > 0).map((s) => s.id);
    if (downloadedIds.length === 0) {
      alert('Nothing to do', 'No downloaded series found.');
      return;
    }
    alert('Unmonitor All Downloaded', `Stop monitoring ${downloadedIds.length} series that already have files?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmonitor',
        onPress: async () => {
          if (!config) return;
          setBusyAction(true);
          try {
            await sonarrApi.bulkUpdateSeriesMonitored(config, downloadedIds, false);
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
    if (!query.trim()) return series;
    const q = query.toLowerCase();
    return series.filter((s) => s.title.toLowerCase().includes(q));
  }, [series, query]);

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

  const missing = useMemo(() => sorted.filter(isMissing), [sorted]);

  // Grouping only applies for fields where a group actually makes sense
  // (see `GROUPABLE_KEYS`) and only when the user hasn't turned group
  // headers off entirely. When not grouping, everything sits in one
  // untitled section. A collapsed section's `data` is emptied (not the
  // section itself removed) so its header still renders with a chevron to
  // re-expand it.
  const groupable = groupHeadersEnabled && GROUPABLE_KEYS.includes(sortKey);
  const allSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(sorted, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: sorted }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [sorted, sortKey, profiles, groupable, collapsed]);
  const missingSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(missing, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: missing }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [missing, sortKey, profiles, groupable, collapsed]);

  // Upcoming always groups by air-date day (independent of the All/Missing
  // sort/group settings, which don't apply to this tab).
  const upcomingSections = useMemo(() => {
    const sorted = [...upcoming].sort((a, b) => (a.airDateUtc ?? '').localeCompare(b.airDateUtc ?? ''));
    return groupConsecutive(sorted, (item) => formatDayGroup(item.airDateUtc));
  }, [upcoming]);

  // Chunked into rows of `columns` so wide/unfolded screens show a
  // multi-column grid instead of one very wide single-column list.
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

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` calls whichever load function the
  // currently-active tab actually needs, mirroring what each tab's own
  // `RefreshControl.onRefresh` already does.
  const refreshActiveTab = () => {
    if (activeTab === 2) loadUpcoming();
    else if (activeTab === 3) loadActivity();
    else if (activeTab === 4) loadHistory();
    else if (activeTab === 5) loadServer();
    else loadLibrary();
  };

  // Per-row long-press menu action: toggles one series' monitored flag.
  const toggleMonitored = async (item: SonarrSeries) => {
    if (!config) return;
    try {
      await sonarrApi.updateSeries(config, { ...item, monitored: !item.monitored });
      loadLibrary();
    } catch (e) {
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Per-row long-press menu action: removes a series, always keeping files
  // on disk (the fuller 3-way delete-files choice lives on the detail page,
  // not this quick list-row menu).
  const removeFromLibrary = (item: SonarrSeries) => {
    alert('Remove from Library', `Remove "${item.title}" from Sonarr? Files on disk are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          try {
            await sonarrApi.deleteSeries(config, item.id, false);
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

  // Tapping the currently-active sort field flips its direction; picking a
  // different field switches to it at that field's own default direction.
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

  if (!config) return <NotConfigured service="Sonarr" tint={colors.sonarr} />;

  // Shared row renderer for both All and Missing tabs (same card layout,
  // different underlying data source) - tap opens the detail page,
  // long-press opens the per-row action menu.
  const renderSeriesRow = (item: SonarrSeries) => {
    const poster = item.images.find((i) => i.coverType === 'poster');
    const countdown = formatCountdown(item.nextAiring);
    return (
      <Pressable style={styles.card} onPress={() => router.push(`/series/${item.id}`)} onLongPress={() => setMenuFor(item)}>
        {poster?.remoteUrl ? (
          <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]} />
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
            {item.year ? ` (${item.year})` : ''}
          </Text>
          <View style={styles.badgeRow}>
            {episodeBadge(item)}
            {countdown ? <Badge label={countdown} tone="info" /> : null}
            {item.statistics?.sizeOnDisk ? <Text style={styles.size}>{formatBytes(item.statistics.sizeOnDisk)}</Text> : null}
          </View>
          <RatingBadges imdb={item.ratings?.value} tint={colors.sonarr} compact />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerLeft: () => null,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.tvShows.icon} tint={SECTION_META.tvShows.tint} title={names.tvShows} />,
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
        <TouchableOpacity style={styles.addButton} onPress={() => router.push('/series/add')}>
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
            tint={colors.sonarr}
          />
        </View>
        <WebRefreshButton onPress={refreshActiveTab} tint={colors.sonarr} />
      </View>

      {activeTab < 2 ? (
        <TouchableOpacity style={styles.sortPill} onPress={() => setSortMenuOpen(true)}>
          <Text style={styles.sortPillText}>{SORT_FIELDS.find((f) => f.key === sortKey)?.label}</Text>
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.sonarr} />
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
            refreshControl={<RefreshControl tintColor={colors.sonarr} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={[sorted.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{error ?? 'No series found'}</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'show' : 'shows'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.sonarr}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((s) => (
                  <View key={s.id} style={styles.rowItem}>
                    {renderSeriesRow(s)}
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
            refreshControl={<RefreshControl tintColor={colors.sonarr} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={[missing.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>Nothing missing</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'show' : 'shows'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.sonarr}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((s) => (
                  <View key={s.id} style={styles.rowItem}>
                    {renderSeriesRow(s)}
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
            refreshControl={<RefreshControl tintColor={colors.sonarr} refreshing={loadingUpcoming} onRefresh={loadUpcoming} />}
            contentContainerStyle={[upcoming.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingUpcoming ? <Text style={styles.empty}>Nothing upcoming</Text> : null}
            renderSectionHeader={({ section }) => <Text style={styles.dayHeader}>{section.title}</Text>}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const poster = item.series?.images.find((i) => i.coverType === 'poster');
                  return (
                    <Pressable key={item.id} style={[styles.card, styles.rowItem]} onPress={() => router.push(`/series/${item.seriesId}`)}>
                      {poster?.remoteUrl ? (
                        <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.poster, styles.posterPlaceholder]} />
                      )}
                      <View style={styles.info}>
                        <Text style={styles.title} numberOfLines={1}>
                          {item.series?.title ?? 'Unknown series'}
                        </Text>
                        <Text style={styles.historySubtitle}>
                          S{item.seasonNumber}E{item.episodeNumber} · {item.title}
                        </Text>
                        <Text style={styles.historyDate}>{formatTime(item.airDateUtc)}</Text>
                        {item.hasFile ? <Badge label="Downloaded" tone="success" /> : null}
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
            refreshControl={<RefreshControl tintColor={colors.sonarr} refreshing={loadingActivity} onRefresh={loadActivity} />}
            contentContainerStyle={[activity.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingActivity ? <Text style={styles.empty}>Nothing pending</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const pct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 100;
                  const messages = item.statusMessages?.flatMap((m) => m.messages) ?? [];
                  return (
                    <Pressable key={item.id} style={[styles.historyRow, styles.rowItem]} onPress={() => router.push(`/series/${item.seriesId}`)}>
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
            refreshControl={<RefreshControl tintColor={colors.sonarr} refreshing={loadingHistory} onRefresh={loadHistory} />}
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
                      <Badge label={historyEventLabel(item.eventType)} tone={item.eventType === 'grabbed' ? 'sonarr' : 'success'} />
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
            serviceIcon="tv"
            title="Sonarr"
            version={version}
            refreshing={loadingServer}
            onRefresh={loadServer}
            tint={colors.sonarr}
            stats={[
              { label: 'Shows', value: String(series.length) },
              { label: 'Downloaded', value: String(series.filter((s) => !isMissing(s)).length) },
              { label: 'Missing', value: String(missing.length) },
              { label: 'On Disk', value: formatBytes(series.reduce((sum, s) => sum + (s.statistics?.sizeOnDisk ?? 0), 0)) },
            ]}
            diskSpace={diskSpace}
            actionGroups={[
              [
                { label: 'Sonarr Settings', icon: 'settings-outline', onPress: () => router.push('/settings') },
                {
                  label: 'View Sonarr on Web',
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

      <ActionSheet visible={!!menuFor} title={menuFor?.title ?? ''} options={menuOptions} onClose={() => setMenuFor(null)} />
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
  // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sonarr,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  // The paging ScrollView and each per-tab page need an explicit flex:1 -
  // native's Yoga layout resolves a real pixel height for a FlatList/
  // SectionList here regardless, but react-native-web needs an unbroken
  // chain of bounded heights down to the scrollable list or its internal
  // overflow:auto container just sizes to content instead of scrolling
  // (confirmed: this was the actual cause of "can't scroll" on the web
  // build, not present/testable on native where it silently worked anyway).
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
  // `minWidth: 0` matters here (and on `info` below) for the same reason
  // documented elsewhere in this codebase for react-native-web: a flex
  // item's default `min-width: auto` refuses to shrink below its own
  // content's natural width, so an unwrapped badge row wide enough could
  // force this whole card past its 1/columns share of the row - overflowing
  // the actual screen width instead of respecting it, especially once 3
  // columns only have ~300px each to work with.
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
  historyDate: { color: colors.sonarr, fontSize: 12, fontWeight: '600', marginTop: 6 },
  activityWarning: { color: colors.sonarr, fontSize: 12, marginTop: 6, lineHeight: 16 },
});
