import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { sabnzbdApi, SabnzbdHistoryItem, SabnzbdQueueItem } from '../../src/api/sabnzbd';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { Badge } from '../../src/components/Badge';
import { NotConfigured } from '../../src/components/NotConfigured';
import { SwipeTabBar } from '../../src/components/SwipeTabBar';
import { WebRefreshButton } from '../../src/components/WebRefreshButton';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { formatMb } from '../../src/lib/format';
import { chunk, useColumns } from '../../src/lib/responsive';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Downloads screen (SABnzbd) - Queue/History swipeable tabs, mirroring
// Torrents' structure closely (paged Animated.ScrollView + SwipeTabBar +
// responsive column chunking) but with SABnzbd-specific data shapes and a
// prominent floating pause/resume button instead of per-tab bulk actions.
const TABS = ['Queue', 'History'] as const;

// Failed history items get the danger badge color; everything else
// (Completed, etc) is treated as a success state.
function historyTone(status: string) {
  if (status === 'Failed') return 'danger' as const;
  return 'success' as const;
}

export default function DownloadsScreen() {
  const { servers } = useServers();
  const config = servers.sabnzbd;
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useRef(new Animated.Value(0)).current;

  const [items, setItems] = useState<SabnzbdQueueItem[]>([]);
  const [history, setHistory] = useState<SabnzbdHistoryItem[]>([]);
  const [speed, setSpeed] = useState('');
  const [paused, setPaused] = useState(false);
  const [queueTimeleft, setQueueTimeleft] = useState('');
  const [queueSizeleft, setQueueSizeleft] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  // History only needs to load once per screen visit (on first switch to
  // that tab), not on every focus - this flag prevents a redundant refetch.
  const historyLoaded = useRef(false);

  // `opts.silent` skips toggling `loading` (see the poll effect below for
  // why that matters).
  const loadQueue = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!config) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const queueData = await sabnzbdApi.getQueue(config);
        setItems(queueData.queue.slots);
        setSpeed(queueData.queue.speed);
        setPaused(queueData.queue.paused);
        setQueueTimeleft(queueData.queue.timeleft);
        setQueueSizeleft(queueData.queue.sizeleft);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load queue');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [config]
  );

  const loadHistory = useCallback(async () => {
    if (!config) return;
    setLoadingHistory(true);
    try {
      const historyData = await sabnzbdApi.getHistory(config);
      setHistory(historyData.history.slots);
      historyLoaded.current = true;
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingHistory(false);
    }
  }, [config]);

  useFocusEffect(
    useCallback(() => {
      loadQueue();
      if (activeTab === 1 && !historyLoaded.current) loadHistory();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadQueue])
  );

  // Poll while the Queue tab is visible so progress/speed update live instead
  // of only refreshing on focus or manual pull-to-refresh. Silent - it must
  // not toggle `loading`, since that's bound to RefreshControl's `refreshing`
  // prop and would otherwise make the pull-to-refresh spinner visibly pop in
  // and bounce the list every 3 seconds even though nobody pulled it.
  useFocusEffect(
    useCallback(() => {
      if (activeTab !== 0) return;
      const interval = setInterval(() => loadQueue({ silent: true }), 3000);
      return () => clearInterval(interval);
    }, [activeTab, loadQueue])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.dispatch(DrawerActions.openDrawer());
        return true;
      });
      return () => sub.remove();
    }, [navigation])
  );

  // Central place to react to the active tab changing, whichever triggered
  // it (tapping a tab vs swiping) - lazily loads History on first visit.
  const handleTabChange = (index: number) => {
    setActiveTab(index);
    if (index === 1 && !historyLoaded.current) loadHistory();
  };

  // Tab-tap path: updates state immediately and animates the paged
  // ScrollView to match.
  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` calls whichever load function the
  // currently-active tab actually needs, mirroring what each tab's own
  // `RefreshControl.onRefresh` already does.
  const refreshActiveTab = () => {
    if (activeTab === 1) loadHistory();
    else loadQueue();
  };

  // Swipe path: fires once the paged scroll settles, deriving the resulting
  // tab index from the final scroll offset.
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  // Global pause/resume for the whole queue (the floating round button),
  // distinct from pausing/resuming one item via its "..." menu below.
  const togglePause = async () => {
    if (!config) return;
    setBusy(true);
    try {
      if (paused) await sabnzbdApi.resumeQueue(config);
      else await sabnzbdApi.pauseQueue(config);
      await loadQueue();
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Reorders one queue item by one position; a no-op past either end of
  // the queue.
  const moveItem = async (item: SabnzbdQueueItem, direction: 'up' | 'down') => {
    if (!config) return;
    const targetIndex = item.index + (direction === 'up' ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= items.length) return;
    try {
      await sabnzbdApi.reorderQueue(config, item.nzo_id, targetIndex);
      await loadQueue();
    } catch (e) {
      alert('Failed to reorder', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Builds the per-item "..." action sheet: Pause/Resume (whichever
  // applies) plus a confirm-then-Delete flow.
  const openItemMenu = (item: SabnzbdQueueItem) => {
    if (!config) return;
    const isPaused = item.status === 'Paused';
    const options: ActionSheetOption[] = [
      {
        label: isPaused ? 'Resume' : 'Pause',
        onPress: async () => {
          try {
            if (isPaused) await sabnzbdApi.resumeItem(config, item.nzo_id);
            else await sabnzbdApi.pauseItem(config, item.nzo_id);
            await loadQueue();
          } catch (e) {
            alert('Failed', e instanceof Error ? e.message : 'Unknown error');
          }
        },
      },
      {
        label: 'Delete',
        destructive: true,
        onPress: () => {
          alert('Delete Download', `Remove "${item.filename}" from the queue?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await sabnzbdApi.deleteFromQueue(config, item.nzo_id);
                  await loadQueue();
                } catch (e) {
                  alert('Delete failed', e instanceof Error ? e.message : 'Unknown error');
                }
              },
            },
          ]);
        },
      },
    ];
    setMenu({ title: item.filename, options });
  };

  // Chunked into rows of `columns` so wide/unfolded screens show a
  // multi-column grid instead of one very wide single-column list. Reorder
  // still operates on the item's own SABnzbd queue index, unaffected by
  // how it's currently chunked for display.
  const rowKey = (row: { nzo_id: string }[]) => row.map((r) => r.nzo_id).join('-');
  const chunkedItems = useMemo(() => chunk(items, columns), [items, columns]);
  const chunkedHistory = useMemo(() => chunk(history, columns), [history, columns]);
  // Map instead of items.findIndex() inside renderItem - this list re-renders
  // every 3s from the queue poll, and findIndex per card was an O(n) scan
  // repeated for every visible card on every poll tick.
  const indexByNzoId = useMemo(() => new Map(items.map((it, i) => [it.nzo_id, i])), [items]);

  if (!config) return <NotConfigured service="SABnzbd" tint={colors.sabnzbd} />;

  const statusLabel = paused ? 'Paused' : items.length === 0 ? 'Idle' : `${speed}B/s`;

  return (
    <View style={styles.screen}>
      <View style={styles.statusBar}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TABS}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={colors.sabnzbd}
          />
        </View>
        <View style={styles.statusRight}>
          <View style={styles.statusTextGroup}>
            <Text style={styles.statusValue}>{statusLabel}</Text>
            {items.length > 0 ? (
              <Text style={styles.statusSubtext}>
                {queueTimeleft || '0:00:00'} · {queueSizeleft || '0 B'} left
              </Text>
            ) : null}
          </View>
          <WebRefreshButton onPress={refreshActiveTab} tint={colors.sabnzbd} />
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
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedItems}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.sabnzbd} refreshing={loading} onRefresh={loadQueue} />}
            contentContainerStyle={[items.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{error ?? 'Your queue is empty.'}</Text> : null}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const index = indexByNzoId.get(item.nzo_id) ?? -1;
                  return (
                    <View key={item.nzo_id} style={[styles.card, styles.rowItem]}>
                      <View style={styles.cardRow}>
                        <View style={styles.cardInfo}>
                          <Text style={styles.title} numberOfLines={1}>
                            {item.filename}
                          </Text>
                          <View style={styles.track}>
                            <View
                              style={[styles.fill, { width: `${Math.min(100, Math.max(0, Number(item.percentage) || 0))}%` }]}
                            />
                          </View>
                          <Text style={styles.subtitle}>
                            {item.status} · {item.timeleft || '—'} left
                            {item.status.toLowerCase() === 'downloading' && !paused && speed ? ` · ${speed}B/s` : ''}
                          </Text>
                          <Text style={styles.subtitle}>
                            {formatMb(String(Number(item.mb) - Number(item.mbleft)))} / {formatMb(item.mb)} MB · {item.percentage}%
                          </Text>
                        </View>
                        <View style={styles.itemActions}>
                          {items.length > 1 ? (
                            <View style={styles.reorderColumn}>
                              <TouchableOpacity
                                style={styles.reorderButton}
                                disabled={index === 0}
                                onPress={() => moveItem(item, 'up')}
                              >
                                <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.textMuted : colors.textPrimary} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.reorderButton}
                                disabled={index === items.length - 1}
                                onPress={() => moveItem(item, 'down')}
                              >
                                <Ionicons
                                  name="chevron-down"
                                  size={18}
                                  color={index === items.length - 1 ? colors.textMuted : colors.textPrimary}
                                />
                              </TouchableOpacity>
                            </View>
                          ) : null}
                          <TouchableOpacity style={styles.menuButton} onPress={() => openItemMenu(item)}>
                            <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          />
        </View>
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedHistory}
            keyExtractor={rowKey}
            refreshControl={<RefreshControl tintColor={colors.sabnzbd} refreshing={loadingHistory} onRefresh={loadHistory} />}
            contentContainerStyle={[history.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={!loadingHistory ? <Text style={styles.empty}>No history yet.</Text> : null}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => (
                  <View key={item.nzo_id} style={[styles.card, styles.rowItem]}>
                    <Text style={styles.title} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={item.status} tone={historyTone(item.status)} />
                      <Text style={styles.subtitle}>{item.storage}</Text>
                    </View>
                    {item.status === 'Failed' && item.fail_message ? (
                      <Text style={styles.failMessage}>{item.fail_message}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          />
        </View>
      </Animated.ScrollView>

      <View style={styles.pauseBar}>
        <TouchableOpacity style={styles.pauseButton} onPress={togglePause} disabled={busy}>
          <Ionicons name={paused ? 'play' : 'pause'} size={28} color="#1A1300" />
        </TouchableOpacity>
      </View>

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
  tabBar: {},
  // See app/(drawer)/index.tsx's identical comment - fixes "can't scroll"
  // on the web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusTextGroup: { alignItems: 'flex-end' },
  statusValue: { color: colors.sabnzbd, fontSize: 16, fontWeight: '700' },
  statusSubtext: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 12, paddingBottom: 100, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardInfo: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.sabnzbd },
  // flexShrink alone isn't enough on the web build (react-native-web is
  // real CSS flexbox under the hood, where flex items default to
  // `min-width: auto` - that overrides flexShrink and refuses to shrink
  // below the text's own unwrapped content width, so long unbroken paths
  // still pushed past the card). minWidth: 0 removes that floor, letting
  // it actually shrink/wrap to the remaining row width. Matters for
  // History's long file paths sitting next to the status Badge in
  // `badgeRow` (a flex row); harmless for the Queue tab's plain
  // single-line usages inside a flex:1 column.
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 8, flexShrink: 1, minWidth: 0 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  reorderColumn: { justifyContent: 'center' },
  reorderButton: { padding: 4 },
  menuButton: { padding: 6 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  failMessage: { color: colors.danger, fontSize: 12, marginTop: 8 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  pauseBar: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  pauseButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sabnzbd,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
