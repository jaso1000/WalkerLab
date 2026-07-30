import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
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
  useWindowDimensions,
  View,
} from 'react-native';
import { radarrApi, RadarrHistoryRecord, RadarrMovie, RadarrQualityProfile, RadarrQueueItem } from '../../src/api/radarr';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { Badge } from '../../src/components/Badge';
import { RatingBadges } from '../../src/components/RatingBadges';
import { NotConfigured } from '../../src/components/NotConfigured';
import { ServerPanel } from '../../src/components/ServerPanel';
import { SortMenu } from '../../src/components/SortMenu';
import { SwipeTabBar } from '../../src/components/SwipeTabBar';
import { WebRefreshButton } from '../../src/components/WebRefreshButton';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import {
  formatBytes,
  formatCountdown,
  formatDate,
  formatDayGroup,
  formatMonthYear,
  historyEventLabel,
  titleCase,
} from '../../src/lib/format';
import { groupConsecutive } from '../../src/lib/groupBy';
import { getGroupHeaders, getSortPreference, setGroupHeaders, setSortPreference } from '../../src/lib/preferences';
import { chunk, useColumns } from '../../src/lib/responsive';
import { colors } from '../../src/theme/colors';

// Movies screen (Radarr) - same shape as the TV Shows screen (`index.tsx`),
// which this file closely mirrors: All/Missing/Upcoming/Activity/History/
// Server paged tabs, shared sort+group-header state for All/Missing, and a
// `ServerPanel` shell for the Server tab. Extra Movies-only sort fields
// (Digital Release/Rating/Popularity/Studio) and a release-triptych-aware
// "nearest upcoming date" replace TV's single `nextAiring` field, since a
// movie can have three different release dates instead of one air date.
const TABS = ['All', 'Missing', 'Upcoming', 'Activity', 'History', 'Server'] as const;
// Same perf tuning as the TV Shows screen - see PLAN.md's scroll-jank
// investigation for why these specific numbers.
const LIST_PERF_PROPS = { initialNumToRender: 8, maxToRenderPerBatch: 4, windowSize: 5 };
const PREFS_SCOPE = 'radarr';

const SORT_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'digitalRelease', label: 'Digital Release' },
  { key: 'size', label: 'Size' },
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
  { key: 'studio', label: 'Studio' },
] as const;
type SortKey = (typeof SORT_FIELDS)[number]['key'];

// Status badge for a movie row: Downloaded takes priority, then "In
// Theaters" for a movie currently released theatrically but not downloaded,
// falling back to the raw Radarr status otherwise.
function movieBadge(item: RadarrMovie) {
  if (item.hasFile) return <Badge label="Downloaded" tone="success" />;
  if (item.status === 'inCinemas') return <Badge label="In Theaters" tone="accent" />;
  return <Badge label={titleCase(item.status) || 'Missing'} tone="danger" />;
}

// Picks whichever of a movie's three release dates (theatrical/digital/
// physical) is soonest but not already past - used for the Upcoming tab's
// grouping/sorting and the countdown badge on list rows.
function nearestUpcomingDate(item: RadarrMovie): string | undefined {
  // Compare against the start of today, not the exact current moment - a
  // movie that released at 1:30pm today should still show as today's
  // release (with a Downloaded badge once it has a file), not disappear
  // from Upcoming the second its release time ticks past.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dates = [item.inCinemas, item.digitalRelease, item.physicalRelease].filter(
    (d): d is string => !!d && new Date(d).getTime() >= startOfToday.getTime()
  );
  dates.sort();
  return dates[0];
}

// Human label for whichever release type `nearestUpcomingDate` picked, so
// the Upcoming tab can say "Digital Release" vs "Theatrical Release" etc.
function nearestUpcomingLabel(item: RadarrMovie): string {
  const date = nearestUpcomingDate(item);
  if (!date) return '';
  if (date === item.inCinemas) return 'Theatrical Release';
  if (date === item.digitalRelease) return 'Digital Release';
  if (date === item.physicalRelease) return 'Physical Release';
  return '';
}

// Maps Radarr's queue item tracked-download status to a badge color.
function activityTone(item: RadarrQueueItem): 'danger' | 'accent' | 'success' {
  if (item.trackedDownloadStatus === 'error') return 'danger';
  if (item.trackedDownloadStatus === 'warning') return 'accent';
  return 'success';
}

// Only these sort fields make sense as section-header groups (rating/
// popularity/size would each produce a near-useless one-item-per-group split).
const GROUPABLE_KEYS: SortKey[] = ['title', 'year', 'added', 'digitalRelease', 'qualityProfile', 'genre', 'studio'];

// Computes the section-header label a movie falls under for the current
// group-by field.
function groupLabel(item: RadarrMovie, key: SortKey, profiles: RadarrQualityProfile[]): string {
  switch (key) {
    case 'title': {
      const c = item.title.trim()[0]?.toUpperCase() ?? '#';
      return /[A-Z]/.test(c) ? c : '#';
    }
    case 'year':
      return item.year ? String(item.year) : 'Unknown';
    case 'added':
      return formatMonthYear(item.added);
    case 'digitalRelease':
      return formatMonthYear(item.digitalRelease);
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name ?? 'Unknown';
    case 'genre':
      return item.genres?.[0] ?? 'Unknown';
    case 'studio':
      return item.studio ?? 'Unknown';
    default:
      return '';
  }
}

// Size defaults to descending; every other field (including the
// Movies-only Rating/Popularity fields) defaults ascending.
function defaultSortAsc(key: SortKey): boolean {
  return key !== 'size';
}

// Extracts the comparable value for a movie under the current sort field.
function sortValue(item: RadarrMovie, key: SortKey, profiles: RadarrQualityProfile[]): string | number {
  switch (key) {
    case 'title':
      return item.title.toLowerCase();
    case 'year':
      return item.year ?? 0;
    case 'added':
      return item.added ? Math.abs(Date.now() - new Date(item.added).getTime()) : Number.POSITIVE_INFINITY;
    case 'digitalRelease':
      return item.digitalRelease
        ? Math.abs(Date.now() - new Date(item.digitalRelease).getTime())
        : Number.POSITIVE_INFINITY;
    case 'size':
      return item.sizeOnDisk ?? 0;
    case 'rating':
      return item.ratings?.imdb?.value ?? 0;
    case 'popularity':
      return item.popularity ?? 0;
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name.toLowerCase() ?? '';
    case 'genre':
      return item.genres?.[0]?.toLowerCase() ?? '';
    case 'studio':
      return item.studio?.toLowerCase() ?? '';
  }
}

export default function MoviesScreen() {
  const { servers } = useServers();
  const config = servers.radarr;
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [profiles, setProfiles] = useState<RadarrQualityProfile[]>([]);
  const [upcoming, setUpcoming] = useState<RadarrMovie[]>([]);
  const [activity, setActivity] = useState<RadarrQueueItem[]>([]);
  const [history, setHistory] = useState<RadarrHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingServer, setLoadingServer] = useState(false);
  const [version, setVersion] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [menuFor, setMenuFor] = useState<RadarrMovie | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortAsc, setSortAsc] = useState(true);
  const [defaultSort, setDefaultSort] = useState<{ key: SortKey; asc: boolean } | null>(null);
  const [groupHeadersEnabled, setGroupHeadersEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Each tab's data only needs to load once per screen visit, not on every
  // focus - guards against redundant refetches when returning from a detail
  // page (same pattern as the TV Shows screen).
  const profilesLoaded = useRef(false);
  const upcomingLoaded = useRef(false);
  const activityLoaded = useRef(false);
  const historyLoaded = useRef(false);
  const serverLoaded = useRef(false);
  const prefsLoaded = useRef(false);
  // The library legitimately reloads on every focus (unlike the one-time
  // guards above) - this just stops two overlapping in-flight loads from
  // both fetching the full movie list concurrently (see the matching
  // comment in the TV Shows screen for why this matters over a
  // bandwidth-constrained link like the Docker/web deployment's tunnel).
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

  // Loads the full movie library (used by All/Missing/Server), plus
  // quality profiles and saved sort/group preferences on first load only.
  const loadLibrary = useCallback(async () => {
    if (!config || libraryLoadInFlight.current) return;
    libraryLoadInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const movieList = await radarrApi.getMovies(config);
      setMovies(movieList);
      if (!profilesLoaded.current) {
        profilesLoaded.current = true;
        radarrApi.getQualityProfiles(config).then(setProfiles);
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
      setError(e instanceof Error ? e.message : 'Failed to load movies');
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
      // Radarr's calendar API itself excludes a movie that already released
      // earlier today (e.g. a 9am digital release when it's now 3pm).
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() + 60);
      setUpcoming(await radarrApi.getCalendar(config, start.toISOString(), end.toISOString()));
      upcomingLoaded.current = true;
    } catch (e) {
      alert('Failed to load upcoming', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingUpcoming(false);
    }
  }, [config]);

  // Loads Radarr's own in-flight download queue for the Activity tab.
  const loadActivity = useCallback(async () => {
    if (!config) return;
    setLoadingActivity(true);
    try {
      const queue = await radarrApi.getQueue(config);
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
      const hist = await radarrApi.getHistory(config, 50);
      setHistory(hist.records);
      historyLoaded.current = true;
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingHistory(false);
    }
  }, [config]);

  // Loads just the Radarr version string for the Server tab's header.
  const loadServer = useCallback(async () => {
    if (!config) return;
    setLoadingServer(true);
    try {
      const status = await radarrApi.getSystemStatus(config);
      setVersion(status.version);
      serverLoaded.current = true;
    } catch (e) {
      alert('Failed to load server info', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingServer(false);
    }
  }, [config]);

  // Library always reloads on focus; other tabs only lazily load if their
  // data hasn't been fetched yet for this screen visit and are active.
  useFocusEffect(
    useCallback(() => {
      loadLibrary();
      if (activeTab === 2 && !upcomingLoaded.current) loadUpcoming();
      if (activeTab === 3 && !activityLoaded.current) loadActivity();
      if (activeTab === 4 && !historyLoaded.current) loadHistory();
      if (activeTab === 5 && !serverLoaded.current) loadServer();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLibrary])
  );

  // Hardware back clears an active search query first, same as the TV
  // Shows screen.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (query) {
          setQuery('');
          return true;
        }
        navigation.dispatch(DrawerActions.openDrawer());
        return true;
      });
      return () => sub.remove();
    }, [query, navigation])
  );

  // Central place to react to the active tab changing (tap or swipe).
  const handleTabChange = (index: number) => {
    if (index !== activeTab && query) setQuery('');
    setActiveTab(index);
    if (index === 2 && !upcomingLoaded.current) loadUpcoming();
    if (index === 3 && !activityLoaded.current) loadActivity();
    if (index === 4 && !historyLoaded.current) loadHistory();
    if (index === 5 && !serverLoaded.current) loadServer();
  };

  // Server tab action: triggers Radarr's own background metadata-refresh
  // job for every movie.
  const updateLibrary = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await radarrApi.refreshAllMovies(config);
      alert('Update started', 'Refreshing the entire library.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: triggers a search for every missing movie
  // library-wide.
  const searchAllMissing = async () => {
    if (!config) return;
    setBusyAction(true);
    try {
      await radarrApi.searchAllMissing(config);
      alert('Search started', 'Searching for all missing movies.');
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyAction(false);
    }
  };

  // Server tab action: bulk-unmonitors every movie that already has a
  // downloaded file - confirmed first since it affects potentially many
  // movies at once.
  const unmonitorAllDownloaded = () => {
    const downloadedIds = movies.filter((m) => m.hasFile).map((m) => m.id);
    if (downloadedIds.length === 0) {
      alert('Nothing to do', 'No downloaded movies found.');
      return;
    }
    alert('Unmonitor All Downloaded', `Stop monitoring ${downloadedIds.length} movies that already have files?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmonitor',
        onPress: async () => {
          if (!config) return;
          setBusyAction(true);
          try {
            await radarrApi.bulkUpdateMoviesMonitored(config, downloadedIds, false);
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
    if (!query.trim()) return movies;
    const q = query.toLowerCase();
    return movies.filter((m) => m.title.toLowerCase().includes(q));
  }, [movies, query]);

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

  const missing = useMemo(() => sorted.filter((m) => !m.hasFile), [sorted]);

  // Same grouping/collapse logic as the TV Shows screen: only groupable
  // fields produce real sections, and a collapsed section keeps its header
  // (with an empty `data`) rather than disappearing entirely.
  const groupable = groupHeadersEnabled && GROUPABLE_KEYS.includes(sortKey);
  const allSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(sorted, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: sorted }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [sorted, sortKey, profiles, groupable, collapsed]);
  const missingSections = useMemo(() => {
    const raw = groupable ? groupConsecutive(missing, (item) => groupLabel(item, sortKey, profiles)) : [{ title: '', data: missing }];
    return raw.map((s) => ({ ...s, count: s.data.length, data: collapsed.has(s.title) ? [] : s.data }));
  }, [missing, sortKey, profiles, groupable, collapsed]);

  // Upcoming always groups by nearest-release day, independent of the
  // All/Missing sort/group settings.
  const upcomingSections = useMemo(() => {
    const sorted = [...upcoming].sort(
      (a, b) => new Date(nearestUpcomingDate(a) ?? 0).getTime() - new Date(nearestUpcomingDate(b) ?? 0).getTime()
    );
    return groupConsecutive(sorted, (item) => formatDayGroup(nearestUpcomingDate(item)));
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

  // Per-row long-press menu action: toggles one movie's monitored flag.
  const toggleMonitored = async (item: RadarrMovie) => {
    if (!config) return;
    try {
      await radarrApi.updateMovie(config, { ...item, monitored: !item.monitored });
      loadLibrary();
    } catch (e) {
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Per-row long-press menu action: removes a movie, always keeping files
  // on disk (the fuller 3-way delete-files choice lives on the detail page).
  const removeFromLibrary = (item: RadarrMovie) => {
    alert('Remove from Library', `Remove "${item.title}" from Radarr? Files on disk are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          try {
            await radarrApi.deleteMovie(config, item.id, false);
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

  if (!config) return <NotConfigured service="Radarr" />;

  // Shared row renderer for both All and Missing tabs - tap opens the
  // detail page, long-press opens the per-row action menu.
  const renderMovieRow = (item: RadarrMovie) => {
    const poster = item.images.find((i) => i.coverType === 'poster');
    const countdown = formatCountdown(nearestUpcomingDate(item));
    return (
      <Pressable style={styles.card} onPress={() => router.push(`/movie/${item.id}`)} onLongPress={() => setMenuFor(item)}>
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
            {movieBadge(item)}
            {countdown ? <Badge label={countdown} tone="info" /> : null}
            {item.sizeOnDisk ? <Text style={styles.size}>{formatBytes(item.sizeOnDisk)}</Text> : null}
          </View>
          <RatingBadges imdb={item.ratings?.imdb?.value} rottenTomatoes={item.ratings?.rottenTomatoes?.value} compact />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
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
        <TouchableOpacity style={styles.addButton} onPress={() => router.push('/movie/add')}>
          <Ionicons name="add" size={26} color="#1A1300" />
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
          />
        </View>
        <WebRefreshButton onPress={refreshActiveTab} tint={colors.accent} />
      </View>

      {activeTab < 2 ? (
        <TouchableOpacity style={styles.sortPill} onPress={() => setSortMenuOpen(true)}>
          <Text style={styles.sortPillText}>{SORT_FIELDS.find((f) => f.key === sortKey)?.label}</Text>
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.accent} />
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
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
          style={styles.pager}
        >
        <View style={[styles.page, { width }]}>
          <SectionList
            sections={chunkedAllSections}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={sorted.length === 0 ? styles.emptyContainer : styles.list}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{error ?? 'No movies found'}</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'movie' : 'movies'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.accent}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((movie) => (
                  <View key={movie.id} style={styles.rowItem}>
                    {renderMovieRow(movie)}
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
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loading} onRefresh={loadLibrary} />}
            contentContainerStyle={missing.length === 0 ? styles.emptyContainer : styles.list}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>Nothing missing</Text> : null}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(section.title)}>
                  <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>
                    {section.count} {section.count === 1 ? 'movie' : 'movies'}
                  </Text>
                  <Ionicons
                    name={collapsed.has(section.title) ? 'chevron-forward' : 'chevron-down'}
                    size={16}
                    color={colors.accent}
                    style={styles.sectionHeaderChevron}
                  />
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((movie) => (
                  <View key={movie.id} style={styles.rowItem}>
                    {renderMovieRow(movie)}
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
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loadingUpcoming} onRefresh={loadUpcoming} />}
            contentContainerStyle={upcoming.length === 0 ? styles.emptyContainer : styles.list}
            ListEmptyComponent={!loadingUpcoming ? <Text style={styles.empty}>Nothing upcoming</Text> : null}
            renderSectionHeader={({ section }) => <Text style={styles.dayHeader}>{section.title}</Text>}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const poster = item.images.find((i) => i.coverType === 'poster');
                  return (
                    <Pressable key={item.id} style={[styles.card, styles.rowItem]} onPress={() => router.push(`/movie/${item.id}`)}>
                      {poster?.remoteUrl ? (
                        <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.poster, styles.posterPlaceholder]} />
                      )}
                      <View style={styles.info}>
                        <Text style={styles.title} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.historySubtitle}>{nearestUpcomingLabel(item)}</Text>
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
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loadingActivity} onRefresh={loadActivity} />}
            contentContainerStyle={activity.length === 0 ? styles.emptyContainer : styles.list}
            ListEmptyComponent={!loadingActivity ? <Text style={styles.empty}>Nothing pending</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const pct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 100;
                  const messages = item.statusMessages?.flatMap((m) => m.messages) ?? [];
                  return (
                    <Pressable key={item.id} style={[styles.historyRow, styles.rowItem]} onPress={() => router.push(`/movie/${item.movieId}`)}>
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
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loadingHistory} onRefresh={loadHistory} />}
            contentContainerStyle={history.length === 0 ? styles.emptyContainer : styles.list}
            ListEmptyComponent={!loadingHistory ? <Text style={styles.empty}>No history yet</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.id} style={[styles.historyRow, styles.rowItem]}>
                    <Text style={styles.historyTitle} numberOfLines={2}>
                      {item.sourceTitle}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={historyEventLabel(item.eventType)} tone={item.eventType === 'grabbed' ? 'accent' : 'success'} />
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
            serviceIcon="film"
            title="Radarr"
            version={version}
            refreshing={loadingServer}
            onRefresh={loadServer}
            stats={[
              { label: 'Movies', value: String(movies.length) },
              { label: 'Downloaded', value: String(movies.filter((m) => m.hasFile).length) },
              { label: 'Missing', value: String(missing.length) },
              { label: 'On Disk', value: formatBytes(movies.reduce((sum, m) => sum + (m.sizeOnDisk ?? 0), 0)) },
            ]}
            actionGroups={[
              [
                { label: 'Radarr Settings', icon: 'settings-outline', onPress: () => router.push('/settings') },
                {
                  label: 'View Radarr on Web',
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
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  // See index.tsx's identical comment - fixes "can't scroll" on the web
  // build without affecting native (which already resolved a real pixel
  // height here regardless).
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
  rowItem: { flex: 1 },
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
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10 },
  poster: { width: 60, height: 90, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  info: { flex: 1, justifyContent: 'center' },
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
  historyDate: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 6 },
  activityWarning: { color: colors.accent, fontSize: 12, marginTop: 6, lineHeight: 16 },
});
