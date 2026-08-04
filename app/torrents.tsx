import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  QbittorrentFilter,
  QbittorrentTorrent,
  qbittorrentApi,
  qbittorrentIsPaused,
  qbittorrentStateLabel,
} from '../src/api/qbittorrent';
import { ActionSheet, ActionSheetOption } from '../src/components/ActionSheet';
import { Badge, BadgeTone } from '../src/components/Badge';
import { NotConfigured } from '../src/components/NotConfigured';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { WebRefreshButton } from '../src/components/WebRefreshButton';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { formatBytes } from '../src/lib/format';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// Torrents screen (qBittorrent) - All/Active/Downloading/Finished/Error
// swipeable tabs backed directly by qBittorrent's own server-side `filter`
// values (not client-side grouping), mirroring Downloads' paged-tab
// structure but keyed by filter string instead of a fixed tab index.
const TABS: { key: QbittorrentFilter; label: string; empty: string }[] = [
  { key: 'all', label: 'All', empty: 'No torrents here.' },
  { key: 'active', label: 'Active', empty: 'Nothing active right now.' },
  { key: 'downloading', label: 'Downloading', empty: 'Nothing downloading right now.' },
  { key: 'completed', label: 'Finished', empty: 'No finished torrents.' },
  { key: 'errored', label: 'Error', empty: 'No torrents with errors.' },
];

// Maps a torrent's raw state to a badge color: red for real errors, muted
// for anything paused, green while seeding, blue while downloading, and the
// generic accent color for other in-between states (checking, moving, etc).
function statusTone(state: string): BadgeTone {
  if (state === 'error' || state === 'missingFiles') return 'danger';
  if (qbittorrentIsPaused(state)) return 'muted';
  const label = qbittorrentStateLabel(state);
  if (label === 'Seeding') return 'success';
  if (label === 'Downloading') return 'info';
  return 'accent';
}

// Formats a raw bytes/sec value as e.g. "512 KB/s" or "3.2 MB/s".
function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB/s`;
  return `${(kb / 1024).toFixed(1)} MB/s`;
}

// Formats a raw ETA in seconds as e.g. "2h 15m left"; returns `null` for
// qBittorrent's "infinite/unknown" sentinel value (8640000, exactly 100
// days) so callers can hide the ETA entirely rather than show a nonsense
// duration.
function formatEta(seconds: number): string | null {
  if (!seconds || seconds >= 8640000) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

type DataByFilter = Record<QbittorrentFilter, QbittorrentTorrent[]>;
const EMPTY_DATA: DataByFilter = {
  all: [],
  active: [],
  downloading: [],
  seeding: [],
  completed: [],
  paused: [],
  errored: [],
};

export default function TorrentsScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.qbittorrent;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useRef(new Animated.Value(0)).current;

  const [activeTab, setActiveTab] = useState(0);
  const [dataByFilter, setDataByFilter] = useState<DataByFilter>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [errorByFilter, setErrorByFilter] = useState<Partial<Record<QbittorrentFilter, string>>>({});
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const activeFilter = TABS[activeTab].key;

  // `opts.silent` skips toggling `loading`, same reasoning as Downloads'
  // `loadQueue` - a live 3s poll shouldn't visibly bounce the
  // pull-to-refresh spinner.
  const load = useCallback(
    async (filter: QbittorrentFilter, opts?: { silent?: boolean }) => {
      if (!config) return;
      if (!opts?.silent) setLoading(true);
      setErrorByFilter((prev) => ({ ...prev, [filter]: undefined }));
      try {
        const data = await qbittorrentApi.listTorrents(config, filter);
        setDataByFilter((prev) => ({ ...prev, [filter]: data }));
      } catch (e) {
        setErrorByFilter((prev) => ({ ...prev, [filter]: e instanceof Error ? e.message : 'Failed to load torrents' }));
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [config]
  );

  useFocusEffect(
    useCallback(() => {
      load(activeFilter);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFilter, load])
  );

  // Poll every 3s while this screen is focused, same reasoning as Downloads'
  // Queue tab - progress/speed should update live without the pull-to-refresh
  // spinner bouncing in on every tick. Restarts (and switches filter) whenever
  // the active tab changes.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => load(activeFilter, { silent: true }), 3000);
      return () => clearInterval(interval);
    }, [activeFilter, load])
  );

  // Central place to react to the active tab changing (tap or swipe) -
  // eagerly loads that filter's data (unlike Downloads' History tab, every
  // qBittorrent filter is expected to be fresh on every switch since the
  // underlying torrent list changes constantly).
  const handleTabChange = (index: number) => {
    setActiveTab(index);
    load(TABS[index].key);
  };

  // Tab-tap path: updates state immediately and animates the paged
  // ScrollView to match.
  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` reloads whichever filter is
  // currently active, mirroring what its own `RefreshControl.onRefresh`
  // already does.
  const refreshActiveTab = () => load(activeFilter);

  // Swipe path: fires once the paged scroll settles, deriving the resulting
  // tab index from the final scroll offset.
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  // A fold/unfold changes `width` without firing a scroll event, so the paged
  // ScrollView's x-offset (recorded in absolute pixels for the old width)
  // silently points at the wrong page under the new one - most visible when
  // the active tab isn't index 0. Re-snap to the current tab under the new
  // width instead of leaving it stale.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeTab * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // Pauses/resumes one specific torrent (per-item "..." menu action).
  const toggleTorrent = async (item: QbittorrentTorrent) => {
    if (!config) return;
    setBusy(true);
    try {
      if (qbittorrentIsPaused(item.state)) await qbittorrentApi.resumeTorrents(config, [item.hash]);
      else await qbittorrentApi.pauseTorrents(config, [item.hash]);
      await load(activeFilter);
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Removes one torrent; `deleteFiles` controls whether the downloaded data
  // on disk goes with it (the confirm dialog offers both as separate
  // options, matching qBittorrent's own remove-torrent prompt).
  const deleteTorrent = (item: QbittorrentTorrent, deleteFiles: boolean) => {
    if (!config) return;
    setBusy(true);
    qbittorrentApi
      .deleteTorrents(config, [item.hash], deleteFiles)
      .then(() => load(activeFilter))
      .catch((e) => alert('Delete failed', e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setBusy(false));
  };

  // Builds the per-item "..." action sheet: Pause/Resume plus a Delete flow
  // with the Remove Only / Delete Files Too choice.
  const openItemMenu = (item: QbittorrentTorrent) => {
    if (!config) return;
    const paused = qbittorrentIsPaused(item.state);
    const options: ActionSheetOption[] = [
      { label: paused ? 'Resume' : 'Pause', onPress: () => toggleTorrent(item) },
      {
        label: 'Delete',
        destructive: true,
        onPress: () => {
          alert('Delete Torrent', `Remove "${item.name}" from qBittorrent?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove Only', onPress: () => deleteTorrent(item, false) },
            { text: 'Delete Files Too', style: 'destructive', onPress: () => deleteTorrent(item, true) },
          ]);
        },
      },
    ];
    setMenu({ title: item.name, options });
  };

  const rowKey = (row: QbittorrentTorrent[]) => row.map((t) => t.hash).join('-');
  const chunkedByFilter = useMemo(() => {
    const next = {} as Record<QbittorrentFilter, QbittorrentTorrent[][]>;
    for (const tab of TABS) next[tab.key] = chunk(dataByFilter[tab.key], columns);
    return next;
  }, [dataByFilter, columns]);

  const activeTorrents = dataByFilter[activeFilter];
  const totalDown = activeTorrents.reduce((sum, t) => sum + t.dlspeed, 0);
  const totalUp = activeTorrents.reduce((sum, t) => sum + t.upspeed, 0);

  if (!config) return <NotConfigured service="qBittorrent" tint={colors.qbittorrent} />;

  const renderRow = (row: QbittorrentTorrent[]) => (
    <View style={styles.row}>
      {row.map((item) => {
        const paused = qbittorrentIsPaused(item.state);
        const eta = formatEta(item.eta);
        return (
          <View key={item.hash} style={[styles.card, styles.rowItem]}>
            <View style={styles.cardRow}>
              <View style={styles.cardInfo}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(item.progress * 100)}%` }]} />
                </View>
                <View style={styles.badgeRow}>
                  <Badge label={qbittorrentStateLabel(item.state)} tone={statusTone(item.state)} />
                  <Text style={styles.subtitle}>
                    {Math.round(item.progress * 100)}% · {formatBytes(item.size)}
                  </Text>
                </View>
                <Text style={styles.subtitle}>
                  ↓ {formatSpeed(item.dlspeed)} · ↑ {formatSpeed(item.upspeed)} · {item.ratio.toFixed(2)} ratio
                  {!paused && eta ? ` · ${eta}` : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.menuButton} onPress={() => openItemMenu(item)} disabled={busy}>
                <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.torrents.icon} tint={SECTION_META.torrents.tint} title={names.torrents} />,
        }}
      />
      <View style={styles.statusBar}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TABS.map((t) => t.label)}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={colors.qbittorrent}
          />
        </View>
        <View style={styles.statusRight}>
          <View style={styles.statusTextGroup}>
            <Text style={styles.statusValue}>
              {activeTorrents.length} torrent{activeTorrents.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.statusSubtext}>
              ↓ {formatSpeed(totalDown)} · ↑ {formatSpeed(totalUp)}
            </Text>
          </View>
          <WebRefreshButton onPress={refreshActiveTab} tint={colors.qbittorrent} />
        </View>
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
        {TABS.map((tab) => (
          <View key={tab.key} style={[styles.page, { width }]}>
            <FlatList
              data={chunkedByFilter[tab.key]}
              keyExtractor={rowKey}
              refreshControl={
                <RefreshControl tintColor={colors.qbittorrent} refreshing={loading} onRefresh={() => load(activeFilter)} />
              }
              contentContainerStyle={[dataByFilter[tab.key].length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
              ListEmptyComponent={
                !loading ? <Text style={styles.empty}>{errorByFilter[tab.key] ?? tab.empty}</Text> : null
              }
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              renderItem={({ item: row }) => renderRow(row)}
            />
          </View>
        ))}
      </Animated.ScrollView>

      {menu ? <ActionSheet visible title={menu.title} options={menu.options} onClose={() => setMenu(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // Unlike Downloads' 2-tab bar (Queue/History, always short enough to fit),
  // 5 tab labels can outgrow the row on a folded/narrow screen. `flex: 1` +
  // `minWidth: 0` properly bounds SwipeTabBar to the remaining space
  // (flex items default to a min-width matching their content, so flex: 1
  // alone still lets a wide ScrollView child push past its box) so its own
  // internal horizontal scroll (see SwipeTabBar) kicks in instead of the row
  // overflowing and crowding the speed stats.
  tabBar: { flex: 1, minWidth: 0, overflow: 'hidden' },
  // See app/index.tsx's identical comment - fixes "can't scroll"
  // on the web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusTextGroup: { alignItems: 'flex-end', flexShrink: 0 },
  statusValue: { color: colors.qbittorrent, fontSize: 16, fontWeight: '700' },
  statusSubtext: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  // `minWidth: 0` - react-native-web flex items default to `min-width: auto`
  // and refuse to shrink below their own content's natural width, which can
  // force a card past its 1/columns share of the row (see the fuller
  // explanation on this same style in movies.tsx/index.tsx).
  rowItem: { flex: 1, minWidth: 0 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardInfo: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.qbittorrent },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  menuButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
