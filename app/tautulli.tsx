// Stats screen (Tautulli) - Activity/Users/History/Stats/Graphs swipeable
// tabs, following the same paged-tab template as Downloads/Torrents/
// Requests: SwipeTabBar driving a paged Animated.ScrollView, each tab
// lazily loads once per screen visit.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  TautulliGraphData,
  TautulliHistoryItem,
  TautulliSession,
  TautulliStatGroup,
  TautulliStatRow,
  TautulliUserRow,
  tautulliApi,
  tautulliImageUrl,
} from '../src/api/tautulli';
import { ServiceConfig } from '../src/api/types';
import { Badge, BadgeTone } from '../src/components/Badge';
import { NotConfigured } from '../src/components/NotConfigured';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { WebRefreshButton } from '../src/components/WebRefreshButton';
import { TautulliHistoryCard } from '../src/components/TautulliHistoryCard';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { formatDuration, titleCase } from '../src/lib/format';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

const TABS = ['Activity', 'Users', 'History', 'Stats', 'Graphs'] as const;
const HISTORY_PAGE_SIZE = 25;

// Maps a session's transcode decision to a badge color: direct play is the
// "best case" (green), a remux/copy is a middle ground (blue), a full
// transcode is the most server-taxing case (amber).
function transcodeTone(decision: string): BadgeTone {
  if (decision === 'transcode') return 'accent';
  if (decision === 'copy') return 'info';
  return 'success';
}

function sessionStateIcon(state: string): keyof typeof Ionicons.glyphMap {
  if (state === 'paused') return 'pause';
  if (state === 'buffering') return 'sync';
  return 'play';
}

// Tautulli's resolution field is a bare number ("1080", "720") or a word
// ("4k", "sd") depending on the source - normalize both into a display label.
function resolutionLabel(resolution?: string): string {
  if (!resolution) return '';
  return /^\d+$/.test(resolution) ? `${resolution}p` : resolution.toUpperCase();
}

function codecLabel(codec?: string): string {
  return codec ? codec.toUpperCase() : '';
}

// Builds the source-quality summary (e.g. "1080p HEVC · AC3 6ch") and, when
// this session is actually transcoding, an arrow-suffixed target summary
// showing exactly what it's being converted to (e.g. "→ 720p H264 · AAC 2ch") -
// this is the "what are they transcoding to" detail called out in feedback.
function sessionQualityLine(session: TautulliSession): string {
  const sourceVideo = [resolutionLabel(session.video_resolution), codecLabel(session.video_codec)].filter(Boolean).join(' ');
  const sourceAudio = [codecLabel(session.audio_codec), session.audio_channels ? `${session.audio_channels}ch` : ''].filter(Boolean).join(' ');
  const source = [sourceVideo, sourceAudio].filter(Boolean).join(' · ');

  const isTranscoding = session.transcode_decision === 'transcode' || session.video_decision === 'transcode' || session.audio_decision === 'transcode';
  if (!isTranscoding) return source;

  const targetVideo = [resolutionLabel(session.stream_video_resolution), codecLabel(session.stream_video_codec)].filter(Boolean).join(' ');
  const targetAudio = codecLabel(session.stream_audio_codec);
  const target = [targetVideo, targetAudio].filter(Boolean).join(' · ');
  return target && target !== source ? `${source}  →  ${target}` : source;
}

// Shortens a "YYYY-MM-DD" category from get_plays_by_date down to "M/D" so
// 30 daily bars don't need 30 full dates to stay legible.
function shortDate(category: string): string {
  const parts = category.split('-');
  if (parts.length !== 3) return category;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// One simple bar-chart card - combines every series (Movies/TV/Music/Live TV)
// into one total-plays-per-category value and renders plain Views sized by
// percentage of the max, since no charting library is in this project's
// dependencies (matches the "no native dep unless necessary" pattern already
// established elsewhere - see PLAN.md's expo-crypto rebuild note).
function GraphCard({
  title,
  data,
  loading,
  formatCategory,
}: {
  title: string;
  data: TautulliGraphData | null;
  loading: boolean;
  formatCategory?: (category: string) => string;
}) {
  const totals = useMemo(
    () => data?.categories.map((_, i) => data.series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)) ?? [],
    [data]
  );
  const max = Math.max(1, ...totals);

  return (
    <View style={styles.graphCard}>
      <Text style={styles.graphTitle}>{title}</Text>
      {loading ? (
        <ActivityIndicator color={colors.tautulli} style={{ marginTop: 12 }} />
      ) : !data || data.categories.length === 0 ? (
        <Text style={styles.empty}>No data yet</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.graphBarsRow}>
          {data.categories.map((category, i) => (
            <View key={`${category}-${i}`} style={styles.graphBarCol}>
              <View style={styles.graphBarTrack}>
                <View
                  style={[styles.graphBarFill, { height: `${Math.max(4, Math.round((totals[i] / max) * 100))}%` }]}
                />
              </View>
              <Text style={styles.graphBarValue}>{totals[i]}</Text>
              <Text style={styles.graphBarLabel} numberOfLines={1}>
                {formatCategory ? formatCategory(category) : category}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// One ranked stat list card for the Stats tab - shared shell for all five
// `get_home_stats` groups this screen surfaces, each with its own metric
// formatter since the meaningful number differs per stat_id (play count for
// top_movies/top_users, unique viewers for popular_movies/popular_tv), and
// its own poster/avatar field since movies/shows/users each carry their
// image under a different field name.
function StatSection({
  title,
  group,
  metric,
  config,
  image,
  placeholderIcon,
}: {
  title: string;
  group?: TautulliStatGroup;
  metric: (row: TautulliStatRow) => string;
  config: ServiceConfig;
  image: (row: TautulliStatRow) => string | undefined;
  placeholderIcon: keyof typeof Ionicons.glyphMap;
}) {
  const rows = group?.rows.slice(0, 5) ?? [];
  return (
    <View style={styles.statCard}>
      <Text style={styles.statTitle}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No data yet</Text>
      ) : (
        rows.map((row, i) => {
          const imageUrl = tautulliImageUrl(config, { img: image(row), ratingKey: row.rating_key, width: 100, height: 150 });
          return (
            <View key={i} style={[styles.statRow, i > 0 && styles.statRowDivider]}>
              <Text style={styles.statRank}>{i + 1}</Text>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.statThumb} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.statThumb, styles.statThumbPlaceholder]}>
                  <Ionicons name={placeholderIcon} size={14} color={colors.textMuted} />
                </View>
              )}
              <Text style={styles.statRowTitle} numberOfLines={1}>
                {row.title ?? row.friendly_name ?? row.user ?? 'Unknown'}
              </Text>
              <Text style={styles.statMetric}>{metric(row)}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

export default function TautulliScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.tautulli;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState(0);

  const [sessions, setSessions] = useState<TautulliSession[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [users, setUsers] = useState<TautulliUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [history, setHistory] = useState<TautulliHistoryItem[]>([]);
  const [historyStart, setHistoryStart] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  const [statGroups, setStatGroups] = useState<TautulliStatGroup[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  const [playsByDate, setPlaysByDate] = useState<TautulliGraphData | null>(null);
  const [playsByDayOfWeek, setPlaysByDayOfWeek] = useState<TautulliGraphData | null>(null);
  const [playsByMonth, setPlaysByMonth] = useState<TautulliGraphData | null>(null);
  const [loadingGraphs, setLoadingGraphs] = useState(false);

  // Each tab (besides Activity, which always refreshes) only needs to load
  // once per screen visit - same lazy-load pattern as every other paged-tab
  // screen in this app.
  const usersLoaded = useRef(false);
  const historyLoaded = useRef(false);
  const statsLoaded = useRef(false);
  const graphsLoaded = useRef(false);
  const loadMoreHistoryLock = useRef(false);

  // `opts.silent` skips toggling `loadingActivity`, same reasoning as
  // Downloads' Queue poll - a live 3s refresh shouldn't visibly bounce the
  // pull-to-refresh spinner.
  const loadActivity = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!config) return;
      if (!opts?.silent) setLoadingActivity(true);
      setActivityError(null);
      try {
        const data = await tautulliApi.getActivity(config);
        setSessions(data.sessions);
      } catch (e) {
        if (!opts?.silent) setActivityError(e instanceof Error ? e.message : 'Failed to load activity');
      } finally {
        if (!opts?.silent) setLoadingActivity(false);
      }
    },
    [config]
  );

  const loadUsers = useCallback(async () => {
    if (!config) return;
    setLoadingUsers(true);
    try {
      const res = await tautulliApi.getUsersTable(config);
      setUsers(res.data);
      usersLoaded.current = true;
    } catch (e) {
      alert('Failed to load users', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingUsers(false);
    }
  }, [config]);

  // Loads page 1 of History, replacing the whole list.
  const loadHistory = useCallback(async () => {
    if (!config) return;
    setLoadingHistory(true);
    try {
      const res = await tautulliApi.getHistory(config, { start: 0, length: HISTORY_PAGE_SIZE });
      setHistory(res.data);
      setHistoryStart(res.data.length);
      setHistoryTotal(res.recordsFiltered);
      historyLoaded.current = true;
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingHistory(false);
    }
  }, [config]);

  // Infinite-scroll continuation for History, guarded against duplicate
  // concurrent calls the same way Discover's category grids are.
  const loadMoreHistory = useCallback(() => {
    if (!config || loadMoreHistoryLock.current || history.length >= historyTotal) return;
    loadMoreHistoryLock.current = true;
    setLoadingMoreHistory(true);
    tautulliApi
      .getHistory(config, { start: historyStart, length: HISTORY_PAGE_SIZE })
      .then((res) => {
        setHistory((prev) => [...prev, ...res.data]);
        setHistoryStart((s) => s + res.data.length);
        setHistoryTotal(res.recordsFiltered);
      })
      .finally(() => {
        setLoadingMoreHistory(false);
        loadMoreHistoryLock.current = false;
      });
  }, [config, history.length, historyTotal, historyStart]);

  const loadStats = useCallback(async () => {
    if (!config) return;
    setLoadingStats(true);
    try {
      setStatGroups(await tautulliApi.getHomeStats(config));
      statsLoaded.current = true;
    } catch (e) {
      alert('Failed to load stats', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingStats(false);
    }
  }, [config]);

  // Loads all three graphs in parallel - one independently failing doesn't
  // block the other two from rendering.
  const loadGraphs = useCallback(async () => {
    if (!config) return;
    setLoadingGraphs(true);
    try {
      const [byDate, byDayOfWeek, byMonth] = await Promise.all([
        tautulliApi.getPlaysByDate(config, 30).catch(() => null),
        tautulliApi.getPlaysByDayOfWeek(config, 30).catch(() => null),
        tautulliApi.getPlaysByMonth(config, 12).catch(() => null),
      ]);
      setPlaysByDate(byDate);
      setPlaysByDayOfWeek(byDayOfWeek);
      setPlaysByMonth(byMonth);
      graphsLoaded.current = true;
    } finally {
      setLoadingGraphs(false);
    }
  }, [config]);

  // Activity always refreshes on focus (it's the "real time" tab); every
  // other tab only lazily loads if it hasn't been fetched yet this visit
  // and is currently active.
  useFocusEffect(
    useCallback(() => {
      loadActivity();
      if (activeTab === 1 && !usersLoaded.current) loadUsers();
      if (activeTab === 2 && !historyLoaded.current) loadHistory();
      if (activeTab === 3 && !statsLoaded.current) loadStats();
      if (activeTab === 4 && !graphsLoaded.current) loadGraphs();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadActivity])
  );

  // Polls Activity every 3s while that tab is focused, silently, so
  // currently-playing sessions' progress updates live.
  useFocusEffect(
    useCallback(() => {
      if (activeTab !== 0) return;
      const interval = setInterval(() => loadActivity({ silent: true }), 3000);
      return () => clearInterval(interval);
    }, [activeTab, loadActivity])
  );

  const handleTabChange = (index: number) => {
    setActiveTab(index);
    if (index === 1 && !usersLoaded.current) loadUsers();
    if (index === 2 && !historyLoaded.current) loadHistory();
    if (index === 3 && !statsLoaded.current) loadStats();
    if (index === 4 && !graphsLoaded.current) loadGraphs();
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
    if (activeTab === 1) loadUsers();
    else if (activeTab === 2) loadHistory();
    else if (activeTab === 3) loadStats();
    else if (activeTab === 4) loadGraphs();
    else loadActivity();
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const sessionRowKey = (row: TautulliSession[]) => row.map((s) => s.session_key).join('-');
  const historyRowKey = (row: TautulliHistoryItem[]) => row.map((h) => String(h.row_id)).join('-');
  const chunkedSessions = useMemo(() => chunk(sessions, columns), [sessions, columns]);
  const chunkedHistory = useMemo(() => chunk(history, columns), [history, columns]);

  if (!config) return <NotConfigured service="Tautulli" tint={colors.tautulli} />;

  const renderSessionRow = (item: TautulliSession) => {
    const posterUrl = tautulliImageUrl(config, { ratingKey: item.rating_key, img: item.thumb, width: 120, height: 180 });
    const percent = Math.max(0, Math.min(100, Math.round(Number(item.progress_percent) || 0)));
    const qualityLine = sessionQualityLine(item);
    const device = item.player || item.product || item.platform;
    return (
      <View style={styles.card}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]} />
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {item.full_title}
          </Text>
          <View style={styles.badgeRow}>
            <Ionicons name={sessionStateIcon(item.state)} size={14} color={colors.tautulli} />
            <Badge label={titleCase(item.transcode_decision)} tone={transcodeTone(item.transcode_decision)} />
          </View>
          {qualityLine ? (
            <Text style={styles.qualityText} numberOfLines={1}>
              {qualityLine}
            </Text>
          ) : null}
          <Text style={styles.subtitle} numberOfLines={1}>
            {item.friendly_name}
            {device ? ` · ${device}` : ''}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.percent}>{percent}%</Text>
        </View>
      </View>
    );
  };

  const renderUserRow = (item: TautulliUserRow) => {
    const avatarUrl = tautulliImageUrl(config, { img: item.user_thumb, width: 120, height: 120 });
    return (
      <Pressable
        style={styles.userRow}
        onPress={() => router.push(`/tautulli/user/${item.user_id}?name=${encodeURIComponent(item.friendly_name)}`)}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={20} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.friendly_name}
          </Text>
          <Text style={styles.userMeta}>
            {item.plays} plays · {formatDuration(item.duration)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable>
    );
  };

  const statGroup = (id: string) => statGroups.find((g) => g.stat_id === id);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.stats.icon} tint={SECTION_META.stats.tint} title={names.stats} />,
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
            tint={colors.tautulli}
          />
        </View>
        <WebRefreshButton onPress={refreshActiveTab} tint={colors.tautulli} />
      </View>

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
          <FlatList
            data={chunkedSessions}
            keyExtractor={sessionRowKey}
            refreshControl={<RefreshControl tintColor={colors.tautulli} refreshing={loadingActivity} onRefresh={() => loadActivity()} />}
            contentContainerStyle={[sessions.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingActivity ? <Text style={styles.empty}>{activityError ?? 'Nothing playing right now.'}</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((session) => (
                  <View key={session.session_key} style={styles.rowItem}>
                    {renderSessionRow(session)}
                  </View>
                ))}
              </View>
            )}
          />
        </View>

        <View style={[styles.page, { width }]}>
          <FlatList
            data={users}
            keyExtractor={(item) => String(item.user_id)}
            refreshControl={<RefreshControl tintColor={colors.tautulli} refreshing={loadingUsers} onRefresh={loadUsers} />}
            contentContainerStyle={[users.length === 0 ? styles.emptyContainer : styles.userList, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingUsers ? <Text style={styles.empty}>No users found.</Text> : null}
            renderItem={({ item }) => renderUserRow(item)}
          />
        </View>

        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedHistory}
            keyExtractor={historyRowKey}
            refreshControl={<RefreshControl tintColor={colors.tautulli} refreshing={loadingHistory} onRefresh={loadHistory} />}
            contentContainerStyle={[history.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            onEndReachedThreshold={0.5}
            onEndReached={loadMoreHistory}
            ListFooterComponent={loadingMoreHistory ? <ActivityIndicator color={colors.tautulli} style={{ marginVertical: 16 }} /> : null}
            ListEmptyComponent={!loadingHistory ? <Text style={styles.empty}>No history yet.</Text> : null}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.row_id} style={styles.rowItem}>
                    <TautulliHistoryCard item={item} config={config} />
                  </View>
                ))}
              </View>
            )}
          />
        </View>

        <View style={[styles.page, { width }]}>
          <ScrollView
            contentContainerStyle={[styles.statsContainer, { paddingBottom: tabBarClearance }]}
            refreshControl={<RefreshControl tintColor={colors.tautulli} refreshing={loadingStats} onRefresh={loadStats} />}
          >
            {loadingStats && statGroups.length === 0 ? (
              <ActivityIndicator color={colors.tautulli} style={{ marginTop: 40 }} />
            ) : (
              <>
                <StatSection
                  title="Most Watched Movies"
                  group={statGroup('top_movies')}
                  metric={(r) => `${r.total_plays ?? 0} plays`}
                  config={config}
                  image={(r) => r.thumb}
                  placeholderIcon="film-outline"
                />
                <StatSection
                  title="Most Popular Movies"
                  group={statGroup('popular_movies')}
                  metric={(r) => `${r.users_watched ?? 0} viewers`}
                  config={config}
                  image={(r) => r.thumb}
                  placeholderIcon="film-outline"
                />
                <StatSection
                  title="Most Popular Shows"
                  group={statGroup('popular_tv')}
                  metric={(r) => `${r.users_watched ?? 0} viewers`}
                  config={config}
                  image={(r) => r.grandparent_thumb ?? r.thumb}
                  placeholderIcon="tv-outline"
                />
                <StatSection
                  title="Most Active Users"
                  group={statGroup('top_users')}
                  metric={(r) => `${r.total_plays ?? 0} plays`}
                  config={config}
                  image={(r) => r.user_thumb}
                  placeholderIcon="person"
                />
                <StatSection
                  title="Most Concurrent Streams"
                  group={statGroup('most_concurrent')}
                  metric={(r) => `${r.total_plays ?? 0}`}
                  config={config}
                  image={() => undefined}
                  placeholderIcon="stats-chart-outline"
                />
              </>
            )}
          </ScrollView>
        </View>

        <View style={[styles.page, { width }]}>
          <ScrollView contentContainerStyle={[styles.statsContainer, { paddingBottom: tabBarClearance }]}>
            <GraphCard title="Plays by Day" data={playsByDate} loading={loadingGraphs} formatCategory={shortDate} />
            <GraphCard title="Plays by Day of Week" data={playsByDayOfWeek} loading={loadingGraphs} />
            <GraphCard title="Plays by Month" data={playsByMonth} loading={loadingGraphs} />
          </ScrollView>
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  // See app/index.tsx's identical comment - fixes "can't scroll"
  // on the web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  list: { padding: 12, gap: 10 },
  userList: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  // `minWidth: 0` matters here (and on `info` below) for the same reason
  // documented elsewhere in this codebase for react-native-web: a flex
  // item's default `min-width: auto` refuses to shrink below its own
  // content's natural width, so an unwrapped row wide enough could force
  // this whole card past its 1/columns share of the row - overflowing the
  // actual screen width instead of respecting it, especially once 3 columns
  // only have ~300px each to work with.
  rowItem: { flex: 1, minWidth: 0 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, minWidth: 0 },
  poster: { width: 60, height: 90, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  info: { flex: 1, justifyContent: 'center', gap: 2, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  qualityText: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, marginTop: 8, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.tautulli },
  percent: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceAlt },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  userMeta: { fontSize: 12, color: colors.textSecondary },
  statsContainer: { padding: 16, gap: 14 },
  statCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 4 },
  statTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  statRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  statRank: { width: 20, color: colors.tautulli, fontWeight: '800', fontSize: 13 },
  statThumb: { width: 32, height: 48, borderRadius: 4, backgroundColor: colors.surfaceAlt },
  statThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  statRowTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  statMetric: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  graphCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 8 },
  graphTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  graphBarsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 8 },
  graphBarCol: { alignItems: 'center', width: 34 },
  graphBarTrack: { width: 16, height: 80, justifyContent: 'flex-end', backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  graphBarFill: { width: '100%', backgroundColor: colors.tautulli, borderRadius: 4 },
  graphBarValue: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  graphBarLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
});
