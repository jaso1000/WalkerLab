import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { ServiceConfig } from '../api/types';
import { useSectionNames } from '../context/SectionNamesContext';
import { alert } from '../lib/alert';
import { formatBytes } from '../lib/format';
import { chunk, useColumns, useContentWidth } from '../lib/responsive';
import { SECTION_META } from '../lib/sectionMeta';
import { SectionId } from '../lib/sectionNames';
import { useTabBarClearance } from '../lib/tabBarClearance';
import { TORRENT_TABS, TorrentClientKind, TorrentItem, TorrentTab, torrentClientApi } from '../lib/torrentClient';
import { colors } from '../theme/colors';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { Badge } from './Badge';
import { HeaderTitle } from './HeaderTitle';
import { NotConfigured } from './NotConfigured';
import { SwipeTabBar } from './SwipeTabBar';
import { WebRefreshButton } from './WebRefreshButton';

// Shared torrent-client screen for both qBittorrent and Transmission -
// mirrors DownloadClientScreen's own role for SABnzbd/NZBGet exactly,
// including the "why" (each client gets its own nav section and route -
// app/torrents.tsx for qBittorrent, app/transmission.tsx for Transmission,
// both independently toggleable in Settings - rendering this exact same
// component with a fixed `client`/`tint`/`sectionId` rather than either
// screen having its own near-duplicate copy of the UI). torrentClient.ts
// normalizes either backend's very different raw shape into the one this
// component renders, so nothing below here needs to know which is active
// beyond the tint color it was given.

// Formats a raw bytes/sec value as e.g. "512 KB/s" or "3.2 MB/s".
function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB/s`;
  return `${(kb / 1024).toFixed(1)} MB/s`;
}

// Formats a raw ETA in seconds as e.g. "2h 15m left"; `null` (unknown/
// infinite, already normalized by torrentClient.ts) hides it entirely.
function formatEta(seconds: number | null): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

// Row - memoized so scrolling/unrelated screen state changes don't
// re-render every off-screen row.
const TorrentRow = memo(function TorrentRow({
  item,
  busy,
  tint,
  onOpenMenu,
}: {
  item: TorrentItem;
  busy: boolean;
  tint: string;
  onOpenMenu: (item: TorrentItem) => void;
}) {
  const eta = formatEta(item.eta);
  return (
    <View style={[styles.card, styles.rowItem]}>
      <View style={styles.cardRow}>
        <View style={styles.cardInfo}>
          <Text style={styles.title} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { backgroundColor: tint, width: `${Math.round(item.progress * 100)}%` }]} />
          </View>
          <View style={styles.badgeRow}>
            <Badge label={item.stateLabel} tone={item.tone} />
            <Text style={styles.subtitle}>
              {Math.round(item.progress * 100)}% · {formatBytes(item.size)}
            </Text>
          </View>
          <Text style={styles.subtitle}>
            ↓ {formatSpeed(item.dlspeed)} · ↑ {formatSpeed(item.upspeed)} · {item.ratio.toFixed(2)} ratio
            {!item.isPaused && eta ? ` · ${eta}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.menuButton} onPress={() => onOpenMenu(item)} disabled={busy}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

type DataByTab = Record<TorrentTab, TorrentItem[]>;
const EMPTY_DATA: DataByTab = { all: [], active: [], downloading: [], completed: [], errored: [] };

export function TorrentClientScreen({
  client,
  config,
  tint,
  sectionId,
  notConfiguredLabel,
}: {
  client: TorrentClientKind;
  config: ServiceConfig | undefined;
  tint: string;
  sectionId: SectionId;
  notConfiguredLabel: string;
}) {
  const { names } = useSectionNames();
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const [activeTab, setActiveTab] = useState(0);
  const [dataByTab, setDataByTab] = useState<DataByTab>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [errorByTab, setErrorByTab] = useState<Partial<Record<TorrentTab, string>>>({});
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const activeKey = TORRENT_TABS[activeTab].key;

  // `opts.silent` skips toggling `loading`, same reasoning as Downloads'
  // `loadQueue` - a live 3s poll shouldn't visibly bounce the
  // pull-to-refresh spinner.
  const load = useCallback(
    async (tab: TorrentTab, opts?: { silent?: boolean }) => {
      if (!config) return;
      if (!opts?.silent) setLoading(true);
      setErrorByTab((prev) => ({ ...prev, [tab]: undefined }));
      try {
        const data = await torrentClientApi.listTorrents(client, config, tab);
        setDataByTab((prev) => ({ ...prev, [tab]: data }));
      } catch (e) {
        setErrorByTab((prev) => ({ ...prev, [tab]: e instanceof Error ? e.message : 'Failed to load torrents' }));
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [client, config]
  );

  useFocusEffect(
    useCallback(() => {
      load(activeKey);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKey, load])
  );

  // Poll every 3s while this screen is focused, same reasoning as Downloads'
  // Queue tab - progress/speed should update live without the pull-to-refresh
  // spinner bouncing in on every tick. Restarts (and switches tab) whenever
  // the active tab changes.
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => load(activeKey, { silent: true }), 3000);
      return () => clearInterval(interval);
    }, [activeKey, load])
  );

  // Central place to react to the active tab changing (tap or swipe) -
  // eagerly loads that tab's data, since the underlying torrent list
  // changes constantly.
  const handleTabChange = (index: number) => {
    setActiveTab(index);
    load(TORRENT_TABS[index].key);
  };

  // Tab-tap path: updates state immediately and animates the paged
  // ScrollView to match.
  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` reloads whichever tab is
  // currently active, mirroring what its own `RefreshControl.onRefresh`
  // already does.
  const refreshActiveTab = () => load(activeKey);

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
  const toggleTorrent = useCallback(
    async (item: TorrentItem) => {
      if (!config) return;
      setBusy(true);
      try {
        if (item.isPaused) await torrentClientApi.resume(client, config, [item.id]);
        else await torrentClientApi.pause(client, config, [item.id]);
        await load(activeKey);
      } catch (e) {
        alert('Failed', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setBusy(false);
      }
    },
    [client, config, activeKey, load]
  );

  // Removes one torrent; `deleteFiles` controls whether the downloaded data
  // on disk goes with it (the confirm dialog offers both as separate
  // options, matching qBittorrent's own remove-torrent prompt).
  const deleteTorrent = useCallback(
    (item: TorrentItem, deleteFiles: boolean) => {
      if (!config) return;
      setBusy(true);
      torrentClientApi
        .remove(client, config, [item.id], deleteFiles)
        .then(() => load(activeKey))
        .catch((e) => alert('Delete failed', e instanceof Error ? e.message : 'Unknown error'))
        .finally(() => setBusy(false));
    },
    [client, config, activeKey, load]
  );

  // Builds the per-item "..." action sheet: Pause/Resume plus a Delete flow
  // with the Remove Only / Delete Files Too choice.
  const openItemMenu = useCallback(
    (item: TorrentItem) => {
      if (!config) return;
      const options: ActionSheetOption[] = [
        { label: item.isPaused ? 'Resume' : 'Pause', onPress: () => toggleTorrent(item) },
        {
          label: 'Delete',
          destructive: true,
          onPress: () => {
            alert('Delete Torrent', `Remove "${item.name}" from ${notConfiguredLabel}?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove Only', onPress: () => deleteTorrent(item, false) },
              { text: 'Remove and delete files', style: 'destructive', onPress: () => deleteTorrent(item, true) },
            ]);
          },
        },
      ];
      setMenu({ title: item.name, options });
    },
    [config, notConfiguredLabel, toggleTorrent, deleteTorrent]
  );

  const rowKey = (row: TorrentItem[]) => row.map((t) => t.id).join('-');
  const chunkedByTab = useMemo(() => {
    const next = {} as Record<TorrentTab, TorrentItem[][]>;
    for (const tab of TORRENT_TABS) next[tab.key] = chunk(dataByTab[tab.key], columns);
    return next;
  }, [dataByTab, columns]);

  const activeTorrents = dataByTab[activeKey];
  const totalDown = activeTorrents.reduce((sum, t) => sum + t.dlspeed, 0);
  const totalUp = activeTorrents.reduce((sum, t) => sum + t.upspeed, 0);

  if (!config) return <NotConfigured service={notConfiguredLabel} tint={tint} />;

  const renderRow = (row: TorrentItem[]) => (
    <View style={styles.row}>
      {row.map((item) => (
        <TorrentRow key={item.id} item={item} busy={busy} tint={tint} onOpenMenu={openItemMenu} />
      ))}
    </View>
  );

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
          headerTitle: () => <HeaderTitle icon={SECTION_META[sectionId].icon} tint={tint} title={names[sectionId]} />,
        }}
      />
      <View style={styles.statusBar}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TORRENT_TABS.map((t) => t.label)}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={tint}
          />
        </View>
        <View style={styles.statusRight}>
          <View style={styles.statusTextGroup}>
            <Text style={[styles.statusValue, { color: tint }]}>
              {activeTorrents.length} torrent{activeTorrents.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.statusSubtext}>
              ↓ {formatSpeed(totalDown)} · ↑ {formatSpeed(totalUp)}
            </Text>
          </View>
          <WebRefreshButton onPress={refreshActiveTab} tint={tint} />
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
        onScroll={onPagerScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {TORRENT_TABS.map((tab) => (
          <View key={tab.key} style={[styles.page, { width }]}>
            <FlatList
              data={chunkedByTab[tab.key]}
              keyExtractor={rowKey}
              refreshControl={<RefreshControl tintColor={tint} refreshing={loading} onRefresh={() => load(activeKey)} />}
              contentContainerStyle={[dataByTab[tab.key].length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
              ListEmptyComponent={!loading ? <Text style={styles.empty}>{errorByTab[tab.key] ?? tab.empty}</Text> : null}
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
  // `color` is set inline per-render (tint depends on which client's active).
  statusValue: { fontSize: 16, fontWeight: '700' },
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
  // `backgroundColor` is set inline per-render (tint depends on which client's active).
  fill: { height: 4, borderRadius: 2 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  menuButton: { padding: 6 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
